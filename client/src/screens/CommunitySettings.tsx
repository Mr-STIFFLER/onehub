import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, Trash2, Crown, Check, X } from 'lucide-react';
import { api, type Report } from '../lib/api';
import { useStore } from '../lib/store';
import { can, P, PERMISSION_LABELS } from '../lib/perms';
import type { Community, Role } from '../lib/types';
import { Avatar, Field, Modal, Spinner, Toggle, timeLabel } from '../components/ui';

type Tab = 'overview' | 'roles' | 'members' | 'reports' | 'bans' | 'invites' | 'audit';

export function CommunitySettings({ onClose, communityId }: { onClose: () => void; communityId: string }) {
  const snap = useStore((s) => s.snapshots[communityId]);
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>('overview');
  if (!snap) return null;
  const perms = snap.myPermissions;
  const tabs: { k: Tab; label: string; show: boolean }[] = [
    { k: 'overview', label: 'Overview', show: true },
    { k: 'roles', label: 'Roles', show: can(perms, P.MANAGE_ROLES) },
    { k: 'members', label: 'Members', show: can(perms, P.MANAGE_ROLES) || can(perms, P.KICK_MEMBERS) || can(perms, P.BAN_MEMBERS) },
    { k: 'reports', label: 'Reports', show: can(perms, P.MANAGE_MESSAGES) },
    { k: 'bans', label: 'Bans', show: can(perms, P.BAN_MEMBERS) },
    { k: 'invites', label: 'Invites', show: can(perms, P.MANAGE_COMMUNITY) },
    { k: 'audit', label: 'Audit log', show: can(perms, P.MANAGE_COMMUNITY) },
  ];

  return (
    <Modal title={snap.name} subtitle="Community settings" onClose={onClose} wide>
      <div className="grid min-h-[440px] gap-8 md:grid-cols-[170px_1fr]">
        <nav className="space-y-1">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button key={t.k} className="nav-item" data-active={tab === t.k} onClick={() => setTab(t.k)}>
                {t.label}
              </button>
            ))}
        </nav>
        <div className="max-h-[62vh] min-w-0 overflow-y-auto pr-1">
          {tab === 'overview' && <Overview snap={snap} isOwner={snap.ownerId === me.id} onClose={onClose} />}
          {tab === 'roles' && <Roles snap={snap} />}
          {tab === 'members' && <Members snap={snap} />}
          {tab === 'reports' && <Reports snap={snap} />}
          {tab === 'bans' && <Bans snap={snap} />}
          {tab === 'invites' && <Invites snap={snap} />}
          {tab === 'audit' && <Audit snap={snap} />}
        </div>
      </div>
    </Modal>
  );
}

const ACCENTS = ['#C9A961', '#E5B8A0', '#A7C4A0', '#8FB3D9', '#B9A3E3', '#E39BB4', '#D96B6B', '#D9D9D9'];

function Overview({ snap, isOwner, onClose }: { snap: Community; isOwner: boolean; onClose: () => void }) {
  const [name, setName] = useState(snap.name);
  const [description, setDescription] = useState(snap.description);
  const [accent, setAccent] = useState(snap.accent);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const canEdit = can(snap.myPermissions, P.MANAGE_COMMUNITY);

  return (
    <div className="space-y-5">
      <Field label="Name">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} maxLength={48} />
      </Field>
      <Field label="Description">
        <textarea className="field min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} maxLength={240} />
      </Field>
      <Field label="Accent">
        <div className="flex gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c}
              disabled={!canEdit}
              onClick={() => setAccent(c)}
              className={clsx('h-8 w-8 rounded-full transition', accent === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-900' : 'hover:scale-110')}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
      {canEdit && (
        <button
          className="btn-gold"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.updateCommunity(snap.id, { name, description, accent });
              toast('Saved');
            } catch (e: any) {
              toast(e.message, 'error');
            }
            setBusy(false);
          }}
        >
          {busy ? <Spinner /> : 'Save changes'}
        </button>
      )}
      <div className="mt-8 rounded-2xl border border-red-400/15 bg-red-500/[0.04] p-5">
        <h3 className="font-semibold text-red-200">{isOwner ? 'Delete community' : 'Leave community'}</h3>
        <p className="mt-1 text-[13px] text-mist-400">
          {isOwner ? 'Permanently deletes every channel and message. This cannot be undone.' : 'You can rejoin later with an invite.'}
        </p>
        <button
          className="btn-danger mt-4"
          onClick={async () => {
            if (!confirm(isOwner ? `Delete ${snap.name} forever?` : `Leave ${snap.name}?`)) return;
            try {
              if (isOwner) await api.deleteCommunity(snap.id);
              else await api.leaveCommunity(snap.id);
              useStore.setState((s) => ({ communities: s.communities.filter((c) => c.id !== snap.id), view: { kind: 'home' } }));
              onClose();
            } catch (e: any) {
              toast(e.message, 'error');
            }
          }}
        >
          {isOwner ? 'Delete community' : 'Leave community'}
        </button>
      </div>
    </div>
  );
}

function Roles({ snap }: { snap: Community }) {
  const [selected, setSelected] = useState<string>(snap.roles[0]?.id);
  const role = snap.roles.find((r) => r.id === selected) ?? snap.roles[0];
  const toast = useStore((s) => s.toast);
  return (
    <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
      <div className="space-y-1">
        {snap.roles.map((r) => (
          <button key={r.id} className="nav-item" data-active={r.id === role?.id} onClick={() => setSelected(r.id)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="truncate">{r.name}</span>
          </button>
        ))}
        <button
          className="nav-item text-gold-300"
          onClick={async () => {
            try {
              const r: any = await api.createRole(snap.id, { name: 'New role' });
              await useStore.getState().refreshCommunity(snap.id);
              setSelected(r.id);
            } catch (e: any) {
              toast(e.message, 'error');
            }
          }}
        >
          <Plus size={15} /> Create role
        </button>
      </div>
      {role && <RoleEditor key={role.id} snap={snap} role={role} />}
    </div>
  );
}

function RoleEditor({ snap, role }: { snap: Community; role: Role }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [perms, setPerms] = useState(BigInt(role.permissions));
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const mine = BigInt(snap.myPermissions);
  const dirty = name !== role.name || color !== role.color || perms !== BigInt(role.permissions);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Role name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} disabled={role.isDefault} maxLength={32} />
        </Field>
        <Field label="Colour">
          <input type="color" className="h-[42px] w-16 cursor-pointer rounded-xl border border-white/10 bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
      </div>
      <div className="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06]">
        {PERMISSION_LABELS.map((p) => {
          const flag = P[p.key];
          const on = (perms & flag) === flag;
          return (
            <div key={p.key} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-[13.5px] font-semibold">{p.label}</div>
                <div className="text-[12px] text-mist-500">{p.hint}</div>
              </div>
              <Toggle checked={on} disabled={(mine & flag) !== flag} onChange={(v) => setPerms(v ? perms | flag : perms & ~flag)} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button
          className="btn-gold"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.updateRole(role.id, { name: role.isDefault ? undefined : name, color, permissions: perms.toString() });
              toast('Role saved');
            } catch (e: any) {
              toast(e.message, 'error');
            }
            setBusy(false);
          }}
        >
          {busy ? <Spinner /> : 'Save role'}
        </button>
        {!role.isDefault && (
          <button
            className="btn-danger"
            onClick={async () => {
              if (!confirm(`Delete the ${role.name} role?`)) return;
              try {
                await api.deleteRole(role.id);
              } catch (e: any) {
                toast(e.message, 'error');
              }
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Members({ snap }: { snap: Community }) {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const [filter, setFilter] = useState('');
  const assignable = snap.roles.filter((r) => !r.isDefault);
  const canRoles = can(snap.myPermissions, P.MANAGE_ROLES);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };
  const list = snap.members.filter((m) => `${m.displayName} ${m.username}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <input className="field mb-4" placeholder="Search members" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="space-y-2">
        {list.map((m) => (
          <div key={m.id} className="glass rounded-2xl px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar name={m.displayName} accent={m.accent} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  {m.displayName} {m.id === snap.ownerId && <Crown size={13} className="text-gold-300" />}
                </div>
                <div className="text-[12px] text-mist-500">@{m.username}</div>
              </div>
              {m.id !== me.id && m.id !== snap.ownerId && (
                <div className="flex gap-1.5">
                  {can(snap.myPermissions, P.KICK_MEMBERS) && (
                    <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={() => confirm(`Kick ${m.displayName}?`) && act(() => api.kick(snap.id, m.id), `Kicked ${m.displayName}`)}>
                      Kick
                    </button>
                  )}
                  {can(snap.myPermissions, P.BAN_MEMBERS) && (
                    <button
                      className="btn-danger px-3 py-1.5 text-[12px]"
                      onClick={() => {
                        const reason = prompt(`Ban ${m.displayName}? Optional reason:`);
                        if (reason !== null) void act(() => api.ban(snap.id, m.id, reason), `Banned ${m.displayName}`);
                      }}
                    >
                      Ban
                    </button>
                  )}
                </div>
              )}
            </div>
            {canRoles && assignable.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {assignable.map((r) => {
                  const has = m.roleIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => act(() => (has ? api.removeRole(snap.id, m.id, r.id) : api.addRole(snap.id, m.id, r.id)), has ? `Removed ${r.name}` : `Added ${r.name}`)}
                      className={clsx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition', has ? 'border-white/20 bg-white/[0.06]' : 'border-dashed border-white/10 text-mist-500 hover:text-mist-300')}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                      {r.name}
                      {has ? <X size={11} /> : <Plus size={11} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const reload = () => void fn().then(setData).catch(() => setData(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, reload };
}

function Reports({ snap }: { snap: Community }) {
  const { data, reload } = useLoad(() => api.communityReports(snap.id), [snap.id]);
  if (!data) return <Spinner />;
  if (!data.length) return <p className="text-mist-500">No reports. Quiet in here.</p>;
  return <ReportList reports={data} onChange={reload} />;
}

export function ReportList({ reports, onChange }: { reports: Report[]; onChange: () => void }) {
  const toast = useStore((s) => s.toast);
  return (
    <div className="space-y-2">
      {reports.map((r) => (
        <div key={r.id} className={clsx('glass rounded-2xl px-4 py-3', r.status !== 'open' && 'opacity-60')}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px]">
              <span className="font-semibold">{r.reporter}</span> reported <span className="font-semibold">{r.target ?? 'a user'}</span>
              <span className="text-mist-500"> · {timeLabel(r.createdAt)}</span>
            </div>
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
                r.status === 'open' ? 'bg-amber-400/15 text-amber-200' : r.status === 'actioned' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/[0.06] text-mist-400',
              )}
            >
              {r.status}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-mist-300">“{r.reason}”</p>
          {r.messageContent && <p className="mt-2 rounded-xl bg-ink-950/60 px-3 py-2 text-[13px] text-mist-400">{r.messageContent}</p>}
          {r.status === 'open' && (
            <div className="mt-3 flex gap-2">
              {r.messageId && (
                <button
                  className="btn-danger px-3 py-1.5 text-[12px]"
                  onClick={async () => {
                    try {
                      await api.deleteMessage(r.messageId!);
                      await api.setReport(r.id, 'actioned');
                      onChange();
                    } catch (e: any) {
                      toast(e.message, 'error');
                    }
                  }}
                >
                  <Trash2 size={13} /> Delete message
                </button>
              )}
              <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={async () => { await api.setReport(r.id, 'actioned'); onChange(); }}>
                <Check size={13} /> Mark handled
              </button>
              <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={async () => { await api.setReport(r.id, 'dismissed'); onChange(); }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Bans({ snap }: { snap: Community }) {
  const { data, reload } = useLoad(() => api.bans(snap.id), [snap.id]);
  if (!data) return <Spinner />;
  if (!data.length) return <p className="text-mist-500">Nobody is banned.</p>;
  return (
    <div className="space-y-2">
      {data.map((b) => (
        <div key={b.userId} className="glass flex items-center justify-between rounded-2xl px-4 py-3">
          <div>
            <div className="font-semibold">{b.displayName}</div>
            <div className="text-[12px] text-mist-500">{b.reason || 'No reason given'}</div>
          </div>
          <button className="btn-ghost py-1.5" onClick={async () => { await api.unban(snap.id, b.userId); reload(); }}>
            Revoke ban
          </button>
        </div>
      ))}
    </div>
  );
}

function Invites({ snap }: { snap: Community }) {
  const { data } = useLoad(() => api.listInvites(snap.id), [snap.id]);
  if (!data) return <Spinner />;
  if (!data.length) return <p className="text-mist-500">No invites yet.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.03] text-mist-500">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Creator</th>
            <th className="px-4 py-2 font-medium">Uses</th>
            <th className="px-4 py-2 font-medium">Expires</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {data.map((i) => (
            <tr key={i.code}>
              <td className="px-4 py-2 font-mono text-gold-200">{i.code}</td>
              <td className="px-4 py-2">{i.creator}</td>
              <td className="px-4 py-2">
                {i.uses}
                {i.maxUses ? ` / ${i.maxUses}` : ''}
              </td>
              <td className="px-4 py-2 text-mist-400">{i.expiresAt ? timeLabel(i.expiresAt) : 'Never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Audit({ snap }: { snap: Community }) {
  const { data } = useLoad(() => api.audit(snap.id), [snap.id]);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-1.5">
      {data.map((a) => (
        <div key={a.id} className="flex items-baseline justify-between gap-4 rounded-xl px-3 py-2 hover:bg-white/[0.02]">
          <div className="text-[13px]">
            <span className="font-semibold">{a.actor}</span> <span className="text-mist-400">{a.action.replace('.', ' · ')}</span>
            {a.detail?.name && <span className="text-mist-300"> “{a.detail.name}”</span>}
            {a.detail?.role && <span className="text-mist-300"> {a.detail.role}</span>}
          </div>
          <span className="shrink-0 text-[11.5px] text-mist-500">{timeLabel(a.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
