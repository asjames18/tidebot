export function hasNativeDesktopWindow(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { tidebotDesktop?: { platform?: string } }).tidebotDesktop?.platform);
}
