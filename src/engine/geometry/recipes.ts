// Turns a ShapeDef recipe into triangle data inside the unit cell [0,1]^3.
// Pure TypeScript (no Three.js) so it runs in Node, browsers and workers.
import type { Recipe, ShapeDef, FaceName } from "../types";
import { triangulate, polygonArea, P2 } from "./triangulate";

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  bounds: [number, number, number, number, number, number];
  triangles: number;
}

export const MAX_TRIANGLES = 20000; // per shape (large multi-cell shapes need more than a 1-cell block)
type V3 = [number, number, number];

class Soup {
  p: number[] = [];
  addTri(a: V3, b: V3, c: V3) {
    this.p.push(...a, ...b, ...c);
  }
  addQuad(a: V3, b: V3, c: V3, d: V3) {
    this.addTri(a, b, c);
    this.addTri(a, c, d);
  }
}

function boxInto(s: Soup, min: V3, max: V3, skip: Set<FaceName> = new Set()) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  if (!skip.has("+x")) s.addQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
  if (!skip.has("-x")) s.addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  if (!skip.has("+y")) s.addQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  if (!skip.has("-y")) s.addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  if (!skip.has("+z")) s.addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  if (!skip.has("-z")) s.addQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
}

/** profile points are (u, v); axis x: u=z, v=y ; axis z: u=x, v=y */
function extrudeInto(s: Soup, profileIn: P2[], axis: "x" | "z", from = 0, to = 1) {
  // normalise to counter-clockwise so side faces point outward
  const profile = polygonArea(profileIn) < 0 ? [...profileIn].reverse() : profileIn;
  const tris = triangulate(profile);
  const map = (u: number, v: number, w: number): V3 => (axis === "x" ? [w, v, u] : [u, v, w]);
  // caps; triangulate() returns CCW in (u,v)
  for (const [a, b, c] of tris) {
    const A = profile[a], B = profile[b], C = profile[c];
    if (axis === "x") {
      // (u=z, v=y) CCW seen from +x means normal -x for this mapping -> flip for +x cap
      s.addTri(map(A[0], A[1], from), map(B[0], B[1], from), map(C[0], C[1], from));
      s.addTri(map(A[0], A[1], to), map(C[0], C[1], to), map(B[0], B[1], to));
    } else {
      s.addTri(map(A[0], A[1], to), map(B[0], B[1], to), map(C[0], C[1], to));
      s.addTri(map(A[0], A[1], from), map(C[0], C[1], from), map(B[0], B[1], from));
    }
  }
  // sides: the x mapping is a mirror of the z mapping, so its winding is reversed
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const A = profile[i], B = profile[(i + 1) % n];
    if (axis === "z") s.addQuad(map(A[0], A[1], from), map(B[0], B[1], from), map(B[0], B[1], to), map(A[0], A[1], to));
    else s.addQuad(map(A[0], A[1], to), map(B[0], B[1], to), map(B[0], B[1], from), map(A[0], A[1], from));
  }
}

function latheInto(s: Soup, profile: P2[], segments = 12, cx = 0.5, cz = 0.5) {
  // profile: (radius, y); revolve around the shape's vertical centre line (cx, cz)
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
      const p = (r: number, y: number, a: number): V3 => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
      s.addQuad(p(r0, y0, a0), p(r1, y1, a0), p(r1, y1, a1), p(r0, y0, a1));
    }
    // caps
    const first = profile[0], last = profile[profile.length - 1];
    const p = (r: number, y: number, a: number): V3 => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
    // profile runs bottom -> top
    if (first[0] > 0) s.addTri([cx, first[1], cz], p(first[0], first[1], a0), p(first[0], first[1], a1));
    if (last[0] > 0) s.addTri([cx, last[1], cz], p(last[0], last[1], a1), p(last[0], last[1], a0));
  }
}

/** sweep: offset a polyline path (u,v) by +-thickness/2 and extrude it */
function curveInto(s: Soup, path: P2[], thickness: number, axis: "x" | "z", from = 0, to = 1, maxU = 1, maxV = 1) {
  const left: P2[] = [], right: P2[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy * thickness / 2, ny = dx * thickness / 2;
    left.push([p[0] + nx, p[1] + ny]);
    right.push([p[0] - nx, p[1] - ny]);
  }
  // thick ends naturally poke out of the cell: clamp the outline into 0..1
  const c = (v: number, m: number) => Math.min(m, Math.max(0, v));
  const outline = [...left, ...right.reverse()].map(([u, v]) => [c(u, maxU), c(v, maxV)] as P2);
  extrudeInto(s, outline, axis, from, to);
}

/** Sub-voxel mask -> faces, with 2D greedy merging per slice (keeps lattice shapes light). */
function subvoxelInto(s: Soup, _size: number, mask: string[][], ext: V3 = [1, 1, 1]) {
  // mask[y][z] is a row string over x. The grid spans the whole shape: dims come from the mask
  // itself, so non-cubic grids (e.g. 16 x 8 x 4 over a 4x2x1 shape) are allowed.
  const dims: V3 = [Math.max(1, ...mask.map((l) => Math.max(0, ...l.map((r) => r.length)))), Math.max(1, mask.length), Math.max(1, ...mask.map((l) => l.length))];
  const filled = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2] && mask[y]?.[z]?.[x] === "#";
  const kv: V3 = [ext[0] / dims[0], ext[1] / dims[1], ext[2] / dims[2]];
  // axis d = normal axis; u, v = the other two axes
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    for (const sign of [1, -1]) {
      const nu = dims[u], nv = dims[v];
      for (let slice = 0; slice < dims[d]; slice++) {
        // exposed[a][b]: cell at (d=slice, u=a, v=b) is filled and its neighbour along sign is empty
        const exposed: boolean[] = new Array(nu * nv).fill(false);
        for (let a = 0; a < nu; a++)
          for (let b = 0; b < nv; b++) {
            const c = [0, 0, 0];
            c[d] = slice; c[u] = a; c[v] = b;
            if (!filled(c[0], c[1], c[2])) continue;
            const nb = [...c];
            nb[d] += sign;
            if (!filled(nb[0], nb[1], nb[2])) exposed[a * nv + b] = true;
          }
        // greedy rectangles
        for (let a = 0; a < nu; a++)
          for (let b = 0; b < nv; b++) {
            if (!exposed[a * nv + b]) continue;
            let w = 1;
            while (b + w < nv && exposed[a * nv + b + w]) w++;
            let h = 1;
            outer: while (a + h < nu) {
              for (let j = 0; j < w; j++) if (!exposed[(a + h) * nv + b + j]) break outer;
              h++;
            }
            for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) exposed[(a + i) * nv + b + j] = false;
            const plane = (sign > 0 ? slice + 1 : slice) * kv[d];
            const p = (aa: number, bb: number): V3 => {
              const o = [0, 0, 0];
              o[d] = plane; o[u] = aa * kv[u]; o[v] = bb * kv[v];
              return o as V3;
            };
            const p00 = p(a, b), p10 = p(a + h, b), p11 = p(a + h, b + w), p01 = p(a, b + w);
            // (u x v) points along +d, so CCW in (u, v) faces +d
            if (sign > 0) s.addQuad(p00, p10, p11, p01);
            else s.addQuad(p00, p01, p11, p10);
          }
      }
    }
  }
}

/** ext = shape size in cells; recipe coordinates are in cell units (0..ext) */
function recipeInto(s: Soup, r: Recipe, depth = 0, ext: V3 = [1, 1, 1]) {
  if (depth > 4) throw new Error("composite nesting too deep (max 4)");
  switch (r.type) {
    case "box": boxInto(s, r.min, r.max); break;
    // extrude/curve: axis x -> points are (z, y), extruded over 0..width ; axis z -> points (x, y) over 0..depth
    case "extrude": { const ax = r.axis ?? "x"; extrudeInto(s, r.profile, ax, r.from ?? 0, r.to ?? (ax === "x" ? ext[0] : ext[2])); break; }
    case "lathe": latheInto(s, r.profile, r.segments, ext[0] / 2, ext[2] / 2); break;
    case "curve": {
      const ax = r.axis ?? "x";
      curveInto(s, r.path, r.thickness, ax, r.from ?? 0, r.to ?? (ax === "x" ? ext[0] : ext[2]), ax === "x" ? ext[2] : ext[0], ext[1]);
      break;
    }
    case "subvoxel": subvoxelInto(s, r.size, r.mask, ext); break;
    case "mesh": {
      for (let i = 0; i + 2 < r.indices.length; i += 3) {
        const v = (j: number): V3 => [r.positions[j * 3], r.positions[j * 3 + 1], r.positions[j * 3 + 2]];
        s.addTri(v(r.indices[i]), v(r.indices[i + 1]), v(r.indices[i + 2]));
      }
      break;
    }
    case "composite": {
      for (const part of r.parts) {
        const sub = new Soup();
        recipeInto(sub, part.recipe, depth + 1, ext);
        const [ox, oy, oz] = part.offset ?? [0, 0, 0];
        const [sx, sy, sz] = part.scale ?? [1, 1, 1];
        const yaw = (((part.yaw ?? 0) % 4) + 4) % 4;
        for (let i = 0; i < sub.p.length; i += 3) {
          let x = sub.p[i] * sx + ox, y = sub.p[i + 1] * sy + oy, z = sub.p[i + 2] * sz + oz;
          // quarter turns inside the shape's footprint (only exact for square footprints)
          for (let k = 0; k < yaw; k++) { const nx = ext[2] - z, nz = x; x = nx; z = nz; }
          s.p.push(x, y, z);
        }
      }
      break;
    }
  }
}

/** Builds flat-shaded, outward-facing geometry with projected UVs. */
export function buildGeometry(recipe: Recipe, size: [number, number, number] = [1, 1, 1]): GeometryData {
  const s = new Soup();
  recipeInto(s, recipe, 0, size);
  const p = s.p;
  const triCount = p.length / 9;
  if (triCount > MAX_TRIANGLES) throw new Error(`shape has ${triCount} triangles (max ${MAX_TRIANGLES})`);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triCount; t++) {
    const a: V3 = [p[t * 9], p[t * 9 + 1], p[t * 9 + 2]];
    const bb: V3 = [p[t * 9 + 3], p[t * 9 + 4], p[t * 9 + 5]];
    const c: V3 = [p[t * 9 + 6], p[t * 9 + 7], p[t * 9 + 8]];
    for (const v of [a, bb, c]) for (const n of v) if (!Number.isFinite(n)) throw new Error("shape has NaN/Infinity vertices");
    const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) continue; // degenerate
    nx /= len; ny /= len; nz /= len;
    for (const v of [a, bb, c]) {
      positions.push(v[0], v[1], v[2]);
      normals.push(nx, ny, nz);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (ax >= ay && ax >= az) uvs.push(v[2], v[1]);
      else if (ay >= az) uvs.push(v[0], v[2]);
      else uvs.push(v[0], v[1]);
      for (let i = 0; i < 3; i++) { if (v[i] < b[i]) b[i] = v[i]; if (v[i] > b[i + 3]) b[i + 3] = v[i]; }
    }
  }
  // uvs are in cell units (a 4-cell wall repeats the block texture 4 times; the shader wraps them)
  const n = positions.length / 3;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return {
    positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs),
    indices, bounds: b, triangles: n / 3,
  };
}

export function validateGeometry(g: GeometryData, size: [number, number, number] = [1, 1, 1]): string[] {
  const issues: string[] = [];
  if (g.triangles === 0) issues.push("shape produced no triangles");
  const [x0, y0, z0, x1, y1, z1] = g.bounds;
  const e = 0.001;
  if (x0 < -e || y0 < -e || z0 < -e || x1 > size[0] + e || y1 > size[1] + e || z1 > size[2] + e) {
    const lim = size.every((v) => v === 1) ? "0..1" : `0..${size.join(" x 0..")} (its size)`;
    issues.push(`shape leaves its cells (bounds ${g.bounds.map((v) => v.toFixed(2)).join(",")}); keep coordinates within ${lim}`);
  }
  return issues;
}

const cache = new Map<string, GeometryData>();
export function geometryFor(def: ShapeDef): GeometryData {
  const key = `${def.id}@${def.version ?? 1}@${JSON.stringify(def.recipe).length}@${(def.size ?? [1, 1, 1]).join("x")}`;
  let g = cache.get(key);
  if (!g) { g = buildGeometry(def.recipe, def.size); cache.set(key, g); }
  return g;
}

export function clearGeometryCache(id?: string) {
  if (!id) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(id + "@")) cache.delete(k);
}
