import { Fragment, type ReactNode } from 'react';

/** A small, safe Markdown subset rendered straight to React nodes (no HTML injection). */
export function Markdown({ text, meName }: { text: string; meName?: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```(?:\w+\n)?([\s\S]*?)```/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(<pre key={i}>{part.replace(/\n$/, '')}</pre>);
      return;
    }
    const lines = part.split('\n');
    lines.forEach((line, j) => {
      const key = `${i}-${j}`;
      if (line.startsWith('> ')) blocks.push(<blockquote key={key}>{inline(line.slice(2), meName)}</blockquote>);
      else {
        blocks.push(<Fragment key={key}>{inline(line, meName)}</Fragment>);
        if (j < lines.length - 1) blocks.push(<br key={`${key}-br`} />);
      }
    });
  });
  return <div className="md whitespace-pre-wrap break-words leading-relaxed text-mist-100/95">{blocks}</div>;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|https?:\/\/[^\s<]+|@[a-z0-9_.]{3,24})/gi;

function inline(s: string, meName?: string): ReactNode[] {
  return s.split(TOKEN).map((t, i) => {
    if (!t) return null;
    if (t.startsWith('`') && t.endsWith('`') && t.length > 2) return <code key={i}>{t.slice(1, -1)}</code>;
    if (t.startsWith('**') && t.endsWith('**') && t.length > 4) return <strong key={i} className="font-semibold text-white">{t.slice(2, -2)}</strong>;
    if (t.startsWith('~~') && t.endsWith('~~') && t.length > 4) return <s key={i}>{t.slice(2, -2)}</s>;
    if (t.startsWith('*') && t.endsWith('*') && t.length > 2) return <em key={i}>{t.slice(1, -1)}</em>;
    if (/^https?:\/\//i.test(t))
      return (
        <a key={i} href={t} target="_blank" rel="noreferrer noopener">
          {t}
        </a>
      );
    if (t.startsWith('@')) {
      const mine = meName && t.slice(1).toLowerCase() === meName.toLowerCase();
      return (
        <span key={i} className={mine ? 'rounded bg-gold-400/25 px-1 text-gold-100' : 'rounded bg-white/[0.06] px-1 text-gold-200'}>
          {t}
        </span>
      );
    }
    return <Fragment key={i}>{t}</Fragment>;
  });
}
