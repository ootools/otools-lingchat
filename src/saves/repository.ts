import { cloneValue, type AsyncStore } from './store';
import { emptyMemory, validateMemory, type MemoryBank } from '../memory/schema';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; memoryEligible: boolean }
export interface RoleState {
  saveId: string; roleId: string; generation: string; revision: number;
  persona: string; outfitId: string | null; scriptState: Record<string, JsonValue>;
  bond: number; achievements: string[]; messages: ChatMessage[]; memory: MemoryBank;
}
export interface SaveRecord {
  schemaVersion: 1; id: string; name: string; createdAt: string; updatedAt: string;
  roles: Record<string, RoleState>;
}
export type RolePatch = Partial<Pick<RoleState, 'persona' | 'outfitId' | 'scriptState' | 'bond' | 'achievements'>>;
const PREFIX = 'save:';
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || reserved.has(value)) throw new Error('Invalid identifier');
}
function text(value: unknown, max = 100_000): value is string { return typeof value === 'string' && value.length <= max; }
function validJson(value: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(v => validJson(v, depth + 1));
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.entries(value).every(([k, v]) => !reserved.has(k) && validJson(v, depth + 1));
}
function validateRole(role: RoleState, saveId: string, roleId: string): void {
  if (!role || role.saveId !== saveId || role.roleId !== roleId || !text(role.generation, 200)
    || !Number.isSafeInteger(role.revision) || role.revision < 0 || !text(role.persona)
    || !(role.outfitId === null || text(role.outfitId, 500)) || !Number.isFinite(role.bond)
    || !Array.isArray(role.achievements) || !role.achievements.every(v => text(v, 500))
    || !role.scriptState || Array.isArray(role.scriptState) || typeof role.scriptState !== 'object' || !validJson(role.scriptState)
    || !Array.isArray(role.messages) || role.messages.length > 100_000) throw new Error('Invalid role schema');
  const ids = new Set<string>();
  for (const message of role.messages) {
    if (!message || !text(message.id, 200) || ids.has(message.id) || !['user', 'assistant'].includes(message.role)
      || !text(message.text) || !text(message.createdAt, 100) || !Number.isFinite(Date.parse(message.createdAt))
      || typeof message.memoryEligible !== 'boolean') throw new Error('Invalid message schema');
    ids.add(message.id);
  }
  validateMemory(role.memory);
  if (role.memory.meta.last_processed_global_idx > role.messages.length) throw new Error('Invalid memory cursor');
}
function validateSave(save: SaveRecord): void {
  if (!save || save.schemaVersion !== 1) throw new Error('Invalid save schema version');
  identifier(save.id);
  if (!text(save.name, 500) || !text(save.createdAt, 100) || !text(save.updatedAt, 100)
    || !Number.isFinite(Date.parse(save.createdAt)) || !Number.isFinite(Date.parse(save.updatedAt))
    || !save.roles || Array.isArray(save.roles) || typeof save.roles !== 'object') throw new Error('Invalid save schema');
  for (const [roleId, role] of Object.entries(save.roles)) { identifier(roleId); validateRole(role, save.id, roleId); }
}
function newRole(saveId: string, roleId: string): RoleState {
  return { saveId, roleId, generation: crypto.randomUUID(), revision: 0, persona: '', outfitId: null,
    scriptState: {}, bond: 0, achievements: [], messages: [], memory: emptyMemory() };
}

export class SaveRepository {
  constructor(readonly store: AsyncStore) {}
  async create(name: string, roleId: string, id: string = crypto.randomUUID()): Promise<SaveRecord> {
    identifier(id); identifier(roleId);
    const now = new Date().toISOString();
    const save: SaveRecord = { schemaVersion: 1, id, name, createdAt: now, updatedAt: now, roles: { [roleId]: newRole(id, roleId) } };
    validateSave(save);
    return (await this.store.update<SaveRecord>(PREFIX + id, existing => {
      if (existing) throw new Error('Save already exists');
      return save;
    }))!;
  }
  async list(): Promise<SaveRecord[]> { return (await this.store.list<SaveRecord>(PREFIX)).map(row => row.value); }
  async get(saveId: string, roleId: string): Promise<RoleState | undefined> {
    identifier(saveId); identifier(roleId);
    return (await this.store.get<SaveRecord>(PREFIX + saveId))?.roles[roleId];
  }
  async ensureRole(saveId: string, roleId: string): Promise<RoleState> {
    identifier(roleId);
    const result = await this.store.update<SaveRecord>(PREFIX + saveId, save => {
      if (!save) throw new Error('Save not found');
      if (!Object.hasOwn(save.roles, roleId)) save.roles[roleId] = newRole(saveId, roleId);
      return save;
    });
    return result!.roles[roleId];
  }
  /** expected is a snapshot token. Guard is rechecked INSIDE the storage transaction. */
  async mutate(saveId: string, roleId: string, expected: Pick<RoleState, 'generation' | 'revision'> | undefined,
    change: (role: RoleState) => void, guard: () => boolean = () => true): Promise<RoleState | undefined> {
    identifier(saveId); identifier(roleId);
    let changed = false;
    const result = await this.store.update<SaveRecord>(PREFIX + saveId, save => {
      const role = save?.roles[roleId];
      if (!save || !role || !guard() || (expected && (role.generation !== expected.generation || role.revision !== expected.revision))) return save;
      change(role);
      role.revision++;
      validateRole(role, saveId, roleId);
      save.updatedAt = new Date().toISOString();
      changed = true;
      return save;
    });
    return changed ? result?.roles[roleId] : undefined;
  }
  async patch(saveId: string, roleId: string, patch: RolePatch): Promise<RoleState | undefined> {
    const allowed = ['persona', 'outfitId', 'scriptState', 'bond', 'achievements'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Invalid role patch');
    return this.mutate(saveId, roleId, undefined, role => Object.assign(role, cloneValue(patch)));
  }
  async remove(saveId: string): Promise<void> { identifier(saveId); await this.store.update(PREFIX + saveId, () => undefined); }
  async clearChat(saveId: string, roleId: string): Promise<RoleState | undefined> {
    return this.mutate(saveId, roleId, undefined, role => { role.messages = []; role.memory = emptyMemory(); });
  }
  async exportSave(saveId: string): Promise<string> {
    const save = await this.store.get<SaveRecord>(PREFIX + saveId);
    if (!save) throw new Error('Save not found');
    validateSave(save);
    return JSON.stringify({ format: 'otools-lingchat-save', version: 1, save });
  }
  async importSave(json: string): Promise<string> {
    if (json.length > 32_000_000) throw new Error('Save archive exceeds 32 MB text limit');
    const archive = JSON.parse(json);
    if (archive?.format !== 'otools-lingchat-save' || archive.version !== 1) throw new Error('Unsupported save archive version');
    validateSave(archive.save);
    const save: SaveRecord = archive.save;
    // Imported history always receives new identities, including replacing the same save.
    for (const role of Object.values(save.roles)) { role.generation = crypto.randomUUID(); role.revision = 0; }
    await this.store.update(PREFIX + save.id, () => save);
    return save.id;
  }
}
