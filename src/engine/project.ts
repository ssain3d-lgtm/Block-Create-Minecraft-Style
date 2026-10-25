import { World, BlockData, SerializedWorld } from "./world";
import { keyToCell, Vec3 } from "./coords";
import type { LogEntry, ProjectMeta, Structure } from "./types";
import type { AssetRegistry } from "./assets/registry";

export interface ProjectFile {
  app: "ai-voxel-studio";
  formatVersion: 1;
  meta: ProjectMeta;
  log: LogEntry[];
  world?: SerializedWorld;
}

export function defaultMeta(name = "untitled"): ProjectMeta {
  return {
    formatVersion: 1,
    name,
    tags: [],
    settings: { cellSize: 1, bounds: { min: [-1024, -64, -1024], max: [1023, 1023, 1023] }, seed: 1 },
    palette: { shapes: ["air"], materials: ["none"] },
    buildings: [],
    structures: [],
    assets: { shapes: [], materials: [], components: [] },
    counters: { structure: 0, building: 0, region: 0 },
  };
}

export class CmdError extends Error {
  constructor(public code: string, message: string, public hint?: string, public path?: string) {
    super(message);
  }
}

export class Project {
  world = new World();
  log: LogEntry[] = [];
  seq = 0;

  constructor(public assets: AssetRegistry, public meta: ProjectMeta = defaultMeta()) {}

  // ---------- palette ----------
  shapeIdx(id: string): number {
    const def = this.assets.findShape(id, this.meta.assets.shapes);
    if (!def) {
      const names = this.assets.allShapes(this.meta.assets.shapes).map((d) => d.id.replace("builtin.", ""));
      throw new CmdError("UNKNOWN_SHAPE", `unknown shape "${id}"`, `use one of: ${names.slice(0, 25).join(", ")} (or createShape first)`);
    }
    if (!this.assets.isBuiltin(def.id) && !this.meta.assets.shapes.some((d) => d.id === def.id)) {
      this.meta.assets.shapes.push(structuredClone(def));
    }
    let i = this.meta.palette.shapes.indexOf(def.id);
    if (i < 0) { this.meta.palette.shapes.push(def.id); i = this.meta.palette.shapes.length - 1; }
    return i;
  }

  materialIdx(id: string): number {
    const def = this.assets.findMaterial(id, this.meta.assets.materials);
    if (!def) {
      const names = this.assets.allMaterials(this.meta.assets.materials).map((d) => d.id.replace("builtin.", ""));
      throw new CmdError("UNKNOWN_MATERIAL", `unknown material "${id}"`, `use one of: ${names.slice(0, 40).join(", ")} (or createMaterial first)`);
    }
    if (!this.assets.isBuiltin(def.id) && !this.meta.assets.materials.some((d) => d.id === def.id)) {
      this.meta.assets.materials.push(structuredClone(def));
    }
    let i = this.meta.palette.materials.indexOf(def.id);
    if (i < 0) { this.meta.palette.materials.push(def.id); i = this.meta.palette.materials.length - 1; }
    return i;
  }

  shapeId(idx: number) { return this.meta.palette.shapes[idx]; }
  materialId(idx: number) { return this.meta.palette.materials[idx]; }

  shapeDefAt(idx: number) { return this.assets.findShape(this.shapeId(idx), this.meta.assets.shapes); }
  materialDefAt(idx: number) { return this.assets.findMaterial(this.materialId(idx), this.meta.assets.materials); }

  // ---------- structures ----------
  structure(idOrKey: string): Structure | undefined {
    return this.meta.structures.find((s) => s.id === idOrKey || s.key === idOrKey || s.name === idOrKey);
  }

  structureByNum(num: number): Structure | undefined {
    return this.meta.structures.find((s) => s.num === num);
  }

  newStructure(p: Partial<Structure> & { name: string; type: string }): Structure {
    const num = ++this.meta.counters.structure;
    const s: Structure = { id: `s-${num}`, num, overrides: [], visible: true, locked: false, ...p };
    this.meta.structures.push(s);
    return s;
  }

  structureBox(s: Structure): { min: Vec3; max: Vec3 } | undefined {
    const cells = this.world.structIndex.get(s.num);
    if (!cells || cells.size === 0) return undefined;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const k of cells) {
      const c = keyToCell(k);
      for (let i = 0; i < 3; i++) { if (c[i] < min[i]) min[i] = c[i]; if (c[i] > max[i]) max[i] = c[i]; }
    }
    return { min, max };
  }

  blockAt(x: number, y: number, z: number) {
    const b = this.world.get(x, y, z);
    if (!b) return null;
    return this.describeBlock(b);
  }

  describeBlock(b: BlockData) {
    return {
      shape: this.shapeId(b.shape),
      material: this.materialId(b.material),
      rot: b.rot,
      structure: b.structure ? this.structureByNum(b.structure)?.id : undefined,
    };
  }

  // ---------- io ----------
  toFile(includeWorld = true): ProjectFile {
    return {
      app: "ai-voxel-studio",
      formatVersion: 1,
      meta: this.meta,
      log: this.log,
      world: includeWorld ? this.world.serialize() : undefined,
    };
  }
}
