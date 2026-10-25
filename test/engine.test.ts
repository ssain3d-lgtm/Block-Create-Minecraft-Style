import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/engine";
import { createNodeEngine } from "../src/node/host";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vox-"));
}

describe("world + commands", () => {
  it("fills, undoes and redoes", () => {
    const e = new Engine();
    const r = e.execute({ cmd: "fillRegion", args: { from: [0, 0, 0], to: [9, 2, 9], material: "stone" } });
    expect(r.ok).toBe(true);
    expect(e.project.world.blockCount).toBe(300);
    e.execute({ cmd: "removeRegion", args: { from: [0, 0, 0], to: [9, 0, 9] } });
    expect(e.project.world.blockCount).toBe(200);
    e.execute({ cmd: "undo" });
    expect(e.project.world.blockCount).toBe(300);
    e.execute({ cmd: "undo" });
    expect(e.project.world.blockCount).toBe(0);
    e.execute({ cmd: "redo" });
    expect(e.project.world.blockCount).toBe(300);
    expect(e.project.log.length).toBe(1);
  });

  it("hollow fill keeps only the shell", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [4, 4, 4], material: "brick", hollow: true });
    expect(e.project.world.blockCount).toBe(125 - 27);
  });

  it("returns validation errors with a hint instead of throwing", () => {
    const e = new Engine();
    const r = e.execute({ cmd: "fillRegion", args: { from: [0, 0], to: [1, 1, 1], material: "stone" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INVALID_ARGS");
      expect(r.error.path).toContain("from");
      expect(r.error.hint).toContain("example");
    }
    const u = e.execute({ cmd: "fillRegon", args: {} });
    expect(u.ok).toBe(false);
  });

  it("rolls back a failed batch completely", () => {
    const e = new Engine();
    const r = e.execute({
      cmd: "runBatch",
      args: { commands: [
        { cmd: "fillRegion", args: { from: [0, 0, 0], to: [3, 0, 3], material: "stone" } },
        { cmd: "fillRegion", args: { from: [0, 1, 0], to: [3, 1, 3], material: "unobtainium" } },
      ] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNKNOWN_MATERIAL");
    expect(e.project.world.blockCount).toBe(0);
    expect(e.project.meta.palette.materials).toEqual(["none"]);
    expect(e.canUndo).toBe(false);
  });

  it("skips blocks outside bounds with a warning", () => {
    const e = new Engine();
    e.run("newProject", { name: "t", bounds: { min: [0, 0, 0], max: [3, 3, 3] } });
    const r = e.execute({ cmd: "fillRegion", args: { from: [0, 0, 0], to: [5, 0, 0], material: "stone" } });
    expect(r.ok && r.warnings[0]).toContain("outside");
    expect(e.project.world.blockCount).toBe(4);
  });

  it("creates structures and deletes them", () => {
    const e = new Engine();
    const r = e.run("fillRegion", { from: [0, 0, 0], to: [2, 2, 2], material: "stone", structure: { name: "box", type: "custom" } });
    expect(r.structureId).toBe("s-1");
    const st = e.run("getState");
    expect(st.structures[0].blocks).toBe(27);
    expect(st.structures[0].box).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
    e.run("deleteStructure", { id: "s-1" });
    expect(e.project.world.blockCount).toBe(0);
    e.run("undo");
    expect(e.project.world.blockCount).toBe(27);
    expect(e.project.meta.structures.length).toBe(1);
  });

  it("records hand edits on rebuildable structures as overrides", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [2, 0, 0], material: "stone", structure: { name: "row", type: "wall" } });
    e.run("editBlocks", { ops: [{ op: "remove", at: [1, 0, 0] }] });
    expect(e.project.meta.structures[0].overrides).toEqual([{ op: "remove", at: [1, 0, 0] }]);
  });
});

describe("save / load / replay", () => {
  it("round-trips through a file with identical content", () => {
    const dir = tmpDir();
    const e = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    e.run("fillRegion", { from: [-20, 0, -20], to: [20, 3, 20], material: "stone", structure: { name: "base", type: "foundation" } });
    e.run("fillRegion", { from: [-3, 4, -3], to: [3, 30, 3], material: "iron_lower", shape: "truss", structure: { name: "tower", type: "tower" } });
    e.run("editBlocks", { ops: [{ op: "set", at: [0, 31, 0], material: "lamp", shape: "lamp_post" }] });
    const h = e.project.world.hash();
    const saved = e.run("saveProject", { path: "p.vox.json" });
    expect(saved.blocks).toBe(e.project.world.blockCount);

    const e2 = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    const loaded = e2.run("loadProject", { path: "p.vox.json" });
    expect(loaded.hash).toBe(h);
    expect(e2.project.meta.structures.map((s) => s.name)).toEqual(["base", "tower"]);
    expect(e2.project.blockAt(0, 31, 0)?.shape).toBe("builtin.lamp_post");

    // log-only file is rebuilt by replay
    e.run("saveProject", { path: "log-only.vox.json", withWorld: false });
    const e3 = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    const l3 = e3.run("loadProject", { path: "log-only.vox.json" });
    expect(l3.replayed).toBe(true);
    expect(l3.hash).toBe(h);
  });

  it("verifyReplay matches after undo/redo", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [5, 5, 5], material: "brick" });
    e.run("replaceInRegion", { from: [0, 0, 0], to: [5, 2, 5], material: "stone" });
    e.run("undo");
    e.run("removeRegion", { from: [0, 0, 0], to: [1, 1, 1] });
    expect(e.run("verifyReplay").match).toBe(true);
  });
});
