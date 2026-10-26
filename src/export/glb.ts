// glTF 2.0 binary (.glb) export of the whole project or some structures.
// Geometry comes from the same mesher as the viewer (hidden faces removed, vertex colours with AO);
// instanced shapes are baked into triangles. Units are metres (cellSize).
import type { Project } from "../engine/project";
import { geometryFor } from "../engine/geometry/recipes";
import { meshChunk } from "../render/mesher";
import { buildPalette } from "../render/palette";

interface Acc { pos: number[]; nor: number[]; col: number[]; idx: number[] }

export function exportGLB(p: Project, opts: { structures?: number[] } = {}): { bytes: Uint8Array; triangles: number } {
  const pal = buildPalette(p);
  if (opts.structures?.length) {
    const keep = new Set(opts.structures);
    for (const s of p.meta.structures) if (!keep.has(s.num)) pal.hidden.add(s.num);
    pal.hidden.add(0);
  }
  const scale = p.meta.settings.cellSize;
  const buckets: Acc[] = [0, 1, 2].map(() => ({ pos: [], nor: [], col: [], idx: [] }));
  for (const c of p.world.chunks.values()) {
    const d = meshChunk(p.world, c.cx, c.cy, c.cz, pal);
    d.buckets.forEach((b, bi) => {
      if (!b) return;
      const A = buckets[bi], base = A.pos.length / 3;
      for (let i = 0; i < b.positions.length; i++) A.pos.push(b.positions[i] * scale);
      for (let i = 0; i < b.normals.length; i++) A.nor.push(b.normals[i]);
      for (let i = 0; i < b.colors.length; i++) A.col.push(b.colors[i]);
      for (let i = 0; i < b.indices.length; i++) A.idx.push(b.indices[i] + base);
    });
    for (const g of d.instances) {
      const def = p.shapeDefAt(g.shape);
      if (!def) continue;
      let geo;
      try { geo = geometryFor(def); } catch { continue; }
      const A = buckets[g.bucket];
      const alpha = g.bucket === 1 ? 0.55 : 1;
      for (let n = 0; n < g.count; n++) {
        const m = g.matrices.subarray(n * 16, n * 16 + 16);
        const base = A.pos.length / 3;
        for (let v = 0; v < geo.positions.length; v += 3) {
          const x = geo.positions[v], y = geo.positions[v + 1], z = geo.positions[v + 2];
          A.pos.push((m[0] * x + m[4] * y + m[8] * z + m[12]) * scale, (m[1] * x + m[5] * y + m[9] * z + m[13]) * scale, (m[2] * x + m[6] * y + m[10] * z + m[14]) * scale);
          const nx = geo.normals[v], ny = geo.normals[v + 1], nz = geo.normals[v + 2];
          A.nor.push(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz);
          A.col.push(g.colors[n * 3], g.colors[n * 3 + 1], g.colors[n * 3 + 2], alpha);
        }
        for (let i = 0; i < geo.indices.length; i++) A.idx.push(geo.indices[i] + base);
      }
    }
  }

  // ---- assemble glTF ----
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [], accessors: object[] = [], primitives: object[] = [];
  const addView = (arr: ArrayBufferView, target: number) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    chunks.push(bytes);
    if (pad) chunks.push(new Uint8Array(pad));
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return bufferViews.length - 1;
  };
  const materials = [
    { name: "opaque", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    { name: "transparent", alphaMode: "BLEND", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.1 } },
    { name: "glow", emissiveFactor: [1, 0.85, 0.5], pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } },
  ];
  let triangles = 0;
  buckets.forEach((A, bi) => {
    if (!A.idx.length) return;
    const pos = Float32Array.from(A.pos);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    // colours as normalised bytes (4 bytes per vertex instead of 16); linear values as in the viewer
    const col8 = new Uint8Array(A.col.length);
    for (let i = 0; i < A.col.length; i++) col8[i] = Math.max(0, Math.min(255, Math.round(A.col[i] * 255)));
    const vPos = addView(pos, 34962), vNor = addView(Float32Array.from(A.nor), 34962), vCol = addView(col8, 34962), vIdx = addView(Uint32Array.from(A.idx), 34963);
    const count = pos.length / 3;
    accessors.push({ bufferView: vPos, componentType: 5126, count, type: "VEC3", min, max });
    accessors.push({ bufferView: vNor, componentType: 5126, count, type: "VEC3" });
    accessors.push({ bufferView: vCol, componentType: 5121, normalized: true, count, type: "VEC4" });
    accessors.push({ bufferView: vIdx, componentType: 5125, count: A.idx.length, type: "SCALAR" });
    const a0 = accessors.length - 4;
    primitives.push({ attributes: { POSITION: a0, NORMAL: a0 + 1, COLOR_0: a0 + 2 }, indices: a0 + 3, material: bi });
    triangles += A.idx.length / 3;
  });
  const gltf = {
    asset: { version: "2.0", generator: "ai-voxel-studio" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: p.meta.name }],
    meshes: [{ name: p.meta.name, primitives }],
    materials,
    buffers: [{ byteLength: offset }],
    bufferViews,
    accessors,
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jpad = (4 - (json.length % 4)) % 4;
  if (jpad) { const j2 = new Uint8Array(json.length + jpad).fill(0x20); j2.set(json); json = j2; }
  const total = 12 + 8 + json.length + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(json, 20);
  let o = 20 + json.length;
  dv.setUint32(o, offset, true);
  dv.setUint32(o + 4, 0x004e4942, true); // BIN
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return { bytes: out, triangles };
}
