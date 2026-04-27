// Reads all native LiaScript quiz/survey/code/task state directly from the
// course's IndexedDB (Dexie) and exposes sendRestoreEvent() to replay it into Elm.
//
// LiaScript uses Dexie with the course URL as the database name.
// Each store (quiz, survey, code, task) holds records: { id, version, data }.
// We open the DB and read all records, grouped by table and section id.

declare global {
  interface Window {
    LIA: { send: (event: unknown) => void } & Record<string, unknown>;
  }
}


export type TableName = "quiz" | "survey" | "code" | "task";

const TABLES: TableName[] = ["quiz", "survey", "code", "task"];

// ---- IndexedDB helpers ----

async function findCourseDbName(): Promise<string> {
  // Compute the base course URL from the viewer query string (without submission token)
  let courseBase = "";
  const search = window.location.search;
  if (search && search !== "?") {
    try {
      const raw = decodeURIComponent(search.slice(1));
      const u = new URL(raw, window.location.href);
      if (String(u.hash).startsWith("#submission=")) u.hash = "";
      courseBase = u.toString();
    } catch {
      courseBase = search.slice(1);
    }
  }

  // Use indexedDB.databases() to list all existing DBs and find the one
  // whose name contains the course file path.
  try {
    const dbs = await indexedDB.databases();

    // First: exact match
    const exact = dbs.find(d => d.name === courseBase);
    if (exact?.name) return exact.name;

    // Second: find any DB whose name shares the same pathname (ignoring protocol/host differences)
    if (courseBase) {
      let coursePath = "";
      try { coursePath = new URL(courseBase).pathname; } catch { coursePath = courseBase; }

      const match = dbs.find(d => {
        if (!d.name) return false;
        try { return new URL(d.name).pathname === coursePath; } catch { return false; }
      });
      if (match?.name) return match.name;

      // Third: substring match on the filename portion
      const file = coursePath.split("/").pop() ?? "";
      if (file) {
        const loose = dbs.find(d => d.name?.includes(file));
        if (loose?.name) return loose.name;
      }
    }

    // Fallback: return the computed courseBase and hope it matches
    return courseBase;
  } catch {
    // indexedDB.databases() not supported (old browser) — fall back directly
    return courseBase;
  }
}

function openCourseDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Open without specifying a version so we never trigger onupgradeneeded
    // and never conflict with Dexie's schema management.
    const req = indexedDB.open(dbName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IDB blocked"));
    req.onupgradeneeded = () => {
      // DB doesn't exist yet — nothing to read, abort the open.
      (req.transaction as IDBTransaction).abort();
      reject(new Error("IDB does not exist yet"));
    };
  });
}

// Read all records from a single store. Returns record[] sorted by id asc.
function readAllFromStore(
  db: IDBDatabase,
  storeName: string
): Promise<Array<{ id: number; version: number; data: unknown }>> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    } catch (e) {
      resolve([]);
    }
  });
}

// For each section id, pick the record with the highest version (most recent save).
function latestBySection(
  records: Array<{ id: number; version: number; data: unknown }>
): Record<number, unknown> {
  const best: Record<number, { version: number; data: unknown }> = {};
  for (const r of records) {
    const id = Number(r.id);
    if (!best[id] || r.version > best[id].version) {
      best[id] = { version: r.version, data: r.data };
    }
  }
  const out: Record<number, unknown> = {};
  for (const [id, entry] of Object.entries(best)) {
    out[Number(id)] = entry.data;
  }
  return out;
}

// ---- Public API ----

export async function loadNativeState(): Promise<{
  quiz: Record<number, unknown>;
  survey: Record<number, unknown>;
  code: Record<number, unknown>;
  task: Record<number, unknown>;
}> {
  const dbName = await findCourseDbName();
  const empty = { quiz: {}, survey: {}, code: {}, task: {} };
  if (!dbName) return empty;

  let db: IDBDatabase;
  try {
    db = await openCourseDb(dbName);
  } catch {
    return empty;
  }

  try {
    const results = await Promise.all(
      TABLES.map(t => readAllFromStore(db, t))
    );
    db.close();
    return {
      quiz:   latestBySection(results[0]),
      survey: latestBySection(results[1]),
      code:   latestBySection(results[2]),
      task:   latestBySection(results[3]),
    };
  } catch {
    db.close();
    return empty;
  }
}

// Restore state for a section by sending a "load" reply directly to Elm.
// window.LIA.send only forwards reply:true events, which Elm accepts as DB replies.
export function sendRestoreEvent(
  table: TableName,
  sectionIndex: number,
  data: unknown
): void {
  window.LIA.send({
    reply: true,
    track: [[table, sectionIndex]],
    service: "db",
    message: { cmd: "load", param: { table, id: sectionIndex, data } },
  });
}

// installPortIntercept is no longer needed — keeping as a no-op for compatibility
// in case other code still calls it.
export function installPortIntercept(): void {}
