import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './store';
import { SignIn } from './components/SignIn';

const Shell = lazy(() => import('./components/Shell').then((m) => ({ default: m.Shell })));

export function App() {
  const authChecked = useStore((s) => s.authChecked);
  const user = useStore((s) => s.user);
  useEffect(() => { useStore.getState().checkAuth(); }, []);
  if (!authChecked) return <div className="boot" />;
  return user ? <Suspense fallback={<div className="boot" />}><Shell /></Suspense> : <SignIn />;
}
