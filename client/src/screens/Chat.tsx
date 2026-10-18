import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Hash, Megaphone, Pencil, Trash2, Flag, SendHorizontal, AtSign, Users, EyeOff, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { can, P } from '../lib/perms';
import type { Channel, Community, DmThread, Message } from '../lib/types';
import { Avatar, Empty, Spinner, timeLabel } from '../components/ui';
import { Markdown } from '../components/Markdown';

type Props = { scope: string; title: string; topic?: string; community?: Community; channel?: Channel; dm?: DmThread };

const EMPTY: Message[] = [];

export function Chat({ scope, title, topic, community, channel, dm }: Props) {
  const messages = useStore((s) => s.messages[scope]) ?? EMPTY;
  const loaded = useStore((s) => scope in s.messages);
  const hasMore = useStore((s) => s.hasMore[scope]);
  const loadMessages = useStore((s) => s.loadMessages);
  const typing = useStore((s) => (channel ? s.typing[channel.id] : undefined));
  const me = useStore((s) => s.me)!;
  const blocked = useStore((s) => s.blocked);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    stick.current = true;
    void loadMessages(scope);
  }, [scope, loadMessages]);

  // Expire typing indicators.
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1500);
    return () => window.clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prevHeight.current && loadingOlder) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
      setLoadingOlder(false);
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, loadingOlder]);

  async function onScroll() {
    const el = listRef.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && !loadingOlder) {
      prevHeight.current = el.scrollHeight;
      setLoadingOlder(true);
      await loadMessages(scope, true);
    }
  }

  const perms = community?.myPermissions;
  const canSend = channel
    ? channel.kind === 'announcement'
      ? can(perms, P.MANAGE_CHANNELS)
      : can(perms, P.SEND_MESSAGES)
    : true;
  const canModerate = can(perms, P.MANAGE_MESSAGES);

  const rows = useMemo(() => groupMessages(messages), [messages]);
  const typers = (typing ?? []).filter((t) => t.until > Date.now());
  const Icon = channel?.kind === 'announcement' ? Megaphone : channel ? Hash : AtSign;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b hairline px-6">
        {dm ? <Avatar name={dm.user.displayName} accent={dm.user.accent} size={28} online={useStore.getState().online.has(dm.user.id)} /> : <Icon size={18} className="text-gold-300" />}
        <h1 className="font-display text-[21px] font-semibold">{title}</h1>
        {topic && (
          <>
            <span className="h-4 w-px bg-white/10" />
            <p className="truncate text-[13px] text-mist-500">{topic}</p>
          </>
        )}
        {community && (
          <div className="ml-auto flex items-center gap-1.5 text-[12px] text-mist-500">
            <Users size={14} /> {community.members.length}
          </div>
        )}
      </header>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {!loaded ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : messages.length === 0 ? (
          <Empty
            icon={<Icon />}
            title={dm ? `You and ${dm.user.displayName}` : `Welcome to #${title}`}
            body={dm ? 'This is the beginning of your private conversation.' : topic || 'This is the very start of the channel. Say hello.'}
          />
        ) : (
          <>
            {loadingOlder && (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            )}
            {!hasMore && (
              <div className="px-6 pb-6 pt-10">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-400/20 bg-gold-400/[0.06] text-gold-300">
                  <Icon size={24} />
                </div>
                <h2 className="font-display text-[30px] font-semibold">{dm ? dm.user.displayName : `#${title}`}</h2>
                <p className="text-mist-500">The beginning of this conversation.</p>
              </div>
            )}
            {rows.map((r) =>
              r.type === 'day' ? (
                <div key={r.key} className="my-4 flex items-center gap-3 px-6">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="label">{r.label}</span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              ) : (
                <MessageRow
                  key={r.m.id}
                  m={r.m}
                  head={r.head}
                  mine={r.m.author.id === me.id}
                  meName={me.username}
                  canModerate={canModerate}
                  hidden={blocked.has(r.m.author.id)}
                  editing={editing === r.m.id}
                  setEditing={setEditing}
                />
              ),
            )}
          </>
        )}
      </div>

      <Composer
        key={scope}
        scope={scope}
        channelId={channel?.id}
        dmId={dm?.id}
        placeholder={canSend ? `Message ${dm ? dm.user.displayName : `#${title}`}` : 'Only staff can post here'}
        disabled={!canSend}
        typers={typers.map((t) => t.name)}
        onSent={() => (stick.current = true)}
      />
    </div>
  );
}

type Row = { type: 'day'; key: string; label: string } | { type: 'msg'; m: Message; head: boolean };

function groupMessages(messages: Message[]): Row[] {
  const out: Row[] = [];
  let prev: Message | undefined;
  for (const m of messages) {
    const d = new Date(m.createdAt);
    if (!prev || new Date(prev.createdAt).toDateString() !== d.toDateString()) {
      out.push({ type: 'day', key: `day-${d.toDateString()}`, label: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) });
      prev = undefined;
    }
    const head = !prev || prev.author.id !== m.author.id || d.getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
    out.push({ type: 'msg', m, head });
    prev = m;
  }
  return out;
}

function MessageRow({
  m,
  head,
  mine,
  meName,
  canModerate,
  hidden,
  editing,
  setEditing,
}: {
  m: Message;
  head: boolean;
  mine: boolean;
  meName: string;
  canModerate: boolean;
  hidden: boolean;
  editing: boolean;
  setEditing: (id: string | null) => void;
}) {
  const openModal = useStore((s) => s.openModal);
  const toast = useStore((s) => s.toast);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const mention = m.content.toLowerCase().includes(`@${meName.toLowerCase()}`);

  async function saveEdit() {
    const content = draft.trim();
    setEditing(null);
    if (!content || content === m.content) return;
    try {
      useStore.getState().upsertMessage(await api.editMessage(m.id, content));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function remove() {
    if (!confirm('Delete this message?')) return;
    try {
      await api.deleteMessage(m.id);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  if (hidden && !reveal) {
    return (
      <button className="mx-4 my-0.5 flex items-center gap-2 rounded-lg px-4 py-1.5 text-[12.5px] text-mist-500 hover:bg-white/[0.02]" onClick={() => setReveal(true)}>
        <EyeOff size={13} /> Message from a blocked user. Click to show.
      </button>
    );
  }

  return (
    <div
      className={clsx(
        'group relative mx-2 flex gap-3.5 rounded-xl px-4 transition hover:bg-white/[0.025]',
        head ? 'mt-3 pt-1.5' : 'py-0.5',
        mention && 'bg-gold-400/[0.06] shadow-[inset_2px_0_0_0_#C9A961] hover:bg-gold-400/[0.09]',
      )}
    >
      <div className="w-10 shrink-0">
        {head ? (
          <button onClick={() => openModal('profile', { userId: m.author.id })}>
            <Avatar name={m.author.displayName} accent={m.author.accent} size={40} />
          </button>
        ) : (
          <span className="invisible block pt-1 text-right text-[10.5px] text-mist-500 group-hover:visible">
            {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 pb-1">
        {head && (
          <div className="flex items-baseline gap-2">
            <button className="font-semibold hover:underline" style={{ color: m.author.accent }} onClick={() => openModal('profile', { userId: m.author.id })}>
              {m.author.displayName}
            </button>
            <span className="text-[11.5px] text-mist-500">{timeLabel(m.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              className="field min-h-[44px] resize-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === 'Escape') setEditing(null);
              }}
            />
            <p className="mt-1 text-[11.5px] text-mist-500">Enter to save · Esc to cancel</p>
          </div>
        ) : (
          <div className="text-[14.5px]">
            <Markdown text={m.content} meName={meName} />
            {m.editedAt && <span className="text-[11px] text-mist-500"> (edited)</span>}
          </div>
        )}
      </div>
      {!editing && (
        <div className="glass absolute -top-3 right-4 hidden items-center rounded-lg p-0.5 group-hover:flex">
          <button className="icon-btn h-7 w-7" title="Copy text" onClick={() => void navigator.clipboard?.writeText(m.content)}>
            <Copy size={14} />
          </button>
          {mine && (
            <button className="icon-btn h-7 w-7" title="Edit" onClick={() => { setDraft(m.content); setEditing(m.id); }}>
              <Pencil size={14} />
            </button>
          )}
          {!mine && (
            <button className="icon-btn h-7 w-7" title="Report" onClick={() => openModal('report', { messageId: m.id, name: m.author.displayName })}>
              <Flag size={14} />
            </button>
          )}
          {(mine || (canModerate && m.channelId)) && (
            <button className="icon-btn h-7 w-7 hover:text-red-300" title="Delete" onClick={() => void remove()}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Composer({
  scope,
  channelId,
  dmId,
  placeholder,
  disabled,
  typers,
  onSent,
}: {
  scope: string;
  channelId?: string;
  dmId?: string;
  placeholder: string;
  disabled: boolean;
  typers: string[];
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const m = channelId ? await api.send(channelId, content) : await api.sendDm(dmId!, content);
      useStore.getState().upsertMessage(m);
      setText('');
      lastTyping.current = 0;
      onSent();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  function onChange(v: string) {
    setText(v);
    if (channelId && v && Date.now() - lastTyping.current > 4000) {
      lastTyping.current = Date.now();
      void api.typing(channelId).catch(() => {});
    }
  }

  return (
    <div className="shrink-0 px-6 pb-5">
      <div
        className={clsx(
          'glass flex items-end gap-2 rounded-2xl px-4 py-2 transition focus-within:border-gold-400/40 focus-within:shadow-glow',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          data-scope={scope}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          className="max-h-[220px] min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-[14.5px] text-mist-100 placeholder:text-mist-500 focus:outline-none"
        />
        <button
          className={clsx('mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition', text.trim() ? 'bg-gold-sheen text-ink-950' : 'text-mist-500')}
          disabled={disabled || !text.trim()}
          onClick={() => void send()}
          aria-label="Send"
        >
          {sending ? <Spinner size={15} /> : <SendHorizontal size={17} />}
        </button>
      </div>
      <div className="h-5 px-1 pt-1 text-[12px] text-mist-500">
        {typers.length > 0 && (
          <span className="animate-fade-up">
            <span className="text-gold-200">{typers.slice(0, 3).join(', ')}</span> {typers.length === 1 ? 'is' : 'are'} typing…
          </span>
        )}
      </div>
    </div>
  );
}
