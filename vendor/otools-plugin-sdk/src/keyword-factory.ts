/**
 * 「关键词派发」接口工厂：宿主把关键词（可带任意 payload）投递给插件。
 *
 * 宿主侧链路（见宿主 platform/keyword_dispatch.rs）：关键词先排进按 pluginUuid
 * 分桶的队列，再对插件 webview `emit_to("otools-keyword-dispatch")` 敲门。事件只做
 * 敲门，真正载荷一律通过 `otools_consume_keyword_dispatch` 取走——无论插件 listener
 * 与宿主投递谁先谁后、插件是否已经运行，关键词都不会丢：
 *
 *   - 宿主先投递（如「快捷键 → 关键词」在按下瞬间入队）、插件后启动：启动时
 *     listen 注册完成后立即 consume 一次即可取走；
 *   - 插件先启动、宿主后投递：敲门命中已注册的 listener，再 consume 取走。
 *
 * 插件侧一行订阅即可（不集成 SDK 时用注入版）：
 *
 *   const unlisten = await window.otools.onOtoolsKeyword((items) => {
 *     for (const { keyword, payload, source } of items) { ... }
 *   });
 *
 * 本文件是**可被注入运行时转译的工厂**（见 scripts/sync-service-injection.mjs），
 * 因此只允许 `import type`，不得引用任何运行时值。
 */

/** 宿主投递敲门事件名（与宿主 platform/keyword_dispatch.rs 的 KEYWORD_DISPATCH_EVENT 对齐）。 */
export const OTOOLS_KEYWORD_DISPATCH_EVENT = 'otools-keyword-dispatch';

export interface OtoolsKeywordDispatch {
  /** 单条派发标识（宿主生成），可用于响应回传时的关联。 */
  id: string;
  /** 小写归一化后的关键词。 */
  keyword: string;
  /** 宿主附带的任意 JSON 载荷，可为 null。 */
  payload: unknown;
  /** 派发来源：shortcut / host / mcp / plugin… */
  source: string;
  createdAtMs: number;
}

export type KeywordUnlisten = () => void | Promise<void>;

/** 绑定好 transport 的订阅器签名（`window.otools.onOtoolsKeyword` 就是它）。 */
export type KeywordListener = (
  handler: (items: OtoolsKeywordDispatch[]) => void,
) => Promise<KeywordUnlisten>;

/** 注入运行时 / SDK 共用的最小调用面。 */
export interface KeywordTransport {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<KeywordUnlisten>;
  /** 解析当前插件 uuid；缺省按 `__OToolsEnv` → URL 参数兜底。 */
  resolvePluginUuid?: () => string;
  /** 当前 webview label；缺省读 `__TAURI_INTERNALS__.metadata.currentWebview.label`。 */
  getTargetLabel?: () => string;
}

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

const readWebviewLabel = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? '';
  } catch {
    return '';
  }
};

/**
 * 造一个绑定到指定 transport 的关键词订阅器。
 *
 * @returns `onOtoolsKeyword(handler)`：返回 unlisten。收到关键词按 id 去重合并后
 *          触发；批量派发一次回调给全量。
 */
export function createKeywordListener(
  transport: KeywordTransport,
): KeywordListener {
  const resolvePluginUuid = transport.resolvePluginUuid ?? readEnvPluginUuid;
  const getTargetLabel = transport.getTargetLabel ?? readWebviewLabel;

  interface KeywordMailbox {
    entries: unknown[];
    consuming: Promise<void> | null;
  }
  const keywordMailboxes = new Map<string, KeywordMailbox>();

  return async function onOtoolsKeyword(handler) {
    const pluginUuid = resolvePluginUuid();
    const targetLabel = getTargetLabel();
    const key = JSON.stringify([pluginUuid.toLowerCase(), targetLabel || '']);
    const mailbox = keywordMailboxes.get(key) || { entries: [], consuming: null };
    keywordMailboxes.set(key, mailbox);
    const consumeAlreadyInFlight = mailbox.consuming;
    const seenIds = new Set<string>();
    let stopped = false;
    let dirty = false;
    let consuming: Promise<void> | null = null;

    const deliver = (items: readonly unknown[]) => {
      const fresh: OtoolsKeywordDispatch[] = [];
      for (const raw of items) {
        if (!raw || typeof raw !== 'object') {
          continue;
        }
        const item = raw as Partial<OtoolsKeywordDispatch>;
        if (typeof item.id !== 'string' || !item.id.trim()
          || typeof item.keyword !== 'string' || !item.keyword.trim()
          || seenIds.has(item.id)) {
          continue;
        }
        seenIds.add(item.id);
        fresh.push(item as OtoolsKeywordDispatch);
      }
      if (seenIds.size > 512) {
        const keep = Array.from(seenIds).slice(-256);
        seenIds.clear();
        for (const id of keep) {
          seenIds.add(id);
        }
      }
      if (fresh.length && !stopped) {
        handler(fresh);
      }
    };

    const consume = (): Promise<void> => {
      dirty = true;
      if (consuming) {
        return consuming;
      }
      consuming = (async () => {
        while (dirty && !stopped) {
          dirty = false;
          if (!pluginUuid) {
            return;
          }
          if (!mailbox.consuming) {
            const args = targetLabel ? { pluginUuid, targetLabel } : { pluginUuid };
            mailbox.consuming = transport.invoke<unknown>('otools_consume_keyword_dispatch', args)
              .then((items) => { if (Array.isArray(items)) mailbox.entries.push(...items); })
              .finally(() => { mailbox.consuming = null; });
          }
          try {
            await mailbox.consuming;
          } catch {
            continue;
          }
          if (!stopped) {
            const entries = mailbox.entries;
            mailbox.entries = [];
            deliver(entries);
          }
        }
      })().finally(() => { consuming = null; });
      return consuming;
    };

    const unlisten = await transport.listen<string>(OTOOLS_KEYWORD_DISPATCH_EVENT, (event) => {
      const target = event?.payload;
      if (!stopped && (typeof target !== 'string'
        || target.toLowerCase() === resolvePluginUuid().toLowerCase())) {
        void consume();
      }
    });
    if (consumeAlreadyInFlight) {
      void consumeAlreadyInFlight.catch(() => {}).then(() => { if (!stopped) void consume(); });
    } else {
      void consume();
    }

    return async () => {
      stopped = true;
      dirty = false;
      await unlisten();
    };
  };
}
