import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy, Hash, Megaphone, Volume2, MessageCircle, Ban, Flag, LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { useVoice } from '../lib/voice';
import type { User } from '../lib/types';
import { Avatar, Field, initials, Modal, Spinner, Toggle } from '../components/ui';
import { CommunitySettings } from './CommunitySettings';

export function Modals() {
  const modal = useStore((s) => s.modal);
  const close = useStore((s) => s.closeModal);
  if (!modal) return null;
  const d = modal.data ?? {};
  switch (modal.kind) {
    case 'create-community':
      return <CreateCommunity onClose={close} />;
    case 'join':
      return <JoinCommunity onClose={close} initialCode={d.code} />;
    case 'invite':
      return <Invite onClose={close} communityId={d.id} name={d.name} />;
    case 'create-channel':
      return <CreateChannel onClose={close} communityId={d.id} category={d.category} kind={d.kind} />;
    case 'report':
      return <Report onClose={close} messageId={d.messageId} userId={d.userId} name={d.name} />;
    case 'profile':
      return <Profile onClose={close} userId={d.userId} communityId={d.communityId} />;
    case 'user-settings':
      return <UserSettings onClose={close} />;
    case 'community-settings':
      return <CommunitySettings onClose={close} communityId={d.id} />;
    default:
      return null;
  }
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string }) {
  return error ? <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">{error}</p> : null;
}

function CreateCommunity({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, run } = useSubmit();
  const openModal = useStore((s) => s.openModal);

  return (
    <Modal title="Create your community" subtitle="A home for your squad, clan or friends. You can change everything later." onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const snap = await api.createCommunity(name, description);
            useStore.setState((s) => ({
              snapshots: { ...s.snapshots, [snap.id]: snap },
              communities: [...s.communities, { id: snap.id, name: snap.name, accent: snap.accent, description: snap.description }],
            }));
            useStore.getState().setView({ kind: 'community', communityId: snap.id });
            onClose();
          });
        }}
      >
        <Field label="Community name">
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Night Raid" maxLength={48} required minLength={2} />
        </Field>
        <Field label="Description" hint="Optional. Shown on invites.">
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ranked grind, every night at 9" maxLength={240} />
        </Field>
        <ErrorLine error={error} />
        <button className="btn-gold w-full py-3" disabled={busy}>
          {busy ? <Spinner /> : 'Create community'}
        </button>
        <p className="text-center text-[13px] text-mist-500">
          Have an invite?{' '}
          <button type="button" className="text-gold-300 hover:underline" onClick={() => openModal('join')}>
            Join a community
          </button>
        </p>
      </form>
    </Modal>
  );
}

function parseCode(input: string) {
  const t = input.trim();
  const m = t.match(/invite\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : t;
}

function JoinCommunity({ onClose, initialCode }: { onClose: () => void; initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.invite>> | null>(null);
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    if (initialCode) void run(async () => setPreview(await api.invite(initialCode)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <Modal title="Join a community" subtitle="Paste an invite link or code from a friend." onClose={onClose}>
      {preview ? (
        <div className="space-y-5">
          <div className="glass flex items-center gap-4 rounded-2xl p-4">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl font-display text-[22px] font-semibold text-ink-950"
              style={{ background: `linear-gradient(140deg, ${preview.community.accent}, #5b4a28)` }}
            >
              {initials(preview.community.name)}
            </div>
            <div>
              <div className="font-display text-[22px] font-semibold">{preview.community.name}</div>
              <div className="text-[13px] text-mist-400">
                {preview.memberCount} member{preview.memberCount === 1 ? '' : 's'}
                {preview.community.description && ` · ${preview.community.description}`}
              </div>
            </div>
          </div>
          <ErrorLine error={error} />
          <button
            className="btn-gold w-full py-3"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const snap = await api.joinInvite(preview.code);
                useStore.setState((s) => ({
                  snapshots: { ...s.snapshots, [snap.id]: snap },
                  communities: s.communities.some((c) => c.id === snap.id)
                    ? s.communities
                    : [...s.communities, { id: snap.id, name: snap.name, accent: snap.accent, description: snap.description }],
                }));
                useStore.getState().setView({ kind: 'community', communityId: snap.id });
                onClose();
              })
            }
          >
            {busy ? <Spinner /> : `Join ${preview.community.name}`}
          </button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => setPreview(await api.invite(parseCode(code))));
          }}
        >
          <Field label="Invite link or code">
            <input className="field" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/invite/aB3xY9 or aB3xY9" required />
          </Field>
          <ErrorLine error={error} />
          <button className="btn-gold w-full py-3" disabled={busy}>
            {busy ? <Spinner /> : 'Find community'}
          </button>
        </form>
      )}
    </Modal>
  );
}

function Invite({ onClose, communityId, name }: { onClose: () => void; communityId: string; name: string }) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState(168);
  const { error, run } = useSubmit();
  const link = code ? `${window.location.origin}/invite/${code}` : '';

  useEffect(() => {
    void run(async () => setCode((await api.createInvite(communityId, { expiresInHours: expiry || undefined })).code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, expiry]);

  return (
    <Modal title={`Invite friends to ${name}`} subtitle="Anyone with this link can join." onClose={onClose}>
      <div className="flex gap-2">
        <input className="field font-mono text-[13px]" readOnly value={link || 'Generating…'} />
        <button
          className="btn-gold shrink-0"
          disabled={!code}
          onClick={async () => {
            await navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-mist-500">
        Code <span className="font-mono text-gold-200">{code}</span> also works in the Join dialog.
      </p>
      <div className="mt-5">
        <Field label="Link expires after">
          <select className="field" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            <option value={1}>1 hour</option>
            <option value={24}>1 day</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
            <option value={0}>Never</option>
          </select>
        </Field>
      </div>
      <ErrorLine error={error} />
    </Modal>
  );
}

function CreateChannel({ onClose, communityId, category, kind: initialKind }: { onClose: () => void; communityId: string; category?: string; kind?: 'text' | 'voice' }) {
  const [kind, setKind] = useState<'text' | 'voice' | 'announcement'>(initialKind ?? 'text');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const { busy, error, run } = useSubmit();
  const kinds = [
    { k: 'text' as const, icon: Hash, t: 'Text', s: 'Messages, links and banter' },
    { k: 'voice' as const, icon: Volume2, t: 'Voice', s: 'Talk, video and screen share' },
    { k: 'announcement' as const, icon: Megaphone, t: 'Announcements', s: 'Staff-only posts' },
  ];
  return (
    <Modal title="Create a channel" subtitle={category ? `In ${category}` : undefined} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const ch: any = await api.createChannel(communityId, {
              name,
              kind,
              topic: topic || undefined,
              category: category && (kind === 'voice') === (category === 'Voice') ? category : undefined,
            });
            await useStore.getState().refreshCommunity(communityId);
            useStore.getState().setView({ kind: 'community', communityId, channelId: ch.id });
            onClose();
          });
        }}
      >
        <div className="grid gap-2">
          {kinds.map(({ k, icon: Icon, t, s }) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              className={clsx(
                'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                kind === k ? 'border-gold-400/50 bg-gold-400/[0.08]' : 'border-white/[0.06] hover:bg-white/[0.03]',
              )}
            >
              <Icon size={18} className={kind === k ? 'text-gold-300' : 'text-mist-500'} />
              <div>
                <div className="font-semibold">{t}</div>
                <div className="text-[12px] text-mist-500">{s}</div>
              </div>
            </button>
          ))}
        </div>
        <Field label="Channel name">
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'voice' ? 'Ranked Squad' : 'strat-talk'} maxLength={32} required />
        </Field>
        {kind !== 'voice' && (
          <Field label="Topic" hint="Optional">
            <input className="field" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={240} />
          </Field>
        )}
        <ErrorLine error={error} />
        <button className="btn-gold w-full py-3" disabled={busy}>
          {busy ? <Spinner /> : 'Create channel'}
        </button>
      </form>
    </Modal>
  );
}

function Report({ onClose, messageId, userId, name }: { onClose: () => void; messageId?: string; userId?: string; name?: string }) {
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();
  const presets = ['Harassment or hate', 'Spam or scam', 'Cheating or exploits', 'Threats or self-harm', 'Sexual content'];
  return (
    <Modal title="Report" subtitle={name ? `Reporting ${messageId ? 'a message from ' : ''}${name}` : undefined} onClose={onClose}>
      {done ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <Check />
          </div>
          <p className="text-mist-300">Thanks. Moderators have been notified. You can also block this person from their profile.</p>
          <button className="btn-ghost mt-6 w-full" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.report({ messageId, userId, reason });
              setDone(true);
            });
          }}
        >
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setReason(p)}
                className={clsx('rounded-full border px-3 py-1.5 text-[12.5px] transition', reason === p ? 'border-gold-400/60 bg-gold-400/15 text-gold-100' : 'border-white/10 text-mist-300 hover:bg-white/[0.04]')}
              >
                {p}
              </button>
            ))}
          </div>
          <Field label="What happened?">
            <textarea className="field min-h-[96px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required minLength={3} />
          </Field>
          <ErrorLine error={error} />
          <button className="btn-danger w-full py-3" disabled={busy}>
            {busy ? <Spinner /> : (
              <>
                <Flag size={15} /> Submit report
              </>
            )}
          </button>
        </form>
      )}
    </Modal>
  );
}

function Profile({ onClose, userId, communityId }: { onClose: () => void; userId: string; communityId?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const me = useStore((s) => s.me)!;
  const online = useStore((s) => s.online);
  const blocked = useStore((s) => s.blocked);
  const snap = useStore((s) => (communityId ? s.snapshots[communityId] : undefined));
  const toast = useStore((s) => s.toast);
  const openModal = useStore((s) => s.openModal);

  useEffect(() => {
    void api.users(userId).then(setUser).catch(() => toast('Could not load profile', 'error'));
  }, [userId, toast]);

  if (!user) return null;
  const member = snap?.members.find((m) => m.id === userId);
  const roles = snap?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? [];
  const isBlocked = blocked.has(userId);

  return (
    <Modal title="" onClose={onClose}>
      <div className="-mt-12 text-center">
        <div className="mx-auto h-24 w-full rounded-2xl" style={{ background: `linear-gradient(120deg, ${user.accent}55, transparent)` }} />
        <div className="-mt-12 flex justify-center">
          <Avatar name={user.displayName} accent={user.accent} size={88} online={online.has(user.id)} className="rounded-full ring-[6px] ring-ink-900" />
        </div>
        <h2 className="mt-3 font-display text-[30px] font-semibold">{member?.displayName ?? user.displayName}</h2>
        <p className="text-mist-500">@{user.username}</p>
        {user.statusText && <p className="mt-2 text-mist-300">{user.statusText}</p>}
        {user.bio && <p className="mx-auto mt-3 max-w-xs text-[13px] text-mist-400">{user.bio}</p>}
        {roles.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {roles.map((r) => (
              <span key={r.id} className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
              </span>
            ))}
          </div>
        )}
        {user.id !== me.id && (
          <div className="mt-6 grid grid-cols-3 gap-2">
            <button
              className="btn-gold col-span-3"
              disabled={isBlocked}
              onClick={async () => {
                try {
                  const dm = await api.openDm(user.id);
                  useStore.setState((s) => ({ dms: s.dms.some((d) => d.id === dm.id) ? s.dms : [dm, ...s.dms] }));
                  useStore.getState().setView({ kind: 'home', dmId: dm.id });
                  onClose();
                } catch (e: any) {
                  toast(e.message, 'error');
                }
              }}
            >
              <MessageCircle size={15} /> Message
            </button>
            <button
              className="btn-ghost col-span-2"
              onClick={async () => {
                if (isBlocked) await api.unblock(user.id);
                else await api.block(user.id);
                await useStore.getState().refreshBlocks();
                toast(isBlocked ? `Unblocked ${user.displayName}` : `Blocked ${user.displayName}`);
              }}
            >
              <Ban size={15} /> {isBlocked ? 'Unblock' : 'Block'}
            </button>
            <button className="btn-ghost" onClick={() => openModal('report', { userId: user.id, name: user.displayName })} title="Report">
              <Flag size={15} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const ACCENTS = ['#C9A961', '#E5B8A0', '#A7C4A0', '#8FB3D9', '#B9A3E3', '#E39BB4', '#E3C26B', '#D9D9D9'];

function UserSettings({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<'profile' | 'voice' | 'privacy'>('profile');
  const [displayName, setDisplayName] = useState(me.displayName);
  const [statusText, setStatusText] = useState(me.statusText);
  const [bio, setBio] = useState(me.bio);
  const [accent, setAccent] = useState(me.accent);
  const [blocks, setBlocks] = useState<{ id: string; displayName: string; username: string }[]>([]);
  const { busy, error, run } = useSubmit();
  const voice = useVoice();

  useEffect(() => {
    if (tab === 'privacy') void api.blocks().then(setBlocks);
    if (tab === 'voice') void voice.loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="grid gap-8 md:grid-cols-[180px_1fr]">
        <nav className="space-y-1">
          {(['profile', 'voice', 'privacy'] as const).map((t) => (
            <button key={t} className="nav-item capitalize" data-active={tab === t} onClick={() => setTab(t)}>
              {t === 'voice' ? 'Voice & audio' : t === 'privacy' ? 'Privacy & safety' : 'My profile'}
            </button>
          ))}
          <div className="my-3 h-px bg-white/[0.06]" />
          <button
            className="nav-item text-red-300 hover:text-red-200"
            onClick={() => {
              void voice.leave();
              useStore.getState().signOut();
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </nav>

        {tab === 'profile' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                useStore.getState().setMe(await api.updateMe({ displayName, statusText, bio, accent }));
                useStore.getState().toast('Profile saved');
              });
            }}
          >
            <div className="glass flex items-center gap-4 rounded-2xl p-4">
              <Avatar name={displayName || me.username} accent={accent} size={64} />
              <div>
                <div className="font-display text-[24px] font-semibold">{displayName || me.username}</div>
                <div className="text-[13px] text-mist-500">@{me.username}</div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name">
                <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required />
              </Field>
              <Field label="Status">
                <input className="field" value={statusText} onChange={(e) => setStatusText(e.target.value)} maxLength={64} placeholder="Grinding ranked" />
              </Field>
            </div>
            <Field label="About me">
              <textarea className="field min-h-[80px]" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190} />
            </Field>
            <Field label="Signature colour">
              <div className="flex gap-2">
                {ACCENTS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setAccent(c)}
                    className={clsx('h-8 w-8 rounded-full transition', accent === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : 'hover:scale-110')}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
            <ErrorLine error={error} />
            <button className="btn-gold" disabled={busy}>
              {busy ? <Spinner /> : 'Save profile'}
            </button>
          </form>
        )}

        {tab === 'voice' && (
          <div className="space-y-5">
            <Field label="Microphone">
              <select className="field" value={voice.inputId} onChange={(e) => void voice.setInput(e.target.value)}>
                <option value="default">System default</option>
                {voice.inputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Speakers / headset">
              <select className="field" value={voice.outputId} onChange={(e) => void voice.setOutput(e.target.value)}>
                <option value="default">System default</option>
                {voice.outputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Speaker'}
                  </option>
                ))}
              </select>
            </Field>
            <div className="glass flex items-center justify-between rounded-2xl p-4">
              <div>
                <div className="font-semibold">Noise suppression</div>
                <div className="text-[12.5px] text-mist-500">Filters keyboard clicks, fans and background noise.</div>
              </div>
              <Toggle checked={voice.noiseSuppression} onChange={(v) => void voice.setNoiseSuppression(v)} />
            </div>
            <p className="text-[12px] text-mist-500">Echo cancellation and automatic gain are always on. Device names appear after you allow microphone access once.</p>
          </div>
        )}

        {tab === 'privacy' && (
          <div>
            <h3 className="label mb-3">Blocked people</h3>
            {blocks.length === 0 ? (
              <p className="text-mist-500">You haven't blocked anyone.</p>
            ) : (
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="glass flex items-center justify-between rounded-2xl px-4 py-3">
                    <div>
                      <div className="font-semibold">{b.displayName}</div>
                      <div className="text-[12px] text-mist-500">@{b.username}</div>
                    </div>
                    <button
                      className="btn-ghost py-1.5"
                      onClick={async () => {
                        await api.unblock(b.id);
                        setBlocks((x) => x.filter((y) => y.id !== b.id));
                        void useStore.getState().refreshBlocks();
                      }}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-6 text-[12.5px] text-mist-500">
              Blocked people can't send you direct messages, and their messages in communities are hidden behind a click.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
