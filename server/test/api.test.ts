import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { migrate, pool } from '../src/db.js';

let base = '';
let wsBase = '';
let app: Awaited<ReturnType<typeof buildApp>>;

type Session = { token: string; user: { id: string; username: string } };

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const suffix = Math.random().toString(36).slice(2, 7);
async function register(name: string): Promise<Session> {
  const r = await api('/auth/register', { body: { username: `${name}_${suffix}`, password: 'correct-horse', displayName: name } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

function connect(token: string) {
  const ws = new WebSocket(`${wsBase}/gateway?token=${token}`);
  const events: { t: string; d: any }[] = [];
  ws.on('message', (raw) => {
    const s = raw.toString();
    if (s !== 'pong') events.push(JSON.parse(s));
  });
  const ready = new Promise<void>((res) => ws.on('message', () => res()));
  const waitFor = async (t: string, pred: (d: any) => boolean = () => true) => {
    for (let i = 0; i < 50; i++) {
      const e = events.find((e) => e.t === t && pred(e.d));
      if (e) return e.d;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`timed out waiting for ${t}`);
  };
  return { ws, events, ready, waitFor };
}

before(async () => {
  await migrate();
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  wsBase = `ws://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  await pool.end();
});

describe('ONEHUB core API', () => {
  let alice: Session, bob: Session, carol: Session;
  let communityId: string, generalId: string, welcomeId: string, everyoneRole: string, modRole: string;

  it('registers and authenticates users', async () => {
    alice = await register('alice');
    bob = await register('bob');
    carol = await register('carol');
    const dup = await api('/auth/register', { body: { username: `alice_${suffix}`, password: 'correct-horse' } });
    assert.equal(dup.status, 409);
    const bad = await api('/auth/login', { body: { username: `alice_${suffix}`, password: 'wrong-password' } });
    assert.equal(bad.status, 401);
    const ok = await api('/auth/login', { body: { username: `alice_${suffix}`, password: 'correct-horse' } });
    assert.equal(ok.status, 200);
    assert.equal((await api('/me')).status, 401);
    const me = await api('/me', { token: alice.token });
    assert.equal(me.data.displayName, 'alice');
  });

  it('creates a community with default channels and roles', async () => {
    const r = await api('/communities', { token: alice.token, body: { name: 'Night Raid' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    communityId = r.data.id;
    generalId = r.data.channels.find((c: any) => c.name === 'general').id;
    welcomeId = r.data.channels.find((c: any) => c.kind === 'announcement').id;
    everyoneRole = r.data.roles.find((x: any) => x.isDefault).id;
    modRole = r.data.roles.find((x: any) => x.name === 'Moderator').id;
    assert.ok(r.data.channels.some((c: any) => c.kind === 'voice'));
    assert.equal((await api(`/communities/${communityId}`, { token: bob.token })).status, 404);
  });

  it('joins through an invite and streams messages in real time', async () => {
    const inv = await api(`/communities/${communityId}/invites`, { token: alice.token, body: { maxUses: 5 } });
    assert.equal(inv.status, 200);
    const preview = await api(`/invites/${inv.data.code}`, { token: bob.token });
    assert.equal(preview.data.community.name, 'Night Raid');
    assert.equal((await api(`/invites/${inv.data.code}/join`, { token: bob.token, method: 'POST' })).status, 200);
    assert.equal((await api(`/invites/${inv.data.code}/join`, { token: carol.token, method: 'POST' })).status, 200);

    const gw = connect(alice.token);
    await gw.ready;
    const sent = await api(`/channels/${generalId}/messages`, { token: bob.token, body: { content: 'gg wp' } });
    assert.equal(sent.status, 200);
    const evt = await gw.waitFor('MESSAGE_CREATE', (d) => d.id === sent.data.id);
    assert.equal(evt.content, 'gg wp');
    assert.equal(evt.author.displayName, 'bob');

    const edited = await api(`/messages/${sent.data.id}`, { token: bob.token, method: 'PATCH', body: { content: 'gg ez' } });
    assert.equal(edited.data.content, 'gg ez');
    assert.ok(edited.data.editedAt);
    assert.equal((await api(`/messages/${sent.data.id}`, { token: carol.token, method: 'PATCH', body: { content: 'x' } })).status, 403);

    const history = await api(`/channels/${generalId}/messages`, { token: carol.token });
    assert.equal(history.data.at(-1).content, 'gg ez');
    gw.ws.close();
  });

  it('enforces permissions for announcements, deletes and channel management', async () => {
    assert.equal((await api(`/channels/${welcomeId}/messages`, { token: bob.token, body: { content: 'hi' } })).status, 403);
    assert.equal((await api(`/channels/${welcomeId}/messages`, { token: alice.token, body: { content: 'Welcome!' } })).status, 200);
    const m = await api(`/channels/${generalId}/messages`, { token: carol.token, body: { content: 'spam spam' } });
    assert.equal((await api(`/messages/${m.data.id}`, { token: bob.token, method: 'DELETE' })).status, 403);
    assert.equal((await api(`/communities/${communityId}/channels`, { token: bob.token, body: { name: 'x', kind: 'text' } })).status, 403);

    // Give Bob the Moderator role; now he can moderate messages but not manage channels.
    assert.equal((await api(`/communities/${communityId}/members/${bob.user.id}/roles/${modRole}`, { token: alice.token, method: 'PUT' })).status, 200);
    assert.equal((await api(`/messages/${m.data.id}`, { token: bob.token, method: 'DELETE' })).status, 200);
    assert.equal((await api(`/communities/${communityId}/channels`, { token: bob.token, body: { name: 'x', kind: 'text' } })).status, 403);
    const ch = await api(`/communities/${communityId}/channels`, { token: alice.token, body: { name: 'Strat Talk', kind: 'text' } });
    assert.equal(ch.data.name, 'strat-talk');
  });

  it('stops privilege escalation through roles', async () => {
    // Bob (moderator) cannot create roles at all.
    assert.equal((await api(`/communities/${communityId}/roles`, { token: bob.token, body: { name: 'God' } })).status, 403);
    // Removing SEND_MESSAGES from @everyone silences Carol.
    assert.equal((await api(`/roles/${everyoneRole}`, { token: alice.token, method: 'PATCH', body: { permissions: '1' } })).status, 200);
    assert.equal((await api(`/channels/${generalId}/messages`, { token: carol.token, body: { content: 'hello?' } })).status, 403);
    assert.equal((await api(`/roles/${everyoneRole}`, { token: alice.token, method: 'PATCH', body: { permissions: String(1 | 2 | 128 | 256 | 512 | 1024) } })).status, 200);
    assert.equal((await api(`/channels/${generalId}/messages`, { token: carol.token, body: { content: 'back' } })).status, 200);
  });

  it('supports direct messages and blocking', async () => {
    const dm = await api('/dms', { token: bob.token, body: { userId: carol.user.id } });
    assert.equal(dm.status, 200);
    const again = await api('/dms', { token: carol.token, body: { userId: bob.user.id } });
    assert.equal(again.data.id, dm.data.id, 'the same pair reuses one conversation');
    assert.equal((await api(`/dms/${dm.data.id}/messages`, { token: bob.token, body: { content: 'duo queue?' } })).status, 200);
    assert.equal((await api(`/dms/${dm.data.id}/messages`, { token: alice.token })).status, 404);
    const list = await api('/dms', { token: carol.token });
    assert.equal(list.data[0].user.id, bob.user.id);

    assert.equal((await api(`/blocks/${bob.user.id}`, { token: carol.token, method: 'PUT' })).status, 200);
    assert.equal((await api(`/dms/${dm.data.id}/messages`, { token: bob.token, body: { content: 'hello?' } })).status, 403);
    assert.equal((await api(`/blocks/${bob.user.id}`, { token: carol.token, method: 'DELETE' })).status, 200);
    assert.equal((await api(`/dms/${dm.data.id}/messages`, { token: bob.token, body: { content: 'ok' } })).status, 200);
  });

  it('files reports that moderators can review', async () => {
    const m = await api(`/channels/${generalId}/messages`, { token: carol.token, body: { content: 'rude thing' } });
    const rep = await api('/reports', { token: alice.token, body: { messageId: m.data.id, reason: 'harassment' } });
    assert.equal(rep.status, 200);
    const list = await api(`/communities/${communityId}/reports`, { token: bob.token });
    assert.ok(list.data.some((r: any) => r.id === rep.data.id && r.messageContent === 'rude thing'));
    assert.equal((await api(`/communities/${communityId}/reports`, { token: carol.token })).status, 403);
    assert.equal((await api(`/reports/${rep.data.id}`, { token: bob.token, method: 'PATCH', body: { status: 'actioned' } })).status, 200);
  });

  it('kicks and bans with rank checks', async () => {
    // Bob (moderator) cannot ban the owner, and Carol cannot kick anyone.
    assert.equal((await api(`/communities/${communityId}/members/${alice.user.id}/ban`, { token: bob.token, body: {} })).status, 403);
    assert.equal((await api(`/communities/${communityId}/members/${bob.user.id}/kick`, { token: carol.token, body: {} })).status, 403);
    assert.equal((await api(`/communities/${communityId}/members/${carol.user.id}/ban`, { token: bob.token, body: { reason: 'spam' } })).status, 200);
    assert.equal((await api(`/communities/${communityId}`, { token: carol.token })).status, 404);
    const inv = await api(`/communities/${communityId}/invites`, { token: alice.token, body: {} });
    assert.equal((await api(`/invites/${inv.data.code}/join`, { token: carol.token, method: 'POST' })).status, 403);
    const audit = await api(`/communities/${communityId}/audit`, { token: alice.token });
    assert.ok(audit.data.some((a: any) => a.action === 'member.ban'));
  });

  it('reports voice as unconfigured without LiveKit credentials', async () => {
    const snap = await api(`/communities/${communityId}`, { token: bob.token });
    const voiceId = snap.data.channels.find((c: any) => c.kind === 'voice').id;
    const r = await api(`/channels/${voiceId}/voice/join`, { token: bob.token, method: 'POST' });
    if (process.env.LIVEKIT_URL) assert.equal(r.status, 200);
    else assert.equal(r.status, 503);
  });
});
