/**
 * 「打开文件」接口（SDK 侧绑定）。
 *
 * 实现搬到了 `file-open-factory.ts`，因为那份实现要被宿主转译后内联进注入运行时
 * （插件不集成 SDK 也能用 `window.otools.onOtoolsOpenFile`）。本文件只把 SDK 运行时
 * 的 `invoke` / `listen` 绑上去，保持既有导出与语义不变。
 *
 * 宿主侧链路：文件路径先排进按 pluginUuid 分桶的队列，再对插件 webview
 * `emit_to("otools-open-file")` 敲门；事件只做敲门，载荷一律通过
 * `otools_consume_open_files` 取走，所以插件先启动还是宿主先投递都不会丢件。
 */

import { invoke, listen } from "./runtime";
import { createFileOpenListener, type FileOpenListener } from "./file-open-factory";

export {
  OTOOLS_FILE_DELIVER_EVENT,
  parseLaunchOpenFiles,
  toOpenFileEntries,
  type OtoolsOpenFileEntry,
  type FileOpenListener,
  type FileOpenUnlisten,
} from "./file-open-factory";

/** 绑定到 SDK 运行时 `invoke` / `listen` 的订阅器；老宿主（apiVersion < 2）才用它。惰性创建以免留下顶层副作用。 */
let localListener: FileOpenListener | null = null;
const resolveLocalListener = (): FileOpenListener => {
  localListener ??= createFileOpenListener({
    invoke: <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
    listen: <T,>(event: string, handler: (event: { payload: T }) => void) =>
      listen<T>(event, handler),
  });
  return localListener;
};

/**
 * 订阅宿主投递的文件。
 *
 * 优先用宿主注入的 `window.otools.onOtoolsOpenFile`（apiVersion >= 2），老宿主才
 * 回落到本地实现。
 */
export const onOtoolsOpenFile: FileOpenListener = (handler) =>
  typeof window !== 'undefined' && typeof window.otools?.onOtoolsOpenFile === 'function'
    ? window.otools.onOtoolsOpenFile(handler)
    : resolveLocalListener()(handler);
