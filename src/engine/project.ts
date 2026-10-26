import { World, BlockData, SerializedWorld } from "./world";
import { keyToCell, Vec3 } from "./coords";
import { OCCUPIED_ID, footprintCells, isMulti, shapeSize, unpackOffset } from "./multicell";
import type { LogEntry, ProjectMeta, ShapeDef, Structure } from "./types";
import type { AssetRegistry } from "./assets/registry";

export interface ProjectFile {
  app: "ai-voxel-studio";
  formatVersion: 1;
  meta: ProjectMeta;
  log: LogEntry[];
  world?: SerializedWorld;
  /** stateHash() at save time; checked on load to detect damaged files */
  checksum?: string;
}

/** FNV-1a 32-bit of a string (fast, sync, same in Node and browsers) */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
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

  private _multi = new Map<number, ShapeDef | null>();
  /** shape definition of a palette index if it is multi-cell, else null (cached per command) */
  multiDef(idx: number): ShapeDef | null {
    let v = this._multi.get(idx);
    if (v === undefined) {
      const def = this.shapeDefAt(idx);
      v = def && isMulti(def) ? def : null;
      this._multi.set(idx, v);
    }
    return v;
  }
  /** call when shape definitions may have changed */
  clearShapeCache() { this._multi.clear(); this._occ = -1; this._occAny = undefined; }

  private _occ = -1;
  /** palette index of the internal "occupied" shape (registered on first use) */
  occIdx(): number {
    if (this._occ < 0 || this.meta.palette.shapes[this._occ] !== OCCUPIED_ID) {
      const i = this.meta.palette.shapes.indexOf(OCCUPIED_ID);
      this._occ = i >= 0 ? i : this.shapeIdx(OCCUPIED_ID);
      this._occAny = this._occ;
    }
    return this._occ;
  }

  private _occAny: number | undefined;
  /** palette index of "occupied" if the project uses it, else -1 (never registers) */
  occIdxIfAny(): number {
    if (this._occAny === undefined || (this._occAny >= 0 && this.meta.palette.shapes[this._occAny] !== OCCUPIED_ID)) {
      this._occAny = this.meta.palette.shapes.indexOf(OCCUPIED_ID);
    }
    return this._occAny;
  }

  /**
   * The shape covering (x,y,z): its anchor cell, its block and every covered cell.
   * For an ordinary block cells = [that cell].
   */
  groupAt(x: number, y: number, z: number): { anchor: Vec3; block: BlockData; cells: Vec3[] } | null {
    const b = this.world.get(x, y, z);
    if (!b) return null;
    let anchor: Vec3 = [x, y, z], ab: BlockData | null = b;
    if (b.shape === this.occIdxIfAny()) {
      const o = unpackOffset(b.aux ?? 0);
      anchor = [x - o[0], y - o[1], z - o[2]];
      ab = this.world.get(...anchor);
      if (!ab) return { anchor: [x, y, z], block: b, cells: [[x, y, z]] }; // orphan (should not happen)
    }
    const def = this.multiDef(ab.shape);
    if (!def) return { anchor, block: ab, cells: [anchor] };
    return { anchor, block: ab, cells: footprintCells(anchor, shapeSize(def), ab.rot) };
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
    if (b.shape === this.occIdxIfAny()) {
      // a cell covered by a multi-cell shape: describe the shape and say where its anchor is
      const g = this.groupAt(x, y, z)!;
      return { ...this.describeBlock(g.block), partOf: g.anchor };
    }
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

  /** Full state fingerprint: blocks (incl. structure ownership) + project metadata. */
  stateHash(): string {
    return `${this.world.hash()}|${fnv(JSON.stringify(this.meta))}`;
  }

  // ---------- io ----------
  toFile(includeWorld = true): ProjectFile {
    return {
      app: "ai-voxel-studio",
      formatVersion: 1,
      meta: this.meta,
      log: this.log,
      world: includeWorld ? this.world.serialize() : undefined,
      checksum: this.stateHash(),
    };
  }
}
