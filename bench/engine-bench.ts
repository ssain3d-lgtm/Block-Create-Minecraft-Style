// CPU-side benchmark (no GPU): build, mesh, save/load and edit timings for each scene.
// Run: npm run bench:engine   -> writes bench/results/engine-<date>.json
import fs from "node:fs";
import os from "node:os";
import { Engine } from "../src/engine/engine";
import { meshChunk } from "../src/render/mesher";
import { buildPalette } from "../src/render/palette";
import { SCENES } from "./scenes";

const now = () => performance.now();
const results: Record<string, unknown>[] = [];

for (const scene of SCENES) {
  const e = new Engine();
  let t = now();
  scene.build(e);
  const buildMs = now() - t;
  const w = e.project.world;

  // full mesh (what the viewer does on load)
  const pal = buildPalette(e.project);
  t = now();
  let quads = 0, instances = 0, visible = 0, groups = 0;
  for (const c of w.chunks.values()) {
    const d = meshChunk(w, c.cx, c.cy, c.cz, pal);
    for (const b of d.buckets) if (b) quads += b.indices.length / 6;
    for (const g of d.instances) { instances += g.count; groups++; }
    visible += d.visible;
  }
  const meshMs = now() - t;

  // save / load
  t = now();
  const text = JSON.stringify(e.project.toFile(true));
  const saveMs = now() - t;
  t = now();
  const e2 = new Engine();
  e2.loadFile(JSON.parse(text));
  const loadMs = now() - t;

  // edit: 1000 blocks in one command + re-mesh only the touched chunks
  w.dirty.clear();
  const ops = Array.from({ length: 1000 }, (_, i) => ({ op: "set", at: [(i % 40) - 20, 200 + Math.floor(i / 400), Math.floor(i / 40) % 10], material: "brick" }));
  t = now();
  e.run("editBlocks", { ops });
  const editCmdMs = now() - t;
  t = now();
  const dirty = [...w.dirty];
  const pal2 = buildPalette(e.project); // the renderer rebuilds the palette every frame too
  for (const k of dirty) { const [cx, cy, cz] = k.split(",").map(Number); meshChunk(w, cx, cy, cz, pal2); }
  const editMeshMs = now() - t;
  t = now();
  e.run("undo");
  const undoMs = now() - t;

  const r = {
    scene: scene.id, blocks: w.blockCount, chunks: w.chunks.size,
    buildMs: Math.round(buildMs), meshAllMs: Math.round(meshMs), meshPerChunkMs: +(meshMs / w.chunks.size).toFixed(2),
    cubeQuads: quads, cubeTriangles: quads * 2, instances, instanceGroups: groups, visibleBlocks: visible,
    fileBytes: text.length, saveMs: Math.round(saveMs), loadMs: Math.round(loadMs),
    edit1000: { commandMs: +editCmdMs.toFixed(1), remeshChunks: dirty.length, remeshMs: +editMeshMs.toFixed(1), undoMs: +undoMs.toFixed(1) },
  };
  console.log(JSON.stringify(r));
  results.push(r);
}

const env = { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()}`, date: new Date().toISOString() };
fs.mkdirSync("bench/results", { recursive: true });
const file = `bench/results/engine-${env.date.slice(0, 10)}.json`;
fs.writeFileSync(file, JSON.stringify({ kind: "engine (CPU, Node)", env, results }, null, 2));
console.log("wrote", file);
