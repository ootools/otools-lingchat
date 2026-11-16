/**
 * 宿主文件系统「页面内 DOM 选择树」工厂。
 *
 * 桌面端有原生面板；纯浏览器 / 远程访问时原生框开在服务器上、远程用户碰不到，
 * 于是改用一棵渲染在页面里的 DOM 树，数据来自宿主 `tools_webview_browse_dialog`
 * / `list_dir` / `read_file`，选出来的路径是**宿主侧**路径。
 *
 * 这个文件是**可被注入运行时转译的工厂**（见 scripts/sync-service-injection.mjs），
 * 因此只允许 `import type`，不得引用任何运行时值——宿主把本文件转译后内联进
 * `embedded-runtime.js`，插件即使不集成 SDK 也能用 `window.otools.pickFromHostTree`。
 */

import type {
  OToolsHostDirEntry,
  OToolsHostReadFilePayload,
  OToolsHostBrowsePayload,
} from './otools-globals';

/** 注入运行时 / SDK 共用的最小调用面。 */
export interface HostTreeTransport {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export type HostDirEntry = OToolsHostDirEntry;
export type HostReadFilePayload = OToolsHostReadFilePayload;
export type HostBrowsePayload = OToolsHostBrowsePayload;

export interface PickFromHostTreeOptions {
  title?: string;
  /** true=选目录，false=选文件。 */
  directory?: boolean;
  /** 多文件选择；目录选择返回当前目录。 */
  multiple?: boolean;
  /** 初始目录；缺省由宿主返回 home。 */
  startPath?: string;
  filters?: { name: string; extensions: string[] }[];
  /**
   * 初始是否显示以 `.` 开头的隐藏项（`.git`、`.env`…），默认 false。
   * 对话框里有一个开关可以随时切换，这里只决定打开时的初始状态。
   */
  showHidden?: boolean;
}

export type HostPickSource = 'host-tree';

export interface HostPickResult {
  kind: 'picked' | 'cancelled';
  source: HostPickSource;
  paths: string[];
  names: string[];
}

/** 绑定好 transport 的选择器函数签名（`window.otools.pickFromHostTree` 就是它）。 */
export type HostTreePicker = (options: PickFromHostTreeOptions) => Promise<HostPickResult>;


/**
 * 造一个绑定到指定 transport 的宿主文件树选择器。
 *
 * 不依赖任何 UI 框架（原生 DOM），Vue / React / 纯 web 都能用。返回结果带
 * `source: "host-tree"`，调用方据此区分「宿主侧路径」与「用户本机路径」。
 */
export function createHostTreePicker(
  transport: HostTreeTransport,
): HostTreePicker {
  /** 列宿主某目录（含根列表与父路径），对应 `tools_webview_browse_dialog`。 */
  const browse = (path?: string): Promise<HostBrowsePayload> =>
    transport.invoke<HostBrowsePayload>('tools_webview_browse_dialog', {
      request: { path: path ?? '' },
    });

const matchesFilter = (
  entry: HostDirEntry,
  filters?: PickFromHostTreeOptions['filters'],
): boolean => {
  if (!filters?.length) {
    return true;
  }
  if (entry.kind === 'directory') {
    return true;
  }
  const ext = entry.name.includes('.')
    ? entry.name.split('.').pop()!.toLowerCase()
    : '';
  return filters.some(
    (filter) =>
      filter.extensions.some((raw) => raw.trim().toLowerCase().replace(/^\./, '') === ext),
  );
};

function injectHostTreeStyle(): void {
  if (document.getElementById('otools-host-tree-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'otools-host-tree-style';
  style.textContent = HOST_TREE_CSS;
  document.head.appendChild(style);
}

/**
 * 弹出一棵宿主文件系统 DOM 树，用户导航后选中目录 / 文件并返回宿主侧路径。
 *
 * 不依赖任何 UI 框架（原生 DOM），所以 Vue / React / 纯 web 都能用。返回结果
 * 带 `source: 'host-tree'`，调用方据此区分「宿主侧路径」与「用户本机路径」。
 */

async function pickFromHostTree(
  options: PickFromHostTreeOptions,
): Promise<HostPickResult> {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('pickFromHostTree requires a DOM document');
  }

  const directory = Boolean(options.directory);
  const multiple = Boolean(options.multiple) && !directory;
  const title = options.title ?? (directory ? '选择目录' : '选择文件');
  /** 宿主会把 `.git`、`.env`、`.DS_Store` 一并返回，默认按惯例先藏起来。 */
  let showHidden = Boolean(options.showHidden);
  let lastPayload: HostBrowsePayload | null = null;

  return new Promise<HostPickResult>((resolve) => {
    let currentPath = '';
    let requestedPath = options.startPath ?? '';
    let ready = false;
    let closed = false;
    let requestId = 0;
    const selected = new Set<string>();

    injectHostTreeStyle();

    const overlay = document.createElement('div');
    overlay.setAttribute('data-host-tree', '');
    overlay.className = 'otools-host-tree-overlay';

    const panel = document.createElement('div');
    panel.className = 'otools-host-tree-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    overlay.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'otools-host-tree-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'otools-host-tree-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    const pathEl = document.createElement('div');
    pathEl.className = 'otools-host-tree-path';
    header.appendChild(pathEl);
    panel.appendChild(header);

    const statusEl = document.createElement('div');
    statusEl.className = 'otools-host-tree-status';
    statusEl.setAttribute('role', 'status');
    statusEl.hidden = true;
    const statusText = document.createElement('span');
    statusText.setAttribute('data-host-tree-error', '');
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'otools-host-tree-btn';
    retryBtn.textContent = '重试';
    retryBtn.setAttribute('data-host-tree-retry', '');
    statusEl.appendChild(statusText);
    statusEl.appendChild(retryBtn);
    panel.appendChild(statusEl);

    const body = document.createElement('div');
    body.className = 'otools-host-tree-body';
    panel.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'otools-host-tree-footer';
    // 放在页脚最左，不挤占「取消 / 选择」的右侧动作区。
    const hiddenToggle = document.createElement('label');
    hiddenToggle.className = 'otools-host-tree-toggle';
    hiddenToggle.title = '显示或隐藏以 . 开头的文件（如 .git、.env）';
    const hiddenBox = document.createElement('input');
    hiddenBox.type = 'checkbox';
    hiddenBox.checked = showHidden;
    hiddenBox.setAttribute('data-host-tree-show-hidden', '');
    hiddenToggle.appendChild(hiddenBox);
    hiddenToggle.appendChild(document.createTextNode('显示隐藏文件'));
    footer.appendChild(hiddenToggle);
    const selectionEl = document.createElement('div');
    selectionEl.className = 'otools-host-tree-selection';
    selectionEl.setAttribute('data-host-tree-selection', '');
    selectionEl.setAttribute('role', 'status');
    selectionEl.textContent = directory ? '请选择目录' : '请选择文件';
    footer.appendChild(selectionEl);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'otools-host-tree-btn';
    cancelBtn.setAttribute('data-host-tree-cancel', '');
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = directory ? '选择此目录' : '选择';
    confirmBtn.className = 'otools-host-tree-btn otools-host-tree-btn-primary';
    confirmBtn.setAttribute('data-host-tree-confirm', '');
    confirmBtn.disabled = true;
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    panel.appendChild(footer);

    const updateConfirm = () => {
      confirmBtn.disabled = !ready || (directory ? !currentPath : !selected.size);
      pathEl.classList.toggle('otools-host-tree-current', directory && ready && Boolean(currentPath));
      selectionEl.textContent = directory && ready
        ? `已选目录：${currentPath}`
        : selected.size ? `已选 ${selected.size} 个文件` : directory ? '请选择目录' : '请选择文件';
      selectionEl.title = directory && ready ? currentPath : '';
    };

    const close = (result: HostPickResult) => {
      if (closed) return;
      closed = true;
      requestId += 1;
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close({ kind: 'cancelled', source: 'host-tree', paths: [], names: [] });
      }
    };
    window.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        close({ kind: 'cancelled', source: 'host-tree', paths: [], names: [] });
      }
    });

    cancelBtn.addEventListener('click', () =>
      close({ kind: 'cancelled', source: 'host-tree', paths: [], names: [] }),
    );

    confirmBtn.addEventListener('click', () => {
      if (confirmBtn.disabled) return;
      const paths = directory ? [currentPath] : Array.from(selected);
      close({
        kind: 'picked',
        source: 'host-tree',
        paths,
        names: paths.map(path => path.split(/[\\/]/).filter(Boolean).pop() || path),
      });
    });

    const render = (payload: HostBrowsePayload) => {
      if (!payload || typeof payload.currentPath !== 'string' || !payload.currentPath
        || !Array.isArray(payload.roots) || !Array.isArray(payload.entries)) {
        throw new Error('宿主返回的目录数据无效');
      }
      currentPath = payload.currentPath;
      lastPayload = payload;
      pathEl.textContent = currentPath;
      body.replaceChildren();

      if (payload.parentPath) {
        const upRow = document.createElement('div');
        upRow.className = 'otools-host-tree-entry otools-host-tree-up';
        upRow.setAttribute('data-host-tree-up', '');
        upRow.setAttribute('data-path', payload.parentPath);
        upRow.setAttribute('data-kind', 'directory');
        upRow.textContent = '↑ 上一级';
        body.appendChild(upRow);
      }

      for (const root of payload.roots) {
        const row = document.createElement('div');
        row.className = 'otools-host-tree-entry otools-host-tree-root';
        row.setAttribute('data-host-tree-root', '');
        row.setAttribute('data-path', root.path);
        row.setAttribute('data-kind', 'directory');
        row.textContent = `📁 ${root.name}  (${root.path})`;
        body.appendChild(row);
      }

      const isHidden = (entry: HostDirEntry) => entry.name.startsWith('.');
      const usable = payload.entries.filter((entry) =>
        entry.kind === 'file' || entry.kind === 'directory',
      );
      const hiddenCount = usable.filter(isHidden).length;
      const visible = usable.filter((entry) =>
        (showHidden || !isHidden(entry)) && matchesFilter(entry, options.filters),
      );
      for (const entry of visible) {
        const row = document.createElement('div');
        row.className = 'otools-host-tree-entry';
        row.setAttribute('data-host-tree-entry', '');
        row.setAttribute('data-path', entry.path);
        row.setAttribute('data-kind', entry.kind);
        const label = document.createElement('span');
        label.className = 'otools-host-tree-entry-label';
        label.textContent = entry.kind === 'directory' ? `📁 ${entry.name}` : `📄 ${entry.name}`;
        row.appendChild(label);
        if (!directory && entry.kind === 'file') {
          row.setAttribute('aria-selected', 'false');
          const check = document.createElement('span');
          check.className = 'otools-host-tree-check';
          check.setAttribute('data-host-tree-check', '');
          check.setAttribute('aria-hidden', 'true');
          check.textContent = '✓';
          check.hidden = true;
          row.appendChild(check);
        }
        body.appendChild(row);
      }

      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'otools-host-tree-empty';
        empty.textContent = hiddenCount > 0 && !showHidden
          ? `该目录只有 ${hiddenCount} 个隐藏项，勾选「显示隐藏文件」查看`
          : '该目录为空';
        body.appendChild(empty);
      }
    };

    const load = async (path: string) => {
      if (closed) return;
      const id = ++requestId;
      requestedPath = path;
      ready = false;
      selected.clear();
      updateConfirm();
      statusEl.hidden = true;
      body.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'otools-host-tree-empty';
      loading.textContent = '正在读取目录…';
      body.appendChild(loading);
      try {
        const payload = await browse(path);
        if (closed || id !== requestId) return;
        render(payload);
        ready = true;
        updateConfirm();
      } catch (error) {
        if (closed || id !== requestId) return;
        body.replaceChildren();
        statusText.textContent = `无法读取宿主目录：${error instanceof Error ? error.message : String(error)}`;
        statusEl.hidden = false;
      }
    };

    retryBtn.addEventListener('click', () => void load(requestedPath));

    // 切换只重画当前目录，不重新问宿主：`browse_dialog` 已经把隐藏项一起返回了。
    hiddenBox.addEventListener('change', () => {
      showHidden = hiddenBox.checked;
      if (lastPayload) render(lastPayload);
      updateConfirm();
    });

    // Keep selection and navigation inside the current webview, without opening
    // a native dialog that takes focus away from the host Panel.
    body.addEventListener('click', (event) => {
      if (!ready || !(event.target instanceof Element)) return;
      const row = event.target.closest(
        '[data-host-tree-entry],[data-host-tree-root],[data-host-tree-up]',
      ) as HTMLElement | null;
      if (!row || !body.contains(row)) return;
      const path = row.getAttribute('data-path') || '';
      const kind = row.getAttribute('data-kind');
      if (!path) return;
      if (kind === 'directory') {
        void load(path);
      } else if (!directory && kind === 'file') {
        if (multiple) {
          if (selected.has(path)) selected.delete(path);
          else selected.add(path);
        } else {
          selected.clear();
          selected.add(path);
        }
        body.querySelectorAll<HTMLElement>('[data-host-tree-entry]').forEach(entry => {
          const isSelected = selected.has(entry.getAttribute('data-path') || '');
          entry.classList.toggle('otools-host-tree-selected', isSelected);
          if (entry.getAttribute('data-kind') === 'file') entry.setAttribute('aria-selected', String(isSelected));
          const check = entry.querySelector<HTMLElement>('[data-host-tree-check]');
          if (check) check.hidden = !isSelected;
        });
        updateConfirm();
      }
    });

    document.body.appendChild(overlay);
    void load(requestedPath);
  });
}

  return pickFromHostTree;
}

const HOST_TREE_CSS = `
.otools-host-tree-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483000;
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.otools-host-tree-panel {
  width: min(560px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  color: #1d1d1f;
}
.otools-host-tree-header {
  padding: 14px 18px 10px;
  border-bottom: 1px solid #ececec;
}
.otools-host-tree-title {
  font-size: 15px;
  font-weight: 600;
}
.otools-host-tree-path {
  margin-top: 4px;
  font-size: 12px;
  color: #6b6b70;
  word-break: break-all;
}
.otools-host-tree-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  font-size: 13px;
  color: #b42318;
}
.otools-host-tree-status[hidden] { display: none; }
.otools-host-tree-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px 8px;
  min-height: 220px;
}
.otools-host-tree-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.otools-host-tree-entry:hover {
  background: #f2f2f4;
}
.otools-host-tree-up,
.otools-host-tree-root {
  color: #2b6fff;
}
.otools-host-tree-selected {
  background: #dbeafe !important;
  color: #174ea6 !important;
  box-shadow: inset 3px 0 #2563eb;
  font-weight: 600;
}
.otools-host-tree-entry-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.otools-host-tree-check { color: #174ea6; font-weight: 700; }
.otools-host-tree-check[hidden] { display: none; }
.otools-host-tree-current {
  background: #dbeafe;
  color: #174ea6;
  border-radius: 6px;
  padding: 6px 8px;
}
.otools-host-tree-selection {
  flex: 1;
  min-width: 0;
  color: #174ea6;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.otools-host-tree-empty {
  padding: 18px 10px;
  text-align: center;
  color: #9a9aa0;
  font-size: 13px;
}
.otools-host-tree-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #ececec;
}
.otools-host-tree-toggle {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #4a4a4f;
  cursor: pointer;
  user-select: none;
}
.otools-host-tree-toggle input {
  margin: 0;
  cursor: pointer;
}
.otools-host-tree-btn {
  padding: 7px 16px;
  border: 1px solid #d6d6da;
  border-radius: 8px;
  background: #f7f7f9;
  font-size: 13px;
  cursor: pointer;
}
.otools-host-tree-btn-primary {
  background: #2b6fff;
  border-color: #2b6fff;
  color: #fff;
}
.otools-host-tree-btn-primary:disabled {
  background: #b9c8ee;
  border-color: #b9c8ee;
  cursor: not-allowed;
}
`;
