import type { ActivityRecord } from "./record";
import type { LogEntry, Sport } from "./types";

/*
 * On-device storage for recordings, so nothing is lost when the page reloads, the browser is
 * closed or crashes, or the phone is offline at the finish. IndexedDB holds:
 *  - recordings: one row per recording (unfinished, or finished and waiting to upload);
 *  - entries: the recording log (every fix and control) in order, to rebuild the engine exactly.
 * Rows are tagged with the account id and FITX's screens only show an account its own rows, but
 * the data is still on disk for anyone using this browser profile: signing out should clear it
 * (clearDeviceActivityData in device-recordings.ts). A finished recording is deleted from the
 * device once the server has it.
 */

export type StoredRecording = {
  clientId: string;
  userId: string;
  sport: Sport;
  startedAt: number;
  /** "active": recording or paused; "finished": waiting to be uploaded. */
  state: "active" | "finished";
  updatedAt: number;
  /** The summary to upload, once finished. */
  record?: ActivityRecord;
  uploadAttempts?: number;
  lastUploadError?: string;
  /** The server refused it for good (it breaks a limit), so it is not retried. */
  uploadRejected?: boolean;
};

export type StoredEntry = { seq: number; entry: LogEntry };

export interface RecordingStore {
  /** False when this browser cannot keep data on the device (the recording still works in memory). */
  readonly durable: boolean;
  saveRecording(recording: StoredRecording): Promise<void>;
  getRecording(clientId: string): Promise<StoredRecording | null>;
  listRecordings(userId: string): Promise<StoredRecording[]>;
  appendEntries(clientId: string, entries: readonly StoredEntry[]): Promise<void>;
  readEntries(clientId: string): Promise<LogEntry[]>;
  deleteRecording(clientId: string): Promise<void>;
  /** Removes every recording of an account (used when deleting all activity data). */
  deleteAll(userId: string): Promise<void>;
  /** Removes log entries whose recording row no longer exists. */
  deleteOrphanEntries(): Promise<void>;
}

/** In-memory store: used in tests and when IndexedDB is unavailable. */
export class MemoryRecordingStore implements RecordingStore {
  readonly durable: boolean;
  private recordings = new Map<string, StoredRecording>();
  private entries = new Map<string, StoredEntry[]>();

  constructor(durable = false) {
    this.durable = durable;
  }

  async saveRecording(recording: StoredRecording) {
    this.recordings.set(recording.clientId, structuredClone(recording));
  }
  async getRecording(clientId: string) {
    const found = this.recordings.get(clientId);
    return found ? structuredClone(found) : null;
  }
  async listRecordings(userId: string) {
    return [...this.recordings.values()].filter((r) => r.userId === userId).map((r) => structuredClone(r)).sort((a, b) => b.startedAt - a.startedAt);
  }
  async appendEntries(clientId: string, entries: readonly StoredEntry[]) {
    const list = this.entries.get(clientId) ?? [];
    for (const item of entries) {
      const at = list.findIndex((existing) => existing.seq === item.seq);
      if (at >= 0) list[at] = structuredClone(item);
      else list.push(structuredClone(item));
    }
    list.sort((a, b) => a.seq - b.seq);
    this.entries.set(clientId, list);
  }
  async readEntries(clientId: string) {
    return (this.entries.get(clientId) ?? []).map((item) => structuredClone(item.entry));
  }
  async deleteRecording(clientId: string) {
    this.recordings.delete(clientId);
    this.entries.delete(clientId);
  }
  async deleteAll(userId: string) {
    for (const recording of [...this.recordings.values()]) if (recording.userId === userId) await this.deleteRecording(recording.clientId);
  }
  async deleteOrphanEntries() {
    for (const clientId of [...this.entries.keys()]) if (!this.recordings.has(clientId)) this.entries.delete(clientId);
  }
}

const DB_NAME = "fitx-activity";
const DB_VERSION = 1;
const RECORDINGS = "recordings";
const ENTRIES = "entries";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

export class IndexedDbRecordingStore implements RecordingStore {
  readonly durable = true;
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(factory: IDBFactory = indexedDB): Promise<IndexedDbRecordingStore> {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: "clientId" }).createIndex("userId", "userId");
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: ["clientId", "seq"] });
    };
    const db = await request(open);
    // Another tab upgrading the database must not be blocked by this one.
    db.onversionchange = () => db.close();
    return new IndexedDbRecordingStore(db);
  }

  async saveRecording(recording: StoredRecording) {
    const tx = this.db.transaction(RECORDINGS, "readwrite");
    tx.objectStore(RECORDINGS).put(recording);
    await done(tx);
  }

  async getRecording(clientId: string) {
    const tx = this.db.transaction(RECORDINGS, "readonly");
    const found = await request(tx.objectStore(RECORDINGS).get(clientId) as IDBRequest<StoredRecording | undefined>);
    return found ?? null;
  }

  async listRecordings(userId: string) {
    const tx = this.db.transaction(RECORDINGS, "readonly");
    const rows = await request(tx.objectStore(RECORDINGS).index("userId").getAll(userId) as IDBRequest<StoredRecording[]>);
    return rows.sort((a, b) => b.startedAt - a.startedAt);
  }

  async appendEntries(clientId: string, entries: readonly StoredEntry[]) {
    if (!entries.length) return;
    const tx = this.db.transaction(ENTRIES, "readwrite");
    const store = tx.objectStore(ENTRIES);
    for (const item of entries) store.put({ clientId, seq: item.seq, entry: item.entry });
    await done(tx);
  }

  async readEntries(clientId: string) {
    const tx = this.db.transaction(ENTRIES, "readonly");
    const range = IDBKeyRange.bound([clientId, 0], [clientId, Number.MAX_SAFE_INTEGER]);
    const rows = await request(tx.objectStore(ENTRIES).getAll(range) as IDBRequest<Array<{ seq: number; entry: LogEntry }>>);
    return rows.sort((a, b) => a.seq - b.seq).map((row) => row.entry);
  }

  async deleteRecording(clientId: string) {
    const tx = this.db.transaction([RECORDINGS, ENTRIES], "readwrite");
    tx.objectStore(RECORDINGS).delete(clientId);
    tx.objectStore(ENTRIES).delete(IDBKeyRange.bound([clientId, 0], [clientId, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }

  async deleteAll(userId: string) {
    for (const recording of await this.listRecordings(userId)) await this.deleteRecording(recording.clientId);
  }

  async deleteOrphanEntries() {
    const read = this.db.transaction([RECORDINGS, ENTRIES], "readonly");
    const owners = new Set(((await request(read.objectStore(RECORDINGS).getAllKeys())) as IDBValidKey[]).map(String));
    const keys = (await request(read.objectStore(ENTRIES).getAllKeys())) as IDBValidKey[];
    const orphans = new Set(keys.map((key) => String((key as [string, number])[0])).filter((clientId) => !owners.has(clientId)));
    if (!orphans.size) return;
    const tx = this.db.transaction(ENTRIES, "readwrite");
    for (const clientId of orphans) tx.objectStore(ENTRIES).delete(IDBKeyRange.bound([clientId, 0], [clientId, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }
}

let shared: Promise<RecordingStore> | null = null;

/** The browser's recording store: IndexedDB when available, otherwise memory only. */
export function recordingStore(): Promise<RecordingStore> {
  if (!shared) {
    shared = (async () => {
      try {
        if (typeof indexedDB === "undefined") return new MemoryRecordingStore();
        return await IndexedDbRecordingStore.open();
      } catch {
        return new MemoryRecordingStore();
      }
    })();
  }
  return shared;
}
