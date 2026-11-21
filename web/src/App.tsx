import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './store';
import { SignIn } from './components/SignIn';

const Shell = lazy(() => import('./components/Shell').then((m) => ({ default: m.Shell })));

export function App() {
  const authChecked = useStore((s) => s.authChecked);
  const user = useStore((s) => s.user);
  useEffect(() => { useStore.getState().checkAuth(); }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      if (window.innerWidth <= 900) {
        document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      } else {
        document.documentElement.style.removeProperty('--app-h');
      }
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      document.documentElement.style.removeProperty('--app-h');
    };
  }, []);
  if (!authChecked) return <div className="boot" />;
  return user ? <Suspense fallback={<div className="boot" />}><Shell /></Suspense> : <SignIn />;
}
