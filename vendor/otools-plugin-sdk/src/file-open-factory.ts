/**
 * 「打开文件」接口工厂：宿主把 OS 双击 / 拖进来的文件投递给插件。
 *
 * 宿主侧链路（见宿主 platform/file_open.rs）：文件路径先排进按 pluginUuid 分桶的
 * 投递队列，再对插件 webview `emit_to("otools-open-file")` 敲门。事件只做敲门，
 * 真正载荷一律通过 `otools_consume_open_files` 取走——这样无论插件 listener 与
 * 宿主投递谁先谁后，文件都不会丢：
 *
 *   - 宿主先投递、插件后启动：启动时 listen 注册完成后立即 consume 一次即可取走；
 *   - 插件先启动、宿主后投递：敲门命中已注册的 listener，再 consume 取走。
 *
 * 另有 URL 参数兜底（新开标签时宿主会把 `?otoolsOpenFile=[...]` 拼进插件 URL），
 * 与队列内容按「3 秒窗口内同路径去重」合并，避免同一路径双份回调。
 *
 * 本文件是**可被注入运行时转译的工厂**（见 scripts/sync-service-injection.mjs），
 * 因此只允许 `import type`，不得引用任何运行时值。
 */

/** 宿主投递敲门事件名（与宿主 platform/file_open.rs 的 FILE_DELIVER_EVENT 对齐）。 */
export const OTOOLS_FILE_DELIVER_EVENT = 'otools-open-file';

export interface OtoolsOpenFileEntry {
  path: string;
  name: string;
  ext: string;
}

export type FileOpenUnlisten = () => void | Promise<void>;

/** 绑定好 transport 的订阅器签名（`window.otools.onOtoolsOpenFile` 就是它）。 */
export type FileOpenListener = (
  handler: (files: OtoolsOpenFileEntry[]) => void,
) => Promise<FileOpenUnlisten>;

/** 注入运行时 / SDK 共用的最小调用面。 */
export interface FileOpenTransport {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<FileOpenUnlisten>;
  /** 解析当前插件 uuid；缺省按 `__OToolsEnv` → URL 参数兜底。 */
  resolvePluginUuid?: () => string;
}

const DEDUPE_WINDOW_MS = 3000;

/** 解析宿主拼进插件 URL 的 `otoolsOpenFile` 参数（JSON 数组）。 */
export function parseLaunchOpenFiles(search: string): string[] {
  if (!search) {
    return [];
  }
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('otoolsOpenFile');
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function toOpenFileEntries(paths: readonly string[]): OtoolsOpenFileEntry[] {
  return paths.map((path) => {
    const normalized = String(path || '').trim();
    const segments = normalized.split(/[\\/]/);
    const name = segments[segments.length - 1] || normalized;
    const dotIndex = name.lastIndexOf('.');
    const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
    return { path: normalized, name, ext };
  });
}

/** 插件身份：与 runtime 的 readPluginUuidFromContext 同源（env 注入优先，URL 参数兜底）。 */
const readEnvPluginUuid = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    const env = (window as { __OToolsEnv?: { pluginUuid?: unknown } }).__OToolsEnv;
    const fromEnv = typeof env?.pluginUuid === 'string' ? env.pluginUuid.trim() : '';
    if (fromEnv) {
      return fromEnv;
    }
    const params = new URLSearchParams(window.location?.search || '');
    const fromParams = (
      params.get('plugin') ||
      params.get('pluginUuid') ||
      params.get('plugin_uuid') ||
      ''
    ).trim();
    if (fromParams) {
      return fromParams;
    }
  } catch {
    // 非浏览器环境或受限 window，交给调用方自行处理。
  }
  return '';
};

/**
 * 造一个绑定到指定 transport 的「打开文件」订阅器。
 *
 * @returns `onOtoolsOpenFile(handler)`：返回 unlisten。收到文件（按 path 去重窗口
 *          合并后）触发；批量投递一次回调给全量。
 */
export function createFileOpenListener(
  transport: FileOpenTransport,
): FileOpenListener {
  const resolvePluginUuid = transport.resolvePluginUuid ?? readEnvPluginUuid;

  return async function onOtoolsOpenFile(handler) {
    const recentPaths = new Map<string, number>();

    const deliver = (paths: readonly string[]) => {
      const now = Date.now();
      const fresh: string[] = [];
      for (const path of paths) {
        const normalized = String(path || '').trim();
        if (!normalized) {
          continue;
        }
        const seenAt = recentPaths.get(normalized);
        if (typeof seenAt === 'number' && now - seenAt < DEDUPE_WINDOW_MS) {
          continue;
        }
        recentPaths.set(normalized, now);
        fresh.push(normalized);
      }
      if (recentPaths.size > 256) {
        for (const [path, seenAt] of recentPaths) {
          if (now - seenAt >= DEDUPE_WINDOW_MS) {
            recentPaths.delete(path);
          }
        }
      }
      if (fresh.length) {
        handler(toOpenFileEntries(fresh));
      }
    };

    const consume = async () => {
      const pluginUuid = resolvePluginUuid();
      if (!pluginUuid) {
        return;
      }
      let paths: string[] = [];
      try {
        const result = await transport.invoke<string[]>('otools_consume_open_files', { pluginUuid });
        paths = Array.isArray(result) ? result.map(String) : [];
      } catch {
        // 宿主未就绪（老版本宿主 / 浏览器直开）：静默，等下一次敲门。
        return;
      }
      deliver(paths);
    };

    // 先注册 listener 再启动 consume：保证「consume 取空后宿主才投递」的窗口内
    // 敲门一定能命中 listener，不漏件。
    const unlisten = await transport.listen<string>(OTOOLS_FILE_DELIVER_EVENT, () => {
      void consume();
    });

    const launchPaths = parseLaunchOpenFiles(
      typeof window !== 'undefined' ? window.location?.search || '' : '',
    );
    if (launchPaths.length) {
      // URL 参数先记账：随后的 consume 即便也取到同一路径也会被去重窗口滤掉。
      deliver(launchPaths);
    }
    void consume();

    return unlisten;
  };
}
