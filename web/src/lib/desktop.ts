interface DesktopBridge {
  platform?: string;
  openGitReview?: () => Promise<void>;
  checkForUpdates?: () => Promise<void>;
}

function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return;
  return (window as Window & { tidebotDesktop?: DesktopBridge }).tidebotDesktop;
}

export function hasNativeDesktopWindow(): boolean {
  return Boolean(desktopBridge()?.platform);
}

export function gitReviewLauncher(): (() => Promise<void>) | undefined {
  return desktopBridge()?.openGitReview;
}

export function desktopUpdateChecker(): (() => Promise<void>) | undefined {
  return desktopBridge()?.checkForUpdates;
}
