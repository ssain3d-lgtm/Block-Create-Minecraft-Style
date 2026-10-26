// High-level, rebuildable architecture generators. LLMs call these instead of writing coordinates.
import { z } from "zod";
import { FACINGS, Facing, Vec3 } from "../coords";
import { CmdError, defineCommand, zFacing } from "./framework";
import { Builder, defineGenerator, FACING_VEC, facingFromVec, Rect, zCommon, zFootprint, zPos } from "./builder";

const zInt = z.number().int();

/** rounds half away from zero so mirrored coordinates stay mirrored (-27.5 -> -28, 27.5 -> 28) */
export const roundSym = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
/** nearest odd size, so a square stays centred on its cell */
export const oddSize = (v: number) => Math.max(1, 2 * Math.round((v - 1) / 2) + 1);

// ---------------- building ----------------
export const createBuilding = defineCommand({
  name: "createBuilding",
  group: "build",
  description: "Create a building (a named group with an origin). Structures with building:<name> use coordinates relative to its origin.",
  schema: z.object({ name: z.string().min(1), origin: z.tuple([zInt, zInt, zInt]).default([0, 0, 0]) }),
  mutates: true,
  example: { name: "house", origin: [0, 0, 0] },
  run(ctx, a) {
    const m = ctx.project.meta;
    if (m.buildings.some((b) => b.name === a.name)) throw new CmdError("DUPLICATE", `building "${a.name}" exists`, "use another name or moveBuilding");
    const id = `b-${++m.counters.building}`;
    m.buildings.push({ id, name: a.name, origin: a.origin, regions: [] });
    return { buildingId: id };
  },
  summarize: (r) => `building ${r.buildingId}`,
});

// ---------------- foundation ----------------
export const createFoundation = defineGenerator({
  name: "createFoundation",
  type: "foundation",
  description: "Solid base/platform. taper>0 steps each layer inward (stone castle base); slope=true smooths the steps with wedges.",
  schema: z.object({
    ...zCommon,
    area: zFootprint,
    height: zInt.min(1).max(256).default(1),
    taper: z.number().min(0).max(4).default(0).describe("cells each side shrinks per layer"),
    slope: z.boolean().default(false),
    topMaterial: z.string().optional(),
    hollow: z.boolean().default(false),
  }),
  example: { key: "base", area: { at: [0, 0, 0], size: [20, 14] }, height: 2, material: "concrete" },
  build(b, a) {
    const r = b.rect(a.area);
    for (let i = 0; i < a.height; i++) {
      const inset = Math.floor(i * a.taper);
      const nextInset = Math.floor((i + 1) * a.taper);
      const x0 = r.x0 + inset, x1 = r.x1 - inset, z0 = r.z0 + inset, z1 = r.z1 - inset;
      if (x1 < x0 || z1 < z0) break;
      const y = r.y + i;
      const top = i === a.height - 1;
      const mat = top && a.topMaterial ? a.topMaterial : a.material;
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const edge = x === x0 || x === x1 || z === z0 || z === z1;
          if (a.hollow && !edge && !top && i > 0) continue;
          const steps = !top && nextInset > inset;
          if (a.slope && steps && edge) {
            const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
            if (corner) { b.set(x, y, z, mat); continue; }
            // tall side toward the centre of the footprint
            const f: Facing = x === x0 ? "east" : x === x1 ? "west" : z === z0 ? "south" : "north";
            b.set(x, y, z, mat, "wedge", b.rot(f));
          } else b.set(x, y, z, mat);
        }
    }
  },
});

// ---------------- floor / deck ----------------
export const createFloor = defineGenerator({
  name: "createFloor",
  type: "floor",
  description: "Floor plate or deck (optionally with a centred hole and a border material). With building set, also registers a floor region.",
  schema: z.object({
    ...zCommon,
    area: zFootprint,
    thickness: zInt.min(1).max(16).default(1),
    shape: z.string().default("cube").describe('"cube", or "floor" for a thin plate'),
    hole: z.object({ size: z.tuple([zInt.min(1), zInt.min(1)]), offset: z.tuple([zInt, zInt]).default([0, 0]) }).optional(),
    border: z.object({ material: z.string(), width: zInt.min(1).default(1) }).optional(),
    level: zInt.optional().describe("floor number for the region record"),
  }),
  example: { key: "floor2", area: { on: { ref: "walls1" } }, thickness: 1, material: "wood_oak", building: "house", level: 2 },
  build(b, a) {
    const r = b.rect(a.area);
    const cx = Math.floor((r.x0 + r.x1) / 2) + (a.hole?.offset[0] ?? 0), cz = Math.floor((r.z0 + r.z1) / 2) + (a.hole?.offset[1] ?? 0);
    const hx0 = a.hole ? cx - Math.floor(a.hole.size[0] / 2) : 1, hx1 = a.hole ? hx0 + a.hole.size[0] - 1 : 0;
    const hz0 = a.hole ? cz - Math.floor(a.hole.size[1] / 2) : 1, hz1 = a.hole ? hz0 + a.hole.size[1] - 1 : 0;
    for (let x = r.x0; x <= r.x1; x++)
      for (let z = r.z0; z <= r.z1; z++) {
        if (a.hole && x >= hx0 && x <= hx1 && z >= hz0 && z <= hz1) continue;
        const bw = a.border?.width ?? 0;
        const onBorder = a.border && (x < r.x0 + bw || x > r.x1 - bw || z < r.z0 + bw || z > r.z1 - bw ||
          (a.hole && x >= hx0 - bw && x <= hx1 + bw && z >= hz0 - bw && z <= hz1 + bw));
        for (let t = 0; t < a.thickness; t++) {
          const top = t === a.thickness - 1;
          b.set(x, r.y + t, z, onBorder ? a.border!.material : a.material, top ? a.shape : "cube");
        }
      }
    const s = b.structure;
    if (s.buildingId) {
      const bl = b.ctx.project.meta.buildings.find((x) => x.id === s.buildingId)!;
      const rid = s.regionId ?? `r-${++b.ctx.project.meta.counters.region}`;
      if (!bl.regions.some((x) => x.id === rid)) bl.regions.push({ id: rid, name: s.name, level: a.level, baseY: r.y });
      s.regionId = rid;
      return { regionId: rid };
    }
  },
});

// ---------------- walls ----------------
const zOpening = z.object({
  side: z.enum(["north", "east", "south", "west"]).optional().describe("which side of a loop wall"),
  at: zInt.min(0).describe("cells from the start of that side (west end for north/south, north end for east/west)"),
  width: zInt.min(1).default(2),
  height: zInt.min(1).default(2),
  bottom: zInt.min(0).default(1).describe("cells above the wall base"),
  fill: z.string().nullable().default("glass").describe('material for the pane, or null for an empty hole (doors)'),
  fillShape: z.string().default("pane"),
});

const zWindowRow = z.object({
  width: zInt.min(1).default(2),
  height: zInt.min(1).default(2),
  bottom: zInt.min(0).default(1),
  spacing: zInt.min(1).default(2).describe("solid wall between windows"),
  margin: zInt.min(0).default(2).describe("solid wall at each end"),
  sides: z.array(z.enum(["north", "east", "south", "west"])).optional(),
  every: zInt.min(1).optional().describe("repeat the row every N cells upward (multi-storey)"),
  fill: z.string().nullable().default("glass"),
  fillShape: z.string().default("pane"),
});

interface WallSeg { side: Facing | "line"; cells: [number, number][]; }

export const createWall = defineGenerator({
  name: "createWall",
  type: "wall",
  description:
    "Walls: a straight wall (from/to) or a closed loop around an area (loop). Supports openings (doors/windows), automatic window rows, horizontal bands and corner pillars.",
  schema: z.object({
    ...zCommon,
    from: zPos.optional(),
    to: zPos.optional(),
    loop: zFootprint.optional(),
    height: zInt.min(1).max(512).default(4),
    thickness: zInt.min(1).max(8).default(1),
    shape: z.string().default("cube"),
    openings: z.array(zOpening).default([]),
    windows: zWindowRow.optional(),
    bands: z.array(z.object({ y: zInt.min(0), material: z.string(), shape: z.string().default("cube") })).default([]),
    corners: z.string().optional().describe("material for corner pillars"),
  }).refine((a) => a.loop || (a.from && a.to), { message: 'give "loop" (an area) or "from" and "to"' }),
  example: {
    key: "walls", building: "house", loop: { on: { ref: "base" } }, height: 5, material: "brick", corners: "stone_light",
    openings: [{ side: "south", at: 9, width: 2, height: 3, bottom: 0, fill: null }],
    windows: { width: 2, height: 2, bottom: 2, spacing: 2, margin: 2 },
  },
  build(b, a) {
    const segs: WallSeg[] = [];
    let y0: number;
    let rect: Rect | undefined;
    if (a.loop) {
      rect = b.rect(a.loop);
      y0 = rect.y;
      const r = rect;
      const row = (z: number, side: Facing): WallSeg => ({ side, cells: Array.from({ length: r.x1 - r.x0 + 1 }, (_, i) => [r.x0 + i, z]) });
      const col = (x: number, side: Facing): WallSeg => ({ side, cells: Array.from({ length: r.z1 - r.z0 + 1 }, (_, i) => [x, r.z0 + i]) });
      segs.push(row(r.z0, "north"), col(r.x1, "east"), row(r.z1, "south"), col(r.x0, "west"));
    } else {
      const p0 = b.pos(a.from!), p1 = b.pos(a.to!);
      y0 = Math.min(p0[1], p1[1]);
      const cells: [number, number][] = [];
      const n = Math.max(Math.abs(p1[0] - p0[0]), Math.abs(p1[2] - p0[2]));
      for (let i = 0; i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        cells.push([Math.round(p0[0] + (p1[0] - p0[0]) * t), Math.round(p0[2] + (p1[2] - p0[2]) * t)]);
      }
      segs.push({ side: "line", cells });
    }
    // opening map per side: Set of "t,h"
    const holes = new Map<string, { fill: string | null; shape: string }>();
    const addOpening = (side: string, at: number, w: number, h: number, bottom: number, fill: string | null, shape: string) => {
      for (let t = at; t < at + w; t++) for (let k = bottom; k < bottom + h; k++) holes.set(`${side}:${t}:${k}`, { fill, shape });
    };
    for (const o of a.openings) addOpening(o.side ?? (a.loop ? "south" : "line"), o.at, o.width, o.height, o.bottom, o.fill, o.fillShape);
    if (a.windows) {
      const wr = a.windows;
      for (const seg of segs) {
        if (wr.sides && seg.side !== "line" && !wr.sides.includes(seg.side)) continue;
        const len = seg.cells.length;
        const usable = len - 2 * wr.margin;
        if (usable < wr.width) continue;
        const n = Math.floor((usable + wr.spacing) / (wr.width + wr.spacing));
        const used = n * wr.width + (n - 1) * wr.spacing;
        const start = wr.margin + Math.floor((usable - used) / 2);
        for (let level = wr.bottom; level + wr.height <= a.height; level += wr.every ?? 1e9) {
          for (let i = 0; i < n; i++) {
            const at = start + i * (wr.width + wr.spacing);
            for (let t = at; t < at + wr.width; t++) for (let k = level; k < level + wr.height; k++) {
              if (!holes.has(`${seg.side}:${t}:${k}`)) holes.set(`${seg.side}:${t}:${k}`, { fill: wr.fill, shape: wr.fillShape });
            }
          }
          if (!wr.every) break;
        }
      }
    }
    const bandAt = new Map(a.bands.map((x) => [x.y, x]));
    for (const seg of segs) {
      const along: [number, number] = seg.side === "north" || seg.side === "south" ? [1, 0] : seg.side === "line"
        ? (seg.cells.length > 1 ? [Math.sign(seg.cells[1][0] - seg.cells[0][0]), Math.sign(seg.cells[1][1] - seg.cells[0][1])] : [1, 0])
        : [0, 1];
      const paneRot = along[0] !== 0 ? 0 : 1; // pane lies in the x-y plane; rotate for walls running along z
      // inward direction for thickness
      const inward: [number, number] = seg.side === "north" ? [0, 1] : seg.side === "south" ? [0, -1] : seg.side === "east" ? [-1, 0] : seg.side === "west" ? [1, 0] : [-along[1], along[0]];
      seg.cells.forEach(([x, z], t) => {
        const corner = rect && (x === rect.x0 || x === rect.x1) && (z === rect.z0 || z === rect.z1);
        for (let k = 0; k < a.height; k++) {
          const hole = holes.get(`${seg.side}:${t}:${k}`);
          for (let d = 0; d < a.thickness; d++) {
            const wx = x + inward[0] * d, wz = z + inward[1] * d;
            if (hole && !corner) {
              if (hole.fill && d === Math.floor((a.thickness - 1) / 2)) b.set(wx, y0 + k, wz, hole.fill, hole.shape, paneRot);
              else if (!hole.fill || d !== Math.floor((a.thickness - 1) / 2)) b.remove(wx, y0 + k, wz);
              continue;
            }
            const band = bandAt.get(k);
            if (corner && a.corners) b.set(wx, y0 + k, wz, a.corners);
            else if (band) b.set(wx, y0 + k, wz, band.material, band.shape);
            else b.set(wx, y0 + k, wz, a.material, a.shape);
          }
        }
      });
    }
  },
});

// ---------------- roof ----------------
export const createRoof = defineGenerator({
  name: "createRoof",
  type: "roof",
  description:
    "Roof over an area. style: gable | hip | pyramid | shed | flat | irimoya (hip-and-gable, Japanese) ; pitch = rise per cell (1 = 45deg, 0.5 = gentle). curve>0 turns the eaves up (Asian roofs). Slope pieces are chosen automatically (wedge / half wedges).",
  schema: z.object({
    ...zCommon,
    area: zFootprint,
    style: z.enum(["gable", "hip", "pyramid", "shed", "flat", "irimoya"]).default("gable"),
    pitch: z.number().min(0.25).max(3).default(1),
    overhang: zInt.min(0).max(8).default(1),
    ridge: z.enum(["x", "z", "auto"]).default("auto").describe("ridge direction for gable/irimoya (auto = along the longer side)"),
    shedFacing: zFacing.default("north").describe("high side of a shed roof"),
    curve: z.number().min(0).max(2).default(0),
    solid: z.boolean().default(true).describe("fill the space under the roof inside the footprint (gable ends)"),
    fillMaterial: z.string().optional(),
    thickness: zInt.min(1).max(4).default(1),
    ridgeMaterial: z.string().optional(),
    slopeShape: z.string().optional().describe('force one slope shape (e.g. a custom "ai.tile") instead of automatic wedges'),
    parapet: z.object({ height: zInt.min(1).default(1), material: z.string() }).optional().describe("flat roofs: low wall around the edge"),
  }),
  example: { key: "roof", building: "house", area: { on: { ref: "walls" } }, style: "gable", pitch: 1, overhang: 1, material: "roof_tile" },
  build(b, a) {
    const inner = b.rect(a.area);
    const o = a.overhang;
    const X0 = inner.x0 - o, X1 = inner.x1 + o, Z0 = inner.z0 - o, Z1 = inner.z1 + o, base = inner.y;
    const W = X1 - X0 + 1, D = Z1 - Z0 + 1;
    const ridgeX = a.ridge === "x" || (a.ridge === "auto" && W >= D);
    const halfShort = (ridgeX ? D : W) / 2;
    // surface height (in cells) at continuous position (u, v) measured from the min corner
    const H = (u: number, v: number): number => {
      const du = Math.min(u, W - u), dv = Math.min(v, D - v);
      let h: number;
      switch (a.style) {
        case "flat": h = 0; break;
        case "shed": {
          const [fx, fz] = FACING_VEC[a.shedFacing];
          h = fx > 0 ? u : fx < 0 ? W - u : fz > 0 ? v : D - v;
          break;
        }
        case "hip": case "pyramid": h = Math.min(du, dv); break;
        case "irimoya": h = ridgeX ? Math.min(dv, du + halfShort * 0.45) : Math.min(du, dv + halfShort * 0.45); break;
        default: h = ridgeX ? dv : du;
      }
      h *= a.pitch;
      if (a.curve > 0) {
        const dm = Math.min(du, dv);
        h += a.curve * Math.max(0, 1.6 - dm) * 0.6;
      }
      return h;
    };
    const fillMat = a.fillMaterial ?? a.material;
    const near = (v: number, t: number) => Math.abs(v - t) < 0.2;
    for (let x = X0; x <= X1; x++)
      for (let z = Z0; z <= Z1; z++) {
        const u = x - X0 + 0.5, v = z - Z0 + 0.5;
        const hc = H(u, v);
        // gradient -> uphill facing
        const gx = H(u + 0.5, v) - H(u - 0.5, v), gz = H(u, v + 0.5) - H(u, v - 0.5);
        const slope = Math.hypot(gx, gz);
        const f = facingFromVec(gx, gz);
        const hu = hc + slope / 2, hd = hc - slope / 2;
        const y = base + Math.floor(hd + 1e-6);
        const top = base + Math.floor(hc + 1e-6);
        const a1 = hu - Math.floor(hd + 1e-6), b1 = hd - Math.floor(hd + 1e-6);
        let shape = "cube", rot = 0, yy = y;
        if (a.style === "flat" || slope < 0.05) {
          yy = top;
          shape = a.style === "flat" ? "cube" : hc - Math.floor(hc + 1e-6) <= 0.5 ? "slab" : "cube";
        } else if (a.slopeShape) {
          shape = a.slopeShape; rot = b.rot(f);
        } else if (near(a1, 1) && near(b1, 0)) { shape = "wedge"; rot = b.rot(f); }
        else if (near(a1, 0.5) && near(b1, 0)) { shape = "wedge_half"; rot = b.rot(f); }
        else if (near(a1, 1) && near(b1, 0.5)) { shape = "wedge_half_hi"; rot = b.rot(f); }
        else if (a1 > 1.2) { shape = "wedge"; rot = b.rot(f); yy = base + Math.floor(hu - 1 + 1e-6); }
        else { shape = b1 >= 0.5 ? "cube" : "slab"; }
        const ridgeCell = slope < 0.05 && a.style !== "flat";
        b.set(x, yy, z, ridgeCell && a.ridgeMaterial ? a.ridgeMaterial : a.material, shape, rot);
        // thickness under the surface piece
        for (let t = 1; t < a.thickness; t++) b.set(x, yy - t, z, a.material);
        const insideFootprint = x >= inner.x0 && x <= inner.x1 && z >= inner.z0 && z <= inner.z1;
        if (a.solid && insideFootprint) for (let k = base; k < yy - (a.thickness - 1); k++) b.setIfEmpty(x, k, z, fillMat);
        else if (!insideFootprint) {
          // keep overhang continuous: fill down to the neighbour step
          const below = base + Math.floor(H(u, v) - a.pitch + 1e-6);
          for (let k = Math.max(base, below + 1); k < yy - (a.thickness - 1); k++) b.setIfEmpty(x, k, z, a.material);
        }
        if (a.parapet && a.style === "flat" && (x === X0 || x === X1 || z === Z0 || z === Z1)) {
          for (let k = 1; k <= a.parapet.height; k++) b.set(x, yy + k, z, a.parapet.material);
        }
      }
    return { ridgeAxis: ridgeX ? "x" : "z", peak: Math.round(H(W / 2, D / 2) * 10) / 10 };
  },
});

// ---------------- tower ----------------
export const createTower = defineGenerator({
  name: "createTower",
  type: "tower",
  description:
    "Square tower that can taper (profile taper/curve; sizes are rounded to odd numbers so it stays centred). style solid | shell | lattice (iron lattice: corner columns + X braces + horizontal frames, like the Eiffel tower's upper part).",
  schema: z.object({
    ...zCommon,
    center: zPos.describe("centre of the base"),
    height: zInt.min(1).max(1024),
    baseSize: zInt.min(1).max(512),
    topSize: zInt.min(1).max(512).optional(),
    profile: z.enum(["straight", "taper", "curve"]).default("taper"),
    curve: z.number().min(0.2).max(5).default(2),
    style: z.enum(["solid", "shell", "lattice"]).default("shell"),
    braceMaterial: z.string().optional(),
    bracePeriod: zInt.min(2).max(64).default(6),
    frameEvery: zInt.min(0).max(64).default(8).describe("lattice: full horizontal ring every N levels (0 = none)"),
    columnSize: zInt.min(1).max(8).default(1),
    accent: z.object({ material: z.string(), face: z.enum(["north", "east", "south", "west"]) }).optional(),
  }),
  example: { key: "upper", center: { ref: "deck2", anchor: "top" }, height: 120, baseSize: 25, topSize: 7, profile: "curve", style: "lattice", material: "iron_mid" },
  build(b, a) {
    const c = b.pos(a.center);
    const top = a.topSize ?? a.baseSize;
    const brace = a.braceMaterial ?? a.material;
    for (let i = 0; i < a.height; i++) {
      const t = a.height === 1 ? 0 : i / (a.height - 1);
      const k = a.profile === "straight" ? 0 : a.profile === "taper" ? t : 1 - Math.pow(1 - t, a.curve);
      const size = oddSize(a.baseSize + (top - a.baseSize) * k);
      const h = Math.floor(size / 2);
      const x0 = c[0] - h, x1 = x0 + size - 1, z0 = c[2] - h, z1 = z0 + size - 1, y = c[1] + i;
      const frame = a.style === "lattice" && a.frameEvery > 0 && (i % a.frameEvery === 0 || i === a.height - 1);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
          const onShell = edgeX || edgeZ;
          if (a.style === "solid") { b.set(x, y, z, a.material); continue; }
          if (!onShell) continue;
          if (a.style === "shell" || size <= 3) { b.set(x, y, z, a.material); continue; }
          const cs = a.columnSize;
          const nearCornerX = x - x0 < cs || x1 - x < cs, nearCornerZ = z - z0 < cs || z1 - z < cs;
          if (nearCornerX && nearCornerZ) { b.set(x, y, z, a.material); continue; }
          if (frame) { b.set(x, y, z, a.material); continue; }
          // X braces on each face
          const uFace = edgeZ ? x - x0 : z - z0;
          const P = a.bracePeriod;
          const ph = ((i % P) + P) % P;
          // measured from the face centre so the bracing is mirror-symmetric
          const um = Math.abs(uFace - h) % P;
          if (um === ph || um === (P - ph) % P) {
            const face: Facing = z === z0 ? "north" : z === z1 ? "south" : x === x1 ? "east" : "west";
            const accent = a.accent && a.accent.face === face && Math.abs(uFace - h) <= 0;
            b.set(x, y, z, accent ? a.accent!.material : brace);
          } else if (a.accent) {
            const face: Facing = z === z0 ? "north" : z === z1 ? "south" : x === x1 ? "east" : "west";
            if (a.accent.face === face && uFace === h) b.set(x, y, z, a.accent.material);
          }
        }
    }
    return { topSize: top };
  },
});

// ---------------- cylinder ----------------
export const createCylinder = defineGenerator({
  name: "createCylinder",
  type: "cylinder",
  description: "Round tower / column / pool ring. hollow=true keeps a wall of the given thickness. topRadius makes cones.",
  schema: z.object({
    ...zCommon,
    center: zPos,
    radius: z.number().min(0.5).max(256),
    topRadius: z.number().min(0).max(256).optional(),
    height: zInt.min(1).max(1024).default(1),
    hollow: z.boolean().default(false),
    thickness: zInt.min(1).max(16).default(1),
  }),
  example: { key: "fountain", center: [0, 1, 0], radius: 5, height: 1, hollow: true, material: "stone_light" },
  build(b, a) {
    const c = b.pos(a.center);
    for (let i = 0; i < a.height; i++) {
      const t = a.height === 1 ? 0 : i / (a.height - 1);
      const r = a.radius + ((a.topRadius ?? a.radius) - a.radius) * t;
      const R = Math.ceil(r);
      for (let dx = -R; dx <= R; dx++)
        for (let dz = -R; dz <= R; dz++) {
          const d = Math.hypot(dx, dz);
          if (d > r + 0.35) continue;
          if (a.hollow && d < r + 0.35 - a.thickness) continue;
          b.set(c[0] + dx, c[1] + i, c[2] + dz, a.material);
        }
    }
  },
});

// ---------------- arch ----------------
export const createArch = defineGenerator({
  name: "createArch",
  type: "arch",
  description: "Elliptical arch between two springing points at the same height (along x or z). thickness = rib depth in the arch plane, depth = cells across.",
  schema: z.object({
    ...zCommon,
    from: zPos,
    to: zPos,
    rise: zInt.min(1).max(512),
    thickness: zInt.min(1).max(16).default(1),
    depth: zInt.min(1).max(64).default(1),
    spandrel: z.boolean().default(false).describe("fill the corners above the arch up to the crown (bridge look)"),
  }),
  example: { key: "arch_s", from: [-30, 12, 40], to: [30, 12, 40], rise: 34, thickness: 2, depth: 2, material: "iron_lower" },
  build(b, a) {
    const p0 = b.pos(a.from), p1 = b.pos(a.to);
    const alongX = Math.abs(p1[0] - p0[0]) >= Math.abs(p1[2] - p0[2]);
    const L = alongX ? p1[0] - p0[0] : p1[2] - p0[2];
    const n = Math.abs(L), dir = Math.sign(L) || 1;
    const half = n / 2;
    const yAt = (s: number) => a.rise * Math.sqrt(Math.max(0, 1 - Math.pow((s - half) / half, 2)));
    for (let s = 0; s <= n; s++) {
      const ys = yAt(s);
      const lo = Math.floor(Math.min(ys, yAt(Math.max(0, s - 1)), yAt(Math.min(n, s + 1))));
      const hi = Math.floor(ys) + a.thickness - 1;
      const top = a.spandrel ? a.rise + a.thickness - 1 : hi;
      for (let y = lo; y <= top; y++)
        for (let d = 0; d < a.depth; d++) {
          const x = alongX ? p0[0] + s * dir : p0[0] + d;
          const z = alongX ? p0[2] + d : p0[2] + s * dir;
          b.set(x, p0[1] + y, z, a.material);
        }
    }
  },
});

// ---------------- truss (box-section lattice along a path) ----------------
export const createTruss = defineGenerator({
  name: "createTruss",
  type: "truss",
  description:
    "Box-section iron lattice along a polyline path (legs, girders, bridges). width can taper [start,end] (odd sizes keep it centred). pattern x | warren | solid | open; frameEvery adds full rings (panel look); accent paints the centre line of one face (e.g. red stair rails).",
  schema: z.object({
    ...zCommon,
    path: z.array(zPos).min(2).max(200),
    width: z.union([zInt.min(1).max(128), z.tuple([zInt.min(1).max(128), zInt.min(1).max(128)])]).default(3),
    pattern: z.enum(["x", "warren", "solid", "open"]).default("x"),
    period: zInt.min(2).max(64).optional().describe("brace period (default = width)"),
    frameEvery: zInt.min(0).max(64).default(0),
    chordMaterial: z.string().optional(),
    columnSize: zInt.min(1).max(8).default(1),
    accent: z.object({ material: z.string(), face: z.enum(["+x", "-x", "+z", "-z", "+y", "-y"]) }).optional(),
    hollow: z.boolean().default(true),
  }),
  example: {
    key: "leg_ne", path: [[48, 0, -48], [33, 57, -33], [16, 115, -16]], width: [22, 10], pattern: "x", frameEvery: 7, material: "iron_lower",
    accent: { material: "rail_red", face: "-x" },
  },
  build(b, a) {
    const pts = a.path.map((p) => b.pos(p));
    const ext = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i])));
    const ax = ext[1] >= ext[0] && ext[1] >= ext[2] ? 1 : ext[0] >= ext[2] ? 0 : 2; // dominant axis
    const u = ax === 1 ? 0 : ax === 0 ? 1 : 0; // cross-section axes
    const v = ax === 2 ? 1 : 2;
    const first = pts[0][ax], last = pts[pts.length - 1][ax];
    const step = Math.sign(last - first) || 1;
    const total = Math.abs(last - first);
    const [w0, w1] = Array.isArray(a.width) ? a.width : [a.width, a.width];
    const chord = a.chordMaterial ?? a.material;
    // cumulative interpolation by the dominant axis (path must be monotonic along it)
    const centerAt = (val: number): Vec3 => {
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        const lo = Math.min(A[ax], B[ax]), hi = Math.max(A[ax], B[ax]);
        if (val >= lo && val <= hi) {
          const t = B[ax] === A[ax] ? 0 : (val - A[ax]) / (B[ax] - A[ax]);
          return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
        }
      }
      return pts[pts.length - 1];
    };
    for (let s = 0; s <= total; s++) {
      const val = first + s * step;
      const c = centerAt(val);
      const t = total === 0 ? 0 : s / total;
      const w = oddSize(w0 + (w1 - w0) * t);
      const h = Math.floor(w / 2);
      const cu0 = roundSym(c[u]) - h, cv0 = roundSym(c[v]) - h;
      const cu1 = cu0 + w - 1, cv1 = cv0 + w - 1;
      const P = a.period ?? Math.max(2, w - 1);
      const frame = a.frameEvery > 0 && (s % a.frameEvery === 0 || s === total);
      for (let i = cu0; i <= cu1; i++)
        for (let j = cv0; j <= cv1; j++) {
          const eu = i === cu0 || i === cu1, ev = j === cv0 || j === cv1;
          if (a.hollow && !eu && !ev && w > 2) continue;
          const cell: Vec3 = [0, 0, 0];
          cell[ax] = val; cell[u] = i; cell[v] = j;
          const cs = a.columnSize;
          const isChord = (i - cu0 < cs || cu1 - i < cs) && (j - cv0 < cs || cv1 - j < cs);
          let mat: string | null = null;
          if (isChord || w <= 2 || a.pattern === "solid" || frame) mat = isChord ? chord : a.material;
          else if (a.pattern !== "open") {
            const along = eu ? j - cv0 : i - cu0; // position across the face
            const ph = ((s % P) + P) % P, m = Math.abs(along - h) % P; // from the face centre: mirror-symmetric
            if (m === ph || (a.pattern === "x" && m === (P - ph) % P)) mat = a.material;
          }
          if (a.accent) {
            const faceName = (axis: number, sign: number) => `${sign > 0 ? "+" : "-"}${"xyz"[axis]}`;
            const onFace = (eu && faceName(u, i === cu1 ? 1 : -1) === a.accent.face && j === cv0 + h) ||
              (ev && faceName(v, j === cv1 ? 1 : -1) === a.accent.face && i === cu0 + h);
            if (onFace) mat = a.accent.material;
          }
          if (mat) b.set(cell[0], cell[1], cell[2], mat);
        }
    }
    return { dominantAxis: "xyz"[ax], length: total + 1 };
  },
});

// ---------------- lines, pillars, stairs ----------------
export const createLine = defineGenerator({
  name: "createLine",
  type: "line",
  description: "Straight 3D line of blocks (beam, rail, fence, cable). Shapes like beam/fence are turned along the line automatically.",
  schema: z.object({ ...zCommon, from: zPos, to: zPos, shape: z.string().default("cube"), size: zInt.min(1).max(16).default(1) }),
  example: { key: "rail", from: [0, 1, 0], to: [10, 1, 0], shape: "fence", material: "iron_black" },
  build(b, a) {
    const p0 = b.pos(a.from), p1 = b.pos(a.to);
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const n = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
    const rot = Math.abs(d[2]) > Math.abs(d[0]) ? 1 : 0;
    const h = Math.floor(a.size / 2);
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      const x = Math.round(p0[0] + d[0] * t), y = Math.round(p0[1] + d[1] * t), z = Math.round(p0[2] + d[2] * t);
      for (let ox = -h; ox < a.size - h; ox++) for (let oz = -h; oz < a.size - h; oz++) b.set(x + ox, y, z + oz, a.material, a.shape, rot);
    }
  },
});

export const createPillar = defineGenerator({
  name: "createPillar",
  type: "pillar",
  description: "Vertical column(s). positions lets one call place a whole colonnade.",
  schema: z.object({ ...zCommon, at: zPos.optional(), positions: z.array(zPos).max(2000).optional(), height: zInt.min(1).max(1024), size: zInt.min(1).max(16).default(1), shape: z.string().default("cube"), capital: z.string().optional() })
    .refine((a) => a.at || a.positions, { message: 'give "at" or "positions"' }),
  example: { key: "columns", positions: [[0, 1, 0], [4, 1, 0], [8, 1, 0]], height: 6, shape: "pillar", material: "stone_light" },
  build(b, a) {
    for (const p of a.positions ?? [a.at!]) {
      const c = b.pos(p);
      const h = Math.floor(a.size / 2);
      for (let y = 0; y < a.height; y++)
        for (let ox = -h; ox < a.size - h; ox++)
          for (let oz = -h; oz < a.size - h; oz++) {
            const capital = a.capital && y === a.height - 1;
            b.set(c[0] + ox, c[1] + y, c[2] + oz, capital ? a.capital! : a.material, capital ? "cube" : a.shape);
          }
    }
  },
});

export const createStairs = defineGenerator({
  name: "createStairs",
  type: "stairs",
  description: "Staircase climbing in the facing direction from a start cell.",
  schema: z.object({ ...zCommon, from: zPos, facing: zFacing, steps: zInt.min(1).max(512), width: zInt.min(1).max(32).default(2), solid: z.boolean().default(true) }),
  example: { key: "steps", from: [4, 1, 10], facing: "north", steps: 5, width: 3, material: "stone_light" },
  build(b, a) {
    const p = b.pos(a.from);
    const [fx, fz] = FACING_VEC[a.facing];
    const [sx, sz] = [-fz, fx]; // sideways
    for (let k = 0; k < a.steps; k++)
      for (let w = 0; w < a.width; w++) {
        const x = p[0] + fx * k + sx * w, z = p[2] + fz * k + sz * w, y = p[1] + k;
        b.set(x, y, z, a.material, "stair", b.rot(a.facing));
        if (a.solid) for (let yy = p[1]; yy < y; yy++) b.set(x, yy, z, a.material);
      }
  },
});

// ---------------- landscape ----------------
export const createTerrain = defineGenerator({
  name: "createTerrain",
  type: "terrain",
  description: "Ground area: lawn, plaza, path or water (top surface at the area's y). border adds an edge of another material.",
  schema: z.object({
    ...zCommon,
    area: zFootprint,
    depth: zInt.min(1).max(64).default(1).describe("layers below the surface"),
    shape: z.string().default("cube").describe('"floor" makes a thin paving layer'),
    border: z.object({ material: z.string(), width: zInt.min(1).default(1), shape: z.string().default("cube") }).optional(),
  }),
  example: { key: "lawn", area: { at: [-40, 0, -40], size: [81, 81] }, material: "grass", border: { material: "leaf_dark", width: 1 } },
  build(b, a) {
    const r = b.rect(a.area);
    for (let x = r.x0; x <= r.x1; x++)
      for (let z = r.z0; z <= r.z1; z++) {
        const bw = a.border?.width ?? 0;
        const edge = a.border && (x < r.x0 + bw || x > r.x1 - bw || z < r.z0 + bw || z > r.z1 - bw);
        for (let d = 0; d < a.depth; d++) {
          const top = d === 0;
          const mat = edge ? a.border!.material : a.material;
          const shape = top ? (edge ? a.border!.shape : a.shape) : "cube";
          b.set(x, r.y - d, z, mat, shape);
        }
      }
  },
});

function rand(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const createTree = defineGenerator({
  name: "createTree",
  type: "tree",
  description: "Voxel tree(s): round or cone crown on a trunk. positions places a row/grove in one call (deterministic by seed).",
  schema: z.object({
    ...zCommon,
    material: z.string().default("leaf"),
    at: zPos.optional(),
    positions: z.array(zPos).max(2000).optional(),
    height: zInt.min(1).max(64).default(4).describe("trunk height"),
    crown: zInt.min(1).max(16).default(2).describe("crown radius"),
    style: z.enum(["round", "cone", "box"]).default("round"),
    trunk: z.string().default("bark"),
    seed: zInt.default(1),
  }).refine((a) => a.at || a.positions, { message: 'give "at" or "positions"' }),
  example: { key: "trees", positions: [[10, 1, 10], [16, 1, 10], [22, 1, 10]], height: 4, crown: 2, material: "leaf" },
  build(b, a) {
    const list = a.positions ?? [a.at!];
    list.forEach((p) => {
      const c = b.pos(p);
      const rnd = rand(a.seed * 977 + Math.abs(c[0]) * 7 + c[2] * 13); // |x| keeps mirrored trees identical
      const th = a.height + (rnd() < 0.5 ? 0 : 1);
      for (let y = 0; y < th; y++) b.set(c[0], c[1] + y, c[2], a.trunk, a.crown >= 2 ? "pillar" : "post");
      const r = a.crown;
      const cy = c[1] + th + (a.style === "cone" ? 0 : r - 1);
      const span = a.style === "cone" ? r * 2 + 1 : r;
      for (let dy = -r; dy <= span; dy++)
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            let inside: boolean;
            if (a.style === "box") inside = Math.abs(dy) <= r;
            else if (a.style === "cone") { const rr = r * (1 - (dy + r) / (span + r + 1)) + 0.4; inside = dy >= -r && Math.hypot(dx, dz) <= rr; }
            else inside = Math.hypot(dx, dy * 1.15, dz) <= r + 0.45;
            if (!inside) continue;
            const surface = Math.hypot(dx, dy, dz) > r - 0.9;
            // a few holes on the round crown's sides only (never the trunk column, so nothing floats)
            if (a.style === "round" && surface && (dx !== 0 || dz !== 0) && rnd() < 0.06) continue;
            b.setIfEmpty(c[0] + dx, cy + dy, c[2] + dz, a.material, surface ? "leaves" : "cube");
          }
    });
    return { trees: list.length };
  },
});

export const GENERATOR_COMMANDS = [
  createBuilding, createFoundation, createFloor, createWall, createRoof, createTower, createCylinder, createArch,
  createTruss, createLine, createPillar, createStairs, createTerrain, createTree,
];
export { FACINGS };
