export function hasNativeDesktopWindow(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { tidebotDesktop?: { platform?: string } }).tidebotDesktop?.platform);
}

export function gitReviewLauncher(): (() => Promise<void>) | undefined {
  if (typeof window === 'undefined') return;
  return (window as Window & { tidebotDesktop?: { openGitReview?: () => Promise<void> } }).tidebotDesktop?.openGitReview;
}
