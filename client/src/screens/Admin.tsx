import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Activity, Users, MessagesSquare, Flag, Server, Radio } from 'lucide-react';
import { api, type AdminStats, type AdminUser, type Report } from '../lib/api';
import { useStore } from '../lib/store';
import { Spinner, timeLabel } from '../components/ui';
import { ReportList } from './CommunitySettings';

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [tab, setTab] = useState<'reports' | 'users'>('reports');
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);

  const load = () => {
    void api.adminStats().then(setStats);
    void api.adminUsers().then(setUsers);
    void api.adminReports().then(setReports);
  };
  useEffect(() => {
    load();
    const t = window.setInterval(() => void api.adminStats().then(setStats), 10000);
    return () => window.clearInterval(t);
  }, []);

  const tiles = stats
    ? [
        { icon: Radio, label: 'Online now', value: stats.online },
        { icon: Users, label: 'Accounts', value: stats.users },
        { icon: Server, label: 'Communities', value: stats.communities },
        { icon: MessagesSquare, label: 'Messages, 24h', value: stats.messages24h },
        { icon: Flag, label: 'Open reports', value: stats.openReports, warn: stats.openReports > 0 },
        { icon: Activity, label: 'Uptime', value: formatUptime(stats.uptimeSeconds) },
      ]
    : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="border-b hairline px-8 pb-6 pt-8">
        <p className="label text-gold-400">Instance administration</p>
        <h1 className="mt-2 font-display text-[38px] font-semibold leading-none">Control room</h1>
        <p className="mt-2 text-mist-400">Health, accounts and safety for this ONEHUB server.</p>
      </header>
      <div className="p-8">
        {!stats ? (
          <Spinner size={24} />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
            {tiles.map((t) => (
              <div key={t.label} className="glass rounded-2xl p-5">
                <t.icon size={18} className={t.warn ? 'text-amber-300' : 'text-gold-300'} />
                <div className="mt-4 font-display text-[36px] font-semibold leading-none tabular-nums">{t.value}</div>
                <div className="mt-1.5 text-[12px] text-mist-500">{t.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex gap-1 border-b hairline">
          {(['reports', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx('-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold capitalize transition', tab === t ? 'border-gold-300 text-mist-100' : 'border-transparent text-mist-500 hover:text-mist-300')}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-5">
          {tab === 'reports' &&
            (reports.length ? <ReportList reports={reports} onChange={load} /> : <p className="text-mist-500">No reports on this instance.</p>)}
          {tab === 'users' && (
            <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-white/[0.03] text-mist-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {users.map((u) => (
                    <tr key={u.id} className={u.disabled ? 'opacity-50' : undefined}>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold">{u.displayName}</div>
                        <div className="text-[12px] text-mist-500">@{u.username}</div>
                      </td>
                      <td className="px-4 py-2.5 text-mist-400">{timeLabel(u.createdAt)}</td>
                      <td className="px-4 py-2.5">{u.isAdmin ? <span className="text-gold-200">Admin</span> : 'Member'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {u.id !== me.id && (
                          <button
                            className={u.disabled ? 'btn-ghost px-3 py-1.5 text-[12px]' : 'btn-danger px-3 py-1.5 text-[12px]'}
                            onClick={async () => {
                              try {
                                await api.adminSetUser(u.id, { disabled: !u.disabled });
                                load();
                              } catch (e: any) {
                                toast(e.message, 'error');
                              }
                            }}
                          >
                            {u.disabled ? 'Restore' : 'Disable'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatUptime(s: number) {
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
