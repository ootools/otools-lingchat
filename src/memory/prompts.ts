import { MEMORY_LIMITS, truncateChars, type MemoryBank, type MemorySection } from './schema';

// Ported from LingChat persistent_memory_system.rs init_prompts (AGPL-3.0-only).
const BASE = '你是一个专业的【记忆档案管理员】。你的任务是基于【旧的记忆档案】和【新增的对话日志】，'
  + '生成一份更新后的、逻辑连贯的记忆文本。\n'
  + '通用规则：\n'
  + "1. 视角：必须严格使用【第三人称】（例如：'（用户的名字）提到...'，'（本AI角色的名字）感到...'）。\n"
  + '2. 时态：使用陈述语气，客观记录事实。\n'
  + '3. 输出：直接输出更新后的内容本身，不要包含任何解释。\n'
  + '4. 逻辑：如果没有新信息需要更新，请原样保留【旧的记忆档案】的内容。\n'
  + '5. 内容完整性：如果【旧的记忆档案】中存在被截断或不完整的片段，请直接丢弃，不要保留或引用它们。\n';
export const SECTION_PROMPTS: Record<MemorySection, string> = {
  short_term: BASE + '\n【任务目标】：生成一份【短期上下文摘要】，用于在下一次对话中承接话题。\n'
    + '【处理逻辑】：\n1. 概括话题：他们刚才在聊什么？话题是否已经结束？\n'
    + '2. 捕捉氛围：当前的对话气氛如何？\n3. 遗忘机制：删除旧记忆中已经过时、结束或不再相关的琐碎细节。\n'
    + '4. 篇幅控制：保持在 100-200 字以内。\n',
  long_term: BASE + '\n【任务目标】：编撰一份【角色经历编年史】，记录具有长期价值的核心事件。\n'
    + '【处理逻辑】：\n1. 过滤噪音：忽略日常问候和闲聊。\n2. 提取事件：只记录具有里程碑意义的事件。\n'
    + '3. 累积更新：将新发生的关键事件追加到旧档案中。\n',
  user_info: BASE + '\n【任务目标】：更新【taの画像】，确保 AI 了解屏幕对面的人。\n'
    + '【处理逻辑】：\n1. 事实提取：提取用户的姓名、年龄、职业、喜好、雷点等。\n'
    + '2. 冲突修正：如果信息冲突（如换了工作），以【新增对话】为准。\n',
  promises: BASE + '\n【任务目标】：维护一份【待办与契约清单】。\n'
    + '【处理逻辑】：\n1. 新增约定：提取对话中明确达成的承诺。\n'
    + '2. 状态核销：如果能够在【新增对话】中找到已完成的证据，从清单中【删除】该条目。\n',
};
export function summaryPrompt(section: MemorySection, bank: MemoryBank, chatText: string): string {
  return `${SECTION_PROMPTS[section]}\n\n【旧内容】：\n${truncateChars(bank.data[section], MEMORY_LIMITS[section])}\n\n【新增对话】：\n${truncateChars(chatText, 16_000)}\n\n【新内容】(直接输出结果，不要废话)：`;
}
