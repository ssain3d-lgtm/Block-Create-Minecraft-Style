// Asset Factory: AI-created shapes, materials and components, registered in the shared library.
import { z } from "zod";
import { normBox, Vec3 } from "../coords";
import { buildGeometry, validateGeometry, clearGeometryCache } from "../geometry/recipes";
import type { ComponentDef, FaceName, MaterialDef, Recipe, ShapeDef } from "../types";
import { CmdError, defineCommand, resolveStructure, zFacing, zStructureRef, zVec3, CmdCtx } from "./framework";
import { FACINGS } from "../coords";

const zNum01 = z.number().min(-0.001).max(1.001);
const zP2 = z.tuple([z.number(), z.number()]);
const zV3f = z.tuple([z.number(), z.number(), z.number()]);

export const zRecipe: z.ZodType<Recipe> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("box"), min: z.tuple([zNum01, zNum01, zNum01]), max: z.tuple([zNum01, zNum01, zNum01]) })
      .describe("axis-aligned box inside the cell, coordinates 0..1"),
    z.object({ type: z.literal("extrude"), profile: z.array(zP2).min(3).max(200), axis: z.enum(["x", "z"]).default("x"), from: zNum01.optional(), to: zNum01.optional() })
      .describe("2D polygon extruded along an axis. axis x: points are (z, y); axis z: points are (x, y). The tall/back side should be at z=0 (north)."),
    z.object({ type: z.literal("lathe"), profile: z.array(zP2).min(2).max(100), segments: z.number().int().min(3).max(48).optional() })
      .describe("profile (radius, y) from bottom to top, revolved around the cell's vertical centre"),
    z.object({ type: z.literal("curve"), path: z.array(zP2).min(2).max(200), thickness: z.number().positive().max(1), axis: z.enum(["x", "z"]).optional(), from: zNum01.optional(), to: zNum01.optional() })
      .describe("thick polyline (curved tile, arch rib): path points like extrude profile points"),
    z.object({ type: z.literal("subvoxel"), size: z.number().int().min(2).max(16), mask: z.array(z.array(z.string())) })
      .describe("mask[y][z] is a row string over x; '#' = filled. size^3 grid inside the cell"),
    z.object({
      type: z.literal("composite"),
      parts: z.array(z.object({ recipe: zRecipe, offset: zV3f.optional(), scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(), yaw: z.number().int().optional() })).min(1).max(32),
    }).describe("several recipes combined"),
    z.object({ type: z.literal("mesh"), positions: z.array(z.number()).max(6000), indices: z.array(z.number().int().nonnegative()).max(18000) })
      .describe("raw triangles (last resort, max 2000 vertices)"),
  ]),
) as z.ZodType<Recipe>;

const zId = z.string().regex(/^[a-z0-9_.-]+$/i, "ids use letters, digits, _ . -").max(64);

function qualify(id: string): string {
  if (id.startsWith("builtin.")) throw new CmdError("READ_ONLY", "builtin.* ids are reserved", 'use an id like "ai.my_block" or "user.my_block"');
  return /^(ai|user)\./.test(id) ? id : `ai.${id}`;
}

/** Faces fully covered by the shape (for hidden-face culling). Exact for box and subvoxel. */
export function autoSolidFaces(r: Recipe): FaceName[] {
  const e = 1e-6;
  if (r.type === "box") {
    const [x0, y0, z0] = r.min, [x1, y1, z1] = r.max;
    const fx = x0 <= e && x1 >= 1 - e, fy = y0 <= e && y1 >= 1 - e, fz = z0 <= e && z1 >= 1 - e;
    const out: FaceName[] = [];
    if (fy && fz && x1 >= 1 - e) out.push("+x");
    if (fy && fz && x0 <= e) out.push("-x");
    if (fx && fz && y1 >= 1 - e) out.push("+y");
    if (fx && fz && y0 <= e) out.push("-y");
    if (fx && fy && z1 >= 1 - e) out.push("+z");
    if (fx && fy && z0 <= e) out.push("-z");
    return out;
  }
  if (r.type === "subvoxel") {
    const n = r.size;
    const f = (x: number, y: number, z: number) => r.mask[y]?.[z]?.[x] === "#";
    const full = (pick: (a: number, b: number) => boolean) => {
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (!pick(a, b)) return false;
      return true;
    };
    const out: FaceName[] = [];
    if (full((a, b) => f(n - 1, a, b))) out.push("+x");
    if (full((a, b) => f(0, a, b))) out.push("-x");
    if (full((a, b) => f(a, n - 1, b))) out.push("+y");
    if (full((a, b) => f(a, 0, b))) out.push("-y");
    if (full((a, b) => f(a, b, n - 1))) out.push("+z");
    if (full((a, b) => f(a, b, 0))) out.push("-z");
    return out;
  }
  return [];
}

function upsert<T extends { id: string; version?: number }>(list: T[], def: T): T {
  const i = list.findIndex((d) => d.id === def.id);
  if (i >= 0) {
    def.version = (list[i].version ?? 1) + 1;
    list[i] = def;
  } else {
    def.version = def.version ?? 1;
    list.push(def);
  }
  return def;
}

// ---------------- search ----------------
export const searchAssets = defineCommand({
  name: "searchAssets",
  group: "asset",
  description: "Search shapes / materials / components (builtin, this project and the shared library) by words and tags. Check here before creating a new asset.",
  schema: z.object({ text: z.string().optional(), tags: z.array(z.string()).optional(), kind: z.enum(["shape", "material", "component"]).optional(), limit: z.number().int().min(1).max(200).default(25) }),
  mutates: false,
  example: { text: "roof tile", kind: "shape" },
  run(ctx, a) {
    const res = ctx.engine.assets.search({ text: a.text, tags: a.tags, kind: a.kind }, ctx.project.meta.assets);
    return { count: res.length, results: res.slice(0, a.limit) };
  },
  summarize: (r) => `${r.count} asset(s) found`,
});

export const describeAsset = defineCommand({
  name: "describeAsset",
  group: "asset",
  description: "Full definition of one asset (shape recipe, material values or component blocks).",
  schema: z.object({ id: z.string(), kind: z.enum(["shape", "material", "component"]).optional() }),
  mutates: false,
  example: { id: "wedge", kind: "shape" },
  run(ctx, a) {
    const A = ctx.engine.assets, pa = ctx.project.meta.assets;
    const shape = a.kind && a.kind !== "shape" ? undefined : A.findShape(a.id, pa.shapes);
    if (shape) {
      const g = buildGeometry(shape.recipe);
      return { kind: "shape", def: shape, triangles: g.triangles, bounds: g.bounds };
    }
    const mat = a.kind && a.kind !== "material" ? undefined : A.findMaterial(a.id, pa.materials);
    if (mat) return { kind: "material", def: mat };
    const comp = A.findComponent(a.id, pa.components);
    if (comp) return { kind: "component", def: comp };
    throw new CmdError("UNKNOWN_ASSET", `asset "${a.id}" not found`, "searchAssets lists ids");
  },
});

// ---------------- shapes ----------------
const zShapeArgs = z.object({
  id: zId.describe('new id, e.g. "ai.jp_roof_tile" (prefix ai. is added when missing)'),
  name: z.string().min(1),
  recipe: zRecipe,
  solidFaces: z.array(z.enum(["+x", "-x", "+y", "-y", "+z", "-z"])).optional().describe("faces fully covering the cell side; auto-detected for box/subvoxel"),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  register: z.boolean().default(true).describe("also save to the shared library for other projects"),
});

function createShapeImpl(ctx: CmdCtx, a: z.output<typeof zShapeArgs>) {
  const id = qualify(a.id);
  let g;
  try {
    g = buildGeometry(a.recipe);
  } catch (e) {
    throw new CmdError("BAD_SHAPE", (e as Error).message, "check the recipe coordinates (0..1) and polygon order");
  }
  const issues = validateGeometry(g);
  if (issues.length) throw new CmdError("BAD_SHAPE", issues.join("; "), "keep every coordinate between 0 and 1");
  const def: ShapeDef = {
    id, name: a.name, recipe: a.recipe,
    solidFaces: a.solidFaces ?? autoSolidFaces(a.recipe),
    tags: a.tags, description: a.description,
  };
  // versions are per project (deterministic on replay); caches are cleared by id below
  def.version = (ctx.project.meta.assets.shapes.find((d) => d.id === id)?.version ?? 0) + 1;
  const list = ctx.project.meta.assets.shapes;
  const i = list.findIndex((d) => d.id === id);
  if (i >= 0) list[i] = def; else list.push(def);
  clearGeometryCache(id);
  if (a.register) ctx.libraryWrites.push({ kind: "shape", def: structuredClone(def) });
  return { id, version: def.version, triangles: g.triangles, bounds: g.bounds.map((v) => +v.toFixed(3)), solidFaces: def.solidFaces, registered: a.register };
}

export const createShape = defineCommand({
  name: "createShape",
  group: "asset",
  description:
    "Create (or update, same id) a parametric block shape from a recipe: box, extrude, lathe, curve, subvoxel, composite or mesh. The engine builds real 3D geometry, validates it and registers it in the library.",
  schema: zShapeArgs,
  mutates: true,
  example: {
    id: "ai.gentle_slope", name: "완경사 지붕", tags: ["roof", "slope"],
    recipe: { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [1, 0.25], [0, 0.75]] },
  },
  run: (ctx, a) => createShapeImpl(ctx, a),
  summarize: (r) => `shape ${r.id} v${r.version}: ${r.triangles} triangles${r.registered ? ", registered" : ""}`,
});

// ---------------- materials ----------------
const zMaterialArgs = z.object({
  id: zId,
  name: z.string().min(1),
  kind: z.enum(["wood", "stone", "metal", "glass", "concrete", "brick", "tile", "plant", "water", "custom"]).default("custom"),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/, "color must be a hex like #8a6a45"),
  opacity: z.number().min(0.05).max(1).default(1),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  emissive: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe("set for glowing materials (lamps)"),
  pattern: z.enum(["noise", "grain", "plank", "brick", "tile", "grid", "none", "leaf"]).optional(),
  variation: z.number().min(0).max(0.3).default(0.07).describe("per-block lightness variation"),
  tags: z.array(z.string()).default([]),
  register: z.boolean().default(true),
});

function createMaterialImpl(ctx: CmdCtx, a: z.output<typeof zMaterialArgs>) {
  const id = qualify(a.id);
  const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`).toLowerCase();
  const def: MaterialDef = {
    id, name: a.name, kind: a.kind, color: hex(a.color), opacity: a.opacity,
    roughness: a.roughness, metalness: a.metalness, emissive: a.emissive ? hex(a.emissive) : undefined,
    pattern: { type: a.pattern ?? (a.kind === "wood" ? "plank" : a.kind === "brick" ? "brick" : a.kind === "tile" ? "tile" : a.kind === "glass" ? "grid" : "noise"), contrast: 0.18 },
    variants: { count: 4, lightness: a.variation },
    tags: a.tags,
  };
  def.version = (ctx.project.meta.assets.materials.find((d) => d.id === id)?.version ?? 0) + 1;
  const list = ctx.project.meta.assets.materials;
  const i = list.findIndex((d) => d.id === id);
  if (i >= 0) list[i] = def; else list.push(def);
  if (a.register) ctx.libraryWrites.push({ kind: "material", def: structuredClone(def) });
  return { id, version: def.version, registered: a.register };
}

export const createMaterial = defineCommand({
  name: "createMaterial",
  group: "asset",
  description: "Create (or update, same id) a material: colour, opacity, glow, procedural pattern. Saved to the library for reuse.",
  schema: zMaterialArgs,
  mutates: true,
  example: { id: "ai.kawara_gray", name: "회색 기와", kind: "tile", color: "#4f5866", tags: ["roof", "japanese"] },
  run: (ctx, a) => createMaterialImpl(ctx, a),
  summarize: (r) => `material ${r.id} v${r.version}${r.registered ? ", registered" : ""}`,
});

export const createCustomBlock = defineCommand({
  name: "createCustomBlock",
  group: "asset",
  description: "One step: create a shape (and optionally a new material) and register both. Same args as createShape plus optional material.",
  schema: zShapeArgs.extend({ material: zMaterialArgs.optional() }),
  mutates: true,
  example: {
    id: "ai.round_tile", name: "둥근 기와", tags: ["roof", "tile"],
    recipe: { type: "curve", axis: "x", thickness: 0.18, path: [[0, 0.9], [0.3, 0.75], [0.6, 0.45], [1, 0.1]] },
    material: { id: "ai.dark_tile", name: "짙은 기와", kind: "tile", color: "#3d4450" },
  },
  run(ctx, a) {
    const shape = createShapeImpl(ctx, a);
    const material = a.material ? createMaterialImpl(ctx, a.material) : undefined;
    return { shape, material };
  },
  summarize: (r) => `custom block ${r.shape.id}${r.material ? " + " + r.material.id : ""}`,
});

// ---------------- components ----------------
export const createComponent = defineCommand({
  name: "createComponent",
  group: "asset",
  description: "Save a reusable multi-block part (window set, railing bay, truss segment). Capture it from a region of the world, or pass blocks directly.",
  schema: z.object({
    id: zId,
    name: z.string().min(1),
    from: zVec3.optional(),
    to: zVec3.optional(),
    blocks: z.array(z.object({ at: zVec3, shape: z.string().default("cube"), material: z.string(), facing: zFacing.optional(), upsideDown: z.boolean().optional() })).max(20000).optional(),
    tags: z.array(z.string()).default([]),
    register: z.boolean().default(true),
  }).refine((a) => (a.from && a.to) || a.blocks, { message: "give from+to (capture) or blocks" }),
  mutates: true,
  example: { id: "ai.window_2x3", name: "창문 2x3", from: [0, 1, 0], to: [1, 3, 0], tags: ["window"] },
  run(ctx, a) {
    const id = qualify(a.id);
    const p = ctx.project;
    let blocks: ComponentDef["blocks"] = [];
    let size: Vec3;
    if (a.from && a.to) {
      const { min, max } = normBox(a.from, a.to);
      size = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
      for (let x = min[0]; x <= max[0]; x++)
        for (let y = min[1]; y <= max[1]; y++)
          for (let z = min[2]; z <= max[2]; z++) {
            const b = p.world.get(x, y, z);
            if (b) blocks.push({ at: [x - min[0], y - min[1], z - min[2]], shape: p.shapeId(b.shape), material: p.materialId(b.material), rot: b.rot });
          }
      if (!blocks.length) throw new CmdError("EMPTY", "no blocks in that region");
    } else {
      blocks = a.blocks!.map((b) => {
        // validate ids now so placing never fails later
        p.assets.findShape(b.shape, p.meta.assets.shapes) ?? (() => { throw new CmdError("UNKNOWN_SHAPE", `unknown shape "${b.shape}"`); })();
        p.assets.findMaterial(b.material, p.meta.assets.materials) ?? (() => { throw new CmdError("UNKNOWN_MATERIAL", `unknown material "${b.material}"`); })();
        return { at: b.at, shape: p.assets.normalizeId(b.shape), material: p.assets.normalizeId(b.material), rot: (b.upsideDown ? 4 : 0) | FACINGS.indexOf(b.facing ?? "north") };
      });
      const mn = [0, 1, 2].map((i) => Math.min(...blocks.map((b) => b.at[i])));
      blocks = blocks.map((b) => ({ ...b, at: [b.at[0] - mn[0], b.at[1] - mn[1], b.at[2] - mn[2]] as Vec3 }));
      size = [0, 1, 2].map((i) => Math.max(...blocks.map((b) => b.at[i])) + 1) as Vec3;
    }
    const def: ComponentDef = { id, name: a.name, size, blocks, tags: a.tags };
    upsert(p.meta.assets.components, def);
    if (a.register) ctx.libraryWrites.push({ kind: "component", def: structuredClone(def) });
    return { id, version: def.version, size, blocks: blocks.length, registered: a.register };
  },
  summarize: (r) => `component ${r.id}: ${r.blocks} blocks, size ${r.size.join("x")}`,
});

/** rotate a component-local cell by yaw k around its footprint (same convention as block facing) */
export function rotateLocal(at: Vec3, size: Vec3, k: number): Vec3 {
  const [x, y, z] = at, [w, , d] = size;
  switch (((k % 4) + 4) % 4) {
    case 1: return [d - 1 - z, y, x];
    case 2: return [w - 1 - x, y, d - 1 - z];
    case 3: return [z, y, w - 1 - x];
    default: return [x, y, z];
  }
}

export const placeComponent = defineCommand({
  name: "placeComponent",
  group: "structure",
  description: "Place a component at a position (its min corner), optionally rotated and repeated in a grid (e.g. a row of windows).",
  schema: z.object({
    id: z.string(),
    at: zVec3,
    facing: zFacing.default("north"),
    repeat: z.object({ count: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]), step: zVec3 }).optional(),
    replace: z.boolean().default(true).describe("false = only fill empty cells"),
    structure: zStructureRef.optional(),
  }),
  mutates: true,
  example: { id: "ai.window_2x3", at: [2, 1, 0], repeat: { count: [4, 1, 1], step: [3, 0, 0] }, structure: { name: "south windows", type: "window" } },
  run(ctx, a) {
    const p = ctx.project;
    const comp = p.assets.findComponent(a.id, p.meta.assets.components) ?? p.assets.findComponent(qualify(a.id), p.meta.assets.components);
    if (!comp) throw new CmdError("UNKNOWN_COMPONENT", `component "${a.id}" not found`, "createComponent first, or searchAssets kind=component");
    if (!p.meta.assets.components.some((d) => d.id === comp.id)) p.meta.assets.components.push(structuredClone(comp));
    const s = resolveStructure(ctx, a.structure, a.structure && typeof a.structure === "object" ? { cmd: "placeComponent", args: { ...a, structure: undefined } } : undefined);
    const k = FACINGS.indexOf(a.facing);
    const [nx, ny, nz] = a.repeat?.count ?? [1, 1, 1];
    const step = a.repeat?.step ?? [0, 0, 0];
    const cache = new Map<string, number>();
    const sIdx = (id: string) => { let v = cache.get("s" + id); if (v === undefined) { v = p.shapeIdx(id); cache.set("s" + id, v); } return v; };
    const mIdx = (id: string) => { let v = cache.get("m" + id); if (v === undefined) { v = p.materialIdx(id); cache.set("m" + id, v); } return v; };
    let n = 0;
    for (let ix = 0; ix < nx; ix++)
      for (let iy = 0; iy < ny; iy++)
        for (let iz = 0; iz < nz; iz++) {
          const base: Vec3 = [a.at[0] + ix * step[0], a.at[1] + iy * step[1], a.at[2] + iz * step[2]];
          for (const b of comp.blocks) {
            const l = rotateLocal(b.at, comp.size, k);
            const x = base[0] + l[0], y = base[1] + l[1], z = base[2] + l[2];
            if (!a.replace && p.world.get(x, y, z)) continue;
            const rot = (((b.rot ?? 0) & 3) + k) % 4 | ((b.rot ?? 0) & 4);
            ctx.tx.set(x, y, z, { shape: sIdx(b.shape), material: mIdx(b.material), rot, structure: s?.num ?? 0 });
            n++;
          }
        }
    return { blocksAdded: n, structureId: s?.id, copies: nx * ny * nz };
  },
});

export const registerAsset = defineCommand({
  name: "registerAsset",
  group: "asset",
  description: "Copy an asset that exists only in this project into the shared library.",
  schema: z.object({ id: z.string() }),
  mutates: false,
  example: { id: "ai.gentle_slope" },
  run(ctx, a) {
    const pa = ctx.project.meta.assets;
    const s = pa.shapes.find((d) => d.id === a.id);
    if (s) { ctx.libraryWrites.push({ kind: "shape", def: structuredClone(s) }); return { id: a.id, kind: "shape" }; }
    const m = pa.materials.find((d) => d.id === a.id);
    if (m) { ctx.libraryWrites.push({ kind: "material", def: structuredClone(m) }); return { id: a.id, kind: "material" }; }
    const c = pa.components.find((d) => d.id === a.id);
    if (c) { ctx.libraryWrites.push({ kind: "component", def: structuredClone(c) }); return { id: a.id, kind: "component" }; }
    throw new CmdError("UNKNOWN_ASSET", `"${a.id}" is not a project asset`);
  },
});
