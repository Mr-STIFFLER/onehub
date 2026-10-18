import { create } from 'zustand';
// livekit-client is loaded on first join so the idle client stays light during gameplay.
import type { LocalTrackPublication, Participant, RemoteParticipant, Room, Track } from 'livekit-client';

type LK = typeof import('livekit-client');
let lk: LK | null = null;
const loadLk = async () => (lk ??= await import('livekit-client'));
import { api } from './api';
import { useStore } from './store';

export type VoicePeer = {
  identity: string;
  name: string;
  speaking: boolean;
  muted: boolean;
  isLocal: boolean;
  camera?: MediaStreamTrack;
  screen?: MediaStreamTrack;
  volume: number;
};

type VoiceState = {
  channelId: string | null;
  communityId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  peers: VoicePeer[];
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
  canVideo: boolean;
  noiseSuppression: boolean;
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  inputId: string;
  outputId: string;
  join: (communityId: string, channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  setVolume: (identity: string, v: number) => void;
  setNoiseSuppression: (on: boolean) => Promise<void>;
  loadDevices: () => Promise<void>;
  setInput: (id: string) => Promise<void>;
  setOutput: (id: string) => Promise<void>;
};

let room: Room | null = null;
const volumes = new Map<string, number>();

function trackOf(p: Participant, source: Track.Source) {
  if (!lk) return undefined;
  return p.getTrackPublication(source)?.track?.mediaStreamTrack;
}

function snapshotPeers(): VoicePeer[] {
  if (!room) return [];
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  return all.map((p) => ({
    identity: p.identity,
    name: p.name || p.identity,
    speaking: p.isSpeaking,
    muted: !p.isMicrophoneEnabled,
    isLocal: p === room!.localParticipant,
    camera: trackOf(p, lk!.Track.Source.Camera),
    screen: trackOf(p, lk!.Track.Source.ScreenShare),
    volume: volumes.get(p.identity) ?? 1,
  }));
}

export const useVoice = create<VoiceState>((set, get) => {
  const sync = () => set({ peers: snapshotPeers() });

  return {
    channelId: null,
    communityId: null,
    status: 'idle',
    peers: [],
    muted: false,
    deafened: false,
    camera: false,
    screen: false,
    canVideo: false,
    noiseSuppression: true,
    inputs: [],
    outputs: [],
    inputId: 'default',
    outputId: 'default',

    async join(communityId, channelId) {
      if (get().channelId === channelId) return;
      await get().leave();
      set({ status: 'connecting', channelId, communityId });
      try {
        const [grant, { Room, RoomEvent, ConnectionState, Track }] = await Promise.all([api.voiceJoin(channelId), loadLk()]);
        const r = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            noiseSuppression: get().noiseSuppression,
            echoCancellation: true,
            autoGainControl: true,
          },
          publishDefaults: { dtx: true, red: true },
        });
        room = r;
        r.on(RoomEvent.ParticipantConnected, sync)
          .on(RoomEvent.ParticipantDisconnected, sync)
          .on(RoomEvent.TrackSubscribed, (_t, _p, participant: RemoteParticipant) => {
            participant.setVolume(get().deafened ? 0 : volumes.get(participant.identity) ?? 1);
            sync();
          })
          .on(RoomEvent.TrackUnsubscribed, sync)
          .on(RoomEvent.TrackMuted, sync)
          .on(RoomEvent.TrackUnmuted, sync)
          .on(RoomEvent.LocalTrackPublished, sync)
          .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.ScreenShare) set({ screen: false });
            if (pub.source === Track.Source.Camera) set({ camera: false });
            sync();
          })
          .on(RoomEvent.ActiveSpeakersChanged, sync)
          .on(RoomEvent.ConnectionStateChanged, (s) => {
            if (s === ConnectionState.Reconnecting) set({ status: 'reconnecting' });
            if (s === ConnectionState.Connected) set({ status: 'connected' });
          })
          .on(RoomEvent.Disconnected, () => {
            if (room === r) {
              room = null;
              set({ status: 'idle', channelId: null, communityId: null, peers: [], camera: false, screen: false });
            }
          });
        await r.connect(grant.url, grant.token);
        set({ status: 'connected', canVideo: grant.canVideo });
        if (grant.canSpeak) {
          try {
            await r.localParticipant.setMicrophoneEnabled(!get().muted);
          } catch {
            useStore.getState().toast('Microphone unavailable. You joined listen-only.', 'error');
            set({ muted: true });
          }
        } else set({ muted: true });
        sync();
        void get().loadDevices();
      } catch (e: any) {
        room?.disconnect();
        room = null;
        set({ status: 'idle', channelId: null, communityId: null, peers: [] });
        void api.voiceLeave(channelId).catch(() => {});
        useStore.getState().toast(e?.message ?? 'Could not join voice', 'error');
      }
    },

    async leave() {
      const id = get().channelId;
      const r = room;
      room = null;
      set({ status: 'idle', channelId: null, communityId: null, peers: [], camera: false, screen: false });
      await r?.disconnect();
      if (id) await api.voiceLeave(id).catch(() => {});
    },

    async toggleMute() {
      const muted = !get().muted;
      set({ muted });
      await room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
      sync();
    },

    toggleDeafen() {
      const deafened = !get().deafened;
      set({ deafened });
      room?.remoteParticipants.forEach((p) => p.setVolume(deafened ? 0 : volumes.get(p.identity) ?? 1));
      if (deafened && !get().muted) void get().toggleMute();
    },

    async toggleCamera() {
      if (!room) return;
      const on = !get().camera;
      try {
        await room.localParticipant.setCameraEnabled(on, { resolution: { width: 1280, height: 720, frameRate: 30 } });
        set({ camera: on });
      } catch {
        useStore.getState().toast('Camera unavailable', 'error');
      }
      sync();
    },

    async toggleScreen() {
      if (!room) return;
      const on = !get().screen;
      try {
        await room.localParticipant.setScreenShareEnabled(on, { audio: true, selfBrowserSurface: 'exclude' });
        set({ screen: on });
      } catch {
        /* user cancelled the picker */
      }
      sync();
    },

    setVolume(identity, v) {
      volumes.set(identity, v);
      const p = room?.remoteParticipants.get(identity);
      if (p && !get().deafened) p.setVolume(v);
      sync();
    },

    async setNoiseSuppression(on) {
      set({ noiseSuppression: on });
      const pub = lk && room?.localParticipant.getTrackPublication(lk.Track.Source.Microphone);
      const track = pub?.track?.mediaStreamTrack;
      await track?.applyConstraints({ noiseSuppression: on }).catch(() => {});
    },

    async loadDevices() {
      const all = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
      set({ inputs: all.filter((d) => d.kind === 'audioinput'), outputs: all.filter((d) => d.kind === 'audiooutput') });
    },

    async setInput(id) {
      set({ inputId: id });
      await room?.switchActiveDevice('audioinput', id).catch(() => {});
    },

    async setOutput(id) {
      set({ outputId: id });
      await room?.switchActiveDevice('audiooutput', id).catch(() => {});
    },
  };
});

/** Remote audio has to be attached to the DOM to play. */
export function attachRemoteAudio(container: HTMLElement) {
  const handler = (track: Track) => {
    if (track.kind === 'audio') container.appendChild(track.attach());
  };
  const detach = (track: Track) => track.detach().forEach((el) => el.remove());
  let bound: Room | null = null;
  const bind = () => {
    if (room === bound) return;
    bound?.off('trackSubscribed', handler).off('trackUnsubscribed', detach);
    bound = room;
    bound?.on('trackSubscribed', handler).on('trackUnsubscribed', detach);
  };
  const unsub = useVoice.subscribe(bind);
  bind();
  return () => {
    unsub();
    bound?.off('trackSubscribed', handler).off('trackUnsubscribed', detach);
  };
}
