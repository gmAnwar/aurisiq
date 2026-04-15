// IndexedDB queue for pending audio recordings
// Stores audio blobs + metadata locally until uploaded to Supabase Storage

const DB_NAME = "aurisiq";
const DB_VERSION = 3;
const STORE_NAME = "pending_recordings";

export interface PendingRecording {
  id: string;
  audio_blob: Blob;
  duration_seconds: number;
  created_at: string;
  organization_id: string;
  user_id: string;
  scorecard_id: string | null;
  funnel_stage_id: string | null;
  prospect_name: string | null;
  notes: string | null;
  status: "pending" | "uploading" | "uploaded" | "analyzing" | "completed" | "error";
  attempt_count: number;
  last_error: string | null;
  uploaded_audio_url: string | null;
  analysis_id: string | null;
  incomplete: boolean;
  mime_type: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // Preserve existing stores from v1/v2 (recordings, offline_queue)
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      // Keep existing stores if they exist
      if (!db.objectStoreNames.contains("recordings")) {
        db.createObjectStore("recordings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("offline_queue")) {
        db.createObjectStore("offline_queue", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putRecording(rec: PendingRecording): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(rec);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getRecording(id: string): Promise<PendingRecording | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function getAllRecordings(userId?: string): Promise<PendingRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      db.close();
      let results = req.result as PendingRecording[];
      if (userId) results = results.filter(r => r.user_id === userId);
      // Sort newest first
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      resolve(results);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function updateRecordingStatus(
  id: string,
  status: PendingRecording["status"],
  extras?: Partial<PendingRecording>,
): Promise<void> {
  const rec = await getRecording(id);
  if (!rec) return;
  await putRecording({ ...rec, status, ...extras });
}

export async function countPending(userId?: string): Promise<number> {
  const all = await getAllRecordings(userId);
  return all.filter(r => r.status !== "completed").length;
}

export async function getIncompleteRecordings(userId: string): Promise<PendingRecording[]> {
  const all = await getAllRecordings(userId);
  return all.filter(r => r.incomplete && r.status === "pending");
}

// ─── BroadcastChannel multi-tab lock ──────────────────────

const LOCK_CHANNEL = "aurisiq_recording_lock";

export class RecordingLock {
  private channel: BroadcastChannel | null = null;
  private _isLockedByOtherTab = false;
  private _tabId = crypto.randomUUID();
  private onChangeCallback: ((locked: boolean) => void) | null = null;

  constructor() {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    try {
      this.channel = new BroadcastChannel(LOCK_CHANNEL);
      this.channel.onmessage = (e) => {
        if (e.data?.tabId === this._tabId) return;
        if (e.data?.type === "lock") {
          this._isLockedByOtherTab = true;
          this.onChangeCallback?.(true);
        } else if (e.data?.type === "unlock") {
          this._isLockedByOtherTab = false;
          this.onChangeCallback?.(false);
        } else if (e.data?.type === "ping") {
          // Another tab is checking — respond if we're recording
          // (handled by the component that calls acquireLock)
        }
      };
    } catch {
      // BroadcastChannel not available — skip lock
    }
  }

  get isLockedByOtherTab() { return this._isLockedByOtherTab; }

  onChange(cb: (locked: boolean) => void) { this.onChangeCallback = cb; }

  acquireLock() {
    this.channel?.postMessage({ type: "lock", tabId: this._tabId });
  }

  releaseLock() {
    this.channel?.postMessage({ type: "unlock", tabId: this._tabId });
  }

  destroy() {
    this.releaseLock();
    this.channel?.close();
    this.channel = null;
  }
}

// ─── Storage estimate helper ──────────────────────────────

export async function checkStorageAvailable(): Promise<{ available: boolean; freeBytes: number | null }> {
  if (!navigator.storage?.estimate) return { available: true, freeBytes: null };
  try {
    const est = await navigator.storage.estimate();
    const free = (est.quota || 0) - (est.usage || 0);
    return { available: free > 200 * 1024 * 1024, freeBytes: free };
  } catch {
    return { available: true, freeBytes: null };
  }
}

// ─── Download helper ──────────────────────────────────────

export function downloadRecordingBlob(rec: PendingRecording) {
  const url = URL.createObjectURL(rec.audio_blob);
  const a = document.createElement("a");
  const ext = rec.mime_type.includes("mp4") ? "mp4" : "webm";
  a.href = url;
  a.download = `grabacion-${rec.prospect_name || rec.id.slice(0, 8)}-${new Date(rec.created_at).toISOString().slice(0, 10)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
