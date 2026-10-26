// Turns mesher output into Three.js objects and keeps them in sync with the world.
//  - incremental: only dirty chunks are re-meshed, with a per-frame time budget
//  - region batching: the meshes of 2x2x2 chunks (32^3 cells) are merged into one draw call per
//    bucket and one InstancedMesh per (shape, bucket), which cuts draw calls ~5-8x
import * as THREE from "three";
import type { Project } from "../engine/project";
import { geometryFor } from "../engine/geometry/recipes";
import { buildPalette, PaletteInfo, BUCKET_GLOW, BUCKET_TRANSPARENT } from "./palette";
import { meshChunk, ChunkMeshData, tileUV, BucketMesh } from "./mesher";
import { createAtlasTexture } from "./atlas";

export const REGION = 2; // chunks per region side

function injectInstanceTile(mat: THREE.Material, span: [number, number]) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tileSpan = { value: new THREE.Vector2(...span) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n#ifdef USE_INSTANCING\nattribute vec2 instTile;\nuniform vec2 tileSpan;\n#endif")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n#if defined(USE_INSTANCING) && defined(USE_MAP)\nvMapUv = instTile + uv * tileSpan;\n#endif");
  };
  mat.customProgramCacheKey = () => "inst-tile";
}

const recipeKeys = new WeakMap<object, string>();
function recipeKey(r: object): string {
  let k = recipeKeys.get(r);
  if (!k) {
    const s = JSON.stringify(r);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    k = `${s.length}.${(h >>> 0).toString(36)}`;
    recipeKeys.set(r, k);
  }
  return k;
}

function regionKeyOf(chunkKey: string) {
  const [cx, cy, cz] = chunkKey.split(",").map(Number);
  return `${Math.floor(cx / REGION)},${Math.floor(cy / REGION)},${Math.floor(cz / REGION)}`;
}

function mergeBuckets(list: BucketMesh[]): BucketMesh {
  let nv = 0, ni = 0;
  for (const b of list) { nv += b.positions.length / 3; ni += b.indices.length; }
  const out: BucketMesh = {
    positions: new Float32Array(nv * 3), normals: new Float32Array(nv * 3), uvs: new Float32Array(nv * 2),
    colors: new Float32Array(nv * 4), indices: new Uint32Array(ni),
  };
  let v = 0, i = 0;
  for (const b of list) {
    out.positions.set(b.positions, v * 3);
    out.normals.set(b.normals, v * 3);
    out.uvs.set(b.uvs, v * 2);
    out.colors.set(b.colors, v * 4);
    for (let k = 0; k < b.indices.length; k++) out.indices[i + k] = b.indices[k] + v;
    v += b.positions.length / 3;
    i += b.indices.length;
  }
  return out;
}

export class ChunkRenderer {
  readonly root = new THREE.Group();
  readonly atlas = createAtlasTexture();
  readonly mats: THREE.Material[];
  readonly instMats: THREE.Material[];
  private chunkData = new Map<string, ChunkMeshData>();
  private regions = new Map<string, THREE.Group>();
  private dirtyRegions = new Set<string>();
  private shapeGeoms = new Map<string, THREE.BufferGeometry>();
  private pal: PaletteInfo | null = null;
  /** set when project meta may have changed (palette, materials, visibility) */
  paletteDirty = true;
  shadows = true;
  totalBlocks = 0;
  visibleBlocks = 0;
  pending = 0;

  constructor(public getProject: () => Project) {
    this.root.name = "voxels";
    const map = this.atlas;
    this.mats = [
      new THREE.MeshLambertMaterial({ map, vertexColors: true }),
      new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, depthWrite: false }),
      new THREE.MeshBasicMaterial({ map, vertexColors: true }),
    ];
    const [, , tw, th] = tileUV(0, 0);
    this.instMats = [
      new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }),
      new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }),
    ];
    for (const m of this.instMats) injectInstanceTile(m, [tw, th]);
  }

  /** Call after a project load/replace: drop every chunk. */
  reset() {
    for (const g of this.regions.values()) this.disposeGroup(g);
    this.regions.clear();
    this.chunkData.clear();
    this.dirtyRegions.clear();
    this.totalBlocks = 0;
    this.visibleBlocks = 0;
    this.pal = null;
    this.paletteDirty = true;
    const w = this.getProject().world;
    for (const k of w.chunks.keys()) w.dirty.add(k);
  }

  private disposeGroup(g: THREE.Group) {
    this.root.remove(g);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    });
  }

  private shapeGeometry(shapeIdx: number): THREE.BufferGeometry {
    const p = this.getProject();
    const id = p.shapeId(shapeIdx);
    const def = p.assets.findShape(id, p.meta.assets.shapes);
    const key = `${id}@${def?.version ?? 0}@${def ? recipeKey(def.recipe) : ""}`;
    let g = this.shapeGeoms.get(key);
    if (!g) {
      g = new THREE.BufferGeometry();
      if (def) {
        try {
          const d = geometryFor(def);
          g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
          g.setAttribute("normal", new THREE.BufferAttribute(d.normals, 3));
          g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
          g.setIndex(new THREE.BufferAttribute(d.indices, 1));
        } catch {
          /* broken shape: render nothing */
        }
      }
      this.shapeGeoms.set(key, g);
    }
    return g;
  }

  /** Re-mesh dirty chunks for up to budgetMs, then rebuild touched regions. Returns chunks still pending. */
  update(budgetMs = 8): number {
    const p = this.getProject();
    const w = p.world;
    if (this.paletteDirty || !this.pal) {
      const pal = buildPalette(p);
      if (!this.pal || this.pal.key !== pal.key) {
        // palette / material / visibility change -> everything is re-meshed
        for (const k of this.chunkData.keys()) w.dirty.add(k);
        for (const k of w.chunks.keys()) w.dirty.add(k);
      }
      this.pal = pal;
      this.paletteDirty = false;
    }
    const t0 = performance.now();
    for (const key of w.dirty) {
      w.dirty.delete(key);
      const [cx, cy, cz] = key.split(",").map(Number);
      const data = meshChunk(w, cx, cy, cz, this.pal);
      const old = this.chunkData.get(key);
      if (old) { this.totalBlocks -= old.total; this.visibleBlocks -= old.visible; }
      if (data.total) {
        this.chunkData.set(key, data);
        this.totalBlocks += data.total;
        this.visibleBlocks += data.visible;
      } else this.chunkData.delete(key);
      if (old || data.total) this.dirtyRegions.add(regionKeyOf(key));
      if (performance.now() - t0 > budgetMs) break;
    }
    // rebuild regions only when their chunk queue is drained (avoids rebuilding a region 8 times)
    const pendingRegions = new Set([...w.dirty].map(regionKeyOf));
    for (const rk of this.dirtyRegions) {
      if (pendingRegions.has(rk)) continue;
      this.buildRegion(rk);
      this.dirtyRegions.delete(rk);
    }
    this.pending = w.dirty.size;
    return this.pending;
  }

  /** Synchronously mesh everything (used by screenshots and benchmarks). */
  flush() {
    while (this.update(1e9) > 0 || this.dirtyRegions.size > 0) { /* loop */ }
  }

  private buildRegion(rk: string) {
    const old = this.regions.get(rk);
    if (old) { this.disposeGroup(old); this.regions.delete(rk); }
    const [rx, ry, rz] = rk.split(",").map(Number);
    const parts: ChunkMeshData[] = [];
    for (let dx = 0; dx < REGION; dx++)
      for (let dy = 0; dy < REGION; dy++)
        for (let dz = 0; dz < REGION; dz++) {
          const d = this.chunkData.get(`${rx * REGION + dx},${ry * REGION + dy},${rz * REGION + dz}`);
          if (d) parts.push(d);
        }
    if (!parts.length) return;
    const group = new THREE.Group();
    group.name = `region ${rk}`;
    for (let bi = 0; bi < 3; bi++) {
      const list = parts.map((p) => p.buckets[bi]).filter((b): b is BucketMesh => !!b);
      if (!list.length) continue;
      const b = list.length === 1 ? list[0] : mergeBuckets(list);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(b.uvs, 2));
      g.setAttribute("color", new THREE.BufferAttribute(b.colors, 4));
      g.setIndex(new THREE.BufferAttribute(b.indices, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.mats[bi]);
      mesh.castShadow = this.shadows && bi !== BUCKET_TRANSPARENT;
      mesh.receiveShadow = this.shadows && bi !== BUCKET_GLOW;
      if (bi === BUCKET_TRANSPARENT) mesh.renderOrder = 2;
      group.add(mesh);
    }
    // merge instance groups of the same (shape, bucket)
    const inst = new Map<number, { shape: number; bucket: number; m: Float32Array[]; c: Float32Array[]; t: Float32Array[]; n: number }>();
    for (const p of parts)
      for (const g of p.instances) {
        const k = g.shape * 4 + g.bucket;
        let e = inst.get(k);
        if (!e) { e = { shape: g.shape, bucket: g.bucket, m: [], c: [], t: [], n: 0 }; inst.set(k, e); }
        e.m.push(g.matrices); e.c.push(g.colors); e.t.push(g.tiles); e.n += g.count;
      }
    const cat = (arrs: Float32Array[]) => {
      if (arrs.length === 1) return arrs[0];
      const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0));
      let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      return out;
    };
    for (const e of inst.values()) {
      const geo = this.shapeGeometry(e.shape);
      if (!geo.getAttribute("position")) continue;
      const g2 = new THREE.BufferGeometry(); // light wrapper sharing the cached shape attributes
      for (const name of ["position", "normal", "uv"]) g2.setAttribute(name, geo.getAttribute(name));
      g2.setIndex(geo.getIndex());
      g2.setAttribute("instTile", new THREE.InstancedBufferAttribute(cat(e.t), 2));
      const mesh = new THREE.InstancedMesh(g2, this.instMats[e.bucket], e.n);
      mesh.instanceMatrix.set(cat(e.m));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(cat(e.c), 3);
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows && e.bucket !== BUCKET_TRANSPARENT;
      mesh.receiveShadow = this.shadows;
      if (e.bucket === BUCKET_TRANSPARENT) mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.root.add(group);
    this.regions.set(rk, group);
  }

  setShadows(on: boolean) {
    this.shadows = on;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const transparent = (m.material as THREE.Material).transparent;
      m.castShadow = on && !transparent;
      m.receiveShadow = on;
    });
  }

  stats() {
    let meshes = 0;
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    return { chunks: this.chunkData.size, regions: this.regions.size, meshes, total: this.totalBlocks, visible: this.visibleBlocks, pending: this.pending };
  }
}
