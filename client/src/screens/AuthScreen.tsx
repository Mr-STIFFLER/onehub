import { useState } from 'react';
import { ArrowRight, Server, ShieldCheck, Mic2, Zap } from 'lucide-react';
import { api, serverUrl, setServerUrl } from '../lib/api';
import { useStore } from '../lib/store';
import { Field, Spinner } from '../components/ui';

const isDesktop = '__TAURI_INTERNALS__' in window;

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [server, setServer] = useState(serverUrl);
  const [showServer, setShowServer] = useState(isDesktop && !serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedIn = useStore((s) => s.signedIn);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setServerUrl(server);
      const res = mode === 'login' ? await api.login(username, password) : await api.register(username, password, displayName);
      await signedIn(res.token, res.user);
    } catch (err: any) {
      if (err.status === 0 && isDesktop) {
        setError('Server unreachable. Run: docker compose up -d');
        setShowServer(true);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r hairline lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(800px_500px_at_20%_20%,rgba(201,169,97,0.18),transparent_60%),radial-gradient(600px_400px_at_80%_90%,rgba(110,100,190,0.14),transparent_60%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px]" />
        <div className="relative flex h-full flex-col justify-between p-14">
          <Logo />
          <div className="max-w-lg">
            <p className="label mb-5 text-gold-400">The gamer's private hub</p>
            <h1 className="font-display text-[64px] font-semibold leading-[0.98] tracking-tight">
              Every squad.
              <br />
              <span className="gold-text italic">One hub.</span>
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-mist-300">
              Crystal-clear voice, real-time chat and serious moderation, on a server you own. Built light so your game keeps every frame.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-3">
              {[
                { icon: <Mic2 size={18} />, t: 'Opus voice', s: 'Low-latency rooms' },
                { icon: <ShieldCheck size={18} />, t: 'Your server', s: 'Self-hosted data' },
                { icon: <Zap size={18} />, t: 'Feather-light', s: 'Built for gameplay' },
              ].map((f) => (
                <div key={f.t} className="glass rounded-2xl p-4">
                  <div className="mb-3 text-gold-300">{f.icon}</div>
                  <div className="text-[13px] font-semibold">{f.t}</div>
                  <div className="text-[12px] text-mist-500">{f.s}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[12px] text-mist-500">© ONEHUB · Free communication, forever.</p>
        </div>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-[400px] animate-fade-up">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h2 className="font-display text-[40px] font-semibold leading-none">
            {mode === 'login' ? 'Welcome back' : 'Claim your name'}
          </h2>
          <p className="mt-3 text-mist-400">
            {mode === 'login' ? 'Sign in to rejoin your communities.' : 'Create an account. It takes ten seconds.'}
          </p>

          <div className="mt-8 space-y-4">
            {mode === 'register' && (
              <Field label="Display name">
                <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How friends see you" maxLength={32} />
              </Field>
            )}
            <Field label="Username">
              <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nightowl" autoComplete="username" autoFocus required />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
              <input
                className="field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </Field>
            {showServer && (
              <Field label="Server address" hint="Your ONEHUB server, e.g. https://hub.example.com">
                <input className="field" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://" />
              </Field>
            )}
          </div>

          {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">{error}</p>}

          <button className="btn-gold mt-7 w-full py-3" disabled={busy}>
            {busy ? <Spinner /> : mode === 'login' ? 'Sign in' : 'Create account'}
            {!busy && <ArrowRight size={16} />}
          </button>

          <div className="mt-6 flex items-center justify-between text-[13px]">
            <button type="button" className="text-mist-400 hover:text-gold-200" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
            </button>
            <button type="button" className="flex items-center gap-1.5 text-mist-500 hover:text-mist-300" onClick={() => setShowServer((v) => !v)}>
              <Server size={13} /> Server
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo.svg" alt="" className={small ? 'h-8 w-8' : 'h-10 w-10'} />
      {!small && <span className="font-display text-[26px] font-semibold tracking-[0.18em]">ONEHUB</span>}
    </div>
  );
}
