// Node-only helpers: sandboxed file host for save/load and the shared asset library folder.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Host } from "../engine/commands/framework";
import type { AssetStore, AssetKind, AnyAsset } from "../engine/assets/registry";
import type { ComponentDef, MaterialDef, ShapeDef } from "../engine/types";
import { Engine } from "../engine/engine";
import { resolveSafe, Sandbox, writeFileAtomic } from "./fsx";

export const PROJECT_EXT = [".vox.json", ".json"];
export const EXPORT_EXT = [".vox.json", ".json", ".glb"];

/**
 * File host used by saveProject / loadProject / exportGLB.
 * Every path is resolved against baseDir and must stay inside the sandbox roots
 * (default: baseDir itself). Writes are atomic.
 */
export function nodeHost(baseDir = process.cwd(), sandbox?: Partial<Sandbox> & { defaultDir?: string }): Host {
  // a bare file name ("house.vox.json") goes to defaultDir (e.g. projects/)
  const base = (p: string) => (sandbox?.defaultDir && typeof p === "string" && !/[\\/]/.test(p) ? path.join(sandbox.defaultDir, p) : p);
  const sb: Sandbox = {
    read: sandbox?.read ?? [baseDir],
    write: sandbox?.write ?? [baseDir],
    readExt: sandbox?.readExt ?? PROJECT_EXT,
    writeExt: sandbox?.writeExt ?? EXPORT_EXT,
  };
  return {
    readText: (p) => fs.readFileSync(resolveSafe(baseDir, base(p), sb, "read"), "utf8"),
    writeText: (p, text) => writeFileAtomic(resolveSafe(baseDir, base(p), sb, "write"), text, 2),
    writeBytes: (p, bytes) => writeFileAtomic(resolveSafe(baseDir, base(p), sb, "write"), bytes),
    exists: (p) => { try { return fs.existsSync(resolveSafe(baseDir, base(p), sb, "read")); } catch { return false; } },
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
  const fileOf = (kind: AssetKind, id: string) => {
    const d = path.join(dir, DIRS[kind]);
    const f = path.join(d, id.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_") + ".json");
    if (path.dirname(f) !== d) throw new Error("bad asset id");
    return f;
  };
  return {
    load: () => ({
      shapes: readAll<ShapeDef>("shape"),
      materials: readAll<MaterialDef>("material"),
      components: readAll<ComponentDef>("component"),
    }),
    save: (kind: AssetKind, def: AnyAsset) => writeFileAtomic(fileOf(kind, def.id), JSON.stringify(def, null, 2)),
    remove: (kind: AssetKind, id: string) => { try { fs.unlinkSync(fileOf(kind, id)); } catch { /* absent */ } },
    read: (kind: AssetKind, id: string) => {
      try { return JSON.parse(fs.readFileSync(fileOf(kind, id), "utf8")) as AnyAsset; } catch { return undefined; }
    },
  };
}

export function repoRoot(): string {
  // src/node/host.ts -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function createNodeEngine(opts: { baseDir?: string; libraryDir?: string; sandbox?: Partial<Sandbox> & { defaultDir?: string } } = {}) {
  const libraryDir = opts.libraryDir ?? path.join(repoRoot(), "library");
  return new Engine({ host: nodeHost(opts.baseDir, opts.sandbox), library: folderLibrary(libraryDir) });
}

/** Sandbox for the server / MCP: projects/ and out/ for writing, plus examples/ for reading. */
export function serverSandbox(root: string): Partial<Sandbox> & { defaultDir: string } {
  const projects = path.join(root, "projects"), out = path.join(root, "out"), examples = path.join(root, "examples");
  return { read: [projects, out, examples], write: [projects, out], defaultDir: projects };
}
