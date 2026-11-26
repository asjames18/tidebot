import { useEffect, useState } from 'react';
import { api, type LatestReleaseResponse } from '../lib/api';
import { DesktopUpdateButton } from './DesktopUpdateButton';

const DISMISS_KEY = 'tidebot-release-dismissed-tag';

// Dismissible "what's new" notice for self-hosters, fed by the server's
// cached check of the public GitHub Releases API (RAK-41). Shown only when
// the running install is behind the newest published release; dismissal is
// remembered per release tag so the next release resurfaces it.
export function ReleaseNotice() {
  const [info, setInfo] = useState<LatestReleaseResponse | null>(null);
  const [dismissedTag, setDismissedTag] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.latestRelease()
      .then((r) => { if (alive && r.updateAvailable && r.release) setInfo(r); })
      .catch(() => { /* offline or rate-limited: stay quiet */ });
    return () => { alive = false; };
  }, []);

  if (!info?.release || dismissedTag === info.release.tag) return null;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === info.release.tag && dismissedTag === null) {
    // Already dismissed in a previous session; hide without re-render churn.
    return null;
  }
  const release = info.release;
  return (
    <div className="release-notice" role="status">
      <div className="release-notice-text">
        <strong>{release.name}</strong> is available — this install runs {info.current}.{' '}
        <a href={release.url} target="_blank" rel="noreferrer noopener">What&rsquo;s new</a>
        <DesktopUpdateButton className="release-notice-update" />
      </div>
      <button
        type="button"
        className="release-notice-close"
        aria-label="Dismiss update notice"
        onClick={() => {
          if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, release.tag);
          setDismissedTag(release.tag);
        }}
      >
        ✕
      </button>
    </div>
  );
}
