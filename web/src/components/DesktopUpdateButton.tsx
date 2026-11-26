import { useState } from 'react';
import { desktopUpdateChecker } from '../lib/desktop';
import { useStore } from '../store';

export function DesktopUpdateButton({ className }: { className: string }) {
  const check = desktopUpdateChecker();
  const [checking, setChecking] = useState(false);
  if (!check) return null;

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      await check();
    } catch {
      useStore.getState().notify('Could not check for desktop updates. Try GitHub Releases.');
    } finally {
      setChecking(false);
    }
  };

  return <button type="button" className={className} disabled={checking} onClick={() => void checkForUpdates()}>
    {checking ? 'Checking…' : 'Check for updates'}
  </button>;
}
