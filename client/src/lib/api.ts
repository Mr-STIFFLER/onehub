import type { Community, CommunitySummary, DmThread, Message, User } from './types';

const SERVER_KEY = 'onehub.server';
const TOKEN_KEY = 'onehub.token';

function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: session-only */
  }
}

/** Empty string means "same origin" (web build, or the Vite dev proxy). The desktop app stores a full URL. */
export let serverUrl = (safeGet(SERVER_KEY) ?? import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');
let token = safeGet(TOKEN_KEY);

export function setServerUrl(url: string) {
  serverUrl = url.trim().replace(/\/$/, '');
  safeSet(SERVER_KEY, serverUrl || null);
}
export function getToken() {
  return token;
}
export function setToken(t: string | null) {
  token = t;
  safeSet(TOKEN_KEY, t);
}

export function gatewayUrl() {
  const origin = serverUrl || window.location.origin;
  return `${origin.replace(/^http/, 'ws')}/gateway?token=${encodeURIComponent(token ?? '')}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the address and your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b: unknown = {}) => request<T>('POST', p, b);
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const put = <T>(p: string) => request<T>('PUT', p, {});
const del = <T>(p: string) => request<T>('DELETE', p);

type Auth = { token: string; user: User };

export const api = {
  register: (username: string, password: string, displayName?: string) =>
    post<Auth>('/auth/register', { username, password, displayName: displayName || undefined }),
  login: (username: string, password: string) => post<Auth>('/auth/login', { username, password }),
  me: () => get<User>('/me'),
  users: (id: string) => get<User>(`/users/${id}`),
  updateMe: (b: Partial<Pick<User, 'displayName' | 'bio' | 'statusText' | 'accent'>>) => patch<User>('/me', b),

  communities: () => get<CommunitySummary[]>('/communities'),
  community: (id: string) => get<Community>(`/communities/${id}`),
  createCommunity: (name: string, description?: string) => post<Community>('/communities', { name, description }),
  updateCommunity: (id: string, b: { name?: string; description?: string; accent?: string }) =>
    patch<Community>(`/communities/${id}`, b),
  deleteCommunity: (id: string) => del(`/communities/${id}`),
  leaveCommunity: (id: string) => post(`/communities/${id}/leave`),

  createChannel: (cid: string, b: { name: string; kind: 'text' | 'voice' | 'announcement'; category?: string; topic?: string }) =>
    post(`/communities/${cid}/channels`, b),
  updateChannel: (id: string, b: { name?: string; topic?: string }) => patch(`/channels/${id}`, b),
  deleteChannel: (id: string) => del(`/channels/${id}`),

  createRole: (cid: string, b: { name: string; color?: string; permissions?: string }) => post(`/communities/${cid}/roles`, b),
  updateRole: (id: string, b: { name?: string; color?: string; permissions?: string }) => patch(`/roles/${id}`, b),
  deleteRole: (id: string) => del(`/roles/${id}`),
  addRole: (cid: string, uid: string, rid: string) => put(`/communities/${cid}/members/${uid}/roles/${rid}`),
  removeRole: (cid: string, uid: string, rid: string) => del(`/communities/${cid}/members/${uid}/roles/${rid}`),
  kick: (cid: string, uid: string) => post(`/communities/${cid}/members/${uid}/kick`),
  ban: (cid: string, uid: string, reason: string) => post(`/communities/${cid}/members/${uid}/ban`, { reason }),
  bans: (cid: string) => get<{ userId: string; username: string; displayName: string; reason: string }[]>(`/communities/${cid}/bans`),
  unban: (cid: string, uid: string) => del(`/communities/${cid}/bans/${uid}`),
  audit: (cid: string) => get<{ id: number; action: string; actor: string; createdAt: string; detail: any }[]>(`/communities/${cid}/audit`),

  createInvite: (cid: string, b: { maxUses?: number; expiresInHours?: number } = {}) =>
    post<{ code: string }>(`/communities/${cid}/invites`, b),
  listInvites: (cid: string) =>
    get<{ code: string; uses: number; maxUses: number | null; expiresAt: string | null; creator: string }[]>(`/communities/${cid}/invites`),
  invite: (code: string) =>
    get<{ code: string; community: { id: string; name: string; description: string; accent: string }; memberCount: number }>(
      `/invites/${code}`,
    ),
  joinInvite: (code: string) => post<Community>(`/invites/${code}/join`),

  messages: (channelId: string, before?: string) =>
    get<Message[]>(`/channels/${channelId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  send: (channelId: string, content: string) => post<Message>(`/channels/${channelId}/messages`, { content }),
  typing: (channelId: string) => post(`/channels/${channelId}/typing`),
  editMessage: (id: string, content: string) => patch<Message>(`/messages/${id}`, { content }),
  deleteMessage: (id: string) => del(`/messages/${id}`),

  dms: () => get<DmThread[]>('/dms'),
  openDm: (userId: string) => post<DmThread>('/dms', { userId }),
  dmMessages: (dmId: string, before?: string) =>
    get<Message[]>(`/dms/${dmId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  sendDm: (dmId: string, content: string) => post<Message>(`/dms/${dmId}/messages`, { content }),

  blocks: () => get<{ id: string; username: string; displayName: string }[]>('/blocks'),
  block: (id: string) => put(`/blocks/${id}`),
  unblock: (id: string) => del(`/blocks/${id}`),
  report: (b: { messageId?: string; userId?: string; reason: string }) => post('/reports', b),
  communityReports: (cid: string) => get<Report[]>(`/communities/${cid}/reports`),
  setReport: (id: string, status: 'actioned' | 'dismissed' | 'open') => patch(`/reports/${id}`, { status }),

  adminStats: () => get<AdminStats>('/admin/stats'),
  adminReports: () => get<Report[]>('/admin/reports'),
  adminUsers: () => get<AdminUser[]>('/admin/users'),
  adminSetUser: (id: string, b: { disabled?: boolean; isAdmin?: boolean }) => patch(`/admin/users/${id}`, b),

  voiceJoin: (channelId: string) =>
    post<{ url: string; token: string; canSpeak: boolean; canVideo: boolean }>(`/channels/${channelId}/voice/join`),
  voiceLeave: (channelId: string) => post(`/channels/${channelId}/voice/leave`),
};

export type Report = {
  id: string;
  reason: string;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: string;
  communityId: string | null;
  reporter: string;
  target: string | null;
  targetUserId: string | null;
  messageContent: string | null;
  messageId: string | null;
};
export type AdminStats = {
  users: number;
  communities: number;
  messages: number;
  messages24h: number;
  openReports: number;
  online: number;
  uptimeSeconds: number;
};
export type AdminUser = { id: string; username: string; displayName: string; isAdmin: boolean; disabled: boolean; createdAt: string };
