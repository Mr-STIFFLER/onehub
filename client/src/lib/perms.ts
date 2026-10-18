// Mirrors server/src/permissions.ts.
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

export const PERMISSION_LABELS: { key: keyof typeof P; label: string; hint: string }[] = [
  { key: 'VIEW_CHANNELS', label: 'View channels', hint: 'See channels and read history' },
  { key: 'SEND_MESSAGES', label: 'Send messages', hint: 'Post in text channels' },
  { key: 'CONNECT_VOICE', label: 'Join voice', hint: 'Connect to voice rooms' },
  { key: 'SPEAK', label: 'Speak', hint: 'Transmit audio in voice rooms' },
  { key: 'VIDEO', label: 'Video & screen share', hint: 'Turn on camera or share a screen' },
  { key: 'CREATE_INVITE', label: 'Create invites', hint: 'Generate invite links' },
  { key: 'MANAGE_MESSAGES', label: 'Manage messages', hint: "Delete others' messages, review reports" },
  { key: 'KICK_MEMBERS', label: 'Kick members', hint: 'Remove members below their role' },
  { key: 'BAN_MEMBERS', label: 'Ban members', hint: 'Ban members below their role' },
  { key: 'MANAGE_CHANNELS', label: 'Manage channels', hint: 'Create, rename and delete channels' },
  { key: 'MANAGE_ROLES', label: 'Manage roles', hint: 'Edit roles below their own' },
  { key: 'MANAGE_COMMUNITY', label: 'Manage community', hint: 'Settings, invites and audit log' },
  { key: 'ADMINISTRATOR', label: 'Administrator', hint: 'Every permission. Grant sparingly.' },
];

export function can(perms: string | undefined, flag: bigint) {
  if (!perms) return false;
  const p = BigInt(perms);
  return (p & P.ADMINISTRATOR) === P.ADMINISTRATOR || (p & flag) === flag;
}
