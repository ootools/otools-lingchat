/** The current plugin page's container, not the user's preferred launch mode. */
export type PageMode = 'panel' | 'tabs' | 'window';

export const createPageModeGetter = (): (() => PageMode) => () => {
  if (typeof window === 'undefined') return 'window';
  const valid = (value: unknown): value is PageMode => value === 'panel' || value === 'tabs' || value === 'window';
  try {
    const mode = window.__OToolsEnv?.pageMode;
    if (valid(mode)) return mode;
  } catch { /* Unavailable host context falls through to local-only hints. */ }
  try {
    if (window.__OTOOLS_CUSTOM_WINDOW__ || window.document?.documentElement?.hasAttribute('data-otools-custom')) return 'window';
    if (window.document?.documentElement?.hasAttribute('data-otools-panel')) return 'panel';
  } catch { /* DOM access may not be available at preload time. */ }
  try {
    const label = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (label === 'otools-panel') return 'panel';
    if (label === 'main') return 'tabs';
    if (label) return 'window';
  } catch { /* Do not read an ancestor's native window metadata. */ }
  try {
    const mode = window.frameElement?.getAttribute('data-otools-page-mode');
    if (valid(mode)) return mode;
  } catch { /* Cross-origin iframe context cannot be identified synchronously. */ }
  return 'window';
};
