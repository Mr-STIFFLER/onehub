import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useStore } from '../lib/store';

export function initials(name: string) {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({
  name,
  accent = '#C9A961',
  size = 36,
  online,
  speaking,
  className,
}: {
  name: string;
  accent?: string;
  size?: number;
  online?: boolean;
  speaking?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className={clsx(
          'flex h-full w-full items-center justify-center rounded-full font-display font-semibold text-ink-950 transition',
          speaking && 'ring-2 ring-gold-300 ring-offset-2 ring-offset-ink-900',
        )}
        style={{
          background: `linear-gradient(140deg, ${accent} 0%, ${shade(accent, -0.35)} 100%)`,
          fontSize: size * 0.42,
        }}
      >
        {initials(name)}
      </div>
      {online !== undefined && (
        <span
          className={clsx(
            'absolute -bottom-0.5 -right-0.5 rounded-full border-[2.5px] border-ink-900',
            online ? 'bg-emerald-400' : 'bg-mist-500',
          )}
          style={{ width: size * 0.34, height: size * 0.34 }}
        />
      )}
    </div>
  );
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        className={clsx('glass relative w-full animate-fade-up rounded-3xl', wide ? 'max-w-4xl' : 'max-w-md')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-6">
          <div>
            <h2 className="font-display text-[28px] font-semibold leading-tight text-mist-100">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] text-mist-400">{subtitle}</p>}
          </div>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-7 pb-7 pt-3">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-mist-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition disabled:opacity-40',
        checked ? 'border-gold-400/60 bg-gold-400/80' : 'border-white/10 bg-ink-700',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-gold-400/30 border-t-gold-300"
      style={{ width: size, height: size }}
    />
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'glass animate-fade-up rounded-full px-5 py-2.5 text-[13px]',
            t.tone === 'error' ? 'border-red-400/30 text-red-100' : 'text-mist-100',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-400/20 bg-gold-400/[0.06] text-gold-300">
        {icon}
      </div>
      <h3 className="font-display text-[26px] font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-mist-400">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
}
