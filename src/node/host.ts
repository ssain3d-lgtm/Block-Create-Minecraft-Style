// Node-only helpers: file host for save/load and the shared asset library folder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Host } from "../engine/commands/framework";
import type { AssetStore, AssetKind, AnyAsset } from "../engine/assets/registry";
import type { ComponentDef, MaterialDef, ShapeDef } from "../engine/types";
import { Engine } from "../engine/engine";

export function nodeHost(baseDir = process.cwd()): Host {
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(baseDir, p));
  return {
    readText: (p) => fs.readFileSync(abs(p), "utf8"),
    writeText: (p, text) => {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), text, "utf8");
    },
    writeBytes: (p, bytes) => {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), bytes);
    },
    exists: (p) => fs.existsSync(abs(p)),
  };
}

const DIRS: Record<AssetKind, string> = { shape: "shapes", material: "materials", component: "components" };

/** library/ folder shared by every project: library/{shapes,materials,components}/<id>.json */
export function folderLibrary(dir: string): AssetStore {
  const readAll = <T>(kind: AssetKind): T[] => {
    const d = path.join(dir, DIRS[kind]);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith(".json")).flatMap((f) => {
      try { return [JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as T]; } catch { return []; }
    });
  };
  return {
    load: () => ({
      shapes: readAll<ShapeDef>("shape"),
      materials: readAll<MaterialDef>("material"),
      components: readAll<ComponentDef>("component"),
    }),
    save: (kind: AssetKind, def: AnyAsset) => {
      const d = path.join(dir, DIRS[kind]);
      fs.mkdirSync(d, { recursive: true });
      const file = def.id.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
      fs.writeFileSync(path.join(d, file), JSON.stringify(def, null, 2), "utf8");
    },
  };
}

export function repoRoot(): string {
  // src/node/host.ts -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function createNodeEngine(opts: { baseDir?: string; libraryDir?: string } = {}) {
  const libraryDir = opts.libraryDir ?? path.join(repoRoot(), "library");
  return new Engine({ host: nodeHost(opts.baseDir), library: folderLibrary(libraryDir) });
}
