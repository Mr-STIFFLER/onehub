import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import {
  Hash,
  Megaphone,
  Volume2,
  Plus,
  Settings,
  MessageCircle,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneOff,
  Video,
  ScreenShare,
  UserPlus,
  Crown,
  Shield,
  WifiOff,
  ChevronDown,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { attachRemoteAudio, useVoice } from '../lib/voice';
import { can, P } from '../lib/perms';
import type { Channel, Community } from '../lib/types';
import { Avatar, Empty, initials } from '../components/ui';
import { Logo } from './AuthScreen';
import { Chat } from './Chat';
import { VoiceStage } from './VoiceStage';
import { MemberList } from './MemberList';
import { AdminDashboard } from './Admin';
import { Modals } from './Modals';

export function Shell() {
  const view = useStore((s) => s.view);
  const snap = useStore((s) => (s.view.kind === 'community' ? s.snapshots[s.view.communityId] : undefined));
  const audioRef = useRef<HTMLDivElement>(null);
  useEffect(() => (audioRef.current ? attachRemoteAudio(audioRef.current) : undefined), []);

  const channel = view.kind === 'community' ? snap?.channels.find((c) => c.id === view.channelId) : undefined;

  return (
    <div className="flex h-full overflow-hidden">
      <CommunityRail />
      <aside className="flex w-[260px] shrink-0 flex-col border-r hairline bg-ink-900/60">
        {view.kind === 'community' && snap ? <ChannelSidebar community={snap} /> : <HomeSidebar />}
        <UserBar />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-ink-850/40">
        {view.kind === 'admin' ? (
          <AdminDashboard />
        ) : view.kind === 'community' ? (
          !snap ? null : channel?.kind === 'voice' ? (
            <VoiceStage community={snap} channel={channel} />
          ) : channel ? (
            <Chat scope={`c:${channel.id}`} title={channel.name} topic={channel.topic} community={snap} channel={channel} />
          ) : (
            <Empty icon={<Hash />} title="No channels yet" body="Create a text channel to get the conversation going." />
          )
        ) : (
          <HomeMain dmId={view.dmId} />
        )}
      </main>
      {view.kind === 'community' && snap && channel?.kind !== 'voice' && <MemberList community={snap} />}
      <div ref={audioRef} className="hidden" />
      <Modals />
    </div>
  );
}

function CommunityRail() {
  const communities = useStore((s) => s.communities);
  const view = useStore((s) => s.view);
  const me = useStore((s) => s.me);
  const setView = useStore((s) => s.setView);
  const openModal = useStore((s) => s.openModal);
  const connected = useStore((s) => s.connected);

  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-2 border-r hairline bg-ink-950/80 py-4">
      <RailButton active={view.kind === 'home'} label="Direct messages" onClick={() => setView({ kind: 'home' })}>
        <Logo small />
      </RailButton>
      <div className="my-1 h-px w-8 bg-white/[0.08]" />
      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {communities.map((c) => (
          <RailButton
            key={c.id}
            label={c.name}
            active={view.kind === 'community' && view.communityId === c.id}
            onClick={() => setView({ kind: 'community', communityId: c.id })}
          >
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl font-display text-[19px] font-semibold text-ink-950"
              style={{ background: `linear-gradient(140deg, ${c.accent}, #5b4a28)` }}
            >
              {initials(c.name)}
            </div>
          </RailButton>
        ))}
        <RailButton label="Create or join a community" onClick={() => openModal('create-community')}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-gold-400/40 text-gold-300 transition group-hover:border-gold-300 group-hover:bg-gold-400/10">
            <Plus size={20} />
          </div>
        </RailButton>
      </div>
      {!connected && (
        <div className="mb-1 text-amber-300" title="Reconnecting to the server…">
          <WifiOff size={16} />
        </div>
      )}
      {me?.isAdmin && (
        <RailButton label="Instance admin" active={view.kind === 'admin'} onClick={() => setView({ kind: 'admin' })}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-mist-300">
            <Shield size={19} />
          </div>
        </RailButton>
      )}
    </nav>
  );
}

function RailButton({ children, active, label, onClick }: { children: React.ReactNode; active?: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="group relative flex w-full justify-center">
      <span
        className={clsx(
          'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-gold-300 transition-all',
          active ? 'h-8' : 'h-0 group-hover:h-4',
        )}
      />
      <div className={clsx('rounded-2xl transition', active ? 'shadow-glow' : 'opacity-85 group-hover:opacity-100')}>{children}</div>
    </button>
  );
}

const ICONS = { text: Hash, announcement: Megaphone, voice: Volume2 } as const;

function ChannelSidebar({ community }: { community: Community }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openModal = useStore((s) => s.openModal);
  const voice = useVoice();
  const members = useMemo(() => new Map(community.members.map((m) => [m.id, m])), [community.members]);
  const manage = can(community.myPermissions, P.MANAGE_CHANNELS);
  const settingsAccess =
    can(community.myPermissions, P.MANAGE_COMMUNITY) ||
    can(community.myPermissions, P.MANAGE_ROLES) ||
    can(community.myPermissions, P.MANAGE_MESSAGES) ||
    can(community.myPermissions, P.BAN_MEMBERS);

  const groups = useMemo(() => {
    const g = new Map<string, Channel[]>();
    const order = ['Information', 'Text', 'Voice'];
    for (const c of community.channels) g.set(c.category, [...(g.get(c.category) ?? []), c]);
    return [...g.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [community.channels]);

  return (
    <>
      <header className="relative border-b hairline px-4 pb-4 pt-5">
        <div className="absolute inset-x-0 top-0 h-20 opacity-60" style={{ background: `radial-gradient(200px 80px at 20% 0%, ${community.accent}33, transparent)` }} />
        <div className="relative flex items-center justify-between gap-2">
          <h2 className="truncate font-display text-[22px] font-semibold">{community.name}</h2>
          {settingsAccess && (
            <button className="icon-btn" title="Community settings" onClick={() => openModal('community-settings', { id: community.id })}>
              <Settings size={16} />
            </button>
          )}
        </div>
        {can(community.myPermissions, P.CREATE_INVITE) && (
          <button className="btn-ghost relative mt-3 w-full py-2" onClick={() => openModal('invite', { id: community.id, name: community.name })}>
            <UserPlus size={15} /> Invite friends
          </button>
        )}
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {groups.map(([cat, channels]) => (
          <section key={cat}>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="label flex items-center gap-1">
                <ChevronDown size={11} /> {cat}
              </span>
              {manage && (
                <button
                  className="text-mist-500 hover:text-gold-200"
                  title="Create channel"
                  onClick={() => openModal('create-channel', { id: community.id, category: cat, kind: channels[0]?.kind === 'voice' ? 'voice' : 'text' })}
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {channels.map((c) => {
                const Icon = ICONS[c.kind];
                const occupants = c.kind === 'voice' ? community.voice[c.id] ?? [] : [];
                const active = view.kind === 'community' && view.channelId === c.id;
                return (
                  <div key={c.id}>
                    <button
                      className="nav-item group"
                      data-active={active}
                      onClick={() => {
                        setView({ kind: 'community', communityId: community.id, channelId: c.id });
                        if (c.kind === 'voice' && voice.channelId !== c.id) void voice.join(community.id, c.id);
                      }}
                    >
                      <Icon size={16} className={clsx('shrink-0', active ? 'text-gold-300' : 'text-mist-500')} />
                      <span className="truncate">{c.name}</span>
                      {c.kind === 'voice' && occupants.length > 0 && (
                        <span className="ml-auto rounded-full bg-white/[0.06] px-1.5 text-[11px] text-mist-400">{occupants.length}</span>
                      )}
                    </button>
                    {occupants.length > 0 && (
                      <div className="mb-1 ml-7 mt-0.5 space-y-0.5">
                        {occupants.map((uid) => {
                          const m = members.get(uid);
                          const peer = voice.channelId === c.id ? voice.peers.find((p) => p.identity === uid) : undefined;
                          return (
                            <div key={uid} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-mist-300">
                              <Avatar name={m?.displayName ?? '?'} accent={m?.accent} size={22} speaking={peer?.speaking} />
                              <span className="truncate">{m?.displayName ?? 'Unknown'}</span>
                              {peer?.muted && <MicOff size={12} className="ml-auto text-red-300/80" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function HomeSidebar() {
  const dms = useStore((s) => s.dms);
  const view = useStore((s) => s.view);
  const online = useStore((s) => s.online);
  const setView = useStore((s) => s.setView);
  return (
    <>
      <header className="border-b hairline px-4 pb-4 pt-5">
        <h2 className="font-display text-[22px] font-semibold">Direct messages</h2>
        <p className="mt-0.5 text-[12px] text-mist-500">Private one-to-one conversations</p>
      </header>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {dms.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-mist-500">Open a member's profile to start a conversation.</p>}
        {dms.map((d) => (
          <button
            key={d.id}
            className="nav-item py-2"
            data-active={view.kind === 'home' && view.dmId === d.id}
            onClick={() => setView({ kind: 'home', dmId: d.id })}
          >
            <Avatar name={d.user.displayName} accent={d.user.accent} size={32} online={online.has(d.user.id)} />
            <div className="min-w-0">
              <div className="truncate text-mist-100">{d.user.displayName}</div>
              <div className="truncate text-[12px] text-mist-500">{d.user.statusText || `@${d.user.username}`}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function HomeMain({ dmId }: { dmId?: string }) {
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me)!;
  const communities = useStore((s) => s.communities);
  const openModal = useStore((s) => s.openModal);
  const dm = dms.find((d) => d.id === dmId);
  if (dm) return <Chat scope={`d:${dm.id}`} title={dm.user.displayName} topic={`@${dm.user.username}`} dm={dm} />;
  return (
    <Empty
      icon={<MessageCircle />}
      title={`Good to see you, ${me.displayName}`}
      body={
        communities.length
          ? 'Pick a conversation on the left, or jump into one of your communities.'
          : 'Create your first community, or join one with an invite link from a friend.'
      }
      action={
        <div className="flex gap-3">
          <button className="btn-gold" onClick={() => openModal('create-community')}>
            <Crown size={15} /> Create a community
          </button>
          <button className="btn-ghost" onClick={() => openModal('join')}>
            Join with invite
          </button>
        </div>
      }
    />
  );
}

function UserBar() {
  const me = useStore((s) => s.me)!;
  const openModal = useStore((s) => s.openModal);
  const snapshots = useStore((s) => s.snapshots);
  const voice = useVoice();
  const channel = voice.communityId ? snapshots[voice.communityId]?.channels.find((c) => c.id === voice.channelId) : undefined;
  return (
    <div className="border-t hairline bg-ink-950/50">
      {voice.channelId && (
        <div className="border-b hairline px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className={clsx('text-[12px] font-semibold', voice.status === 'connected' ? 'text-emerald-300' : 'text-amber-300')}>
                {voice.status === 'connected' ? 'Voice connected' : voice.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
              </div>
              <div className="truncate text-[12px] text-mist-500">
                {channel?.name ?? 'Voice'} · {snapshots[voice.communityId!]?.name}
              </div>
            </div>
            <button className="icon-btn text-red-300 hover:bg-red-500/15 hover:text-red-200" title="Disconnect" onClick={() => void voice.leave()}>
              <PhoneOff size={16} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button className={clsx('btn-ghost py-1.5 text-[12px]', voice.camera && 'border-gold-400/40 text-gold-200')} disabled={!voice.canVideo} onClick={() => void voice.toggleCamera()}>
              <Video size={14} /> Camera
            </button>
            <button className={clsx('btn-ghost py-1.5 text-[12px]', voice.screen && 'border-gold-400/40 text-gold-200')} disabled={!voice.canVideo} onClick={() => void voice.toggleScreen()}>
              <ScreenShare size={14} /> Screen
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2.5 px-3 py-3">
        <button className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left hover:bg-white/[0.03]" onClick={() => openModal('user-settings')}>
          <Avatar name={me.displayName} accent={me.accent} size={34} online />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{me.displayName}</div>
            <div className="truncate text-[11.5px] text-mist-500">{me.statusText || `@${me.username}`}</div>
          </div>
        </button>
        <button className={clsx('icon-btn', voice.muted && 'text-red-300')} title={voice.muted ? 'Unmute' : 'Mute'} onClick={() => void voice.toggleMute()}>
          {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button className={clsx('icon-btn', voice.deafened && 'text-red-300')} title={voice.deafened ? 'Undeafen' : 'Deafen'} onClick={voice.toggleDeafen}>
          {voice.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
        </button>
        <button className="icon-btn" title="Settings" onClick={() => openModal('user-settings')}>
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
}
