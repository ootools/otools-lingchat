/**
 * 宿主文件系统上的「Web 选择树」通用能力（SDK 侧绑定）。
 *
 * 真正的实现搬到了 `host-tree-factory.ts`，因为那份实现要被宿主转译后内联进
 * 注入运行时（插件不集成 SDK 也能用 `window.otools.pickFromHostTree`）。
 * 本文件只做一件事：把运行时自己的 `invoke` 绑上去，保持既有导出不变。
 *
 * 注意**不要**在这里挂「宿主树选择器」的全局变量。那是宿主 `embedded-runtime.js`
 * 的职责（它幂等挂载且优先），SDK 侧再挂一次等于给本模块加一个顶层副作用，
 * 会把整条 `host-tree-factory` + `runtime` 链钉死在任何插件的产物里，白背
 * 二十多 kB。
 *
 * 桌面端走 native 面板 / 宿主原生对话框即可；但在纯浏览器或远程访问时，
 * 那些都弹不出来（原生框开在服务器上，远程用户碰不到）。此时改用一棵
 * 渲染在页面里的 DOM 树，数据全部来自宿主暴露的 `tools_webview_browse_dialog`
 * / `list_dir` / `read_file`，选出来的路径是**宿主侧**路径（不是用户本机）。
 *
 * 浏览器安全限制：纯 web 永远拿不到用户本机路径，所以这里选的只能是宿主
 * 文件系统上的路径——虚拟机磁盘 / ISO 本就躺在宿主上，语义正好对得上。
 */

import { invoke } from './runtime';
import { createHostTreePicker, type HostTreePicker } from './host-tree-factory';
import type {
  OToolsHostDirEntry,
  OToolsHostReadFilePayload,
  OToolsHostBrowsePayload,
} from './otools-globals';

export type {
  HostDirEntry,
  HostReadFilePayload,
  HostBrowsePayload,
  PickFromHostTreeOptions,
  HostPickSource,
  HostPickResult,
} from './host-tree-factory';

type HostDirEntry = OToolsHostDirEntry;
type HostReadFilePayload = OToolsHostReadFilePayload;
type HostBrowsePayload = OToolsHostBrowsePayload;

/** 列宿主某目录（含根列表与父路径），对应 `tools_webview_browse_dialog`。 */
export async function browseHostDir(path?: string): Promise<HostBrowsePayload> {
  return invoke<HostBrowsePayload>('tools_webview_browse_dialog', { request: { path: path ?? '' } });
}

/** 列宿主目录下的一层条目（对应 `tools_webview_list_dir`）。 */
export async function listHostDir(path: string): Promise<HostDirEntry[]> {
  const target = String(path ?? '').trim();
  if (!target) {
    throw new Error('listHostDir requires path');
  }
  return invoke<HostDirEntry[]>('tools_webview_list_dir', { path: target });
}

/** 读宿主文件内容（对应 `tools_webview_read_file`）。 */
export async function readHostFile(path: string): Promise<HostReadFilePayload> {
  const target = String(path ?? '').trim();
  if (!target) {
    throw new Error('readHostFile requires path');
  }
  return invoke<HostReadFilePayload>('tools_webview_read_file', { path: target });
}

/** 绑定到 SDK 运行时 `invoke` 的选择器；老宿主（apiVersion < 2）才用它。惰性创建以免留下顶层副作用。 */
let localPicker: HostTreePicker | null = null;
const resolveLocalPicker = (): HostTreePicker => {
  localPicker ??= createHostTreePicker({ invoke });
  return localPicker;
};

/**
 * 宿主文件系统 DOM 选择树。
 *
 * 优先用宿主注入的 `window.otools.pickFromHostTree`（apiVersion >= 2），老宿主才回落
 * 到本地实现——两份实现同源，行为一致，但用宿主那份可以少打包一份代码。
 */
export const pickFromHostTree: HostTreePicker = (options) =>
  typeof window !== 'undefined' && typeof window.otools?.pickFromHostTree === 'function'
    ? window.otools.pickFromHostTree(options)
    : resolveLocalPicker()(options);
