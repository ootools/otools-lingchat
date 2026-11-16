/**
 * 「关键词派发」接口（SDK 侧绑定）。
 *
 * 实现搬到了 `keyword-factory.ts`，因为那份实现要被宿主转译后内联进注入运行时
 * （插件不集成 SDK 也能用 `window.otools.onOtoolsKeyword`）。本文件只把 SDK 运行时
 * 的 `invokeTauri` / `listenTauri` 绑上去，保持既有导出与语义不变。
 *
 * 插件侧一行订阅：
 *
 *   import { onOtoolsKeyword } from "otools-plugin-sdk";
 *   const unlisten = await onOtoolsKeyword((items) => {
 *     for (const { keyword, payload, source } of items) {
 *       // 按 keyword 做出响应；响应可经 window.otools.invoke / emit 回传宿主。
 *     }
 *   });
 *
 * 事件只做「敲门」，载荷一律通过 `otools_consume_keyword_dispatch` 取走，所以
 * 无论插件 listener 与宿主投递谁先谁后、插件是否已经运行，关键词都不会丢。
 */

import { invokeTauri, listenTauri } from "./runtime";
import { createKeywordListener, type KeywordListener } from "./keyword-factory";

export {
  OTOOLS_KEYWORD_DISPATCH_EVENT,
  type OtoolsKeywordDispatch,
  type KeywordUnlisten,
} from "./keyword-factory";

/** 绑定到 SDK 运行时 `invokeTauri` / `listenTauri` 的订阅器；老宿主（apiVersion < 2）才用它。惰性创建以免留下顶层副作用。 */
let localListener: KeywordListener | null = null;
const resolveLocalListener = (): KeywordListener => {
  localListener ??= createKeywordListener({
    invoke: <T,>(command: string, args?: Record<string, unknown>) => invokeTauri<T>(command, args),
    listen: <T,>(event: string, handler: (event: { payload: T }) => void) =>
      listenTauri<T>(event, handler),
  });
  return localListener;
};

/**
 * 订阅宿主派发的关键词。
 *
 * 优先用宿主注入的 `window.otools.onOtoolsKeyword`（apiVersion >= 2），老宿主才回落
 * 到本地实现。
 */
export const onOtoolsKeyword: KeywordListener = (handler) =>
  typeof window !== 'undefined' && typeof window.otools?.onOtoolsKeyword === 'function'
    ? window.otools.onOtoolsKeyword(handler)
    : resolveLocalListener()(handler);
