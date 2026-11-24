// App-shell update handling for the service worker in web/public/sw.js.
//
// The worker calls skipWaiting(), so a newly deployed worker activates
// immediately and claims existing tabs. A tab still running the old bundle
// must then reload exactly once: its lazily imported asset chunks may no
// longer exist once the worker's activate step deletes the old shell cache.
//
// The reload is skipped when no controller existed yet — that first claim is
// the initial install, not an update, and reloading would discard state for
// no benefit.
export function watchForAppUpdates(sw: ServiceWorkerContainer, reload: () => void): void {
  const hadController = Boolean(sw.controller);
  let reloaded = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    reload();
  });
}
