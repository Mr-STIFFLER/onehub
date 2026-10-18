import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Volume2, Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, Headphones, HeadphoneOff, Radio } from 'lucide-react';
import { useVoice, type VoicePeer } from '../lib/voice';
import type { Channel, Community } from '../lib/types';
import { Avatar, Spinner } from '../components/ui';

export function VoiceStage({ community, channel }: { community: Community; channel: Channel }) {
  const v = useVoice();
  const here = v.channelId === channel.id;
  const occupants = community.voice[channel.id] ?? [];
  const members = new Map(community.members.map((m) => [m.id, m]));
  const screens = here ? v.peers.filter((p) => p.screen) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b hairline px-6">
        <Volume2 size={18} className="text-gold-300" />
        <h1 className="font-display text-[21px] font-semibold">{channel.name}</h1>
        <span className="h-4 w-px bg-white/10" />
        <p className="text-[13px] text-mist-500">
          {occupants.length ? `${occupants.length} connected` : 'Nobody here yet'}
        </p>
        {here && v.status === 'connected' && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-200">
            <Radio size={12} /> Live
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!here ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-6 flex -space-x-3">
              {occupants.slice(0, 5).map((id) => {
                const m = members.get(id);
                return <Avatar key={id} name={m?.displayName ?? '?'} accent={m?.accent} size={56} className="rounded-full ring-4 ring-ink-850" />;
              })}
            </div>
            <h2 className="font-display text-[32px] font-semibold">{channel.name}</h2>
            <p className="mt-2 text-mist-400">{occupants.length ? 'Your squad is waiting.' : 'Open the room and others will see you here.'}</p>
            <button className="btn-gold mt-7 px-6 py-3" disabled={v.status === 'connecting'} onClick={() => void v.join(community.id, channel.id)}>
              {v.status === 'connecting' ? <Spinner /> : <Volume2 size={16} />} Join voice
            </button>
          </div>
        ) : v.status === 'connecting' ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={28} />
          </div>
        ) : (
          <div className="space-y-4">
            {screens.map((p) => (
              <div key={`${p.identity}-screen`} className="glass overflow-hidden rounded-3xl">
                <VideoEl track={p.screen!} className="aspect-video w-full bg-black object-contain" />
                <div className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-mist-300">
                  <ScreenShare size={14} className="text-gold-300" /> {p.isLocal ? 'You are' : `${p.name} is`} sharing their screen
                </div>
              </div>
            ))}
            <div className={clsx('grid gap-4', v.peers.length <= 1 ? 'grid-cols-1 lg:grid-cols-2' : v.peers.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 xl:grid-cols-3')}>
              {v.peers.map((p) => (
                <Tile key={p.identity} peer={p} accent={members.get(p.identity)?.accent} onVolume={(x) => v.setVolume(p.identity, x)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {here && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t hairline bg-ink-950/40 py-4">
          <CtlButton active={!v.muted} onClick={() => void v.toggleMute()} label={v.muted ? 'Unmute' : 'Mute'}>
            {v.muted ? <MicOff size={19} /> : <Mic size={19} />}
          </CtlButton>
          <CtlButton active={!v.deafened} onClick={v.toggleDeafen} label={v.deafened ? 'Undeafen' : 'Deafen'}>
            {v.deafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
          </CtlButton>
          <CtlButton active={v.camera} gold disabled={!v.canVideo} onClick={() => void v.toggleCamera()} label="Camera">
            {v.camera ? <Video size={19} /> : <VideoOff size={19} />}
          </CtlButton>
          <CtlButton active={v.screen} gold disabled={!v.canVideo} onClick={() => void v.toggleScreen()} label="Share screen">
            {v.screen ? <ScreenShareOff size={19} /> : <ScreenShare size={19} />}
          </CtlButton>
          <button className="ml-3 flex h-12 items-center gap-2 rounded-2xl bg-red-500/90 px-5 font-semibold text-white transition hover:bg-red-500" onClick={() => void v.leave()}>
            <PhoneOff size={18} /> Leave
          </button>
        </div>
      )}
    </div>
  );
}

function CtlButton({
  children,
  active,
  gold,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  gold?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-12 w-12 items-center justify-center rounded-2xl border transition disabled:opacity-40',
        gold
          ? active
            ? 'border-gold-400/50 bg-gold-400/20 text-gold-100'
            : 'border-white/10 bg-white/[0.04] text-mist-400 hover:bg-white/[0.08] hover:text-mist-100'
          : active
            ? 'border-white/10 bg-white/[0.06] text-mist-100 hover:bg-white/[0.1]'
            : 'border-red-400/30 bg-red-500/15 text-red-200',
      )}
    >
      {children}
    </button>
  );
}

function Tile({ peer, accent, onVolume }: { peer: VoicePeer; accent?: string; onVolume: (v: number) => void }) {
  return (
    <div
      className={clsx(
        'group relative aspect-video overflow-hidden rounded-3xl border bg-ink-900 transition',
        peer.speaking ? 'border-gold-300/70 shadow-glow' : 'border-white/[0.06]',
      )}
    >
      {peer.camera ? (
        <VideoEl track={peer.camera} mirror={peer.isLocal} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center" style={{ background: `radial-gradient(circle at 50% 40%, ${accent ?? '#C9A961'}22, transparent 65%)` }}>
          <div className={clsx('rounded-full', peer.speaking && 'animate-pulse-ring')}>
            <Avatar name={peer.name} accent={accent} size={84} />
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[12.5px] font-semibold backdrop-blur">
        {peer.muted && <MicOff size={12} className="text-red-300" />}
        {peer.name}
        {peer.isLocal && <span className="font-normal text-mist-400">(you)</span>}
      </div>
      {!peer.isLocal && (
        <div className="absolute right-3 top-3 hidden items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur group-hover:flex">
          <Volume2 size={12} className="text-mist-300" />
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={peer.volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-1 w-24 accent-[#C9A961]"
            aria-label={`Volume for ${peer.name}`}
          />
        </div>
      )}
    </div>
  );
}

function VideoEl({ track, className, mirror }: { track: MediaStreamTrack; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={className} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}
