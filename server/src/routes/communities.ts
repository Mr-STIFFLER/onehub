import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { hub } from '../gateway.js';
import { authenticate, HttpError, idParams, parse, userId, uuid } from '../http.js';
import { DEFAULT_EVERYONE, MODERATOR, NotFoundError, P, PermissionError, rank, require } from '../permissions.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\s+/g, '-'))
  .pipe(z.string().regex(/^[a-z0-9-_]{1,32}$/, 'Channel names are 1–32 letters, numbers or dashes'));

async function audit(communityId: string, actorId: string, action: string, detail: object = {}) {
  await q('INSERT INTO audit_log (community_id, actor_id, action, detail) VALUES ($1, $2, $3, $4)', [
    communityId,
    actorId,
    action,
    JSON.stringify(detail),
  ]);
}

/** Full community snapshot as seen by one member. */
async function snapshot(communityId: string, viewerId: string) {
  const perms = await require(communityId, viewerId, P.VIEW_CHANNELS);
  const community = (await one('SELECT * FROM communities WHERE id = $1', [communityId]))!;
  const [channels, roles, members] = await Promise.all([
    q('SELECT * FROM channels WHERE community_id = $1 ORDER BY category, position, created_at', [communityId]),
    q('SELECT * FROM roles WHERE community_id = $1 ORDER BY position DESC', [communityId]),
    q(
      `SELECT u.id, u.username, u.display_name, u.accent, u.status_text, m.nickname, m.joined_at,
              COALESCE(array_agg(mr.role_id) FILTER (WHERE mr.role_id IS NOT NULL), '{}') AS role_ids
       FROM members m JOIN users u ON u.id = m.user_id
       LEFT JOIN member_roles mr ON mr.community_id = m.community_id AND mr.user_id = m.user_id
       WHERE m.community_id = $1
       GROUP BY u.id, m.nickname, m.joined_at
       ORDER BY lower(u.display_name)`,
      [communityId],
    ),
  ]);
  const voiceIds = channels.filter((c) => c.kind === 'voice').map((c) => c.id);
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    accent: community.accent,
    ownerId: community.owner_id,
    myPermissions: perms.toString(),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      category: c.category,
      topic: c.topic,
      position: c.position,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: String(r.permissions),
      position: r.position,
      isDefault: r.is_default,
    })),
    members: members.map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.nickname ?? m.display_name,
      accent: m.accent,
      statusText: m.status_text,
      roleIds: m.role_ids,
      online: hub.isOnline(m.id),
    })),
    voice: hub.voiceSnapshot(voiceIds),
  };
}

async function broadcastSnapshotChange(communityId: string, type: string, d: unknown) {
  await hub.toCommunity(communityId, { t: type, d: { communityId, ...(d as object) } });
}

export async function communityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/communities', async (req) => {
    const rows = await q(
      `SELECT c.id, c.name, c.accent, c.description FROM communities c
       JOIN members m ON m.community_id = c.id WHERE m.user_id = $1 ORDER BY m.joined_at`,
      [userId(req)],
    );
    return rows;
  });

  app.post('/communities', async (req) => {
    const me = userId(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(48),
        description: z.string().max(240).optional(),
        accent: hex.optional(),
      }),
      req.body,
    );
    const id = await tx(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO communities (name, description, accent, owner_id) VALUES ($1, $2, COALESCE($3, $4), $5) RETURNING id',
        [body.name, body.description ?? '', body.accent, '#C9A961', me],
      );
      const cid = rows[0].id as string;
      await c.query('INSERT INTO members (community_id, user_id) VALUES ($1, $2)', [cid, me]);
      await c.query(
        `INSERT INTO roles (community_id, name, color, permissions, position, is_default) VALUES
         ($1, '@everyone', '#9CA3AF', $2, 0, true),
         ($1, 'Moderator', '#7FB3D5', $3, 1, false)`,
        [cid, DEFAULT_EVERYONE.toString(), MODERATOR.toString()],
      );
      await c.query(
        `INSERT INTO channels (community_id, name, kind, category, position, topic) VALUES
         ($1, 'welcome', 'announcement', 'Information', 0, 'Start here'),
         ($1, 'general', 'text', 'Text', 0, 'Talk about anything'),
         ($1, 'clips', 'text', 'Text', 1, 'Share your best plays'),
         ($1, 'Lounge', 'voice', 'Voice', 0, ''),
         ($1, 'Squad', 'voice', 'Voice', 1, '')`,
        [cid],
      );
      return cid;
    });
    await audit(id, me, 'community.create', { name: body.name });
    return snapshot(id, me);
  });

  app.get('/communities/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    return snapshot(id, userId(req));
  });

  app.patch('/communities/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    await require(id, me, P.MANAGE_COMMUNITY);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(48).optional(),
        description: z.string().max(240).optional(),
        accent: hex.optional(),
      }),
      req.body,
    );
    await q(
      `UPDATE communities SET name = COALESCE($2, name), description = COALESCE($3, description),
       accent = COALESCE($4, accent) WHERE id = $1`,
      [id, body.name, body.description, body.accent],
    );
    await audit(id, me, 'community.update', body);
    await broadcastSnapshotChange(id, 'COMMUNITY_UPDATE', {});
    return snapshot(id, me);
  });

  app.delete('/communities/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const c = await one('SELECT owner_id FROM communities WHERE id = $1', [id]);
    if (!c) throw new NotFoundError();
    if (c.owner_id !== userId(req)) throw new PermissionError('Only the owner can delete a community');
    await broadcastSnapshotChange(id, 'COMMUNITY_DELETE', {});
    await q('DELETE FROM communities WHERE id = $1', [id]);
    return { ok: true };
  });

  app.post('/communities/:id/leave', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const c = await one('SELECT owner_id FROM communities WHERE id = $1', [id]);
    if (!c) throw new NotFoundError();
    if (c.owner_id === me) throw new HttpError(400, 'Transfer ownership or delete the community before leaving');
    await q('DELETE FROM members WHERE community_id = $1 AND user_id = $2', [id, me]);
    await broadcastSnapshotChange(id, 'MEMBER_LEAVE', { userId: me });
    return { ok: true };
  });

  app.post('/communities/:id/transfer', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const { userId: target } = parse(z.object({ userId: uuid }), req.body);
    const c = await one('SELECT owner_id FROM communities WHERE id = $1', [id]);
    if (!c || c.owner_id !== me) throw new PermissionError('Only the owner can transfer ownership');
    const member = await one('SELECT 1 FROM members WHERE community_id = $1 AND user_id = $2', [id, target]);
    if (!member) throw new HttpError(400, 'The new owner must be a member');
    await q('UPDATE communities SET owner_id = $2 WHERE id = $1', [id, target]);
    await audit(id, me, 'community.transfer', { to: target });
    await broadcastSnapshotChange(id, 'COMMUNITY_UPDATE', {});
    return { ok: true };
  });

  // ---- channels ----

  app.post('/communities/:id/channels', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    await require(id, me, P.MANAGE_CHANNELS);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(32),
        kind: z.enum(['text', 'voice', 'announcement']),
        category: z.string().trim().min(1).max(32).optional(),
        topic: z.string().max(240).optional(),
      }),
      req.body,
    );
    const name = body.kind === 'voice' ? body.name : parse(channelName, body.name);
    const category = body.category ?? (body.kind === 'voice' ? 'Voice' : 'Text');
    const pos = await one<{ n: number }>(
      'SELECT COALESCE(max(position) + 1, 0) AS n FROM channels WHERE community_id = $1 AND category = $2',
      [id, category],
    );
    const ch = (await one(
      `INSERT INTO channels (community_id, name, kind, category, topic, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, name, body.kind, category, body.topic ?? '', pos!.n],
    ))!;
    await audit(id, me, 'channel.create', { name, kind: body.kind });
    await broadcastSnapshotChange(id, 'CHANNELS_UPDATE', {});
    return ch;
  });

  app.patch('/channels/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const ch = await one('SELECT * FROM channels WHERE id = $1', [id]);
    if (!ch) throw new NotFoundError();
    await require(ch.community_id, me, P.MANAGE_CHANNELS);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(32).optional(),
        topic: z.string().max(240).optional(),
        category: z.string().trim().min(1).max(32).optional(),
      }),
      req.body,
    );
    const name = body.name && ch.kind !== 'voice' ? parse(channelName, body.name) : body.name;
    await q(
      'UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic), category = COALESCE($4, category) WHERE id = $1',
      [id, name, body.topic, body.category],
    );
    await audit(ch.community_id, me, 'channel.update', { id, ...body });
    await broadcastSnapshotChange(ch.community_id, 'CHANNELS_UPDATE', {});
    return { ok: true };
  });

  app.delete('/channels/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const ch = await one('SELECT * FROM channels WHERE id = $1', [id]);
    if (!ch) throw new NotFoundError();
    await require(ch.community_id, me, P.MANAGE_CHANNELS);
    await q('DELETE FROM channels WHERE id = $1', [id]);
    await audit(ch.community_id, me, 'channel.delete', { name: ch.name });
    await broadcastSnapshotChange(ch.community_id, 'CHANNELS_UPDATE', {});
    return { ok: true };
  });

  // ---- roles ----

  const roleBody = z.object({
    name: z.string().trim().min(1).max(32).optional(),
    color: hex.optional(),
    permissions: z.string().regex(/^\d+$/).optional(),
  });

  app.post('/communities/:id/roles', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const perms = await require(id, me, P.MANAGE_ROLES);
    const body = parse(roleBody.extend({ name: z.string().trim().min(1).max(32) }), req.body);
    const requested = BigInt(body.permissions ?? DEFAULT_EVERYONE.toString());
    if ((requested & perms) !== requested) throw new PermissionError('You cannot grant permissions you do not have');
    const myRank = await rank(id, me);
    const top = await one<{ n: number }>('SELECT COALESCE(max(position), 0) AS n FROM roles WHERE community_id = $1', [id]);
    // New roles sit just under the creator so they can manage them, never above.
    const position = Math.min(top!.n + 1, myRank === Number.MAX_SAFE_INTEGER ? top!.n + 1 : myRank);
    const role = (await one(
      'INSERT INTO roles (community_id, name, color, permissions, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, body.name, body.color ?? '#C9A961', requested.toString(), position],
    ))!;
    await audit(id, me, 'role.create', { name: body.name });
    await broadcastSnapshotChange(id, 'ROLES_UPDATE', {});
    return role;
  });

  async function loadManageableRole(roleId: string, me: string) {
    const role = await one('SELECT * FROM roles WHERE id = $1', [roleId]);
    if (!role) throw new NotFoundError('Role not found');
    const perms = await require(role.community_id, me, P.MANAGE_ROLES);
    if (!role.is_default && role.position >= (await rank(role.community_id, me))) {
      throw new PermissionError('You can only manage roles below your highest role');
    }
    return { role, perms };
  }

  app.patch('/roles/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const { role, perms } = await loadManageableRole(id, me);
    const body = parse(roleBody, req.body);
    if (body.permissions !== undefined) {
      const requested = BigInt(body.permissions);
      if ((requested & perms) !== requested) throw new PermissionError('You cannot grant permissions you do not have');
    }
    await q(
      'UPDATE roles SET name = COALESCE($2, name), color = COALESCE($3, color), permissions = COALESCE($4, permissions) WHERE id = $1',
      [id, role.is_default ? null : body.name, body.color, body.permissions],
    );
    await audit(role.community_id, me, 'role.update', { id, ...body });
    await broadcastSnapshotChange(role.community_id, 'ROLES_UPDATE', {});
    return { ok: true };
  });

  app.delete('/roles/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const { role } = await loadManageableRole(id, me);
    if (role.is_default) throw new HttpError(400, 'The @everyone role cannot be deleted');
    await q('DELETE FROM roles WHERE id = $1', [id]);
    await audit(role.community_id, me, 'role.delete', { name: role.name });
    await broadcastSnapshotChange(role.community_id, 'ROLES_UPDATE', {});
    return { ok: true };
  });

  app.put('/communities/:id/members/:userId/roles/:roleId', async (req) => {
    const p = parse(z.object({ id: uuid, userId: uuid, roleId: uuid }), req.params);
    const me = userId(req);
    const { role } = await loadManageableRole(p.roleId, me);
    if (role.community_id !== p.id || role.is_default) throw new HttpError(400, 'Invalid role');
    const member = await one('SELECT 1 FROM members WHERE community_id = $1 AND user_id = $2', [p.id, p.userId]);
    if (!member) throw new NotFoundError('Member not found');
    await q('INSERT INTO member_roles VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [p.id, p.userId, p.roleId]);
    await audit(p.id, me, 'member.role_add', { userId: p.userId, role: role.name });
    await broadcastSnapshotChange(p.id, 'MEMBERS_UPDATE', {});
    return { ok: true };
  });

  app.delete('/communities/:id/members/:userId/roles/:roleId', async (req) => {
    const p = parse(z.object({ id: uuid, userId: uuid, roleId: uuid }), req.params);
    const me = userId(req);
    const { role } = await loadManageableRole(p.roleId, me);
    await q('DELETE FROM member_roles WHERE community_id = $1 AND user_id = $2 AND role_id = $3', [p.id, p.userId, p.roleId]);
    await audit(p.id, me, 'member.role_remove', { userId: p.userId, role: role.name });
    await broadcastSnapshotChange(p.id, 'MEMBERS_UPDATE', {});
    return { ok: true };
  });

  // ---- moderation: kick / ban ----

  async function assertOutranks(communityId: string, me: string, target: string) {
    if (me === target) throw new HttpError(400, 'You cannot do that to yourself');
    const c = await one('SELECT owner_id FROM communities WHERE id = $1', [communityId]);
    if (c?.owner_id === target) throw new PermissionError('The owner cannot be removed');
    if ((await rank(communityId, target)) >= (await rank(communityId, me))) {
      throw new PermissionError('That member has an equal or higher role');
    }
  }

  app.post('/communities/:id/members/:userId/kick', async (req) => {
    const p = parse(z.object({ id: uuid, userId: uuid }), req.params);
    const me = userId(req);
    await require(p.id, me, P.KICK_MEMBERS);
    await assertOutranks(p.id, me, p.userId);
    await q('DELETE FROM members WHERE community_id = $1 AND user_id = $2', [p.id, p.userId]);
    hub.leaveAllVoice(p.userId);
    await audit(p.id, me, 'member.kick', { userId: p.userId });
    hub.send(p.userId, { t: 'COMMUNITY_DELETE', d: { communityId: p.id } });
    await broadcastSnapshotChange(p.id, 'MEMBER_LEAVE', { userId: p.userId });
    return { ok: true };
  });

  app.post('/communities/:id/members/:userId/ban', async (req) => {
    const p = parse(z.object({ id: uuid, userId: uuid }), req.params);
    const me = userId(req);
    const { reason } = parse(z.object({ reason: z.string().max(240).default('') }), req.body ?? {});
    await require(p.id, me, P.BAN_MEMBERS);
    await assertOutranks(p.id, me, p.userId);
    await tx(async (c) => {
      await c.query('DELETE FROM members WHERE community_id = $1 AND user_id = $2', [p.id, p.userId]);
      await c.query(
        'INSERT INTO bans (community_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [p.id, p.userId, me, reason],
      );
    });
    hub.leaveAllVoice(p.userId);
    await audit(p.id, me, 'member.ban', { userId: p.userId, reason });
    hub.send(p.userId, { t: 'COMMUNITY_DELETE', d: { communityId: p.id } });
    await broadcastSnapshotChange(p.id, 'MEMBER_LEAVE', { userId: p.userId });
    return { ok: true };
  });

  app.get('/communities/:id/bans', async (req) => {
    const { id } = parse(idParams, req.params);
    await require(id, userId(req), P.BAN_MEMBERS);
    return q(
      `SELECT b.user_id AS "userId", u.username, u.display_name AS "displayName", b.reason, b.created_at AS "createdAt"
       FROM bans b JOIN users u ON u.id = b.user_id WHERE b.community_id = $1 ORDER BY b.created_at DESC`,
      [id],
    );
  });

  app.delete('/communities/:id/bans/:userId', async (req) => {
    const p = parse(z.object({ id: uuid, userId: uuid }), req.params);
    const me = userId(req);
    await require(p.id, me, P.BAN_MEMBERS);
    await q('DELETE FROM bans WHERE community_id = $1 AND user_id = $2', [p.id, p.userId]);
    await audit(p.id, me, 'member.unban', { userId: p.userId });
    return { ok: true };
  });

  app.get('/communities/:id/audit', async (req) => {
    const { id } = parse(idParams, req.params);
    await require(id, userId(req), P.MANAGE_COMMUNITY);
    return q(
      `SELECT a.id, a.action, a.detail, a.created_at AS "createdAt", u.display_name AS "actor"
       FROM audit_log a JOIN users u ON u.id = a.actor_id WHERE a.community_id = $1 ORDER BY a.id DESC LIMIT 100`,
      [id],
    );
  });

  // ---- invites ----

  app.post('/communities/:id/invites', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    await require(id, me, P.CREATE_INVITE);
    const body = parse(
      z.object({
        maxUses: z.number().int().min(1).max(1000).optional(),
        expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
      }),
      req.body ?? {},
    );
    const code = randomBytes(6).toString('base64url');
    const invite = (await one(
      `INSERT INTO invites (code, community_id, creator_id, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5::int || ' hours')::interval END)
       RETURNING code, max_uses AS "maxUses", expires_at AS "expiresAt", uses`,
      [code, id, me, body.maxUses ?? null, body.expiresInHours ?? null],
    ))!;
    return invite;
  });

  app.get('/communities/:id/invites', async (req) => {
    const { id } = parse(idParams, req.params);
    await require(id, userId(req), P.MANAGE_COMMUNITY);
    return q(
      `SELECT i.code, i.uses, i.max_uses AS "maxUses", i.expires_at AS "expiresAt", u.display_name AS "creator"
       FROM invites i JOIN users u ON u.id = i.creator_id WHERE i.community_id = $1 ORDER BY i.created_at DESC`,
      [id],
    );
  });

  const validInvite = `SELECT i.*, c.name, c.description, c.accent,
      (SELECT count(*)::int FROM members m WHERE m.community_id = c.id) AS member_count
    FROM invites i JOIN communities c ON c.id = i.community_id
    WHERE i.code = $1 AND (i.expires_at IS NULL OR i.expires_at > now())
      AND (i.max_uses IS NULL OR i.uses < i.max_uses)`;

  app.get('/invites/:code', async (req) => {
    const { code } = parse(z.object({ code: z.string().max(32) }), req.params);
    const inv = await one(validInvite, [code]);
    if (!inv) throw new NotFoundError('This invite is invalid or has expired');
    return {
      code,
      community: { id: inv.community_id, name: inv.name, description: inv.description, accent: inv.accent },
      memberCount: inv.member_count,
    };
  });

  app.post('/invites/:code/join', async (req) => {
    const { code } = parse(z.object({ code: z.string().max(32) }), req.params);
    const me = userId(req);
    const inv = await one(validInvite, [code]);
    if (!inv) throw new NotFoundError('This invite is invalid or has expired');
    const banned = await one('SELECT 1 FROM bans WHERE community_id = $1 AND user_id = $2', [inv.community_id, me]);
    if (banned) throw new PermissionError('You are banned from this community');
    const joined = await one(
      'INSERT INTO members (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1',
      [inv.community_id, me],
    );
    if (joined) {
      await q('UPDATE invites SET uses = uses + 1 WHERE code = $1', [code]);
      await broadcastSnapshotChange(inv.community_id, 'MEMBER_JOIN', { userId: me });
    }
    return snapshot(inv.community_id, me);
  });
}
