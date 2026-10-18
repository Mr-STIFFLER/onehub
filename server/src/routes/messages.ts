import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { hub } from '../gateway.js';
import {
  authenticate,
  HttpError,
  idParams,
  MESSAGE_SELECT,
  messageOut,
  parse,
  publicUser,
  userId,
  uuid,
  type MessageRow,
  type UserRow,
} from '../http.js';
import { has, NotFoundError, P, PermissionError, require } from '../permissions.js';

const content = z.string().trim().min(1, 'Message is empty').max(4000, 'Messages are limited to 4000 characters');
const page = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

async function channelFor(channelId: string) {
  const ch = await one('SELECT * FROM channels WHERE id = $1', [channelId]);
  if (!ch) throw new NotFoundError('Channel not found');
  return ch;
}

async function assertDmParticipant(dmId: string, me: string) {
  const ok = await one('SELECT 1 FROM dm_participants WHERE dm_id = $1 AND user_id = $2', [dmId, me]);
  if (!ok) throw new NotFoundError('Conversation not found');
}

async function isBlockedEitherWay(a: string, b: string) {
  return !!(await one(
    'SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)',
    [a, b],
  ));
}

async function fetchMessage(id: string) {
  const row = await one<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  if (!row) throw new NotFoundError('Message not found');
  return row;
}

async function broadcastMessage(row: MessageRow, t: string, d: unknown = messageOut(row)) {
  if (row.channel_id) {
    const ch = await channelFor(row.channel_id);
    await hub.toCommunity(ch.community_id, { t, d });
  } else if (row.dm_id) {
    await hub.toDm(row.dm_id, { t, d });
  }
}

export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- community channels ----

  app.get('/channels/:id/messages', async (req) => {
    const { id } = parse(idParams, req.params);
    const { before, limit } = parse(page, req.query);
    const ch = await channelFor(id);
    await require(ch.community_id, userId(req), P.VIEW_CHANNELS);
    const rows = await q<MessageRow>(
      `${MESSAGE_SELECT} WHERE m.channel_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [id, before ?? null, limit],
    );
    return rows.reverse().map(messageOut);
  });

  app.post('/channels/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const body = parse(z.object({ content }), req.body);
    const ch = await channelFor(id);
    if (ch.kind === 'voice') throw new HttpError(400, 'Voice channels do not have a text chat');
    const perms = await require(ch.community_id, me, P.VIEW_CHANNELS, P.SEND_MESSAGES);
    if (ch.kind === 'announcement' && !has(perms, P.MANAGE_CHANNELS)) {
      throw new PermissionError('Only staff can post in announcement channels');
    }
    const { id: msgId } = (await one('INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, $3) RETURNING id', [
      id,
      me,
      body.content,
    ]))!;
    const row = await fetchMessage(msgId);
    await broadcastMessage(row, 'MESSAGE_CREATE');
    return messageOut(row);
  });

  app.post('/channels/:id/typing', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const ch = await channelFor(id);
    await require(ch.community_id, me, P.SEND_MESSAGES);
    const u = await one<UserRow>('SELECT * FROM users WHERE id = $1', [me]);
    await hub.toCommunity(ch.community_id, {
      t: 'TYPING_START',
      d: { channelId: id, userId: me, displayName: u?.display_name },
    });
    return { ok: true };
  });

  // ---- edit / delete (channels and DMs) ----

  app.patch('/messages/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const body = parse(z.object({ content }), req.body);
    const row = await fetchMessage(id);
    if (row.author_id !== me) throw new PermissionError('You can only edit your own messages');
    await q('UPDATE messages SET content = $2, edited_at = now() WHERE id = $1', [id, body.content]);
    const updated = await fetchMessage(id);
    await broadcastMessage(updated, 'MESSAGE_UPDATE');
    return messageOut(updated);
  });

  app.delete('/messages/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const row = await fetchMessage(id);
    if (row.author_id !== me) {
      if (!row.channel_id) throw new PermissionError();
      const ch = await channelFor(row.channel_id);
      await require(ch.community_id, me, P.MANAGE_MESSAGES);
      await q('INSERT INTO audit_log (community_id, actor_id, action, detail) VALUES ($1, $2, $3, $4)', [
        ch.community_id,
        me,
        'message.delete',
        JSON.stringify({ authorId: row.author_id, channel: ch.name }),
      ]);
    }
    await q('DELETE FROM messages WHERE id = $1', [id]);
    await broadcastMessage(row, 'MESSAGE_DELETE', { id, channelId: row.channel_id, dmId: row.dm_id });
    return { ok: true };
  });

  // ---- direct messages ----

  app.get('/dms', async (req) => {
    const me = userId(req);
    const rows = await q(
      `SELECT d.id, u.id AS user_id, u.username, u.display_name, u.accent, u.bio, u.status_text,
              (SELECT max(created_at) FROM messages WHERE dm_id = d.id) AS last_at
       FROM dm_threads d
       JOIN dm_participants me ON me.dm_id = d.id AND me.user_id = $1
       JOIN dm_participants other ON other.dm_id = d.id AND other.user_id <> $1
       JOIN users u ON u.id = other.user_id
       ORDER BY last_at DESC NULLS LAST, d.created_at DESC`,
      [me],
    );
    return rows.map((r) => ({
      id: r.id,
      lastMessageAt: r.last_at,
      user: { ...publicUser({ ...r, id: r.user_id } as UserRow), online: hub.isOnline(r.user_id) },
    }));
  });

  app.post('/dms', async (req) => {
    const me = userId(req);
    const { userId: other } = parse(z.object({ userId: uuid }), req.body);
    if (other === me) throw new HttpError(400, 'You cannot message yourself');
    const target = await one<UserRow>('SELECT * FROM users WHERE id = $1', [other]);
    if (!target) throw new NotFoundError('User not found');
    if (await isBlockedEitherWay(me, other)) throw new PermissionError('You cannot message this person');
    const pairKey = [me, other].sort().join(':');
    const dmId = await tx(async (c) => {
      const existing = await c.query('SELECT id FROM dm_threads WHERE pair_key = $1', [pairKey]);
      if (existing.rows[0]) return existing.rows[0].id as string;
      const { rows } = await c.query('INSERT INTO dm_threads (pair_key) VALUES ($1) RETURNING id', [pairKey]);
      await c.query('INSERT INTO dm_participants VALUES ($1, $2), ($1, $3)', [rows[0].id, me, other]);
      return rows[0].id as string;
    });
    return { id: dmId, lastMessageAt: null, user: { ...publicUser(target), online: hub.isOnline(other) } };
  });

  app.get('/dms/:id/messages', async (req) => {
    const { id } = parse(idParams, req.params);
    const { before, limit } = parse(page, req.query);
    await assertDmParticipant(id, userId(req));
    const rows = await q<MessageRow>(
      `${MESSAGE_SELECT} WHERE m.dm_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [id, before ?? null, limit],
    );
    return rows.reverse().map(messageOut);
  });

  app.post('/dms/:id/messages', { config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const body = parse(z.object({ content }), req.body);
    await assertDmParticipant(id, me);
    const other = await one<{ user_id: string }>('SELECT user_id FROM dm_participants WHERE dm_id = $1 AND user_id <> $2', [
      id,
      me,
    ]);
    if (other && (await isBlockedEitherWay(me, other.user_id))) {
      throw new PermissionError('You cannot message this person');
    }
    const { id: msgId } = (await one('INSERT INTO messages (dm_id, author_id, content) VALUES ($1, $2, $3) RETURNING id', [
      id,
      me,
      body.content,
    ]))!;
    const row = await fetchMessage(msgId);
    await broadcastMessage(row, 'MESSAGE_CREATE');
    return messageOut(row);
  });
}
