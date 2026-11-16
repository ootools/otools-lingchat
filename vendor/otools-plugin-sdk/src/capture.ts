/**
 * 截屏实例（薄层）。
 *
 * 宿主从 apiVersion 1 起就在 `window.otools.capture` 上提供同一份实现。这里用惰性
 * 代理转发过去，老宿主才回落到本地 `createCaptureApi`——这样插件不必再打包一份
 * 截屏实现，`createCaptureApi` 也从公开面移除了（它是宿主注入运行时的构建源）。
 */

import { invoke, listenTauri } from './runtime';
import { createCaptureApi, type CaptureApi } from './capture-factory';

/** 只再导出类型；`createCaptureApi` 不再是对外 API。 */
export type * from './capture-factory';

/**
 * 错误类要能构造、能 `instanceof`，所以是值导出——但只带这一个 class，
 * `createCaptureApi` / `normalizeError` 会被摇树丢掉。
 */
export { CaptureError } from './capture-factory';

/**
 * 惰性创建本地实现。
 *
 * 不能在模块顶层直接 `createCaptureApi(...)`：那是一次顶层副作用，打包器没法把
 * 未使用 `capture` 的插件里的这份实现摇掉。改成用到才建。
 */
let local: CaptureApi | null = null;

const resolveCapture = (): CaptureApi => {
  const fromHost = typeof window !== 'undefined' ? window.otools?.capture : undefined;
  if (fromHost) {
    return fromHost;
  }
  local ??= createCaptureApi({ invoke, listen: listenTauri });
  return local;
};

/**
 * 截屏 API。优先转发到 `window.otools.capture`，老宿主回落本地实现。
 *
 * 用代理而不是直接取引用：插件模块可能在宿主注入 `window.otools` 之前就被求值
 * （比如开发模式的 ESM 预加载），取引用会拿到 undefined 并永久失效。
 */
export const capture: CaptureApi = new Proxy({} as CaptureApi, {
  get(_target, prop) {
    const source = resolveCapture() as unknown as Record<string | symbol, unknown>;
    const value = source[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(source) : value;
  },
});
