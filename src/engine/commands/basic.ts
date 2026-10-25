import { z } from "zod";
import { keyToCell, makeRot, normBox } from "../coords";
import { CmdError, defineCommand, resolveStructure, zFacing, zStructureRef, zVec3, boxSize } from "./framework";
import type { ProjectFile } from "../project";

const MAX_REGION = 4_000_000;

function rotFrom(a: { facing?: "north" | "east" | "south" | "west"; upsideDown?: boolean }) {
  return makeRot(a.facing ?? "north", a.upsideDown ?? false);
}

// ---------------- project ----------------
export const newProject = defineCommand({
  name: "newProject",
  group: "project",
  description: "Start an empty project (clears undo history). cellSize = meters per block.",
  schema: z.object({
    name: z.string().default("untitled"),
    cellSize: z.number().positive().max(10).default(1),
    bounds: z.object({ min: zVec3, max: zVec3 }).optional(),
  }),
  mutates: false,
  example: { name: "my city", cellSize: 1 },
  run(ctx, a) {
    ctx.engine.newProject(a.name, { cellSize: a.cellSize, ...(a.bounds ? { bounds: a.bounds } : {}) });
    return { name: a.name };
  },
});

export const setProjectInfo = defineCommand({
  name: "setProjectInfo",
  group: "project",
  description: "Set project name / title / description / tags shown in the studio sidebar.",
  schema: z.object({
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  mutates: true,
  example: { name: "에펠탑", title: "iron lace", description: "블록으로 세운 파리의 탑", tags: ["파리, 프랑스", "샹드마르스"] },
  run(ctx, a) {
    Object.assign(ctx.project.meta, Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)));
    return {};
  },
});

export const getState = defineCommand({
  name: "getState",
  group: "inspect",
  description: "Summary of the project: block count, bounds, buildings and structures (with ids and boxes).",
  schema: z.object({ verbose: z.boolean().default(false) }),
  mutates: false,
  example: {},
  run(ctx, a) {
    const p = ctx.project;
    const structures = p.meta.structures.map((s) => ({
      id: s.id, key: s.key, name: s.name, type: s.type, building: s.buildingId,
      blocks: p.world.structIndex.get(s.num)?.size ?? 0,
      box: s.box, rebuildable: !!s.source, overrides: s.overrides.length,
      ...(a.verbose ? { source: s.source } : {}),
    }));
    return {
      name: p.meta.name, title: p.meta.title, cellSize: p.meta.settings.cellSize,
      blocks: p.world.blockCount, bounds: p.world.bounds(),
      buildings: p.meta.buildings, structures,
      logLength: p.log.length, canUndo: ctx.engine.canUndo, canRedo: ctx.engine.canRedo,
    };
  },
  summarize: (r) => `${r.name}: ${r.blocks} blocks, ${r.structures.length} structures`,
});

export const listCommands = defineCommand({
  name: "listCommands",
  group: "meta",
  description: "List every command with a one-line description and an example.",
  schema: z.object({ group: z.string().optional() }),
  mutates: false,
  example: {},
  run(ctx, a) {
    return { commands: ctx.engine.commandList().filter((c) => !a.group || c.group === a.group) };
  },
  summarize: (r) => `${r.commands.length} commands`,
});

export const describeCommand = defineCommand({
  name: "describeCommand",
  group: "meta",
  description: "Full JSON Schema of one command's args.",
  schema: z.object({ name: z.string() }),
  mutates: false,
  example: { name: "fillRegion" },
  run(ctx, a) {
    const s = ctx.engine.commandSchema(a.name);
    if (!s) throw new CmdError("UNKNOWN_COMMAND", `unknown command "${a.name}"`, "call listCommands");
    return s;
  },
});

// ---------------- blocks ----------------
export const getBlock = defineCommand({
  name: "getBlock",
  group: "blocks",
  description: "Read one cell.",
  schema: z.object({ at: zVec3 }),
  mutates: false,
  example: { at: [0, 0, 0] },
  run(ctx, a) {
    return { at: a.at, block: ctx.project.blockAt(...a.at) };
  },
});

const zEditOp = z.object({
  op: z.enum(["set", "remove"]),
  at: zVec3,
  shape: z.string().default("cube"),
  material: z.string().optional(),
  facing: zFacing.optional(),
  upsideDown: z.boolean().optional(),
});

export const editBlocks = defineCommand({
  name: "editBlocks",
  group: "blocks",
  description:
    "Low-level per-cell edits (hand editing). Edits on cells owned by a rebuildable structure are remembered as overrides and re-applied after rebuilds.",
  schema: z.object({ ops: z.array(zEditOp).min(1).max(100000), structure: zStructureRef.optional() }),
  mutates: true,
  example: { ops: [{ op: "set", at: [0, 0, 0], material: "stone" }, { op: "remove", at: [1, 0, 0] }] },
  run(ctx, a) {
    const p = ctx.project;
    const target = resolveStructure(ctx, a.structure);
    let added = 0, removed = 0, changed = 0;
    for (const op of a.ops) {
      const prev = p.world.get(...op.at);
      const ownerNum = target?.num ?? prev?.structure ?? 0;
      const owner = ownerNum ? p.structureByNum(ownerNum) : undefined;
      if (owner?.locked) throw new CmdError("LOCKED", `structure ${owner.id} is locked`);
      if (op.op === "remove") {
        if (!prev) continue;
        ctx.tx.set(...op.at, null);
        removed++;
      } else {
        if (!op.material) throw new CmdError("INVALID_ARGS", "set needs a material", '{"op":"set","at":[0,0,0],"material":"stone"}');
        const rot = rotFrom(op);
        ctx.tx.set(...op.at, { shape: p.shapeIdx(op.shape), material: p.materialIdx(op.material), rot, structure: ownerNum });
        if (prev) changed++; else added++;
      }
      if (owner?.source) {
        owner.overrides = owner.overrides.filter((o) => o.at.join() !== op.at.join());
        owner.overrides.push(op.op === "remove" ? { op: "remove", at: op.at } : { op: "set", at: op.at, shape: op.shape, material: op.material, rot: rotFrom(op) });
      }
    }
    return { blocksAdded: added, blocksRemoved: removed, blocksChanged: changed, structureId: target?.id };
  },
});

export const fillRegion = defineCommand({
  name: "fillRegion",
  group: "blocks",
  description: "Fill a box (inclusive corners) with one shape/material. hollow=true keeps only the shell.",
  schema: z.object({
    from: zVec3,
    to: zVec3,
    material: z.string(),
    shape: z.string().default("cube"),
    facing: zFacing.optional(),
    upsideDown: z.boolean().optional(),
    hollow: z.boolean().default(false),
    structure: zStructureRef.optional(),
  }),
  mutates: true,
  example: { from: [0, 0, 0], to: [9, 0, 9], material: "stone", structure: { name: "floor", type: "foundation" } },
  run(ctx, a) {
    const p = ctx.project;
    const { min, max } = normBox(a.from, a.to);
    if (boxSize(min, max) > MAX_REGION) throw new CmdError("TOO_LARGE", `region larger than ${MAX_REGION} cells`, "split it into smaller boxes");
    const s = resolveStructure(ctx, a.structure, a.structure && typeof a.structure === "object" ? { cmd: "fillRegion", args: { ...a, structure: undefined } } : undefined);
    if (s?.locked) throw new CmdError("LOCKED", `structure ${s.id} is locked`);
    const shape = p.shapeIdx(a.shape), material = p.materialIdx(a.material), rot = rotFrom(a);
    let n = 0;
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++) {
          if (a.hollow && x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2]) continue;
          ctx.tx.set(x, y, z, { shape, material, rot, structure: s?.num ?? 0 });
          n++;
        }
    return { blocksAdded: n, structureId: s?.id };
  },
});

export const removeRegion = defineCommand({
  name: "removeRegion",
  group: "blocks",
  description: "Remove all blocks in a box. With structure set, only that structure's blocks are removed.",
  schema: z.object({ from: zVec3, to: zVec3, structure: z.string().optional() }),
  mutates: true,
  example: { from: [0, 0, 0], to: [4, 4, 4] },
  run(ctx, a) {
    const p = ctx.project;
    const { min, max } = normBox(a.from, a.to);
    if (boxSize(min, max) > MAX_REGION) throw new CmdError("TOO_LARGE", `region larger than ${MAX_REGION} cells`);
    const only = a.structure ? p.structure(a.structure) : undefined;
    if (a.structure && !only) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.structure}" not found`);
    let n = 0;
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++) {
          const b = p.world.get(x, y, z);
          if (!b || (only && b.structure !== only.num)) continue;
          const owner = b.structure ? p.structureByNum(b.structure) : undefined;
          if (owner?.locked) continue;
          ctx.tx.set(x, y, z, null);
          n++;
        }
    return { blocksRemoved: n };
  },
});

export const replaceInRegion = defineCommand({
  name: "replaceInRegion",
  group: "blocks",
  description: "Repaint blocks in a box with a new material (optionally only those with matchMaterial / in one structure).",
  schema: z.object({
    from: zVec3, to: zVec3, material: z.string(),
    matchMaterial: z.string().optional(), structure: z.string().optional(),
  }),
  mutates: true,
  example: { from: [0, 0, 0], to: [9, 9, 9], material: "brick", matchMaterial: "stone" },
  run(ctx, a) {
    const p = ctx.project;
    const { min, max } = normBox(a.from, a.to);
    if (boxSize(min, max) > MAX_REGION) throw new CmdError("TOO_LARGE", `region larger than ${MAX_REGION} cells`);
    const mat = p.materialIdx(a.material);
    const match = a.matchMaterial ? p.materialIdx(a.matchMaterial) : 0;
    const only = a.structure ? p.structure(a.structure) : undefined;
    let n = 0;
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++) {
          const b = p.world.get(x, y, z);
          if (!b || (match && b.material !== match) || (only && b.structure !== only.num)) continue;
          ctx.tx.set(x, y, z, { ...b, material: mat });
          n++;
        }
    return { blocksChanged: n };
  },
});

// ---------------- history ----------------
export const undo = defineCommand({
  name: "undo", group: "project", description: "Undo the last change.",
  schema: z.object({}), mutates: false, example: {},
  run(ctx) { return ctx.engine.undo(); },
  summarize: (r) => (r.undone ? `undid ${r.undone}` : "nothing to undo"),
});

export const redo = defineCommand({
  name: "redo", group: "project", description: "Redo the last undone change.",
  schema: z.object({}), mutates: false, example: {},
  run(ctx) { return ctx.engine.redo(); },
  summarize: (r) => (r.redone ? `redid ${r.redone}` : "nothing to redo"),
});

// ---------------- batch ----------------
export const runBatch = defineCommand({
  name: "runBatch",
  group: "meta",
  description: "Run many commands as ONE undo step. If any fails, everything in the batch is rolled back.",
  schema: z.object({ commands: z.array(z.object({ cmd: z.string(), args: z.unknown().optional() })).min(1).max(5000) }),
  mutates: true,
  example: { commands: [{ cmd: "fillRegion", args: { from: [0, 0, 0], to: [3, 0, 3], material: "stone" } }] },
  run(ctx, a) {
    const results: unknown[] = [];
    a.commands.forEach((c, i) => {
      try {
        results.push(ctx.run(c.cmd, c.args ?? {}));
      } catch (e) {
        if (e instanceof CmdError) throw new CmdError(e.code, `batch step ${i} (${c.cmd}): ${e.message}`, e.hint, `commands.${i}`);
        throw e;
      }
    });
    return { steps: results.length, results };
  },
  summarize: (r) => `batch: ${r.steps} steps`,
});

// ---------------- io ----------------
export const saveProject = defineCommand({
  name: "saveProject",
  group: "io",
  description: "Save the project file (meta + command log + block snapshot). withWorld=false saves only the log (rebuilt on load).",
  schema: z.object({ path: z.string().min(1), withWorld: z.boolean().default(true) }),
  mutates: false,
  example: { path: "projects/house.vox.json" },
  run(ctx, a) {
    if (!ctx.host) throw new CmdError("NO_HOST", "saving needs a file host (CLI/server); in the studio use the Save button");
    const file = ctx.project.toFile(a.withWorld);
    const text = JSON.stringify(file);
    ctx.host.writeText(a.path, text);
    return { path: a.path, bytes: text.length, blocks: ctx.project.world.blockCount, hash: ctx.project.world.hash() };
  },
  summarize: (r) => `saved ${r.path} (${r.blocks} blocks, ${Math.round(r.bytes / 1024)} KB)`,
});

export const loadProject = defineCommand({
  name: "loadProject",
  group: "io",
  description: "Load a project file (clears undo history).",
  schema: z.object({ path: z.string().min(1) }),
  mutates: false,
  example: { path: "projects/house.vox.json" },
  run(ctx, a) {
    if (!ctx.host) throw new CmdError("NO_HOST", "loading needs a file host");
    let file: ProjectFile;
    try {
      file = JSON.parse(ctx.host.readText(a.path));
    } catch (e) {
      throw new CmdError("READ_FAILED", `cannot read ${a.path}: ${(e as Error).message}`);
    }
    const r = ctx.engine.loadFile(file);
    const p = ctx.engine.project;
    return { path: a.path, blocks: p.world.blockCount, structures: p.meta.structures.length, replayed: r.replayed, hash: p.world.hash() };
  },
  summarize: (r) => `loaded ${r.path} (${r.blocks} blocks)`,
});

export const verifyReplay = defineCommand({
  name: "verifyReplay",
  group: "inspect",
  description: "Rebuild the project from its command log in a scratch engine and compare with the current blocks.",
  schema: z.object({}),
  mutates: false,
  example: {},
  run(ctx) {
    // static Engine.replay via the instance (avoids a circular import)
    const replay = (ctx.engine.constructor as unknown as typeof import("../engine").Engine).replay;
    const p = replay(ctx.project.log, ctx.engine.assets, ctx.project.meta.settings, ctx.project.meta.assets);
    const a = ctx.project.world.hash(), b = p.world.hash();
    return { match: a === b, current: a, replayed: b, steps: ctx.project.log.length };
  },
  summarize: (r) => (r.match ? `replay matches (${r.steps} steps)` : `REPLAY MISMATCH ${r.current} vs ${r.replayed}`),
});

export const setStructure = defineCommand({
  name: "setStructure",
  group: "structure",
  description: "Change structure properties: name, visible (hide/show), locked (protect from edits), tags.",
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  }),
  mutates: true,
  example: { id: "s-3", visible: false },
  run(ctx, a) {
    const s = ctx.project.structure(a.id);
    if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`, "call getState");
    if (a.name !== undefined) s.name = a.name;
    if (a.visible !== undefined) s.visible = a.visible;
    if (a.locked !== undefined) s.locked = a.locked;
    if (a.tags !== undefined) s.tags = a.tags;
    return { structureId: s.id, visible: s.visible, locked: s.locked };
  },
});

export const deleteStructure = defineCommand({
  name: "deleteStructure",
  group: "structure",
  description: "Delete a structure and all its blocks.",
  schema: z.object({ id: z.string() }),
  mutates: true,
  example: { id: "s-3" },
  run(ctx, a) {
    const p = ctx.project;
    const s = p.structure(a.id);
    if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${a.id}" not found`, "call getState");
    let n = 0;
    for (const k of p.world.structureCells(s.num)) {
      const [x, y, z] = keyToCell(k);
      ctx.tx.set(x, y, z, null);
      n++;
    }
    p.meta.structures = p.meta.structures.filter((x) => x !== s);
    return { blocksRemoved: n, structureId: s.id };
  },
});
