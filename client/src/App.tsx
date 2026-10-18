import { useEffect } from 'react';
import { useStore } from './lib/store';
import { AuthScreen } from './screens/AuthScreen';
import { Shell } from './screens/Shell';
import { Spinner, Toasts } from './components/ui';

export function App() {
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const boot = useStore((s) => s.boot);

  useEffect(() => {
    // Invite links (/invite/<code>) open the join dialog once signed in.
    const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)/);
    if (m) {
      try {
        sessionStorage.setItem('onehub.pendingInvite', m[1]);
      } catch {
        /* ignore */
      }
      window.history.replaceState(null, '', '/');
    }
    void boot();
  }, [boot]);

  return (
    <>
      {booting ? (
        <div className="flex h-full items-center justify-center">
          <Spinner size={28} />
        </div>
      ) : me ? (
        <Shell />
      ) : (
        <AuthScreen />
      )}
      <Toasts />
    </>
  );
}
