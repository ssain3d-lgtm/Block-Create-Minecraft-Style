import { z } from "zod";
import { cellKey, keyToCell, Vec3 } from "../coords";
import type { BlockData } from "../world";
import { CmdError, Project } from "../project";
import { footprintCells, packOffset, shapeSize } from "../multicell";
import type { Structure } from "../types";

export { CmdError };

export interface Host {
  readText(path: string): string;
  writeText(path: string, text: string): void;
  writeBytes?(path: string, bytes: Uint8Array): void;
  exists?(path: string): boolean;
}

/**
 * Records every cell change of one command so it can be undone / redone / rolled back.
 *
 * set() is the LOGICAL write used by commands. It keeps multi-cell shapes whole:
 *  - writing over (or clearing) any cell of a multi-cell shape removes that whole shape first
 *  - writing a multi-cell shape at a cell uses it as the anchor (min corner) and fills its
 *    footprint with "occupied" cells; if part of the footprint is outside the project bounds the
 *    whole shape is skipped
 *  - explicit writes of "occupied" cells are ignored (they always come from their anchor)
 * setRaw() writes exactly one cell (used by rollback-like code paths).
 */
export class Tx {
  keys: number[] = [];
  before: (BlockData | null)[] = [];
  private index = new Set<number>();
  touchedStructures = new Set<number>();
  skippedOutOfBounds = 0;
  /** cells of other blocks removed because a multi-cell shape was written over them */
  displaced = 0;

  constructor(private project: Project) {}

  private inBounds(x: number, y: number, z: number) {
    const { min, max } = this.project.meta.settings.bounds;
    return !(x < min[0] || y < min[1] || z < min[2] || x > max[0] || y > max[1] || z > max[2]);
  }

  setRaw(x: number, y: number, z: number, b: BlockData | null) {
    if (!this.inBounds(x, y, z)) { this.skippedOutOfBounds++; return; }
    const prev = this.project.world.set(x, y, z, b);
    const k = cellKey(x, y, z);
    if (!this.index.has(k)) {
      this.index.add(k);
      this.keys.push(k);
      this.before.push(prev);
    }
    if (prev?.structure) this.touchedStructures.add(prev.structure);
    if (b?.structure) this.touchedStructures.add(b.structure);
  }

  /** removes the whole multi-cell shape that covers (x,y,z), if any. Returns true if one was removed. */
  clearGroup(x: number, y: number, z: number, known?: BlockData | null): boolean {
    const p = this.project;
    const b = known === undefined ? p.world.get(x, y, z) : known;
    if (!b || (b.shape !== p.occIdxIfAny() && !p.multiDef(b.shape))) return false; // fast path: plain block
    const g = p.groupAt(x, y, z);
    if (!g || g.cells.length === 1) return false;
    for (const c of g.cells) this.setRaw(c[0], c[1], c[2], null);
    return true;
  }

  set(x: number, y: number, z: number, b: BlockData | null) {
    const p = this.project;
    if (b && b.shape === p.occIdx()) return;
    const prev = p.world.get(x, y, z);
    if (prev) this.clearGroup(x, y, z, prev);
    if (!b) { if (prev) this.setRaw(x, y, z, null); return; }
    const def = p.multiDef(b.shape);
    if (!def) { this.setRaw(x, y, z, b.aux ? { ...b, aux: undefined } : b); return; }
    const cells = footprintCells([x, y, z], shapeSize(def), b.rot);
    if (!cells.every((c) => this.inBounds(c[0], c[1], c[2]))) { this.skippedOutOfBounds += cells.length; return; }
    for (const c of cells) {
      const other = p.world.get(c[0], c[1], c[2]);
      if (other) { this.displaced++; if (!this.clearGroup(c[0], c[1], c[2], other)) this.setRaw(c[0], c[1], c[2], null); }
    }
    const occ = p.occIdx();
    for (const c of cells) {
      const anchor = c[0] === x && c[1] === y && c[2] === z;
      this.setRaw(c[0], c[1], c[2], anchor
        ? { shape: b.shape, material: b.material, rot: b.rot, structure: b.structure }
        : { shape: occ, material: b.material, rot: 0, structure: b.structure, aux: packOffset(c[0] - x, c[1] - y, c[2] - z) });
    }
  }

  get size() { return this.keys.length; }

  rollback() {
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const [x, y, z] = keyToCell(this.keys[i]);
      this.project.world.set(x, y, z, this.before[i]);
    }
  }

  finalize(): Diff {
    const after = this.keys.map((k) => {
      const [x, y, z] = keyToCell(k);
      return this.project.world.get(x, y, z);
    });
    return { keys: this.keys, before: this.before, after };
  }
}

export interface Diff {
  keys: number[];
  before: (BlockData | null)[];
  after: (BlockData | null)[];
}

export interface CmdCtx {
  project: Project;
  tx: Tx;
  host?: Host;
  warnings: string[];
  /** run another command inside the same transaction (one undo step) */
  run(cmd: string, args: unknown): any;
  engine: import("../engine").Engine;
  /** set by a command (dry runs) to roll everything back after it returns */
  rollbackOnly?: boolean;
  /**
   * Shared-library writes requested by this command. They are applied only after the whole
   * command (batch / plan included) succeeded, and never for dry runs or replays.
   */
  libraryWrites: { kind: "shape" | "material" | "component"; def: any }[];
  /** set by executePlan{newProject}: the project to swap in once the command succeeded */
  replaceProject?: import("../project").Project;
}

export interface CommandDef<S extends z.ZodType = z.ZodType> {
  name: string;
  group: "project" | "blocks" | "build" | "structure" | "asset" | "inspect" | "io" | "meta";
  description: string;
  schema: S;
  /** changes the project (gets undo + log) */
  mutates: boolean;
  /** recorded in the command log (default = mutates) */
  logged?: boolean;
  example: z.input<S>;
  run(ctx: CmdCtx, args: z.output<S>): unknown;
  summarize?(result: any, args: z.output<S>): string;
}

export function defineCommand<S extends z.ZodType>(d: CommandDef<S>): CommandDef<S> {
  return d;
}

// ---------- shared schema pieces ----------
export const zInt = z.number().int();
export const zVec3 = z.tuple([zInt, zInt, zInt]).describe("[x, y, z] integer cell coordinates, y is up");
export const zFacing = z.enum(["north", "east", "south", "west"]).describe("direction the tall/back side of a shape faces");
export const zStructureRef = z
  .union([
    z.string().describe("existing structure id/key/name"),
    z.object({
      name: z.string().min(1),
      type: z.string().default("custom"),
      building: z.string().optional(),
      region: z.string().optional(),
      key: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ])
  .describe("structure to put the blocks in: an existing id, or {name,type} to create one");

export type StructureRef = z.output<typeof zStructureRef>;

/** Resolves a structure argument; creates the structure when an object is given. */
export function resolveStructure(ctx: CmdCtx, ref: StructureRef | undefined, source?: { cmd: string; args: unknown }): Structure | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === "string") {
    const s = ctx.project.structure(ref);
    if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${ref}" not found`, "call getState to list structures");
    return s;
  }
  if (ref.building && !ctx.project.meta.buildings.some((b) => b.id === ref.building || b.name === ref.building)) {
    throw new CmdError("UNKNOWN_BUILDING", `building "${ref.building}" not found`, "createBuilding first, or omit building");
  }
  const b = ref.building ? ctx.project.meta.buildings.find((x) => x.id === ref.building || x.name === ref.building) : undefined;
  return ctx.project.newStructure({ name: ref.name, type: ref.type, buildingId: b?.id, regionId: ref.region, key: ref.key, tags: ref.tags, source });
}

export function boxSize(min: Vec3, max: Vec3) {
  return (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
}
