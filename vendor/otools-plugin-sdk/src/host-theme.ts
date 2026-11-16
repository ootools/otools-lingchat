export type HostThemeOverride = 'light' | 'dark' | null;
export type HostThemeOptions = { background?: string | null };
export type SetTempHostTheme = (theme: HostThemeOverride, options?: HostThemeOptions) => Promise<void>;

/** 外壳背景仅接受安全的纯色 CSS 颜色写法；其余（url()/var() 等）在发送前拒绝。 */
const BACKGROUND_PATTERN = /^(?:transparent|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\([0-9 .,%/]{1,40}\))$/i;

export const isValidHostThemeBackground = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 48 && BACKGROUND_PATTERN.test(value);

export const createTempHostThemeSetter = (transport: {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  isNative?: () => boolean;
}): SetTempHostTheme => {
  let sequence = 0;
  let declaration: { theme: HostThemeOverride; background: string | null } | undefined;
  let browserReadyListener = false;
  const sendToParent = (theme: HostThemeOverride, background: string | null): Promise<void> => {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return Promise.reject(new Error('Host theme API unavailable'));
    const parent = window.parent;
    const id = `host-theme-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const clean = () => { window.removeEventListener('message', receive); clearTimeout(timer); };
      const receive = (event: MessageEvent) => {
        if (event.source !== parent || event.data?.type !== 'otools:host-theme-result' || event.data.id !== id) return;
        clean();
        if (event.data.ok === true) resolve(); else reject(new Error(String(event.data.error || 'Host theme request rejected')));
      };
      const timer = setTimeout(() => { clean(); reject(new Error('Host theme request timed out')); }, 3000);
      window.addEventListener('message', receive);
      try { parent.postMessage({ type: 'otools:host-theme', id, theme, background }, '*'); } catch (error) { clean(); reject(error); }
    });
  };
  return async (theme, options) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== null) throw new Error('Invalid host theme');
    const requestedBackground = options?.background ?? null;
    if (requestedBackground !== null) {
      if (theme === null) throw new Error('Host theme background requires a theme');
      if (!isValidHostThemeBackground(requestedBackground)) throw new Error('Invalid host theme background');
    }
    const background = requestedBackground;
    if (transport.isNative?.() === false) {
      declaration = { theme, background };
      if (!browserReadyListener && typeof window !== 'undefined') {
        browserReadyListener = true;
        window.addEventListener('message', (event: MessageEvent) => {
          if (event.source === window.parent && event.data?.type === 'otools:host-theme-ready' && declaration !== undefined) {
            void sendToParent(declaration.theme, declaration.background).catch(() => {});
          }
        });
      }
      return sendToParent(theme, background);
    }
    await transport.invoke('otools_host_set_theme_override', { theme, background });
  };
};
