/** Atomic updater must be synchronous. Host adapters must clone at both boundaries,
 * serialize updates (including across windows), and roll back when updater throws.
 * Store Blob/ArrayBuffer assets under asset:* keys; never stringify large packs. */
export interface AsyncStore {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
  update<T>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined>;
}

export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements AsyncStore {
  private values = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> {
    await this.tail;
    return cloneValue(this.values.get(key) as T | undefined);
  }
  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    await this.tail;
    return [...this.values].filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: cloneValue(value as T) }));
  }
  update<T>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined> {
    const operation = this.tail.then(() => {
      const next = cloneValue(updater(cloneValue(this.values.get(key) as T | undefined)));
      if (next === undefined) this.values.delete(key);
      else this.values.set(key, next);
      return cloneValue(next);
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
}

/** Each update performs read + mutation + write inside one IndexedDB transaction. */
export class IndexedDbStore implements AsyncStore {
  private database: Promise<IDBDatabase>;
  constructor(name = 'otools-lingchat', factory: IDBFactory = globalThis.indexedDB) {
    this.database = new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('IndexedDB is unavailable; supply a host AsyncStore adapter')); return; }
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onerror = () => reject(request.error ?? new Error('Cannot open storage'));
      request.onblocked = () => reject(new Error('Storage upgrade blocked by another window'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(key);
      tx.oncomplete = () => resolve(cloneValue(req.result as T | undefined));
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Read failed'));
    });
  }
  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const values: Array<{ key: string; value: T }> = [];
      const req = tx.objectStore('records').openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          values.push({ key: cursor.key, value: cloneValue(cursor.value as T) });
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(values);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('List failed'));
    });
  }
  async update<T>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const req = store.get(key);
      let result: T | undefined;
      let failure: unknown;
      req.onsuccess = () => {
        try {
          result = cloneValue(updater(cloneValue(req.result as T | undefined)));
          if (result === undefined) store.delete(key);
          else store.put(result, key);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(cloneValue(result));
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Write failed'));
    });
  }
  async close(): Promise<void> { (await this.database).close(); }
}
