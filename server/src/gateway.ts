import type { WebSocket } from 'ws';
import { q } from './db.js';

export type GatewayEvent = { t: string; d: unknown };

/** Tracks live sockets, presence and voice occupancy. Single-process; swap for Redis pub/sub to scale out. */
class Hub {
  private sockets = new Map<string, Set<WebSocket>>();
  /** voice channel id -> user ids currently connected */
  private voice = new Map<string, Set<string>>();
  private voiceCommunity = new Map<string, string>();

  attach(userId: string, ws: WebSocket) {
    const set = this.sockets.get(userId) ?? new Set();
    const cameOnline = set.size === 0;
    set.add(ws);
    this.sockets.set(userId, set);
    if (cameOnline) void this.broadcastPresence(userId, 'online');

    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) {
        this.sockets.delete(userId);
        this.leaveAllVoice(userId);
        void this.broadcastPresence(userId, 'offline');
      }
    });
  }

  isOnline(userId: string) {
    return this.sockets.has(userId);
  }

  onlineUserIds() {
    return [...this.sockets.keys()];
  }

  send(userId: string, event: GatewayEvent) {
    const payload = JSON.stringify(event);
    for (const ws of this.sockets.get(userId) ?? []) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  toUsers(userIds: Iterable<string>, event: GatewayEvent) {
    for (const id of new Set(userIds)) this.send(id, event);
  }

  async toCommunity(communityId: string, event: GatewayEvent) {
    const rows = await q<{ user_id: string }>('SELECT user_id FROM members WHERE community_id = $1', [communityId]);
    this.toUsers(rows.map((r) => r.user_id), event);
  }

  async toDm(dmId: string, event: GatewayEvent) {
    const rows = await q<{ user_id: string }>('SELECT user_id FROM dm_participants WHERE dm_id = $1', [dmId]);
    this.toUsers(rows.map((r) => r.user_id), event);
  }

  private async broadcastPresence(userId: string, status: 'online' | 'offline') {
    const rows = await q<{ user_id: string }>(
      `SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.community_id = m2.community_id
       WHERE m1.user_id = $1
       UNION SELECT p2.user_id FROM dm_participants p1 JOIN dm_participants p2 ON p1.dm_id = p2.dm_id WHERE p1.user_id = $1`,
      [userId],
    );
    this.toUsers(rows.map((r) => r.user_id), { t: 'PRESENCE_UPDATE', d: { userId, status } });
  }

  // ---- voice occupancy ----

  voiceJoin(communityId: string, channelId: string, userId: string) {
    this.leaveAllVoice(userId);
    const set = this.voice.get(channelId) ?? new Set();
    set.add(userId);
    this.voice.set(channelId, set);
    this.voiceCommunity.set(channelId, communityId);
    void this.toCommunity(communityId, { t: 'VOICE_STATE', d: { channelId, userIds: [...set] } });
  }

  voiceLeave(channelId: string, userId: string) {
    const set = this.voice.get(channelId);
    if (!set?.delete(userId)) return;
    const communityId = this.voiceCommunity.get(channelId);
    if (communityId) void this.toCommunity(communityId, { t: 'VOICE_STATE', d: { channelId, userIds: [...set] } });
  }

  leaveAllVoice(userId: string) {
    for (const [channelId, set] of this.voice) if (set.has(userId)) this.voiceLeave(channelId, userId);
  }

  voiceSnapshot(channelIds: string[]) {
    const out: Record<string, string[]> = {};
    for (const id of channelIds) out[id] = [...(this.voice.get(id) ?? [])];
    return out;
  }
}

export const hub = new Hub();
