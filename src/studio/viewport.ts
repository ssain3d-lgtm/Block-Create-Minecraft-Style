// 3D viewport: scene, camera presets, ambience presets, picking, hover/ghost preview, screenshots.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Engine } from "../engine/engine";
import type { Vec3 } from "../engine/coords";
import { ChunkRenderer } from "../render/chunkRenderer";
import { geometryFor } from "../engine/geometry/recipes";
import { instanceMatrix } from "../render/orient";

export type ViewPreset = "all" | "main" | "front" | "side" | "top";
export type Ambience = "day" | "dusk" | "moon";

export interface Hit {
  cell: Vec3; // the block that was hit (or the ground cell under the cursor)
  normal: Vec3; // face normal
  ground: boolean;
}

const AMBIENCE: Record<Ambience, { top: string; bottom: string; sun: string; sunI: number; sunDir: Vec3; hemiSky: string; hemiGround: string; hemiI: number; glow: number }> = {
  day: { top: "#c5d9d6", bottom: "#e9efed", sun: "#fffaf0", sunI: 2.4, sunDir: [0.55, 1, 0.35], hemiSky: "#f1f6f6", hemiGround: "#9a9a8a", hemiI: 1.9, glow: 1 },
  dusk: { top: "#e7a98a", bottom: "#f6dfc2", sun: "#ffb27a", sunI: 2.2, sunDir: [1, 0.32, 0.15], hemiSky: "#f5d0b8", hemiGround: "#6b5a4a", hemiI: 1.4, glow: 1.2 },
  moon: { top: "#1b2638", bottom: "#3a4b66", sun: "#b9c8ff", sunI: 1.3, sunDir: [-0.4, 1, -0.5], hemiSky: "#6b7fa8", hemiGround: "#2a2a36", hemiI: 1.5, glow: 1.6 },
};

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly chunks: ChunkRenderer;
  readonly sun = new THREE.DirectionalLight("#ffffff", 2.4);
  readonly hemi = new THREE.HemisphereLight("#ffffff", "#888888", 1.8);
  private grid: THREE.GridHelper | null = null;
  private highlight: THREE.LineSegments;
  private ghost: THREE.Mesh;
  private ghostShape = "";
  private skyCanvas = document.createElement("canvas");
  private skyTex: THREE.CanvasTexture;
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null = null;
  ambience: Ambience = "day";
  fps = 0;
  private frames = 0;
  private fpsT0 = performance.now();
  frameHooks: (() => void)[] = [];

  constructor(public canvasHost: HTMLElement, public engine: Engine) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 6000);
    this.camera.position.set(60, 50, 60);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    this.skyCanvas.width = 2; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.skyTex;
    this.scene.fog = new THREE.Fog("#e9efed", 400, 2400);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.chunks = new ChunkRenderer(() => this.engine.project);
    this.scene.add(this.chunks.root);
    // meta (palette, materials, visibility) may change with any command
    engine.onChange(() => (this.chunks.paletteDirty = true));

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: "#1f5e4c", depthTest: false, transparent: true, opacity: 0.9 }));
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: "#2a7a5f", transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 9;
    this.scene.add(this.ghost);

    this.setAmbience("day");
    new ResizeObserver(() => this.resize()).observe(canvasHost);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvasHost.clientWidth || 800, h = this.canvasHost.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    this.chunks.update(10);
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, e);
      if (k >= 1) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    const now = performance.now();
    if (now - this.fpsT0 >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT0);
      this.frames = 0;
      this.fpsT0 = now;
    }
    for (const h of this.frameHooks) h();
  }

  // ---------------- ambience ----------------
  setAmbience(a: Ambience) {
    this.ambience = a;
    this.canvasHost.classList.toggle("dark", a === "moon");
    const s = AMBIENCE[a];
    const ctx = this.skyCanvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, s.top);
    g.addColorStop(1, s.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 256);
    this.skyTex.needsUpdate = true;
    (this.scene.fog as THREE.Fog).color.set(s.bottom);
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.color.set(s.hemiSky);
    this.hemi.groundColor.set(s.hemiGround);
    this.hemi.intensity = s.hemiI;
    this.sunDir = new THREE.Vector3(...s.sunDir).normalize();
    this.fitShadow();
  }

  private sunDir = new THREE.Vector3(0.55, 1, 0.35).normalize();

  /** Fits the sun's shadow camera around the current blocks. */
  fitShadow() {
    const b = this.engine.project.world.bounds();
    const min = b ? new THREE.Vector3(...b.min) : new THREE.Vector3(-16, 0, -16);
    const max = b ? new THREE.Vector3(...b.max).addScalar(1) : new THREE.Vector3(16, 16, 16);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(8, min.distanceTo(max) / 2);
    this.sun.position.copy(center).addScaledVector(this.sunDir, radius * 2);
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 0.5; cam.far = radius * 4;
    cam.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).near = radius * 3;
    (this.scene.fog as THREE.Fog).far = radius * 12 + 400;
  }

  setShadows(on: boolean) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.chunks.setShadows(on);
  }

  setGrid(on: boolean) {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; }
    if (!on) return;
    const b = this.engine.project.world.bounds();
    const size = b ? Math.max(32, Math.ceil(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 16 + 2) * 16) : 64;
    const cx = b ? Math.round((b.min[0] + b.max[0] + 1) / 2) : 0, cz = b ? Math.round((b.min[2] + b.max[2] + 1) / 2) : 0;
    this.grid = new THREE.GridHelper(size, size, "#7f9a90", "#b9c8c2");
    this.grid.position.set(cx, 0.002, cz);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.grid);
  }

  // ---------------- camera ----------------
  focusBox(min: Vec3, max: Vec3, dir: THREE.Vector3, animate = true) {
    const bmin = new THREE.Vector3(...min), bmax = new THREE.Vector3(...max).addScalar(1);
    const center = bmin.clone().add(bmax).multiplyScalar(0.5);
    const radius = Math.max(4, bmin.distanceTo(bmax) / 2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const dist = (radius / Math.sin(fit / 2)) * 1.02;
    const to = center.clone().addScaledVector(dir.clone().normalize(), dist);
    this.camera.far = Math.max(2000, dist * 6);
    this.camera.near = Math.max(0.1, dist / 2000);
    this.camera.updateProjectionMatrix();
    if (!animate) {
      this.camera.position.copy(to);
      this.controls.target.copy(center);
      return;
    }
    this.tween = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: center, t0: performance.now(), dur: 650 };
  }

  view(preset: ViewPreset, animate = true) {
    const p = this.engine.project;
    let box = p.world.bounds();
    if (preset === "main") {
      const tagged = p.meta.structures.filter((s) => s.tags?.includes("main") && s.box);
      const list = tagged.length ? tagged : [...p.meta.structures].filter((s) => s.box).sort((a, b) => (b.box!.max[1] - b.box!.min[1]) - (a.box!.max[1] - a.box!.min[1])).slice(0, 1);
      if (list.length) {
        const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (const s of list) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], s.box!.min[i]); max[i] = Math.max(max[i], s.box!.max[i]); }
        box = { min, max };
      }
    }
    if (!box) box = { min: [-8, 0, -8], max: [8, 8, 8] };
    const dirs: Record<ViewPreset, THREE.Vector3> = {
      all: new THREE.Vector3(1, 0.75, 1),
      main: new THREE.Vector3(1, 0.45, 1.15),
      front: new THREE.Vector3(0, 0.12, 1),
      side: new THREE.Vector3(1, 0.12, 0),
      top: new THREE.Vector3(0, 1, 0.001), // north up
    };
    this.focusBox(box.min, box.max, dirs[preset], animate);
  }

  /** azimuth of the camera around its target, radians (0 = looking north) */
  azimuth(): number {
    const d = this.controls.target.clone().sub(this.camera.position);
    return Math.atan2(d.x, -d.z);
  }

  // ---------------- picking ----------------
  /** Voxel DDA ray cast against world data (exact cells, independent of meshes). */
  pick(clientX: number, clientY: number): Hit | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const w = this.engine.project.world;
    const hidden = new Set(this.engine.project.meta.structures.filter((s) => !s.visible).map((s) => s.num));
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : (o.x - x) * tdx;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : (o.y - y) * tdy;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : (o.z - z) * tdz;
    let normal: Vec3 = [0, 1, 0];
    const maxT = this.camera.far;
    let t = 0;
    for (let i = 0; i < 4000 && t < maxT; i++) {
      const b = w.get(x, y, z);
      if (b && !hidden.has(b.structure)) return { cell: [x, y, z], normal, ground: false };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; normal = [-sx, 0, 0]; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; normal = [0, -sy, 0]; }
      else { z += sz; t = tmz; tmz += tdz; normal = [0, 0, -sz]; }
    }
    // ground plane y = 0
    if (d.y < -1e-6) {
      const tg = -o.y / d.y;
      const p = o.clone().addScaledVector(d, tg);
      return { cell: [Math.floor(p.x), -1, Math.floor(p.z)], normal: [0, 1, 0], ground: true };
    }
    return null;
  }

  showHighlight(cell: Vec3 | null, color = "#1f5e4c") {
    if (!cell) { this.highlight.visible = false; return; }
    this.highlight.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
    (this.highlight.material as THREE.LineBasicMaterial).color.set(color);
    this.highlight.visible = true;
  }

  showGhost(cell: Vec3 | null, shapeId: string, rot: number) {
    if (!cell) { this.ghost.visible = false; return; }
    const def = this.engine.assets.findShape(shapeId, this.engine.project.meta.assets.shapes);
    const key = `${shapeId}@${def?.version ?? 0}`;
    if (key !== this.ghostShape) {
      const g = new THREE.BufferGeometry();
      if (def) {
        const d = geometryFor(def);
        g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
        g.setIndex(new THREE.BufferAttribute(d.indices, 1));
      }
      this.ghost.geometry.dispose();
      this.ghost.geometry = g;
      this.ghostShape = key;
    }
    // same transform as the renderer: anchor = min corner of the rotated footprint
    const m = new Float32Array(16);
    instanceMatrix(cell[0], cell[1], cell[2], rot, m, 0, def?.size ?? [1, 1, 1]);
    this.ghost.matrixAutoUpdate = false;
    this.ghost.matrix.fromArray(m);
    this.ghost.matrixWorldNeedsUpdate = true;
    this.ghost.visible = true;
  }

  /**
   * Renders several fixed views for AI inspection. Returns PNG data URLs plus meta
   * (camera, visible structures and their on-screen label positions).
   */
  renderViews(opts: { views: string[]; isolate?: string[]; labels?: boolean; width?: number; height?: number }) {
    const p = this.engine.project;
    const w = opts.width ?? 1024, h = opts.height ?? 768;
    const only = opts.isolate?.length ? new Set(opts.isolate.map((id) => p.structure(id)?.num).filter((n): n is number => !!n)) : null;
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevPos = this.camera.position.clone(), prevTarget = this.controls.target.clone(), prevAspect = this.camera.aspect;
    const prevRatio = this.renderer.getPixelRatio();
    this.chunks.only = only;
    this.chunks.paletteDirty = true;
    this.chunks.flush();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const hv = this.highlight.visible, gv = this.ghost.visible;
    this.highlight.visible = false; this.ghost.visible = false;
    // focus box: isolated structures or the whole world
    let box = p.world.bounds();
    if (only) {
      const boxes = p.meta.structures.filter((s) => only.has(s.num)).map((s) => p.structureBox(s)).filter((b): b is NonNullable<typeof b> => !!b);
      if (boxes.length) box = { min: [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i]))) as Vec3, max: [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i]))) as Vec3 };
    }
    if (!box) box = { min: [-8, 0, -8], max: [8, 8, 8] };
    const dirs: Record<string, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.05, 1), back: new THREE.Vector3(0, 0.05, -1), left: new THREE.Vector3(-1, 0.05, 0), right: new THREE.Vector3(1, 0.05, 0),
      top: new THREE.Vector3(0, 1, 0.001), iso: new THREE.Vector3(1, 0.8, 1),
    };
    const images: Record<string, string> = {};
    const meta: Record<string, unknown> = {};
    const structs = p.meta.structures.filter((s) => s.visible && (!only || only.has(s.num)) && s.box);
    for (const v of opts.views) {
      this.focusBox(box.min, box.max, dirs[v] ?? dirs.iso, false);
      this.controls.update();
      this.camera.updateMatrixWorld();
      this.renderer.render(this.scene, this.camera);
      const labels: { id: string; name: string; x: number; y: number }[] = [];
      for (const s of structs) {
        const c = new THREE.Vector3((s.box!.min[0] + s.box!.max[0] + 1) / 2, (s.box!.min[1] + s.box!.max[1] + 1) / 2, (s.box!.min[2] + s.box!.max[2] + 1) / 2).project(this.camera);
        if (c.z < -1 || c.z > 1 || Math.abs(c.x) > 1 || Math.abs(c.y) > 1) continue;
        labels.push({ id: s.id, name: s.name, x: Math.round(((c.x + 1) / 2) * w), y: Math.round(((1 - c.y) / 2) * h) });
      }
      let url = this.renderer.domElement.toDataURL("image/png");
      if (opts.labels) {
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const g = cv.getContext("2d")!;
        g.drawImage(this.renderer.domElement, 0, 0, w, h);
        g.font = "bold 13px sans-serif";
        for (const l of labels) {
          const t = l.id;
          const tw = g.measureText(t).width + 8;
          g.fillStyle = "rgba(20,40,32,.78)";
          g.fillRect(l.x - tw / 2, l.y - 9, tw, 18);
          g.fillStyle = "#fff";
          g.fillText(t, l.x - tw / 2 + 4, l.y + 5);
        }
        url = cv.toDataURL("image/png");
      }
      images[v] = url;
      meta[v] = { camera: { position: this.camera.position.toArray().map((n) => +n.toFixed(2)), target: this.controls.target.toArray().map((n) => +n.toFixed(2)), fov: this.camera.fov }, labels };
    }
    // restore
    this.chunks.only = null;
    this.chunks.paletteDirty = true;
    this.renderer.setPixelRatio(prevRatio);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(prevPos);
    this.controls.target.copy(prevTarget);
    this.highlight.visible = hv; this.ghost.visible = gv;
    return { images, meta, size: [w, h], visibleStructures: structs.map((s) => ({ id: s.id, name: s.name, type: s.type, box: s.box })) };
  }

  /** PNG data URL of the current view (all pending chunks meshed first). */
  screenshot(): string {
    this.chunks.flush();
    const hv = this.highlight.visible, gv = this.ghost.visible;
    this.highlight.visible = false; this.ghost.visible = false;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.highlight.visible = hv; this.ghost.visible = gv;
    return url;
  }
}
