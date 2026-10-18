import { create } from 'zustand';
import { api, gatewayUrl, getToken, setToken } from './api';
import type { Community, CommunitySummary, DmThread, Message, User } from './types';

export type View =
  | { kind: 'home'; dmId?: string }
  | { kind: 'community'; communityId: string; channelId?: string }
  | { kind: 'admin' };

type Typing = { userId: string; name: string; until: number };

type Toast = { id: number; text: string; tone: 'info' | 'error' };

type State = {
  me: User | null;
  booting: boolean;
  connected: boolean;
  view: View;
  communities: CommunitySummary[];
  snapshots: Record<string, Community>;
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  dms: DmThread[];
  online: Set<string>;
  typing: Record<string, Typing[]>;
  blocked: Set<string>;
  toasts: Toast[];
  modal: null | { kind: string; data?: any };

  boot: () => Promise<void>;
  signedIn: (token: string, user: User) => Promise<void>;
  signOut: () => void;
  setView: (v: View) => void;
  openModal: (kind: string, data?: any) => void;
  closeModal: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  refreshCommunity: (id: string) => Promise<void>;
  refreshCommunities: () => Promise<void>;
  refreshDms: () => Promise<void>;
  loadMessages: (scope: string, older?: boolean) => Promise<void>;
  upsertMessage: (m: Message) => void;
  removeMessage: (scope: string, id: string) => void;
  setMe: (u: User) => void;
  refreshBlocks: () => Promise<void>;
};

export const scopeOf = (m: { channelId: string | null; dmId: string | null }) =>
  m.channelId ? `c:${m.channelId}` : `d:${m.dmId}`;

let socket: WebSocket | null = null;
let heartbeat: number | undefined;
let retry = 0;
let refreshTimers: Record<string, number> = {};

export const useStore = create<State>((set, get) => {
  function debouncedRefresh(communityId: string) {
    window.clearTimeout(refreshTimers[communityId]);
    refreshTimers[communityId] = window.setTimeout(() => void get().refreshCommunity(communityId), 150);
  }

  function handleEvent(t: string, d: any) {
    switch (t) {
      case 'READY':
        set({ online: new Set(d.online) });
        break;
      case 'MESSAGE_CREATE':
      case 'MESSAGE_UPDATE': {
        get().upsertMessage(d);
        if (t === 'MESSAGE_CREATE' && d.dmId) {
          const known = get().dms.some((x) => x.id === d.dmId);
          if (!known) void get().refreshDms();
          else
            set((s) => ({
              dms: [...s.dms]
                .map((x) => (x.id === d.dmId ? { ...x, lastMessageAt: d.createdAt } : x))
                .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
            }));
        }
        if (t === 'MESSAGE_CREATE' && d.channelId) {
          set((s) => ({ typing: { ...s.typing, [d.channelId]: (s.typing[d.channelId] ?? []).filter((x) => x.userId !== d.author.id) } }));
        }
        break;
      }
      case 'MESSAGE_DELETE':
        get().removeMessage(scopeOf(d), d.id);
        break;
      case 'TYPING_START': {
        if (d.userId === get().me?.id) break;
        set((s) => {
          const list = (s.typing[d.channelId] ?? []).filter((x) => x.userId !== d.userId);
          list.push({ userId: d.userId, name: d.displayName, until: Date.now() + 6000 });
          return { typing: { ...s.typing, [d.channelId]: list } };
        });
        break;
      }
      case 'PRESENCE_UPDATE':
        set((s) => {
          const online = new Set(s.online);
          if (d.status === 'online') online.add(d.userId);
          else online.delete(d.userId);
          return { online };
        });
        break;
      case 'VOICE_STATE':
        set((s) => {
          const snapshots = { ...s.snapshots };
          for (const [cid, snap] of Object.entries(snapshots)) {
            if (snap.channels.some((c) => c.id === d.channelId)) {
              snapshots[cid] = { ...snap, voice: { ...snap.voice, [d.channelId]: d.userIds } };
            }
          }
          return { snapshots };
        });
        break;
      case 'COMMUNITY_DELETE': {
        const { communityId } = d;
        set((s) => {
          const snapshots = { ...s.snapshots };
          delete snapshots[communityId];
          const view = s.view.kind === 'community' && s.view.communityId === communityId ? { kind: 'home' as const } : s.view;
          return { communities: s.communities.filter((c) => c.id !== communityId), snapshots, view };
        });
        break;
      }
      case 'COMMUNITY_UPDATE':
        debouncedRefresh(d.communityId);
        void get().refreshCommunities();
        break;
      case 'CHANNELS_UPDATE':
      case 'ROLES_UPDATE':
      case 'MEMBERS_UPDATE':
      case 'MEMBER_JOIN':
      case 'MEMBER_LEAVE':
        debouncedRefresh(d.communityId);
        break;
      case 'REPORT_CREATE':
        get().toast('A new report needs review');
        break;
      case 'SESSION_REVOKED':
        get().signOut();
        break;
    }
  }

  function connect() {
    socket?.close();
    const ws = new WebSocket(gatewayUrl());
    socket = ws;
    ws.onopen = () => {
      retry = 0;
      set({ connected: true });
      window.clearInterval(heartbeat);
      heartbeat = window.setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 25000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      const { t, d } = JSON.parse(e.data);
      handleEvent(t, d);
    };
    ws.onclose = (e) => {
      if (socket !== ws) return;
      set({ connected: false });
      window.clearInterval(heartbeat);
      if (e.code === 4001 || e.code === 4003) return get().signOut();
      const delay = Math.min(15000, 500 * 2 ** retry++);
      window.setTimeout(() => {
        if (socket === ws && getToken()) {
          connect();
          // Catch up on anything missed while disconnected.
          const v = get().view;
          if (v.kind === 'community') void get().refreshCommunity(v.communityId);
        }
      }, delay);
    };
  }

  return {
    me: null,
    booting: true,
    connected: false,
    view: { kind: 'home' },
    communities: [],
    snapshots: {},
    messages: {},
    hasMore: {},
    dms: [],
    online: new Set(),
    typing: {},
    blocked: new Set(),
    toasts: [],
    modal: null,

    async boot() {
      if (!getToken()) return set({ booting: false });
      try {
        const me = await api.me();
        await get().signedIn(getToken()!, me);
      } catch {
        setToken(null);
      } finally {
        set({ booting: false });
      }
    },

    async signedIn(token, user) {
      setToken(token);
      set({ me: user });
      connect();
      const [communities, dms] = await Promise.all([api.communities(), api.dms()]);
      set({ communities, dms });
      void get().refreshBlocks();
      const pending = sessionStorageGet('onehub.pendingInvite');
      if (pending) get().openModal('join', { code: pending });
    },

    signOut() {
      setToken(null);
      const ws = socket;
      socket = null;
      ws?.close();
      set({ me: null, communities: [], snapshots: {}, messages: {}, dms: [], view: { kind: 'home' }, connected: false });
    },

    setView(view) {
      set({ view });
      if (view.kind === 'community') {
        const snap = get().snapshots[view.communityId];
        if (!snap) void get().refreshCommunity(view.communityId);
        else if (!view.channelId) {
          const first = snap.channels.find((c) => c.kind !== 'voice');
          if (first) set({ view: { ...view, channelId: first.id } });
        }
      }
    },

    openModal: (kind, data) => set({ modal: { kind, data } }),
    closeModal: () => set({ modal: null }),

    toast(text, tone = 'info') {
      const id = Date.now() + Math.random();
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
      window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
    },

    async refreshCommunity(id) {
      try {
        const snap = await api.community(id);
        set((s) => {
          const view = s.view;
          let nextView = view;
          if (view.kind === 'community' && view.communityId === id) {
            const stillThere = view.channelId && snap.channels.some((c) => c.id === view.channelId);
            if (!stillThere) {
              const first = snap.channels.find((c) => c.kind !== 'voice');
              nextView = { ...view, channelId: first?.id };
            }
          }
          // Snapshots carry each member's live presence; fold it in so late joiners show as online.
          const online = new Set(s.online);
          for (const m of snap.members) {
            if (m.online) online.add(m.id);
            else online.delete(m.id);
          }
          return { snapshots: { ...s.snapshots, [id]: snap }, view: nextView, online };
        });
      } catch (e: any) {
        if (e.status === 404) handleEvent('COMMUNITY_DELETE', { communityId: id });
      }
    },

    async refreshCommunities() {
      set({ communities: await api.communities() });
    },

    async refreshDms() {
      set({ dms: await api.dms() });
    },

    async loadMessages(scope, older = false) {
      const [kind, id] = [scope.slice(0, 1), scope.slice(2)];
      const existing = get().messages[scope] ?? [];
      const before = older ? existing[0]?.createdAt : undefined;
      const page = kind === 'c' ? await api.messages(id, before) : await api.dmMessages(id, before);
      set((s) => ({
        messages: { ...s.messages, [scope]: older ? [...page, ...existing] : page },
        hasMore: { ...s.hasMore, [scope]: page.length >= 50 },
      }));
    },

    upsertMessage(m) {
      const scope = scopeOf(m);
      set((s) => {
        const list = s.messages[scope];
        if (!list) return {};
        const i = list.findIndex((x) => x.id === m.id);
        const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
        return { messages: { ...s.messages, [scope]: next } };
      });
    },

    removeMessage(scope, id) {
      set((s) => ({ messages: { ...s.messages, [scope]: (s.messages[scope] ?? []).filter((m) => m.id !== id) } }));
    },

    setMe: (u) => set({ me: u }),

    async refreshBlocks() {
      const list = await api.blocks();
      set({ blocked: new Set(list.map((b) => b.id)) });
    },
  };
});

function sessionStorageGet(key: string) {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v;
  } catch {
    return null;
  }
}
