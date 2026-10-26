// Automatic quality checks the engine can do without vision: floating parts, structures that are
// mostly overwritten or emptied (missing), broken asset references, symmetry, empty structures.
import { z } from "zod";
import { cellKey, keyToCell, Vec3 } from "../coords";
import type { Structure } from "../types";
import { CmdCtx, CmdError, defineCommand, Tx } from "./framework";
import { Builder, GENERATORS } from "./builder";

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  structureId?: string;
  bounds?: { min: Vec3; max: Vec3 };
  message: string;
  fixHint?: unknown;
}

// 26-neighbourhood: blocks touching at an edge or a corner count as connected (X-braced lattices)
const NB26: Vec3[] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) NB26.push([dx, dy, dz]);

/** connected groups of blocks (26-neighbour, through every block) that do not reach the lowest level */
function floatingGroups(ctx: CmdCtx) {
  const w = ctx.project.world;
  const all: number[] = [];
  let minY = Infinity;
  w.forEach((x, y, z) => { all.push(cellKey(x, y, z)); if (y < minY) minY = y; });
  if (!all.length) return [];
  const seen = new Set<number>();
  const groups: { size: number; min: Vec3; max: Vec3; structures: Set<number> }[] = [];
  for (const start of all) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let grounded = false, size = 0;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const structs = new Set<number>();
    while (stack.length) {
      const k = stack.pop()!;
      const c = keyToCell(k);
      size++;
      if (c[1] <= minY) grounded = true;
      for (let i = 0; i < 3; i++) { if (c[i] < min[i]) min[i] = c[i]; if (c[i] > max[i]) max[i] = c[i]; }
      const b = w.get(c[0], c[1], c[2]);
      if (b?.structure) structs.add(b.structure);
      for (const d of NB26) {
        const x = c[0] + d[0], y = c[1] + d[1], z = c[2] + d[2];
        const nk = cellKey(x, y, z);
        if (seen.has(nk)) continue;
        if (!w.get(x, y, z)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    if (!grounded) groups.push({ size, min, max, structures: structs });
  }
  return groups;
}

/** Cells a generated structure would have if rebuilt now (dry run of its generator). */
function intendedCells(ctx: CmdCtx, s: Structure): Set<number> | null {
  if (!s.source) return null;
  const gen = GENERATORS.get(s.source.cmd);
  if (!gen) return null;
  const parsed = gen.schema.safeParse(s.source.args);
  if (!parsed.success) return null;
  // run the generator against a recording transaction, then roll it back
  const tx = new Tx(ctx.project);
  const metaBefore = JSON.stringify(ctx.project.meta);
  const sub: CmdCtx = { ...ctx, tx, warnings: [] };
  const b = new Builder(sub, s);
  try {
    gen.build(b, parsed.data);
  } catch {
    tx.rollback();
    ctx.project.meta = JSON.parse(metaBefore);
    return null;
  }
  // only cells the generator wrote (not removed): those now holding this structure in the scratch state
  const written = new Set<number>();
  for (const k of tx.keys) {
    const b2 = ctx.project.world.get(...keyToCell(k));
    if (b2 && b2.structure === s.num) written.add(k);
  }
  tx.rollback();
  ctx.project.meta = JSON.parse(metaBefore);
  for (const o of s.overrides) {
    const k = cellKey(...o.at);
    if (o.op === "remove") written.delete(k); else written.add(k);
  }
  return written;
}

function inspect(ctx: CmdCtx, a: { structures?: string[]; checks: string[]; symmetry?: { axis: "x" | "z"; center?: number; structures?: string[] }; maxIssues: number }) {
  const p = ctx.project;
  const issues: Issue[] = [];
  const targets = a.structures?.length
    ? a.structures.map((id) => { const s = p.structure(id); if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${id}" not found`); return s; })
    : p.meta.structures;
  const nums = new Set(targets.map((s) => s.num));
  const has = (c: string) => a.checks.includes(c);

  if (has("empty")) {
    for (const s of targets) {
      if (!(p.world.structIndex.get(s.num)?.size)) issues.push({
        severity: "warning", code: "EMPTY_STRUCTURE", structureId: s.id, message: `${s.id} "${s.name}" has no blocks`,
        fixHint: s.source ? { cmd: "rebuildStructure", args: { id: s.id } } : { cmd: "deleteStructure", args: { id: s.id } },
      });
    }
  }

  if (has("missing")) {
    for (const s of targets) {
      const want = intendedCells(ctx, s);
      if (!want || want.size === 0) continue;
      const have = p.world.structIndex.get(s.num) ?? new Set<number>();
      let missing = 0, layered = 0;
      const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
      const owners = new Map<string, number>();
      for (const k of want) {
        if (have.has(k)) continue;
        const b = p.world.get(...keyToCell(k));
        const owner = b?.structure ? p.structureByNum(b.structure) : undefined;
        // ground layered by a later ground structure (plaza over lawn) is intended, not missing
        if (owner && owner.num > s.num && s.type === "terrain" && ["terrain", "floor", "cylinder"].includes(owner.type)) { layered++; continue; }
        missing++;
        const c = keyToCell(k);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], c[i]); mx[i] = Math.max(mx[i], c[i]); }
        const o = owner?.id ?? (b ? "(unowned)" : "(empty)");
        owners.set(o, (owners.get(o) ?? 0) + 1);
      }
      const ratio = missing / want.size;
      if (missing) {
        const top = [...owners.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([o, n]) => `${o}:${n}`).join(", ");
        issues.push({
          severity: ratio >= 0.5 ? "error" : ratio >= 0.1 ? "warning" : "info", code: "MISSING_CELLS", structureId: s.id, bounds: { min: mn, max: mx },
          message: `${s.id} "${s.name}" is missing ${missing}/${want.size} cells (${Math.round(ratio * 100)}%) — now: ${top}${layered ? ` (+${layered} intentionally layered)` : ""}`,
          fixHint: { cmd: "rebuildStructure", args: { id: s.id } },
        });
      }
    }
  }

  if (has("floating")) {
    const groups = floatingGroups(ctx).filter((g) => !a.structures?.length || [...g.structures].some((n) => nums.has(n)));
    for (const g of groups.sort((x, y) => y.size - x.size)) {
      const ids = [...g.structures].map((n) => p.structureByNum(n)?.id).filter(Boolean) as string[];
      issues.push({
        severity: g.size > 20 ? "error" : "warning", code: "FLOATING", structureId: ids[0], bounds: { min: g.min, max: g.max },
        message: `${g.size} block(s) not connected to the ground at ${g.min.join(",")}..${g.max.join(",")} (structures: ${ids.join(", ") || "none"})`,
        fixHint: { cmd: "createPillar", args: { at: [Math.round((g.min[0] + g.max[0]) / 2), 0, Math.round((g.min[2] + g.max[2]) / 2)], height: Math.max(1, g.min[1]), material: "stone" } },
      });
    }
  }

  if (has("assets")) {
    p.meta.palette.shapes.forEach((id, i) => { if (i && !p.assets.findShape(id, p.meta.assets.shapes)) issues.push({ severity: "error", code: "UNKNOWN_SHAPE", message: `palette shape ${id} cannot be resolved`, fixHint: { cmd: "searchAssets", args: { text: id } } }); });
    p.meta.palette.materials.forEach((id, i) => { if (i && !p.assets.findMaterial(id, p.meta.assets.materials)) issues.push({ severity: "error", code: "UNKNOWN_MATERIAL", message: `palette material ${id} cannot be resolved`, fixHint: { cmd: "searchAssets", args: { text: id } } }); });
  }

  let symmetry: { axis: string; center: number; score: number } | undefined;
  if (a.symmetry) {
    // explicit structures, the inspected structures, or (whole project) every block
    const sel: Set<number> | null = a.symmetry.structures?.length
      ? new Set(a.symmetry.structures.map((id) => p.structure(id)?.num).filter((n): n is number => !!n))
      : a.structures?.length ? nums : null;
    const inSel = (n: number) => !sel || sel.has(n);
    const cells: Vec3[] = [];
    p.world.forEach((x, y, z, b) => { if (inSel(b.structure)) cells.push([x, y, z]); });
    if (cells.length) {
      const ax = a.symmetry.axis === "x" ? 0 : 2;
      const lo = Math.min(...cells.map((c) => c[ax])), hi = Math.max(...cells.map((c) => c[ax]));
      const center2 = a.symmetry.center !== undefined ? a.symmetry.center * 2 : lo + hi; // mirror cell m = center2 - v
      let hit = 0;
      for (const c of cells) {
        const m: Vec3 = [...c];
        m[ax] = center2 - c[ax];
        const b = p.world.get(...m);
        if (b && inSel(b.structure)) hit++;
      }
      const score = hit / cells.length;
      symmetry = { axis: a.symmetry.axis, center: center2 / 2, score: +score.toFixed(3) };
      if (score < 0.9) issues.push({ severity: "warning", code: "ASYMMETRIC", message: `mirror symmetry on ${a.symmetry.axis} is ${(score * 100).toFixed(1)}%` });
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((x, y) => order[x.severity] - order[y.severity]);
  return { ok: counts.error === 0, counts, issues: issues.slice(0, a.maxIssues), truncated: issues.length > a.maxIssues, symmetry, checked: targets.length };
}

const zChecks = z.array(z.enum(["empty", "missing", "floating", "assets"])).default(["empty", "missing", "floating", "assets"]);

export const inspectProject = defineCommand({
  name: "inspectProject",
  group: "inspect",
  description:
    "Automatic checks: floating parts (not connected to the ground), MISSING_CELLS (a structure lost cells to later structures or edits), empty structures, unresolved assets, optional mirror symmetry. Each issue carries a fixHint command.",
  schema: z.object({
    checks: zChecks,
    symmetry: z.object({ axis: z.enum(["x", "z"]), center: z.number().optional(), structures: z.array(z.string()).optional() }).optional(),
    maxIssues: z.number().int().min(1).max(500).default(50),
  }),
  mutates: false,
  example: { symmetry: { axis: "x", center: 0 } },
  run: (ctx, a) => inspect(ctx, a),
  summarize: (r) => `inspect: ${r.counts.error} error(s), ${r.counts.warning} warning(s)${r.symmetry ? `, symmetry ${(r.symmetry.score * 100).toFixed(1)}%` : ""}`,
});

export const inspectStructure = defineCommand({
  name: "inspectStructure",
  group: "inspect",
  description: "Same checks for selected structures only (floating = not connected to the ground through those structures).",
  schema: z.object({ ids: z.array(z.string()).min(1), checks: zChecks, maxIssues: z.number().int().min(1).max(500).default(50) }),
  mutates: false,
  example: { ids: ["roof"] },
  run: (ctx, a) => inspect(ctx, { structures: a.ids, checks: a.checks, maxIssues: a.maxIssues }),
  summarize: (r) => `inspect: ${r.counts.error} error(s), ${r.counts.warning} warning(s)`,
});
