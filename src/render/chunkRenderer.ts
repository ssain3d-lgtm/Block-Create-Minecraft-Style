// Turns mesher output into Three.js objects and keeps them in sync with the world.
// Incremental: only dirty chunks are re-meshed, with a per-frame time budget.
import * as THREE from "three";
import type { Project } from "../engine/project";
import { geometryFor } from "../engine/geometry/recipes";
import { buildPalette, PaletteInfo, BUCKET_GLOW, BUCKET_TRANSPARENT } from "./palette";
import { meshChunk, ChunkMeshData, tileUV } from "./mesher";
import { createAtlasTexture } from "./atlas";

interface ChunkObjects {
  group: THREE.Group;
  total: number;
  visible: number;
}

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

export class ChunkRenderer {
  readonly root = new THREE.Group();
  readonly atlas = createAtlasTexture();
  readonly mats: THREE.Material[];
  readonly instMats: THREE.Material[];
  private chunks = new Map<string, ChunkObjects>();
  private shapeGeoms = new Map<string, THREE.BufferGeometry>();
  private pal: PaletteInfo | null = null;
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
    for (const c of this.chunks.values()) this.disposeGroup(c.group);
    this.chunks.clear();
    this.pal = null;
    const w = this.getProject().world;
    for (const k of w.chunks.keys()) w.dirty.add(k);
  }

  private disposeGroup(g: THREE.Group) {
    this.root.remove(g);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        mesh.geometry.dispose();
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      }
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

  invalidateShape(id: string) {
    for (const k of [...this.shapeGeoms.keys()]) if (k.startsWith(id + "@")) { this.shapeGeoms.get(k)!.dispose(); this.shapeGeoms.delete(k); }
  }

  /** Re-mesh dirty chunks for up to budgetMs. Returns number of chunks still pending. */
  update(budgetMs = 8): number {
    const p = this.getProject();
    const w = p.world;
    const pal = buildPalette(p);
    if (!this.pal || this.pal.key !== pal.key) {
      // palette/material/visibility change -> everything must be re-meshed
      for (const k of this.chunks.keys()) w.dirty.add(k);
      for (const k of w.chunks.keys()) w.dirty.add(k);
      this.pal = pal;
    }
    const t0 = performance.now();
    for (const key of w.dirty) {
      w.dirty.delete(key);
      const [cx, cy, cz] = key.split(",").map(Number);
      const data = meshChunk(w, cx, cy, cz, this.pal);
      this.apply(data);
      if (performance.now() - t0 > budgetMs) break;
    }
    this.pending = w.dirty.size;
    return this.pending;
  }

  /** Synchronously mesh everything (used by screenshots and benchmarks). */
  flush() {
    while (this.update(1e9) > 0) { /* loop */ }
  }

  private apply(d: ChunkMeshData) {
    const old = this.chunks.get(d.key);
    if (old) {
      this.totalBlocks -= old.total;
      this.visibleBlocks -= old.visible;
      this.disposeGroup(old.group);
      this.chunks.delete(d.key);
    }
    if (d.total === 0) return;
    const group = new THREE.Group();
    group.name = `chunk ${d.key}`;
    d.buckets.forEach((b, bi) => {
      if (!b) return;
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
      mesh.userData.chunk = d.key;
      group.add(mesh);
    });
    for (const inst of d.instances) {
      const geo = this.shapeGeometry(inst.shape);
      if (!geo.getAttribute("position")) continue;
      const mesh = new THREE.InstancedMesh(geo, this.instMats[inst.bucket], inst.count);
      mesh.instanceMatrix.set(inst.matrices);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(inst.colors, 3);
      // per-instance atlas tile (custom attribute read by the injected shader code)
      const tiles = new THREE.InstancedBufferAttribute(inst.tiles, 2);
      // light geometry wrapper: shares the cached shape attributes, adds the per-instance tile
      const g2 = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) g2.setAttribute(name, geo.getAttribute(name));
      g2.setIndex(geo.getIndex());
      g2.setAttribute("instTile", tiles);
      mesh.geometry = g2;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows && inst.bucket !== BUCKET_TRANSPARENT;
      mesh.receiveShadow = this.shadows;
      if (inst.bucket === BUCKET_TRANSPARENT) mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.root.add(group);
    this.chunks.set(d.key, { group, total: d.total, visible: d.visible });
    this.totalBlocks += d.total;
    this.visibleBlocks += d.visible;
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
    let drawObjects = 0;
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) drawObjects++; });
    return { chunks: this.chunks.size, meshes: drawObjects, total: this.totalBlocks, visible: this.visibleBlocks, pending: this.pending };
  }
}
