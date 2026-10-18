import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { hub } from '../gateway.js';
import { authenticate, HttpError, idParams, parse, userId, uuid } from '../http.js';
import { NotFoundError, P, PermissionError, require } from '../permissions.js';

async function requireAdmin(req: FastifyRequest) {
  const u = await one('SELECT is_admin FROM users WHERE id = $1', [userId(req)]);
  if (!u?.is_admin) throw new PermissionError('Administrator access required');
}

export async function safetyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- blocking ----

  app.get('/blocks', async (req) => {
    return q(
      `SELECT u.id, u.username, u.display_name AS "displayName" FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [userId(req)],
    );
  });

  app.put('/blocks/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    if (id === me) throw new HttpError(400, 'You cannot block yourself');
    if (!(await one('SELECT 1 FROM users WHERE id = $1', [id]))) throw new NotFoundError('User not found');
    await q('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [me, id]);
    return { ok: true };
  });

  app.delete('/blocks/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    await q('DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2', [userId(req), id]);
    return { ok: true };
  });

  // ---- reports ----

  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const me = userId(req);
    const body = parse(
      z
        .object({
          messageId: uuid.optional(),
          userId: uuid.optional(),
          reason: z.string().trim().min(3, 'Tell us briefly what happened').max(1000),
        })
        .refine((b) => b.messageId || b.userId, 'Report a message or a user'),
      req.body,
    );
    let targetUser = body.userId ?? null;
    let communityId: string | null = null;
    if (body.messageId) {
      const m = await one(
        `SELECT m.author_id, c.community_id FROM messages m LEFT JOIN channels c ON c.id = m.channel_id WHERE m.id = $1`,
        [body.messageId],
      );
      if (!m) throw new NotFoundError('Message not found');
      targetUser = m.author_id;
      communityId = m.community_id;
    }
    const report = (await one(
      `INSERT INTO reports (reporter_id, target_user_id, message_id, community_id, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at AS "createdAt"`,
      [me, targetUser, body.messageId ?? null, communityId, body.reason],
    ))!;
    if (communityId) {
      // Let online moderators know without waiting for them to refresh.
      const mods = await q<{ user_id: string }>(
        `SELECT DISTINCT m.user_id FROM members m
         LEFT JOIN member_roles mr ON mr.community_id = m.community_id AND mr.user_id = m.user_id
         LEFT JOIN roles r ON r.id = mr.role_id
         JOIN communities c ON c.id = m.community_id
         WHERE m.community_id = $1 AND (c.owner_id = m.user_id OR (r.permissions & $2) <> 0)`,
        [communityId, (P.MANAGE_MESSAGES | P.ADMINISTRATOR).toString()],
      );
      hub.toUsers(mods.map((r) => r.user_id), { t: 'REPORT_CREATE', d: { communityId, reportId: report.id } });
    }
    return report;
  });

  const reportSelect = `
    SELECT r.id, r.reason, r.status, r.created_at AS "createdAt", r.community_id AS "communityId",
           rep.display_name AS "reporter", tgt.id AS "targetUserId", tgt.display_name AS "target",
           m.content AS "messageContent", m.id AS "messageId"
    FROM reports r
    JOIN users rep ON rep.id = r.reporter_id
    LEFT JOIN users tgt ON tgt.id = r.target_user_id
    LEFT JOIN messages m ON m.id = r.message_id`;

  app.get('/communities/:id/reports', async (req) => {
    const { id } = parse(idParams, req.params);
    await require(id, userId(req), P.MANAGE_MESSAGES);
    return q(`${reportSelect} WHERE r.community_id = $1 ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`, [id]);
  });

  app.patch('/reports/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const { status } = parse(z.object({ status: z.enum(['actioned', 'dismissed', 'open']) }), req.body);
    const r = await one('SELECT community_id FROM reports WHERE id = $1', [id]);
    if (!r) throw new NotFoundError('Report not found');
    if (r.community_id) await require(r.community_id, me, P.MANAGE_MESSAGES);
    else await requireAdmin(req);
    await q('UPDATE reports SET status = $2 WHERE id = $1', [id, status]);
    return { ok: true };
  });

  // ---- instance administration ----

  app.get('/admin/stats', async (req) => {
    await requireAdmin(req);
    const s = (await one(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM communities) AS communities,
        (SELECT count(*)::int FROM messages) AS messages,
        (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS "messages24h",
        (SELECT count(*)::int FROM reports WHERE status = 'open') AS "openReports"`))!;
    return { ...s, online: hub.onlineUserIds().length, uptimeSeconds: Math.round(process.uptime()) };
  });

  app.get('/admin/reports', async (req) => {
    await requireAdmin(req);
    return q(`${reportSelect} ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 200`);
  });

  app.get('/admin/users', async (req) => {
    await requireAdmin(req);
    return q(
      `SELECT id, username, display_name AS "displayName", is_admin AS "isAdmin", disabled, created_at AS "createdAt"
       FROM users ORDER BY created_at DESC LIMIT 500`,
    );
  });

  app.patch('/admin/users/:id', async (req) => {
    await requireAdmin(req);
    const { id } = parse(idParams, req.params);
    if (id === userId(req)) throw new HttpError(400, 'You cannot change your own admin account here');
    const body = parse(z.object({ disabled: z.boolean().optional(), isAdmin: z.boolean().optional() }), req.body);
    await q('UPDATE users SET disabled = COALESCE($2, disabled), is_admin = COALESCE($3, is_admin) WHERE id = $1', [
      id,
      body.disabled,
      body.isAdmin,
    ]);
    if (body.disabled) hub.send(id, { t: 'SESSION_REVOKED', d: {} });
    return { ok: true };
  });
}
