import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNodeEngine } from "../src/node/host";
import { Engine } from "../src/engine";
import { autoSolidFaces } from "../src/engine/commands/assets";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vox-assets-"));

describe("asset factory", () => {
  it("AI flow: search -> create slope -> register -> build -> reuse in another project -> modify", () => {
    const dir = tmp();
    const lib = path.join(dir, "library");
    const a = createNodeEngine({ baseDir: dir, libraryDir: lib });

    // 1-2. nothing suitable yet
    expect(a.run("searchAssets", { text: "gentle_slope", kind: "shape" }).count).toBe(0);

    // 3-5. new parametric slope shape + material, registered in the library
    const shape = a.run("createShape", {
      id: "gentle_slope", name: "완경사", tags: ["roof", "slope"],
      recipe: { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [1, 0.25], [0, 0.75]] },
    });
    expect(shape.id).toBe("ai.gentle_slope");
    expect(shape.triangles).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(lib, "shapes", "ai.gentle_slope.json"))).toBe(true);
    a.run("createMaterial", { id: "ai.kawara_gray", name: "회색 기와", kind: "tile", color: "#4f5866" });

    // 6. use it
    a.run("fillRegion", { from: [0, 0, 0], to: [5, 0, 0], shape: "ai.gentle_slope", material: "ai.kawara_gray", facing: "south", structure: { name: "roof row", type: "roof" } });
    expect(a.project.blockAt(2, 0, 0)?.shape).toBe("ai.gentle_slope");
    a.run("saveProject", { path: "a.vox.json" });

    // 7. a different project (new engine, same library) finds and reuses it
    const b = createNodeEngine({ baseDir: dir, libraryDir: lib });
    const found = b.run("searchAssets", { tags: ["slope"], kind: "shape" });
    expect(found.results.map((r: { id: string }) => r.id)).toContain("ai.gentle_slope");
    b.run("fillRegion", { from: [0, 0, 0], to: [0, 0, 3], shape: "ai.gentle_slope", material: "ai.kawara_gray" });
    expect(b.project.meta.assets.shapes.map((s) => s.id)).toEqual(["ai.gentle_slope"]); // copied into the project

    // modify in project B (v2), project A's saved copy stays v1 and still loads without the library
    const v2 = b.run("createShape", { id: "ai.gentle_slope", name: "완경사 v2", recipe: { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [0, 0.5]] }, tags: ["roof", "slope"] });
    expect(v2.version).toBe(2);
    fs.rmSync(lib, { recursive: true });
    const c = createNodeEngine({ baseDir: dir, libraryDir: lib });
    c.run("loadProject", { path: "a.vox.json" });
    expect(c.project.meta.assets.shapes[0].version).toBe(1);
    expect(c.run("verifyReplay").match).toBe(true);
  });

  it("rejects broken shapes with a hint", () => {
    const e = new Engine();
    const r = e.execute({ cmd: "createShape", args: { id: "bad", name: "bad", recipe: { type: "box", min: [0, 0, 0], max: [2, 1, 1] } } });
    expect(r.ok).toBe(false);
    const r2 = e.execute({ cmd: "createShape", args: { id: "builtin.cube", name: "x", recipe: { type: "box", min: [0, 0, 0], max: [1, 1, 1] } } });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("READ_ONLY");
  });

  it("auto-detects solid faces", () => {
    expect(autoSolidFaces({ type: "box", min: [0, 0, 0], max: [1, 0.5, 1] })).toEqual(["-y"]);
    expect(autoSolidFaces({ type: "box", min: [0, 0, 0], max: [1, 1, 1] }).length).toBe(6);
  });

  it("captures and places rotated, repeated components", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [1, 2, 0], material: "glass", shape: "pane" });
    e.run("editBlocks", { ops: [{ op: "set", at: [0, 0, 0], material: "wood_dark", shape: "stair", facing: "north" }] });
    const c = e.run("createComponent", { id: "win", name: "창", from: [0, 0, 0], to: [1, 2, 0], register: false });
    expect(c.blocks).toBe(6);
    const placed = e.run("placeComponent", { id: "ai.win", at: [10, 0, 10], facing: "east", repeat: { count: [1, 1, 3], step: [0, 0, 3] }, structure: { name: "windows", type: "window" } });
    expect(placed.blocksAdded).toBe(18);
    // rotated east: the component's x run (width 2) becomes a z run
    expect(e.project.blockAt(10, 0, 10)?.shape).toBe("builtin.stair");
    expect(e.project.blockAt(10, 0, 11)?.shape).toBe("builtin.pane");
    expect(e.project.world.get(10, 0, 10)!.rot & 3).toBe(1); // stair turned east
  });
});
