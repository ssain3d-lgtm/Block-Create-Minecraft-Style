// Multi-cell shapes: placement with layouts (grid / line / ring) and collision policies.
import { z } from "zod";
import { FACINGS, Facing, makeRot, Vec3 } from "../coords";
import { footprintCells, rotatedSize, shapeSize } from "../multicell";
import { CmdError, defineCommand, zFacing } from "./framework";
import { defineGenerator, facingFromVec, zCommon, zPos } from "./builder";

const zInt = z.number().int();
const zV = z.tuple([zInt, zInt, zInt]);

export const zLayout = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single") }),
  z.object({
    type: z.literal("grid"),
    count: z.tuple([zInt.min(1).max(256), zInt.min(1).max(256), zInt.min(1).max(256)]),
    step: zV.optional().describe("default = the rotated footprint (copies touch, never overlap)"),
  }),
  z.object({ type: z.literal("line"), to: zV.describe("anchor of the last copy, relative like 'at'"), count: zInt.min(2).max(1024) }),
  z.object({
    type: z.literal("ring"),
    radius: z.number().min(1).max(512),
    count: zInt.min(1).max(1024),
    face: z.enum(["out", "in", "fixed"]).default("out").describe("turn each copy to face away from / toward the centre"),
    startAngle: z.number().default(0).describe("degrees, 0 = +x (east), 90 = +z (south)"),
  }),
]).describe("how many copies and where: single | grid | line | ring");

export type Layout = z.output<typeof zLayout>;

const OPP: Record<Facing, Facing> = { north: "south", south: "north", east: "west", west: "east" };

export const placeShape = defineGenerator({
  name: "placeShape",
  type: "parts",
  description:
    "Place a shape (any size, e.g. a 2x4x1 arch or a 4x4x4 cupola) once or as a pattern (grid / line / ring). 'at' is the anchor = min corner of the rotated footprint (ring: the centre). onCollision: replace | skip | error. Rebuildable like other generators.",
  schema: z.object({
    ...zCommon,
    shape: z.string(),
    at: zPos,
    facing: zFacing.default("north"),
    upsideDown: z.boolean().default(false),
    layout: zLayout.default({ type: "single" }),
    onCollision: z.enum(["replace", "skip", "error"]).default("replace"),
  }),
  example: { key: "colonnade", shape: "ai.column_1x4", at: [0, 1, 0], material: "stone_light", layout: { type: "grid", count: [6, 1, 1], step: [3, 0, 0] } },
  build(b, a) {
    b.allowMulti = true;
    const p = b.ctx.project;
    const sIdx = b.shape(a.shape);
    const def = p.shapeDefAt(sIdx)!;
    const size = shapeSize(def);
    const base = b.pos(a.at);
    const items: { at: Vec3; facing: Facing }[] = [];
    const L = a.layout;
    const fp0 = rotatedSize(size, FACINGS.indexOf(a.facing));
    if (L.type === "single") items.push({ at: base, facing: a.facing });
    else if (L.type === "grid") {
      const st = L.step ?? fp0;
      for (let i = 0; i < L.count[0]; i++) for (let j = 0; j < L.count[1]; j++) for (let k = 0; k < L.count[2]; k++)
        items.push({ at: [base[0] + i * st[0], base[1] + j * st[1], base[2] + k * st[2]], facing: a.facing });
    } else if (L.type === "line") {
      const to = Array.isArray(a.at) ? [L.to[0] + b.origin[0], L.to[1] + b.origin[1], L.to[2] + b.origin[2]] : L.to;
      for (let i = 0; i < L.count; i++) {
        const t = i / (L.count - 1);
        items.push({ at: [Math.round(base[0] + (to[0] - base[0]) * t), Math.round(base[1] + (to[1] - base[1]) * t), Math.round(base[2] + (to[2] - base[2]) * t)], facing: a.facing });
      }
    } else {
      for (let i = 0; i < L.count; i++) {
        const ang = ((L.startAngle + (360 * i) / L.count) * Math.PI) / 180;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        const out = facingFromVec(dx, dz);
        const facing = L.face === "fixed" ? a.facing : L.face === "out" ? out : OPP[out];
        const fp = rotatedSize(size, FACINGS.indexOf(facing));
        // ring centre -> footprint centre on the circle; anchor = min corner
        items.push({ at: [Math.round(base[0] + dx * L.radius - fp[0] / 2 + 0.5), base[1], Math.round(base[2] + dz * L.radius - fp[2] / 2 + 0.5)], facing });
      }
    }
    let placed = 0, skipped = 0;
    const mat = b.mat(a.material);
    for (const it of items) {
      const rot = makeRot(it.facing, a.upsideDown);
      const cells = footprintCells(it.at, size, rot);
      const hits = cells.map((c) => p.world.get(c[0], c[1], c[2])).filter((x) => x && x.structure !== b.structure.num);
      if (hits.length) {
        if (a.onCollision === "skip") { skipped++; continue; }
        if (a.onCollision === "error") {
          const owner = hits[0]!.structure ? p.structureByNum(hits[0]!.structure)?.id ?? "?" : "(no structure)";
          throw new CmdError("COLLISION", `copy at ${it.at.join(",")} overlaps ${hits.length} cell(s) of ${owner}`, `move it, use onCollision "skip" or "replace", or check with inspectProject`);
        }
        if (hits.some((h) => h!.structure && p.structureByNum(h!.structure)?.locked)) { skipped++; continue; }
        b.overwrote += hits.length;
      }
      b.ctx.tx.set(it.at[0], it.at[1], it.at[2], { shape: sIdx, material: mat, rot, structure: b.structure.num });
      b.count += cells.length;
      placed++;
    }
    if (skipped) b.ctx.warnings.push(`${b.structure.id}: ${skipped} cop${skipped === 1 ? "y" : "ies"} skipped (collision or locked)`);
    return { copies: placed, skipped, footprint: rotatedSize(size, makeRot(a.facing)) };
  },
});

export const getShapeInfo = defineCommand({
  name: "getShapeInfo",
  group: "asset",
  description: "Size, footprint per facing and triangle count of a shape; with 'at' also tells whether a placement there would collide.",
  schema: z.object({ shape: z.string(), at: zV.optional(), facing: zFacing.default("north"), upsideDown: z.boolean().default(false) }),
  mutates: false,
  example: { shape: "ai.arch_2x4", at: [0, 1, 0], facing: "east" },
  run(ctx, a) {
    const p = ctx.project;
    const def = p.assets.findShape(a.shape, p.meta.assets.shapes);
    if (!def) throw new CmdError("UNKNOWN_SHAPE", `unknown shape "${a.shape}"`, "searchAssets kind=shape");
    const size = shapeSize(def);
    const rot = makeRot(a.facing, a.upsideDown);
    const out: Record<string, unknown> = {
      id: def.id, size, cells: size[0] * size[1] * size[2],
      footprint: Object.fromEntries(FACINGS.map((f) => [f, rotatedSize(size, makeRot(f))])),
    };
    if (a.at) {
      const collisions = footprintCells(a.at, size, rot).flatMap((c) => {
        const b = p.world.get(c[0], c[1], c[2]);
        return b ? [{ at: c, structure: b.structure ? p.structureByNum(b.structure)?.id : undefined }] : [];
      });
      out.at = a.at;
      out.fits = collisions.length === 0;
      out.collisions = collisions.slice(0, 20);
    }
    return out;
  },
  summarize: (r) => `${r.id}: ${r.size.join("x")} cells${r.at ? (r.fits ? ", fits" : `, ${r.collisions.length} collision(s)`) : ""}`,
});
