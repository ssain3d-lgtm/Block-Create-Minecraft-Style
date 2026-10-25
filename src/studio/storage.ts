// Browser persistence: autosave the current project in IndexedDB, shared asset library in localStorage.
import type { AssetStore, AssetKind, AnyAsset } from "../engine/assets/registry";
import type { ComponentDef, MaterialDef, ShapeDef } from "../engine/types";

const DB = "ai-voxel-studio";
const STORE = "projects";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(key: string, value: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function idbGet(key: string): Promise<string | undefined> {
  const db = await openDb();
  const v = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as string | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return v;
}

const LIB_KEY = "ai-voxel-studio.library.v1";

export function localStorageLibrary(): AssetStore {
  const read = (): { shapes: ShapeDef[]; materials: MaterialDef[]; components: ComponentDef[] } => {
    try {
      const raw = localStorage.getItem(LIB_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* blocked storage */ }
    return { shapes: [], materials: [], components: [] };
  };
  return {
    load: read,
    save: (kind: AssetKind, def: AnyAsset) => {
      const lib = read();
      const list = (kind === "shape" ? lib.shapes : kind === "material" ? lib.materials : lib.components) as AnyAsset[];
      const i = list.findIndex((d) => d.id === def.id);
      if (i >= 0) list[i] = def; else list.push(def);
      try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch { /* quota */ }
    },
  };
}

export function downloadText(name: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}
