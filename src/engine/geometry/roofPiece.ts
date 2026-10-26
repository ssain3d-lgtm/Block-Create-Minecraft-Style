// Roof pieces made on demand: one cell of a roof surface whose corner heights are known.
// A piece is the part of the roof body that falls inside one cell (clipped to 0..1), so a steep or
// offset slope is split over stacked cells and still meets its neighbours exactly.
// Local frame = facing north: the high side / apex is toward z = 0.
//   s (slope): high along the north edge          h = lo + r * (1 - z)   (lo = hi: level)
//   o (outer hip corner): apex at the NE corner    h = lo + r * min(x, 1 - z)
//   i (inner / valley corner): low only at SW      h = lo + r * max(x, 1 - z)
// The body reaches from h - t up to h (a plate of vertical thickness t), or down to the cell
// bottom when t is omitted. Heights are multiples of 1/ROOF_Q cell, so any pitch gets an even slope.
// ids: builtin.roofp_<s|o|i>_<lo*Q>_<hi*Q>[_t<t*Q>] with "n" for negatives (e.g. roofp_o_n4_5_t8).
import type { FaceName, ShapeDef } from "../types";

export type RoofPieceType = "s" | "o" | "i";
export const ROOF_Q = 8;
const ID_RE = /^builtin\.roofp_([soi])_(n?\d+)_(n?\d+)(?:_t(\d+))?$/;
const enc = (v: number) => { const n = Math.round(v * ROOF_Q); return n < 0 ? `n${-n}` : `${n}`; };
const dec = (s: string) => (s.startsWith("n") ? -Number(s.slice(1)) : Number(s)) / ROOF_Q;

/**
 * id of the piece for surface heights lo..hi (cells, relative to the cell bottom, multiples of 1/ROOF_Q);
 * t = plate thickness (omit for a body that fills down to the cell bottom).
 * Returns null when the cell holds nothing.
 */
export function roofPieceId(type: RoofPieceType, lo: number, hi: number, t?: number): string | null {
  if (hi <= 0) return null;
  if (t !== undefined && lo - t >= 1) return null;
  if (hi === lo) type = "s"; // a level piece looks the same in every orientation
  if (t === undefined || hi - t <= 0) {
    // the plate bottom is below this cell: same as a full-depth piece
    if (lo >= 1) return "builtin.cube";
    if (hi === lo && lo === 0.5) return "builtin.slab";
    if (type === "s") {
      if (lo === 0 && hi === 1) return "builtin.wedge";
      if (lo === 0 && hi === 0.5) return "builtin.wedge_half";
      if (lo === 0.5 && hi === 1) return "builtin.wedge_half_hi";
    }
    return `builtin.roofp_${type}_${enc(lo)}_${enc(hi)}`;
  }
  return `builtin.roofp_${type}_${enc(lo)}_${enc(hi)}_t${Math.round(t * ROOF_Q)}`;
}

type V3 = [number, number, number];
interface HV { x: number; z: number; h: number }

export function roofPieceDef(id: string): ShapeDef | undefined {
  const m = ID_RE.exec(id);
  if (!m) return undefined;
  const type = m[1] as RoofPieceType, lo = dec(m[2]), hi = dec(m[3]);
  const t = m[4] !== undefined ? Number(m[4]) / ROOF_Q : Infinity;
  if (!(hi >= lo) || hi - lo > 8 || hi <= 0 || !(t > 0)) return undefined;
  const r = hi - lo;
  const h = (x: number, z: number) =>
    lo + r * (type === "s" ? 1 - z : type === "o" ? Math.min(x, 1 - z) : Math.max(x, 1 - z));
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  const topY = (hv: number) => cl(hv), botY = (hv: number) => cl(hv - t);
  const positions: number[] = [];
  const indices: number[] = [];
  const tri = (a: V3, b: V3, c: V3, want: V3) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (Math.hypot(...n) < 1e-9) return;
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const base = positions.length / 3;
    positions.push(...a, ...(flip ? c : b), ...(flip ? b : c));
    indices.push(base, base + 1, base + 2);
  };
  const fan = (poly: V3[], want: V3) => { for (let k = 1; k + 1 < poly.length; k++) tri(poly[0], poly[k], poly[k + 1], want); };
  // clip a convex polygon (h linear over it) to h >= c (keepAbove) or h <= c
  const clip = (poly: HV[], c: number, keepAbove: boolean): HV[] => {
    const out: HV[] = [];
    const inside = (p: HV) => (keepAbove ? p.h >= c - 1e-9 : p.h <= c + 1e-9);
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) {
        const s = (c - p.h) / (q.h - p.h);
        out.push({ x: p.x + (q.x - p.x) * s, z: p.z + (q.z - p.z) * s, h: c });
      }
    }
    return out;
  };
  // top and bottom are clamped linear functions; between these breaks both are linear
  const breaks = [0, 1, t, t + 1].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const bands: [number, number][] = [];
  for (let k = 0; k <= breaks.length; k++) bands.push([k === 0 ? -Infinity : breaks[k - 1], k === breaks.length ? Infinity : breaks[k]]);
  const P = (x: number, z: number): HV => ({ x, z, h: h(x, z) });
  // the crease of o / i runs SW (0,1) -> NE (1,0); both triangles are planar
  const tris: HV[][] = [[P(0, 1), P(0, 0), P(1, 0)], [P(0, 1), P(1, 0), P(1, 1)]];
  for (const tr of tris) {
    for (const [b0, b1] of r > 0 ? bands : [[-Infinity, Infinity]]) { // a level piece is a single box
      let poly = tr;
      if (Number.isFinite(b0)) poly = clip(poly, b0, true);
      if (poly.length >= 3 && Number.isFinite(b1)) poly = clip(poly, b1, false);
      if (poly.length < 3) continue;
      const mh = poly.reduce((s, p) => s + p.h, 0) / poly.length;
      if (topY(mh) - botY(mh) < 1e-9) continue; // empty band
      fan(poly.map((p) => [p.x, topY(p.h), p.z] as V3), [0, 1, 0]);
      fan(poly.map((p) => [p.x, botY(p.h), p.z] as V3), [0, -1, 0]);
    }
  }
  // side walls along the four cell edges (h is linear along each edge)
  const edges: [number, number, number, number, V3][] = [
    [0, 0, 1, 0, [0, 0, -1]], [1, 0, 1, 1, [1, 0, 0]], [1, 1, 0, 1, [0, 0, 1]], [0, 1, 0, 0, [-1, 0, 0]],
  ];
  for (const [x0, z0, x1, z1, out] of edges) {
    const h0 = h(x0, z0), h1 = h(x1, z1);
    const ss = [0, 1];
    if (h1 !== h0) for (const c of breaks) { const s = (c - h0) / (h1 - h0); if (s > 0 && s < 1) ss.push(s); }
    ss.sort((a, b) => a - b);
    for (let k = 0; k + 1 < ss.length; k++) {
      const pa = ss[k], pb = ss[k + 1];
      const ha = h0 + (h1 - h0) * pa, hb = h0 + (h1 - h0) * pb;
      const ax = x0 + (x1 - x0) * pa, az = z0 + (z1 - z0) * pa, bx = x0 + (x1 - x0) * pb, bz = z0 + (z1 - z0) * pb;
      if (topY(ha) - botY(ha) < 1e-9 && topY(hb) - botY(hb) < 1e-9) continue;
      fan([[ax, botY(ha), az], [bx, botY(hb), bz], [bx, topY(hb), bz], [ax, topY(ha), az]], out);
    }
  }
  // faces fully covered by the piece (used for neighbour culling)
  const corner = [h(0, 0), h(1, 0), h(1, 1), h(0, 1)]; // NW NE SE SW
  const full = (...hs: number[]) => hs.every((v) => v >= 1) && hs.every((v) => v - t <= 0);
  const solid: FaceName[] = [];
  if (corner.every((v) => v >= 0) && corner.every((v) => v - t <= 0)) solid.push("-y");
  if (full(...corner)) solid.push("+y");
  if (full(corner[0], corner[1])) solid.push("-z");
  if (full(corner[1], corner[2])) solid.push("+x");
  if (full(corner[2], corner[3])) solid.push("+z");
  if (full(corner[3], corner[0])) solid.push("-x");
  const label = r === 0 ? "level" : type === "s" ? "slope" : type === "o" ? "hip corner" : "valley corner";
  return {
    id, name: `roof ${label} ${lo}..${hi}${Number.isFinite(t) ? ` t${t}` : ""}`, recipe: { type: "mesh", positions, indices }, solidFaces: solid,
    tags: ["roof", "internal"], description: `Roof ${label} piece, heights ${lo}..${hi} (made by createRoof).`, version: 1, internal: true,
  };
}
