// Generator framework: positions with anchors, footprints, the Builder that writes blocks
// into one structure, and defineGenerator() which makes every generator rebuildable.
import { z } from "zod";
import { makeRot, Vec3, FACINGS, Facing } from "../coords";
import type { Structure } from "../types";
import { CmdCtx, CmdError, CommandDef, defineCommand } from "./framework";

// ---------------- positions & anchors ----------------
export const ANCHORS = ["top", "bottom", "center", "north", "south", "east", "west", "min", "max", "topMin", "topMax"] as const;

export const zRef = z.object({
  ref: z.string().describe("structure key / id / name"),
  anchor: z.enum(ANCHORS).default("top"),
  offset: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
});

export const zPos = z
  .union([z.tuple([z.number().int(), z.number().int(), z.number().int()]), zRef])
  .describe('[x,y,z] (relative to the building origin) or {"ref":"walls","anchor":"top","offset":[0,0,0]}');
export type Pos = z.output<typeof zPos>;

export const zFootprint = z
  .object({
    at: zPos.optional().describe("min corner [x,y,z]; y = base level"),
    size: z.tuple([z.number().int().min(1).max(2048), z.number().int().min(1).max(2048)]).optional().describe("[width along x, depth along z]"),
    on: z.object({ ref: z.string(), inset: z.number().int().default(0), offset: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional() }).optional()
      .describe("sit on top of another structure, using its footprint (shrunk by inset)"),
  })
  .refine((f) => f.on || (f.at && f.size), { message: 'give "on" or both "at" and "size"' });

export const zCommon = {
  name: z.string().optional(),
  key: z.string().optional().describe("short name other structures can reference"),
  building: z.string().optional().describe("building id/name: positions become relative to its origin"),
  region: z.string().optional(),
  tags: z.array(z.string()).optional(),
  material: z.string(),
};

export interface Rect { x0: number; z0: number; x1: number; z1: number; y: number }

export const FACING_VEC: Record<Facing, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** writes blocks of one structure; resolves positions, palette indices and counts */
export class Builder {
  count = 0;
  overwrote = 0;
  private sCache = new Map<string, number>();
  private mCache = new Map<string, number>();
  readonly origin: Vec3;

  constructor(public ctx: CmdCtx, public structure: Structure) {
    const b = structure.buildingId ? ctx.project.meta.buildings.find((x) => x.id === structure.buildingId) : undefined;
    this.origin = b?.origin ?? [0, 0, 0];
  }

  /** generators that place multi-cell shapes on purpose (placeShape) set this */
  allowMulti = false;

  shape(id: string) {
    let v = this.sCache.get(id);
    if (v === undefined) {
      v = this.ctx.project.shapeIdx(id);
      if (!this.allowMulti && this.ctx.project.multiDef(v)) {
        throw new CmdError("MULTI_CELL_SHAPE", `"${id}" is a multi-cell shape; this generator fills cell by cell`, `place it with placeShape (layout grid/line/ring) or inside a component`);
      }
      this.sCache.set(id, v);
    }
    return v;
  }

  mat(id: string) {
    let v = this.mCache.get(id);
    if (v === undefined) { v = this.ctx.project.materialIdx(id); this.mCache.set(id, v); }
    return v;
  }

  /** world-space set */
  set(x: number, y: number, z: number, material: string, shape = "builtin.cube", rot = 0) {
    const prev = this.ctx.project.world.get(x, y, z);
    if (prev && prev.structure && prev.structure !== this.structure.num) {
      const owner = this.ctx.project.structureByNum(prev.structure);
      if (owner?.locked) return;
      this.overwrote++;
    }
    this.ctx.tx.set(x, y, z, { shape: this.shape(shape), material: this.mat(material), rot, structure: this.structure.num });
    this.count++;
  }

  setIfEmpty(x: number, y: number, z: number, material: string, shape = "builtin.cube", rot = 0) {
    if (this.ctx.project.world.get(x, y, z)) return;
    this.set(x, y, z, material, shape, rot);
  }

  remove(x: number, y: number, z: number) {
    this.ctx.tx.set(x, y, z, null);
  }

  box(ref: string): { min: Vec3; max: Vec3 } {
    const s = findRef(this.ctx, ref, this.structure.buildingId);
    if (s === this.structure) throw new CmdError("SELF_REF", `structure "${ref}" cannot reference itself`);
    const b = this.ctx.project.structureBox(s); // always fresh (boxes are cached only after a command)
    if (!b) throw new CmdError("EMPTY_REF", `structure "${ref}" has no blocks yet`, "build it before referencing it");
    return b;
  }

  /** resolves a Pos to world coordinates */
  pos(p: Pos): Vec3 {
    if (Array.isArray(p)) return [p[0] + this.origin[0], p[1] + this.origin[1], p[2] + this.origin[2]];
    const { min, max } = this.box(p.ref);
    const cx = Math.floor((min[0] + max[0]) / 2), cy = Math.floor((min[1] + max[1]) / 2), cz = Math.floor((min[2] + max[2]) / 2);
    let v: Vec3;
    switch (p.anchor) {
      case "top": v = [cx, max[1] + 1, cz]; break;
      case "bottom": v = [cx, min[1], cz]; break;
      case "center": v = [cx, cy, cz]; break;
      case "north": v = [cx, min[1], min[2] - 1]; break;
      case "south": v = [cx, min[1], max[2] + 1]; break;
      case "west": v = [min[0] - 1, min[1], cz]; break;
      case "east": v = [max[0] + 1, min[1], cz]; break;
      case "min": v = [...min] as Vec3; break;
      case "max": v = [...max] as Vec3; break;
      case "topMin": v = [min[0], max[1] + 1, min[2]]; break;
      case "topMax": v = [max[0], max[1] + 1, max[2]]; break;
      default: v = [cx, max[1] + 1, cz];
    }
    const o = p.offset ?? [0, 0, 0];
    return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
  }

  rect(f: z.output<typeof zFootprint>): Rect {
    if (f.on) {
      const { min, max } = this.box(f.on.ref);
      const o = f.on.offset ?? [0, 0, 0];
      const r = { x0: min[0] + f.on.inset + o[0], z0: min[2] + f.on.inset + o[2], x1: max[0] - f.on.inset + o[0], z1: max[2] - f.on.inset + o[2], y: max[1] + 1 + o[1] };
      if (f.size) { r.x1 = r.x0 + f.size[0] - 1; r.z1 = r.z0 + f.size[1] - 1; }
      if (f.at && Array.isArray(f.at)) { /* explicit y overrides */ r.y = f.at[1] + this.origin[1]; }
      if (r.x1 < r.x0 || r.z1 < r.z0) throw new CmdError("BAD_FOOTPRINT", `inset ${f.on.inset} leaves no area on "${f.on.ref}"`);
      return r;
    }
    const a = this.pos(f.at!);
    return { x0: a[0], z0: a[2], x1: a[0] + f.size![0] - 1, z1: a[2] + f.size![1] - 1, y: a[1] };
  }

  rot(facing: Facing | undefined, upsideDown = false) {
    return makeRot(facing ?? "north", upsideDown);
  }
}

export function findRef(ctx: CmdCtx, ref: string, buildingId?: string): Structure {
  const list = ctx.project.meta.structures.filter((s) => s.id === ref || s.key === ref || s.name === ref);
  const s = list.find((x) => x.buildingId === buildingId) ?? list[list.length - 1];
  if (!s) throw new CmdError("UNKNOWN_REF", `no structure "${ref}"`, "use a key/id from getState (keys are set with \"key\")");
  return s;
}

/** facing that points from (x,z) toward the higher side of a gradient */
export function facingFromVec(dx: number, dz: number): Facing {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "east" : "west";
  return dz > 0 ? "south" : "north";
}

// ---------------- generator definition ----------------
export interface GeneratorDef<S extends z.ZodType> {
  name: string;
  type: string;
  description: string;
  schema: S;
  example: z.input<S>;
  build(b: Builder, args: z.output<S>): Record<string, unknown> | void;
}

export const GENERATORS = new Map<string, GeneratorDef<any>>();

/** Runs a generator into a structure (new or rebuilt) and re-applies hand-edit overrides. */
export function runGenerator(ctx: CmdCtx, gen: GeneratorDef<any>, args: any, s: Structure) {
  const b = new Builder(ctx, s);
  const extra = gen.build(b, args) ?? {};
  for (const o of s.overrides) {
    const [x, y, z] = o.at;
    if (o.op === "remove") ctx.tx.set(x, y, z, null);
    else ctx.tx.set(x, y, z, { shape: b.shape(o.shape ?? "cube"), material: b.mat(o.material ?? "stone"), rot: o.rot ?? 0, structure: s.num });
  }
  if (b.overwrote) ctx.warnings.push(`${s.id}: ${b.overwrote} cell(s) replaced blocks of other structures`);
  if (b.count === 0) ctx.warnings.push(`${s.id}: generator produced no blocks (check sizes / positions)`);
  return { blocksAdded: b.count, ...extra };
}

export function defineGenerator<S extends z.ZodType>(g: GeneratorDef<S>): CommandDef<S> {
  GENERATORS.set(g.name, g);
  return defineCommand({
    name: g.name,
    group: "build",
    description: g.description,
    schema: g.schema,
    mutates: true,
    example: g.example,
    run(ctx, args: any) {
      const p = ctx.project;
      let buildingId: string | undefined;
      if (args.building) {
        const bl = p.meta.buildings.find((x) => x.id === args.building || x.name === args.building);
        if (!bl) throw new CmdError("UNKNOWN_BUILDING", `building "${args.building}" not found`, "createBuilding first");
        buildingId = bl.id;
      }
      if (args.key && p.meta.structures.some((s) => s.key === args.key && s.buildingId === buildingId)) {
        throw new CmdError("DUPLICATE_KEY", `key "${args.key}" already used`, "use modifyStructure to change it, or pick another key");
      }
      const s = p.newStructure({
        name: args.name ?? args.key ?? g.type, type: g.type, key: args.key, buildingId, regionId: args.region, tags: args.tags,
        source: { cmd: g.name, args },
      });
      const r = runGenerator(ctx, g, args, s);
      return { structureId: s.id, key: s.key, ...r };
    },
  });
}

export function facingIndex(f: Facing) {
  return FACINGS.indexOf(f);
}
