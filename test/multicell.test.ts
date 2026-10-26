// Multi-cell shapes (2x4x1, 4x4x4 ...): placement, collisions, rotation, removal, undo, save/load,
// replay, rendering data, components, duplication and generator integration.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine";
import { createNodeEngine } from "../src/node/host";
import { meshChunk } from "../src/render/mesher";
import { buildPalette } from "../src/render/palette";
import { instanceMatrix } from "../src/render/orient";
import { buildGeometry } from "../src/engine/geometry/recipes";

const ARCH = { // 2 wide, 4 tall, 1 deep: a doorway arch (profile in x,y, extruded along z)
  id: "ai.arch_2x4", name: "아치 2x4", size: [2, 4, 1], tags: ["arch", "door"],
  recipe: { type: "extrude", axis: "z", profile: [[0, 0], [0.3, 0], [0.3, 2.6], [0.6, 3.2], [1, 3.4], [1.4, 3.2], [1.7, 2.6], [1.7, 0], [2, 0], [2, 4], [0, 4]] },
};
const CUPOLA = { // 4x4x4 drum + dome
  id: "ai.cupola_4", name: "돔 4x4x4", size: [4, 4, 4], tags: ["dome", "roof"],
  recipe: { type: "lathe", segments: 16, profile: [[1.9, 0], [1.9, 1.6], [1.75, 1.6], [1.7, 2.4], [1.4, 3.1], [0.9, 3.6], [0.35, 3.9], [0, 4]] },
};

function eng() {
  const e = new Engine();
  e.run("createShape", ARCH);
  e.run("createShape", CUPOLA);
  return e;
}

const count = (e: Engine) => e.project.world.blockCount;

describe("multi-cell shapes", () => {
  it("creates shapes with a size and validates coordinates against it", () => {
    const e = eng();
    const info = e.run("getShapeInfo", { shape: "ai.arch_2x4" });
    expect(info.size).toEqual([2, 4, 1]);
    expect(info.footprint.east).toEqual([1, 4, 2]);
    const bad = e.execute({ cmd: "createShape", args: { ...ARCH, id: "ai.too_big", recipe: { type: "box", min: [0, 0, 0], max: [3, 1, 1] } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.hint).toContain("0..2");
    const g = buildGeometry(CUPOLA.recipe as never, [4, 4, 4]);
    expect(g.bounds[3]).toBeLessThanOrEqual(4.001);
    expect(g.bounds[4]).toBeCloseTo(4, 3);
  });

  it("places, fills the footprint, and removes the whole shape from any covered cell", () => {
    const e = eng();
    e.run("editBlocks", { ops: [{ op: "set", at: [10, 0, 10], shape: "ai.cupola_4", material: "stone_light" }] });
    expect(count(e)).toBe(64);
    const top = e.project.blockAt(13, 3, 13)!;
    expect(top.shape).toBe("ai.cupola_4");
    expect((top as { partOf?: number[] }).partOf).toEqual([10, 0, 10]);
    e.run("editBlocks", { ops: [{ op: "remove", at: [12, 2, 11] }] });
    expect(count(e)).toBe(0);
    e.run("undo");
    expect(count(e)).toBe(64);
    e.run("redo");
    expect(count(e)).toBe(0);
  });

  it("rotates the footprint (quarter turns swap width and depth)", () => {
    const e = eng();
    e.run("placeShape", { shape: "ai.arch_2x4", at: [0, 0, 0], facing: "east", material: "stone" });
    expect(e.project.world.get(0, 3, 1)).not.toBeNull(); // depth 2 along z
    expect(e.project.world.get(1, 0, 0)).toBeNull(); // width 1 along x
    // renderer transform keeps the rotated shape inside its footprint
    const m = new Float32Array(16);
    instanceMatrix(0, 0, 0, 1, m, 0, [2, 4, 1]);
    const g = buildGeometry(ARCH.recipe as never, [2, 4, 1]);
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      expect(wx).toBeGreaterThan(-1e-6); expect(wx).toBeLessThan(1 + 1e-6);
      expect(wz).toBeGreaterThan(-1e-6); expect(wz).toBeLessThan(2 + 1e-6);
    }
  });

  it("collision policies: replace removes what was there, skip and error leave it", () => {
    const e = eng();
    e.run("fillRegion", { from: [1, 0, 1], to: [1, 0, 1], material: "brick", structure: { name: "post", type: "x" } });
    const skip = e.run("placeShape", { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone", onCollision: "skip" });
    expect(skip.copies).toBe(0);
    expect(e.execute({ cmd: "placeShape", args: { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone", onCollision: "error" } }).ok).toBe(false);
    expect(e.project.blockAt(1, 0, 1)?.material).toBe("builtin.brick");
    e.run("placeShape", { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone" });
    expect(e.project.blockAt(1, 0, 1)?.shape).toBe("ai.cupola_4");
    // a shape that overlaps another multi-cell shape removes that whole shape (no orphan cells)
    e.run("placeShape", { shape: "ai.arch_2x4", at: [3, 0, 3], material: "brick" });
    const orphans: number[] = [];
    e.project.world.forEach((x, y, z, b) => { if (b.shape === e.project.occIdxIfAny() && !e.project.groupAt(x, y, z)) orphans.push(1); });
    expect(orphans.length).toBe(0);
    expect(e.project.blockAt(0, 0, 0)).toBeNull(); // the cupola was displaced as a whole
    expect(e.project.blockAt(3, 3, 3)?.shape).toBe("ai.arch_2x4");
  });

  it("skips a shape that would leave the project bounds", () => {
    const e = new Engine();
    e.run("newProject", { name: "b", bounds: { min: [0, 0, 0], max: [2, 2, 2] } });
    e.run("createShape", CUPOLA);
    const r = e.execute({ cmd: "editBlocks", args: { ops: [{ op: "set", at: [0, 0, 0], shape: "ai.cupola_4", material: "stone" }] } });
    expect(r.ok && r.warnings[0]).toContain("outside");
    expect(count(e)).toBe(0);
  });

  it("layouts: grid, line and ring", () => {
    const e = eng();
    const g = e.run("placeShape", { key: "arches", shape: "ai.arch_2x4", at: [0, 0, 0], material: "stone", layout: { type: "grid", count: [5, 1, 1] } });
    expect(g.copies).toBe(5);
    expect(count(e)).toBe(5 * 8);
    const ring = e.run("placeShape", { key: "ring", shape: "ai.arch_2x4", at: [0, 0, 30], material: "brick", layout: { type: "ring", radius: 9, count: 8, face: "out" } });
    expect(ring.copies).toBe(8);
    const line = e.run("placeShape", { key: "line", shape: "ai.cupola_4", at: [30, 0, 0], material: "brick", layout: { type: "line", to: [30, 0, 20], count: 5 } });
    expect(line.copies).toBe(5);
    // rebuild through modifyStructure (change count) keeps everything consistent
    e.run("modifyStructure", { id: "arches", args: { layout: { type: "grid", count: [3, 1, 1] } } });
    expect(e.project.world.structIndex.get(e.project.structure("arches")!.num)!.size).toBe(3 * 8);
    expect(e.run("verifyReplay").match).toBe(true);
  });

  it("fillRegion tiles a multi-cell shape by its footprint", () => {
    const e = eng();
    const r = e.run("fillRegion", { from: [0, 0, 0], to: [8, 3, 0], shape: "ai.arch_2x4", material: "stone" });
    expect(r.blocksAdded).toBe(4 * 8); // 4 copies fit in 9 cells, the last column stays empty
    expect(e.project.world.get(8, 0, 0)).toBeNull();
  });

  it("paints a whole shape from any of its cells", () => {
    const e = eng();
    e.run("placeShape", { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone" });
    e.run("replaceInRegion", { from: [2, 2, 2], to: [2, 2, 2], material: "brick" });
    let other = 0;
    e.project.world.forEach((_x, _y, _z, b) => { if (e.project.materialId(b.material) !== "builtin.brick") other++; });
    expect(other).toBe(0);
  });

  it("saves, loads and replays identically (file format v2, aux kept)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-mc-"));
    const e = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    e.run("createShape", ARCH);
    e.run("createShape", CUPOLA);
    e.run("placeShape", { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone", facing: "west", layout: { type: "grid", count: [3, 1, 2], step: [6, 0, 6] }, structure: undefined });
    e.run("placeShape", { shape: "ai.arch_2x4", at: [0, 0, 20], material: "brick", facing: "south" });
    const h = e.project.stateHash();
    e.run("saveProject", { path: "mc.vox.json" });
    const file = JSON.parse(fs.readFileSync(path.join(dir, "mc.vox.json"), "utf8"));
    expect(file.world.encoding).toBe("chunks-rle-b64-le-v2");
    const e2 = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib-empty") });
    e2.run("loadProject", { path: "mc.vox.json" });
    expect(e2.project.stateHash()).toBe(h);
    expect(e2.project.groupAt(9, 3, 3)!.cells.length).toBe(64);
    expect(e2.run("verifyReplay").match).toBe(true);
  });

  it("renders one instance per shape and nothing for covered cells", () => {
    const e = eng();
    e.run("placeShape", { shape: "ai.cupola_4", at: [0, 0, 0], material: "stone", layout: { type: "grid", count: [2, 1, 2] } });
    e.run("fillRegion", { from: [-3, 0, 0], to: [-1, 0, 0], material: "brick" });
    const pal = buildPalette(e.project);
    const d = meshChunk(e.project.world, 0, 0, 0, pal);
    const inst = d.instances.reduce((n, g) => n + g.count, 0);
    expect(inst).toBe(4);
    expect(d.total).toBe(4); // logical shapes, not the 256 covered cells
    // the brick row next to it still shows its face toward the cupolas (they never hide faces)
    const d2 = meshChunk(e.project.world, -1, 0, 0, pal);
    expect(d2.buckets[0]!.indices.length / 6).toBe(3 * 6 - 4);
  });

  it("components keep multi-cell shapes whole when captured, rotated and repeated", () => {
    const e = eng();
    e.run("placeShape", { shape: "ai.arch_2x4", at: [0, 0, 0], material: "stone" });
    e.run("fillRegion", { from: [2, 0, 0], to: [2, 3, 0], material: "brick" });
    const c = e.run("createComponent", { id: "bay", name: "아치 한 칸", from: [0, 0, 0], to: [2, 3, 0], register: false });
    expect(c.blocks).toBe(5); // 1 arch anchor + 4 bricks
    const p = e.run("placeComponent", { id: "ai.bay", at: [0, 0, 10], facing: "east", repeat: { count: [1, 1, 3], step: [0, 0, 3] }, structure: { name: "bays", type: "wall" } });
    expect(p.copies).toBe(3);
    const arches = new Set<string>();
    e.project.world.forEach((x, y, z, b) => {
      if (e.project.shapeId(b.shape) === "ai.arch_2x4" && z >= 10) arches.add([x, y, z].join());
    });
    expect(arches.size).toBe(3);
    expect(e.project.groupAt(0, 3, 11)?.block.shape).toBe(e.project.shapeIdx("ai.arch_2x4"));
  });

  it("duplicate with rotation re-anchors multi-cell shapes", () => {
    const e = eng();
    e.run("placeShape", { key: "a", shape: "ai.arch_2x4", at: [0, 0, 0], material: "stone" });
    const d = e.run("duplicateStructure", { id: "a", offset: [10, 0, 0], rotate: 1 });
    expect(d.blocksAdded).toBe(8);
    let n = 0;
    e.project.world.forEach((x) => { if (x >= 10) n++; });
    expect(n).toBe(8);
    expect(e.run("verifyReplay").match).toBe(true);
  });

  it("generators that fill cell by cell refuse multi-cell shapes with a hint", () => {
    const e = eng();
    const r = e.execute({ cmd: "createWall", args: { from: [0, 0, 0], to: [6, 0, 0], height: 4, material: "stone", shape: "ai.arch_2x4" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.hint).toContain("placeShape");
  });

  it("refuses to change the size of a shape that is already placed", () => {
    const e = eng();
    e.run("placeShape", { shape: "ai.arch_2x4", at: [0, 0, 0], material: "stone" });
    const r = e.execute({ cmd: "createShape", args: { ...ARCH, size: [2, 3, 1], recipe: { type: "box", min: [0, 0, 0], max: [2, 3, 1] } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SIZE_IN_USE");
    // same size, new recipe -> allowed (version 2)
    expect(e.run("createShape", { ...ARCH, recipe: { type: "box", min: [0, 0, 0], max: [2, 4, 0.5] } }).version).toBe(2);
  });

  it("stays fast with many parts (20k multi-cell shapes)", () => {
    const e = eng();
    e.run("createShape", { id: "ai.slab_2x1x2", name: "판 2x1x2", size: [2, 1, 2], recipe: { type: "box", min: [0, 0, 0], max: [2, 0.5, 2] } });
    const t0 = performance.now();
    e.run("placeShape", { shape: "ai.slab_2x1x2", at: [-140, 0, -140], material: "stone", layout: { type: "grid", count: [140, 1, 143] } });
    const placeMs = performance.now() - t0;
    expect(count(e)).toBe(140 * 143 * 4);
    const pal = buildPalette(e.project);
    const t1 = performance.now();
    let inst = 0;
    for (const c of e.project.world.chunks.values()) inst += meshChunk(e.project.world, c.cx, c.cy, c.cz, pal).instances.reduce((n, g) => n + g.count, 0);
    const meshMs = performance.now() - t1;
    expect(inst).toBe(140 * 143);
    console.log(`20,020 multi-cell parts: place ${Math.round(placeMs)} ms, mesh ${Math.round(meshMs)} ms`);
    expect(placeMs + meshMs).toBeLessThan(15000);
  });
});
