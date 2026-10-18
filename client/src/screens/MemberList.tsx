import { useMemo } from 'react';
import { Crown } from 'lucide-react';
import { useStore } from '../lib/store';
import type { Community, Member } from '../lib/types';
import { Avatar } from '../components/ui';

export function MemberList({ community }: { community: Community }) {
  const online = useStore((s) => s.online);
  const openModal = useStore((s) => s.openModal);

  const sections = useMemo(() => {
    // Hoist members into their highest coloured role, like a seating chart.
    const roles = community.roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
    const buckets = new Map<string, Member[]>(roles.map((r) => [r.id, []]));
    const on: Member[] = [];
    const off: Member[] = [];
    for (const m of community.members) {
      const isOn = online.has(m.id);
      if (!isOn) {
        off.push(m);
        continue;
      }
      const top = roles.find((r) => m.roleIds.includes(r.id));
      if (top) buckets.get(top.id)!.push(m);
      else on.push(m);
    }
    return [
      ...roles.filter((r) => buckets.get(r.id)!.length).map((r) => ({ key: r.id, title: r.name, color: r.color, members: buckets.get(r.id)! })),
      { key: 'online', title: 'Online', color: undefined, members: on },
      { key: 'offline', title: 'Offline', color: undefined, members: off },
    ].filter((s) => s.members.length);
  }, [community, online]);

  return (
    <aside className="hidden w-[240px] shrink-0 overflow-y-auto border-l hairline bg-ink-900/50 px-3 py-5 xl:block">
      {sections.map((s) => (
        <section key={s.key} className="mb-5">
          <h3 className="label mb-1.5 px-2" style={s.color ? { color: s.color } : undefined}>
            {s.title} — {s.members.length}
          </h3>
          {s.members.map((m) => (
            <button
              key={m.id}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
              style={{ opacity: s.key === 'offline' ? 0.45 : 1 }}
              onClick={() => openModal('profile', { userId: m.id, communityId: community.id })}
            >
              <Avatar name={m.displayName} accent={m.accent} size={32} online={online.has(m.id)} />
              <div className="min-w-0">
                <div className="flex items-center gap-1 truncate text-[13.5px]" style={s.color ? { color: s.color } : undefined}>
                  {m.displayName}
                  {m.id === community.ownerId && <Crown size={12} className="shrink-0 text-gold-300" />}
                </div>
                {m.statusText && <div className="truncate text-[11.5px] text-mist-500">{m.statusText}</div>}
              </div>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}
