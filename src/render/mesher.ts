// Chunk mesher (pure TypeScript, no Three.js — can run in a worker).
//  - cubes: merged per chunk, hidden-face culling, per-vertex ambient occlusion,
//           per-block colour variants and atlas texture variants
//  - other shapes: instance lists per (shape, bucket), fully enclosed instances skipped
import { CHUNK, CHUNK_VOL } from "../engine/coords";
import type { World } from "../engine/world";
import { instanceMatrix } from "./orient";
import { ATLAS_COLS, ATLAS_ROWS, BUCKET_TRANSPARENT, PaletteInfo, VARIANTS_PER_PATTERN } from "./palette";

const P = CHUNK + 2; // padded size
const PV = P * P * P;
const pidx = (x: number, y: number, z: number) => (y * P + z) * P + x;

export interface BucketMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array; // rgba
  indices: Uint32Array;
}

export interface InstanceGroup {
  shape: number;
  bucket: number;
  count: number;
  matrices: Float32Array;
  colors: Float32Array; // rgb
  tiles: Float32Array; // atlas uv offset per instance
}

export interface ChunkMeshData {
  key: string;
  buckets: (BucketMesh | null)[];
  instances: InstanceGroup[];
  total: number;
  visible: number;
}

export interface PaddedChunk {
  shape: Uint16Array;
  material: Uint16Array;
  rot: Uint8Array;
  structure: Uint32Array;
}

/** Copies a chunk plus a one-cell border from the world (border used for culling and AO). */
export function padChunk(world: World, cx: number, cy: number, cz: number): PaddedChunk | null {
  const c = world.chunks.get(`${cx},${cy},${cz}`);
  if (!c) return null;
  const out: PaddedChunk = { shape: new Uint16Array(PV), material: new Uint16Array(PV), rot: new Uint8Array(PV), structure: new Uint32Array(PV) };
  for (let ly = 0; ly < CHUNK; ly++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const src = (ly * CHUNK + lz) * CHUNK;
      const dst = pidx(1, ly + 1, lz + 1);
      out.shape.set(c.shape.subarray(src, src + CHUNK), dst);
      out.material.set(c.material.subarray(src, src + CHUNK), dst);
      out.rot.set(c.rot.subarray(src, src + CHUNK), dst);
      out.structure.set(c.structure.subarray(src, src + CHUNK), dst);
    }
  const bx = cx * CHUNK - 1, by = cy * CHUNK - 1, bz = cz * CHUNK - 1;
  for (let y = 0; y < P; y++)
    for (let z = 0; z < P; z++)
      for (let x = 0; x < P; x++) {
        if (x > 0 && x < P - 1 && y > 0 && y < P - 1 && z > 0 && z < P - 1) continue;
        const b = world.get(bx + x, by + y, bz + z);
        if (!b) continue;
        const i = pidx(x, y, z);
        out.shape[i] = b.shape; out.material[i] = b.material; out.rot[i] = b.rot; out.structure[i] = b.structure;
      }
  return out;
}

function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// cube face corner tables (unit cube), winding matches engine box geometry
const FACES: { dir: [number, number, number]; corners: [number, number, number][]; uv: [number, number][] }[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];
const OPP = [1, 0, 3, 2, 5, 4];
const AO_SHADE = [0.5, 0.68, 0.84, 1];
const FACE_SHADE = [0.92, 0.88, 1.0, 0.7, 0.96, 0.84]; // slight baked face tint for a crisper voxel look

class Grow {
  a: Float32Array;
  n = 0;
  constructor(size = 4096) { this.a = new Float32Array(size); }
  push4(a: number, b: number, c: number, d: number) {
    if (this.n + 4 > this.a.length) { const t = new Float32Array(this.a.length * 2); t.set(this.a); this.a = t; }
    this.a[this.n++] = a; this.a[this.n++] = b; this.a[this.n++] = c; this.a[this.n++] = d;
  }
  push3(a: number, b: number, c: number) {
    if (this.n + 3 > this.a.length) { const t = new Float32Array(this.a.length * 2); t.set(this.a); this.a = t; }
    this.a[this.n++] = a; this.a[this.n++] = b; this.a[this.n++] = c;
  }
  push2(a: number, b: number) {
    if (this.n + 2 > this.a.length) { const t = new Float32Array(this.a.length * 2); t.set(this.a); this.a = t; }
    this.a[this.n++] = a; this.a[this.n++] = b;
  }
  done() { return this.a.slice(0, this.n); }
}

const INSET = 0.5 / (16 * ATLAS_COLS);
export function tileUV(pattern: number, variant: number): [number, number, number, number] {
  const t = pattern * VARIANTS_PER_PATTERN + (variant % VARIANTS_PER_PATTERN);
  const col = t % ATLAS_COLS, row = Math.floor(t / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + INSET, v0 = 1 - (row + 1) / ATLAS_ROWS + INSET;
  return [u0, v0, 1 / ATLAS_COLS - 2 * INSET, 1 / ATLAS_ROWS - 2 * INSET];
}

export function meshChunk(world: World, cx: number, cy: number, cz: number, pal: PaletteInfo): ChunkMeshData {
  const key = `${cx},${cy},${cz}`;
  const pc = padChunk(world, cx, cy, cz);
  const empty: ChunkMeshData = { key, buckets: [null, null, null], instances: [], total: 0, visible: 0 };
  if (!pc) return empty;
  const { shape, material, rot, structure } = pc;
  // hidden structures behave as air
  if (pal.hidden.size) {
    for (let i = 0; i < PV; i++) if (shape[i] && pal.hidden.has(structure[i])) shape[i] = 0;
  }
  const bucketData = [0, 1, 2].map(() => ({ pos: new Grow(), nor: new Grow(), uv: new Grow(), col: new Grow(), idx: [] as number[], verts: 0 }));
  const groups = new Map<number, { shape: number; bucket: number; m: number[]; c: number[]; t: number[] }>();
  const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;
  let total = 0, visible = 0;

  const isOccluderAO = (i: number) => {
    const s = shape[i];
    return s !== 0 && pal.shapeIsCube[s] === 1 && pal.matBucket[material[i]] !== BUCKET_TRANSPARENT;
  };

  for (let ly = 0; ly < CHUNK; ly++)
    for (let lz = 0; lz < CHUNK; lz++)
      for (let lx = 0; lx < CHUNK; lx++) {
        const px = lx + 1, py = ly + 1, pz = lz + 1;
        const i = pidx(px, py, pz);
        const s = shape[i];
        if (!s) continue;
        total++;
        const m = material[i];
        const bucket = pal.matBucket[m] ?? 0; // stale palette (new material) falls back to opaque
        const wx = ox + lx, wy = oy + ly, wz = oz + lz;
        const h = hash3(wx, wy, wz);
        const vc = pal.matVarCount[m];
        const vlight = vc > 1 ? (((h >>> 2) % vc) / (vc - 1) - 0.5) * 2 * pal.matVarLight[m] : 0;
        const r0 = pal.matColor[m * 3] * (1 + vlight), g0 = pal.matColor[m * 3 + 1] * (1 + vlight), b0 = pal.matColor[m * 3 + 2] * (1 + vlight);
        const alpha = pal.matAlpha[m];
        const [tu, tv, tw, th] = tileUV(pal.matPattern[m], h & 3);

        if (pal.shapeIsCube[s]) {
          let emitted = false;
          const bd = bucketData[bucket];
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const ni = pidx(px + F.dir[0], py + F.dir[1], pz + F.dir[2]);
            const ns = shape[ni];
            if (ns) {
              const nSolid = pal.shapeSolid[ns * 8 + rot[ni]] & (1 << OPP[f]);
              if (nSolid) {
                const nb = pal.matBucket[material[ni]];
                if (nb !== BUCKET_TRANSPARENT || (bucket === BUCKET_TRANSPARENT && material[ni] === m)) continue;
              }
            }
            emitted = true;
            // per-vertex AO
            const ao: number[] = [];
            for (let k = 0; k < 4; k++) {
              const c = F.corners[k];
              // tangent offsets toward this corner on the two axes of the face plane
              const d = [c[0] * 2 - 1, c[1] * 2 - 1, c[2] * 2 - 1];
              const axis = F.dir[0] !== 0 ? 0 : F.dir[1] !== 0 ? 1 : 2;
              const t1 = axis === 0 ? 1 : 0, t2 = axis === 2 ? 1 : 2;
              const base = [px + F.dir[0], py + F.dir[1], pz + F.dir[2]];
              const s1 = [...base]; s1[t1] += d[t1];
              const s2 = [...base]; s2[t2] += d[t2];
              const cc = [...base]; cc[t1] += d[t1]; cc[t2] += d[t2];
              const o1 = isOccluderAO(pidx(s1[0], s1[1], s1[2])) ? 1 : 0;
              const o2 = isOccluderAO(pidx(s2[0], s2[1], s2[2])) ? 1 : 0;
              const o3 = isOccluderAO(pidx(cc[0], cc[1], cc[2])) ? 1 : 0;
              ao.push(o1 && o2 ? 0 : 3 - (o1 + o2 + o3));
            }
            const fs = FACE_SHADE[f];
            for (let k = 0; k < 4; k++) {
              const c = F.corners[k];
              bd.pos.push3(wx + c[0], wy + c[1], wz + c[2]);
              bd.nor.push3(F.dir[0], F.dir[1], F.dir[2]);
              bd.uv.push2(tu + F.uv[k][0] * tw, tv + F.uv[k][1] * th);
              const sh = AO_SHADE[ao[k]] * fs;
              bd.col.push4(r0 * sh, g0 * sh, b0 * sh, alpha);
            }
            const v = bd.verts;
            // flip the quad diagonal to avoid AO anisotropy
            if (ao[0] + ao[2] > ao[1] + ao[3]) bd.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
            else bd.idx.push(v + 1, v + 2, v + 3, v + 1, v + 3, v);
            bd.verts += 4;
          }
          if (emitted) visible++;
        } else {
          // skip instances completely enclosed by opaque full cubes
          let enclosed = true;
          for (let f = 0; f < 6 && enclosed; f++) {
            const F = FACES[f];
            const ni = pidx(px + F.dir[0], py + F.dir[1], pz + F.dir[2]);
            if (!isOccluderAO(ni)) enclosed = false;
          }
          if (enclosed) continue;
          visible++;
          const gk = s * 4 + bucket;
          let g = groups.get(gk);
          if (!g) { g = { shape: s, bucket, m: [], c: [], t: [] }; groups.set(gk, g); }
          const mat = new Float32Array(16);
          instanceMatrix(wx, wy, wz, rot[i], mat, 0);
          for (let k = 0; k < 16; k++) g.m.push(mat[k]);
          g.c.push(r0, g0, b0);
          g.t.push(tu, tv);
        }
      }

  const buckets = bucketData.map((b) =>
    b.verts === 0 ? null : { positions: b.pos.done(), normals: b.nor.done(), uvs: b.uv.done(), colors: b.col.done(), indices: Uint32Array.from(b.idx) },
  );
  const instances: InstanceGroup[] = [...groups.values()].map((g) => ({
    shape: g.shape, bucket: g.bucket, count: g.c.length / 3,
    matrices: Float32Array.from(g.m), colors: Float32Array.from(g.c), tiles: Float32Array.from(g.t),
  }));
  return { key, buckets, instances, total, visible };
}

export const CHUNK_VOLUME = CHUNK_VOL;
