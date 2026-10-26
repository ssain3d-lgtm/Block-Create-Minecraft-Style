// Structure operations (rebuild / modify / duplicate / move) and the BuildingPlan executor.
import { z } from "zod";
import { keyToCell, Vec3 } from "../coords";
import type { Structure } from "../types";
import { CmdCtx, CmdError, defineCommand, zVec3 } from "./framework";
import { GENERATORS, runGenerator } from "./builder";
import { rotateLocal } from "./assets";
import { footprintCells, shapeSize } from "../multicell";

function refsOf(s: Structure): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "ref" && typeof x === "string") out.push(x);
        else walk(x);
      }
    }
  };
  walk(s.source?.args);
  return out;
}

function dependents(ctx: CmdCtx, s: Structure): Structure[] {
  const names = new Set([s.id, s.key, s.name].filter(Boolean) as string[]);
  return ctx.project.meta.structures.filter((o) => o !== s && o.buildingId === s.buildingId && refsOf(o).some((r) => names.has(r)));
}

function clearStructure(ctx: CmdCtx, s: Structure) {
  for (const k of ctx.project.world.structureCells(s.num)) {
    const [x, y, z] = keyToCell(k);
    ctx.tx.set(x, y, z, null);
  }
}

function applyOverrides(ctx: CmdCtx, s: Structure) {
  const p = ctx.project;
  for (const o of s.overrides) {
    const [x, y, z] = o.at;
    if (o.op === "remove") ctx.tx.set(x, y, z, null);
    else ctx.tx.set(x, y, z, { shape: p.shapeIdx(o.shape ?? "cube"), material: p.materialIdx(o.material ?? "stone"), rot: o.rot ?? 0, structure: s.num });
  }
}

/** Re-runs the structure's source command into the same structure (keeps id, overrides). */
export function rebuild(ctx: CmdCtx, s: Structure): number {
  if (!s.source) throw new CmdError("NOT_REBUILDABLE", `${s.id} was not made by a generator`, "only generated structures can be rebuilt");
  if (s.locked) throw new CmdError("LOCKED", `structure ${s.id} is locked`);
  clearStructure(ctx, s);
  const gen = GENERATORS.get(s.source.cmd);
  if (gen) {
    const parsed = gen.schema.safeParse(s.source.args);
    if (!parsed.success) throw new CmdError("INVALID_ARGS", `${s.id}: ${parsed.error.issues[0].message}`, undefined, parsed.error.issues[0].path.join("."));
    return runGenerator(ctx, gen, parsed.data, s).blocksAdded;
  }
  if (s.source.cmd === "duplicateStructure") {
    const n = copyFrom(ctx, s.source.args as DupArgs, s);
    applyOverrides(ctx, s);
    return n;
  }
  // block commands that accept a structure id (fillRegion, placeComponent)
  const r = ctx.run(s.source.cmd, { ...(s.source.args as object), structure: s.id }) as { blocksAdded?: number };
  applyOverrides(ctx, s);
  return r.blocksAdded ?? 0;
}

function rebuildCascade(ctx: CmdCtx, root: Structure, cascade: boolean) {
  const done = new Set<Structure>();
  const order: { id: string; blocks: number }[] = [];
  const visit = (s: Structure) => {
    if (done.has(s)) return;
    done.add(s);
    order.push({ id: s.id, blocks: rebuild(ctx, s) });
    if (cascade) for (const d of dependents(ctx, s)) if (d.source && !d.locked) visit(d);
  };
  visit(root);
  return order;
}

export const rebuildStructure = defineCommand({
  name: "rebuildStructure",
  group: "structure",
  description: "Rebuild one structure from its recorded command (hand edits are re-applied). cascade also rebuilds structures that reference it.",
  schema: z.object({ id: z.string(), cascade: z.boolean().default(false) }),
  mutates: true,
  example: { id: "roof" },
  run(ctx, a) {
    const s = ctx.project.structure(a.id);
    if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`, "call getState");
    const rebuilt = rebuildCascade(ctx, s, a.cascade);
    return { structureId: s.id, rebuilt };
  },
  summarize: (r) => `rebuilt ${r.rebuilt.map((x: { id: string }) => x.id).join(", ")}`,
});

function merge(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined;
  if (Array.isArray(patch) || typeof patch !== "object" || patch === undefined) return patch === undefined ? base : patch;
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const m = merge(out[k], v);
    if (m === undefined) delete out[k]; else out[k] = m;
  }
  return out;
}

export const modifyStructure = defineCommand({
  name: "modifyStructure",
  group: "structure",
  description:
    "Change some arguments of a generated structure and rebuild ONLY it (and, with cascade, what sits on it). args is merged into the original args (objects merge, arrays replace, null removes).",
  schema: z.object({ id: z.string(), args: z.record(z.string(), z.unknown()), cascade: z.boolean().default(true) }),
  mutates: true,
  example: { id: "roof", args: { pitch: 0.5, material: "roof_tile" } },
  run(ctx, a) {
    const s = ctx.project.structure(a.id);
    if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`, "call getState");
    if (!s.source) throw new CmdError("NOT_REBUILDABLE", `${s.id} has no recorded command`);
    const merged = merge(s.source.args, a.args) as Record<string, unknown>;
    const gen = GENERATORS.get(s.source.cmd);
    const schema = gen?.schema ?? ctx.engine.commands.get(s.source.cmd)?.schema;
    if (schema) {
      const parsed = schema.safeParse(merged);
      if (!parsed.success) {
        const is = parsed.error.issues[0];
        throw new CmdError("INVALID_ARGS", `${is.path.join(".")}: ${is.message}`, `current args: ${JSON.stringify(s.source.args).slice(0, 400)}`, is.path.join("."));
      }
      s.source = { cmd: s.source.cmd, args: parsed.data };
    } else s.source = { cmd: s.source.cmd, args: merged };
    if (typeof merged.name === "string") s.name = merged.name;
    const rebuilt = rebuildCascade(ctx, s, a.cascade);
    return { structureId: s.id, rebuilt };
  },
  summarize: (r) => `modified ${r.structureId}; rebuilt ${r.rebuilt.length} structure(s), ${r.rebuilt.reduce((n: number, x: { blocks: number }) => n + x.blocks, 0)} blocks`,
});

// ---------------- duplicate ----------------
const zDup = z.object({
  id: z.string(),
  offset: zVec3,
  count: z.number().int().min(1).max(256).default(1),
  rotate: z.number().int().min(0).max(3).default(0).describe("quarter turns around the copy's footprint"),
  mirror: z.enum(["none", "x", "z"]).default("none"),
  name: z.string().optional(),
  key: z.string().optional(),
  index: z.number().int().min(1).optional(),
});
type DupArgs = z.output<typeof zDup>;

function copyFrom(ctx: CmdCtx, a: DupArgs, dst: Structure): number {
  const p = ctx.project;
  const src = p.structure(a.id);
  if (!src) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`);
  const box = p.structureBox(src);
  if (!box) return 0;
  const size: Vec3 = [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1];
  const i = a.index ?? 1;
  let n = 0;
  const occ = p.occIdxIfAny();
  const moveCell = (c: Vec3): Vec3 => {
    let l: Vec3 = [c[0] - box.min[0], c[1] - box.min[1], c[2] - box.min[2]];
    if (a.mirror === "x") l = [size[0] - 1 - l[0], l[1], l[2]];
    if (a.mirror === "z") l = [l[0], l[1], size[2] - 1 - l[2]];
    l = rotateLocal(l, size, a.rotate);
    return [box.min[0] + l[0] + a.offset[0] * i, box.min[1] + l[1] + a.offset[1] * i, box.min[2] + l[2] + a.offset[2] * i];
  };
  // read everything first (the copy may overlap the source)
  const src2 = p.world.structureCells(src.num).map((k) => { const c = keyToCell(k); return { c, b: p.world.get(c[0], c[1], c[2])! }; });
  for (const { c, b } of src2) {
    if (b.shape === occ) continue; // covered cells are recreated from their anchor
    let yaw = b.rot & 3;
    if (a.mirror === "x" && (yaw === 1 || yaw === 3)) yaw = 4 - yaw;
    if (a.mirror === "z" && (yaw === 0 || yaw === 2)) yaw = 2 - yaw;
    yaw = (yaw + a.rotate) % 4;
    const multi = p.multiDef(b.shape);
    // a multi-cell shape's new anchor is the min corner of its transformed footprint
    const t = multi
      ? footprintCells(c, shapeSize(multi), b.rot).map(moveCell).reduce((m, v) => [Math.min(m[0], v[0]), Math.min(m[1], v[1]), Math.min(m[2], v[2])] as Vec3)
      : moveCell(c);
    ctx.tx.set(t[0], t[1], t[2], { ...b, rot: yaw | (b.rot & 4), structure: dst.num });
    n += multi ? shapeSize(multi).reduce((x, y) => x * y, 1) : 1;
  }
  return n;
}

export const duplicateStructure = defineCommand({
  name: "duplicateStructure",
  group: "structure",
  description: "Copy a structure (offset, quarter-turn rotate, mirror; count makes a row of copies). Copies follow the original when rebuilt.",
  schema: zDup,
  mutates: true,
  example: { id: "tower_w", offset: [40, 0, 0], mirror: "x" },
  run(ctx, a) {
    const src = ctx.project.structure(a.id);
    if (!src) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`, "call getState");
    const made: { id: string; blocks: number }[] = [];
    for (let i = 1; i <= a.count; i++) {
      const args = { ...a, count: 1, index: i };
      const s = ctx.project.newStructure({
        name: a.name ? (a.count > 1 ? `${a.name} ${i}` : a.name) : `${src.name} copy${a.count > 1 ? " " + i : ""}`,
        type: src.type, key: a.key ? (a.count > 1 ? `${a.key}_${i}` : a.key) : undefined,
        buildingId: src.buildingId, tags: src.tags, source: { cmd: "duplicateStructure", args },
      });
      made.push({ id: s.id, blocks: copyFrom(ctx, args, s) });
    }
    return { copies: made, blocksAdded: made.reduce((n, m) => n + m.blocks, 0) };
  },
  summarize: (r) => `duplicated into ${r.copies.map((c: { id: string }) => c.id).join(", ")} (+${r.blocksAdded} blocks)`,
});

export const moveBuilding = defineCommand({
  name: "moveBuilding",
  group: "structure",
  description: "Move a whole building to a new origin (generated structures are rebuilt there, others are shifted).",
  schema: z.object({ building: z.string(), origin: zVec3 }),
  mutates: true,
  example: { building: "house", origin: [30, 0, 0] },
  run(ctx, a) {
    const p = ctx.project;
    const b = p.meta.buildings.find((x) => x.id === a.building || x.name === a.building);
    if (!b) throw new CmdError("UNKNOWN_BUILDING", `building "${a.building}" not found`);
    const d: Vec3 = [a.origin[0] - b.origin[0], a.origin[1] - b.origin[1], a.origin[2] - b.origin[2]];
    b.origin = a.origin;
    const list = p.meta.structures.filter((s) => s.buildingId === b.id);
    // shift non-generated blocks first (collect, clear, re-set)
    const moved: { x: number; y: number; z: number; b: ReturnType<typeof p.world.get> }[] = [];
    for (const s of list) {
      if (s.source && GENERATORS.has(s.source.cmd)) continue;
      const cells = p.world.structureCells(s.num).map((k) => keyToCell(k));
      // read first, then clear (clearing one cell of a multi-cell shape clears the whole shape)
      for (const [x, y, z] of cells) moved.push({ x: x + d[0], y: y + d[1], z: z + d[2], b: p.world.get(x, y, z) });
      for (const [x, y, z] of cells) ctx.tx.set(x, y, z, null);
      s.overrides = s.overrides.map((o) => ({ ...o, at: [o.at[0] + d[0], o.at[1] + d[1], o.at[2] + d[2]] as Vec3 }));
    }
    for (const m of moved) ctx.tx.set(m.x, m.y, m.z, m.b);
    for (const s of list) {
      if (!s.source || !GENERATORS.has(s.source.cmd)) continue;
      s.overrides = s.overrides.map((o) => ({ ...o, at: [o.at[0] + d[0], o.at[1] + d[1], o.at[2] + d[2]] as Vec3 }));
      rebuild(ctx, s);
    }
    return { buildingId: b.id, structures: list.length };
  },
});

// ---------------- plan ----------------
export const zPlan = z.object({
  plan: z.string().optional().describe("plan name"),
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  cellSize: z.number().optional(),
  newProject: z.boolean().optional().describe("(CLI/studio) start an empty project first"),
  assets: z.array(z.object({ cmd: z.string(), args: z.unknown() })).default([]).describe("createShape / createMaterial / createComponent steps run first"),
  buildings: z.array(z.object({
    name: z.string(),
    origin: z.tuple([z.number().int(), z.number().int(), z.number().int()]).default([0, 0, 0]),
    structures: z.array(z.object({ key: z.string(), cmd: z.string(), args: z.record(z.string(), z.unknown()).default({}) })).max(2000),
  })).default([]),
  after: z.array(z.object({ cmd: z.string(), args: z.unknown() })).default([]).describe("extra commands at the end (duplicate, editBlocks ...)"),
  dryRun: z.boolean().default(false).describe("check everything and report counts, then undo it all"),
});

export const executePlan = defineCommand({
  name: "executePlan",
  group: "build",
  description:
    "Run a BuildingPlan: assets first, then each building's structures in order (keys let later structures reference earlier ones), then 'after' steps. One undo step. dryRun validates and reports without changing anything.",
  schema: zPlan,
  mutates: true,
  example: {
    plan: "small_house",
    buildings: [{
      name: "house", origin: [0, 0, 0], structures: [
        { key: "base", cmd: "createFoundation", args: { area: { at: [0, 0, 0], size: [12, 9] }, height: 1, material: "concrete" } },
        { key: "walls", cmd: "createWall", args: { loop: { on: { ref: "base" } }, height: 4, material: "brick", openings: [{ side: "south", at: 5, width: 2, height: 3, bottom: 0, fill: null }] } },
        { key: "roof", cmd: "createRoof", args: { area: { on: { ref: "walls" } }, style: "gable", pitch: 1, material: "roof_tile" } },
      ],
    }],
  },
  run(ctx, a) {
    if (a.newProject) {
      // "new project + plan" is one atomic step: the plan is built in a scratch engine on an empty
      // project; nothing (project, shared library) changes unless the whole plan succeeds.
      const E = ctx.engine.constructor as typeof import("../engine").Engine;
      const scratch = new E({ assets: ctx.engine.assets, host: ctx.host, replaying: a.dryRun, collectLibrary: true });
      scratch.newProject(a.name ?? a.plan ?? "plan", a.cellSize ? { cellSize: a.cellSize } : undefined);
      const r = scratch.execute({ cmd: "executePlan", args: { ...a, newProject: false, dryRun: false } });
      if (!r.ok) throw new CmdError(r.error.code, r.error.message, r.error.hint, r.error.path);
      if (a.dryRun) return { ...r.result, dryRun: true, newProject: true };
      ctx.libraryWrites.push(...scratch.collectedLibrary);
      ctx.replaceProject = scratch.project;
      return { ...r.result, newProject: true };
    }
    const p = ctx.project;
    if (a.title || a.description || a.tags || a.name) ctx.run("setProjectInfo", { name: a.name, title: a.title, description: a.description, tags: a.tags });
    const steps: { key: string; cmd: string; structureId?: string; blocks?: number; warnings?: string[] }[] = [];
    a.assets.forEach((st, i) => {
      try { ctx.run(st.cmd, st.args); } catch (e) { throw annotate(e, `assets[${i}] ${st.cmd}`); }
    });
    for (const b of a.buildings) {
      if (!p.meta.buildings.some((x) => x.name === b.name)) ctx.run("createBuilding", { name: b.name, origin: b.origin });
      for (const st of b.structures) {
        const before = ctx.warnings.length;
        let r: any;
        try {
          r = ctx.run(st.cmd, { ...st.args, key: st.key, building: b.name });
        } catch (e) {
          throw annotate(e, `${b.name}/${st.key} (${st.cmd})`);
        }
        steps.push({ key: st.key, cmd: st.cmd, structureId: r?.structureId, blocks: r?.blocksAdded, warnings: ctx.warnings.slice(before) });
      }
    }
    a.after.forEach((st, i) => {
      try { ctx.run(st.cmd, st.args); } catch (e) { throw annotate(e, `after[${i}] ${st.cmd}`); }
    });
    if (a.dryRun) ctx.rollbackOnly = true;
    const blocks = steps.reduce((n, s) => n + (s.blocks ?? 0), 0);
    return { dryRun: a.dryRun, structures: steps.length, blocksAdded: blocks, totalBlocks: p.world.blockCount, steps };
  },
  summarize: (r) => `${r.dryRun ? "DRY RUN — " : ""}plan: ${r.structures} structures, +${r.blocksAdded} blocks (project ${r.totalBlocks})`,
});

function annotate(e: unknown, where: string): Error {
  if (e instanceof CmdError) return new CmdError(e.code, `${where}: ${e.message}`, e.hint, e.path);
  return new CmdError("INTERNAL", `${where}: ${(e as Error).message}`);
}
