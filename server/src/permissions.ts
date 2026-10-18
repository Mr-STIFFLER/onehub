import { one, q } from './db.js';

/** Community permission bits. Stored as a bigint on each role and OR-ed together per member. */
export const P = {
  VIEW_CHANNELS: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  MANAGE_MESSAGES: 1n << 2n,
  MANAGE_CHANNELS: 1n << 3n,
  MANAGE_ROLES: 1n << 4n,
  KICK_MEMBERS: 1n << 5n,
  BAN_MEMBERS: 1n << 6n,
  CONNECT_VOICE: 1n << 7n,
  SPEAK: 1n << 8n,
  VIDEO: 1n << 9n,
  CREATE_INVITE: 1n << 10n,
  MANAGE_COMMUNITY: 1n << 11n,
  ADMINISTRATOR: 1n << 30n,
} as const;

export type PermName = keyof typeof P;

export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0n);

export const DEFAULT_EVERYONE =
  P.VIEW_CHANNELS | P.SEND_MESSAGES | P.CONNECT_VOICE | P.SPEAK | P.VIDEO | P.CREATE_INVITE;

export const MODERATOR = DEFAULT_EVERYONE | P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.BAN_MEMBERS;

export class PermissionError extends Error {
  statusCode = 403;
  constructor(message = 'You do not have permission to do that') {
    super(message);
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message = 'Not found') {
    super(message);
  }
}

export async function memberPermissions(communityId: string, userId: string): Promise<bigint | null> {
  const community = await one<{ owner_id: string }>('SELECT owner_id FROM communities WHERE id = $1', [communityId]);
  if (!community) return null;
  const member = await one('SELECT 1 FROM members WHERE community_id = $1 AND user_id = $2', [communityId, userId]);
  if (!member) return null;
  if (community.owner_id === userId) return ALL_PERMISSIONS;

  const rows = await q<{ permissions: string }>(
    `SELECT r.permissions FROM roles r
     WHERE r.community_id = $1
       AND (r.is_default OR r.id IN (SELECT role_id FROM member_roles WHERE community_id = $1 AND user_id = $2))`,
    [communityId, userId],
  );
  const perms = rows.reduce((acc, r) => acc | BigInt(r.permissions), 0n);
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms;
}

export function has(perms: bigint | null, flag: bigint) {
  return perms !== null && (perms & flag) === flag;
}

/** Throws unless the user is a member holding every listed permission. Returns their permissions. */
export async function require(communityId: string, userId: string, ...flags: bigint[]): Promise<bigint> {
  const perms = await memberPermissions(communityId, userId);
  if (perms === null) throw new NotFoundError('Community not found');
  for (const f of flags) if (!has(perms, f)) throw new PermissionError();
  return perms;
}

/** Highest role position a member holds; owners rank above every role. */
export async function rank(communityId: string, userId: string): Promise<number> {
  const c = await one<{ owner_id: string }>('SELECT owner_id FROM communities WHERE id = $1', [communityId]);
  if (c?.owner_id === userId) return Number.MAX_SAFE_INTEGER;
  const r = await one<{ max: number | null }>(
    `SELECT max(r.position) AS max FROM member_roles mr JOIN roles r ON r.id = mr.role_id
     WHERE mr.community_id = $1 AND mr.user_id = $2`,
    [communityId, userId],
  );
  return r?.max ?? 0;
}
