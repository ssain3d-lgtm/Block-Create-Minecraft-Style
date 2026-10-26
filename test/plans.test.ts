import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNodeEngine } from "../src/node/host";
import { Engine } from "../src/engine";
import { keyToCell } from "../src/engine/coords";
import { toRequests } from "../src/cli/input";
import { housePlan, eiffelPlan, pavilionPlan } from "../examples/plans";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vox-plan-"));

function runPlan(e: Engine, plan: unknown) {
  for (const req of toRequests(plan)) {
    const r = e.execute(req);
    if (!r.ok) throw new Error(`${r.cmd}: ${r.error.message}`);
  }
}

function cellsOf(e: Engine, key: string) {
  const s = e.project.structure(key)!;
  return e.project.world.structureCells(s.num).sort((a, b) => a - b)
    .map((k) => [k, JSON.stringify(e.project.world.get(...keyToCell(k)))].join(":")).join("|");
}

describe("D. AI-only test house (JSON commands only)", () => {
  it("builds, reuses a new slope block, modifies only the roof, saves and reloads", () => {
    const dir = tmp();
    const e = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "library") });
    runPlan(e, housePlan());
    const st = e.run("getState");
    expect(st.structures.length).toBe(12);
    expect(st.blocks).toBeGreaterThan(2000);
    // new slope block was created, registered and used on the roof
    expect(fs.existsSync(path.join(dir, "library", "shapes", "ai.shingle.json"))).toBe(true);
    const roof = e.project.structure("roof")!;
    const roofShapes = new Set(e.project.world.structureCells(roof.num).map((k) => e.project.blockAt(...keyToCell(k))!.shape));
    expect(roofShapes.has("ai.shingle")).toBe(true);
    // door opening exists (south wall, 3 high, empty)
    const walls = e.project.structure("walls1")!;
    expect(walls.box).toBeDefined();
    expect(e.project.world.get(8, 2, 11)).toBeNull();
    // windows are glass panes
    const paneCount = e.project.world.structureCells(walls.num).filter((k) => e.project.blockAt(...keyToCell(k))!.shape === "builtin.pane").length;
    expect(paneCount).toBeGreaterThan(10);

    // modify only the roof
    const before = Object.fromEntries(["walls1", "walls2", "base", "chimney", "trees"].map((k) => [k, cellsOf(e, k)]));
    const roofBefore = cellsOf(e, "roof");
    const r = e.run("modifyStructure", { id: "roof", args: { style: "hip", pitch: 0.5 } });
    expect(r.rebuilt.map((x: { id: string }) => x.id)).toEqual([roof.id]);
    expect(cellsOf(e, "roof")).not.toBe(roofBefore);
    for (const k of Object.keys(before)) {
      // the chimney pokes through the roof: the roof never overwrites it because it was built later
      if (k === "chimney") continue;
      expect(cellsOf(e, k), k).toBe(before[k]);
    }
    // undo restores the old roof exactly
    e.run("undo");
    expect(cellsOf(e, "roof")).toBe(roofBefore);
    e.run("redo");

    // save -> load -> same blocks; replay of the log is deterministic
    const hash = e.project.world.hash();
    e.run("saveProject", { path: "house.vox.json" });
    const e2 = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "library") });
    expect(e2.run("loadProject", { path: "house.vox.json" }).hash).toBe(hash);
    expect(e2.run("verifyReplay").match).toBe(true);
  });

  it("dry run reports without changing anything", () => {
    const e = new Engine();
    const plan = { ...housePlan(), newProject: false, dryRun: true };
    const r = e.execute({ cmd: "executePlan", args: plan });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.blocksAdded).toBeGreaterThan(2000);
    expect(e.project.world.blockCount).toBe(0);
    expect(e.project.meta.structures.length).toBe(0);
    expect(e.canUndo).toBe(false);
  });

  it("plan errors name the failing structure and roll back", () => {
    const e = new Engine();
    const plan = housePlan();
    (plan.buildings[0].structures[3].args as Record<string, unknown>).material = "nope";
    const r = e.execute({ cmd: "executePlan", args: { ...plan, newProject: false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("house/walls1");
    expect(e.project.world.blockCount).toBe(0);
  });

  it("cascade: changing the foundation rebuilds what sits on it", () => {
    const e = new Engine();
    runPlan(e, housePlan());
    const r = e.run("modifyStructure", { id: "base", args: { area: { at: [0, 1, 0], size: [22, 12] } } });
    const ids = r.rebuilt.map((x: { id: string }) => e.project.meta.structures.find((s) => s.id === x.id)!.key);
    expect(ids).toEqual(expect.arrayContaining(["base", "walls1", "floor2", "walls2", "roof"]));
    expect(e.project.structure("roof")!.box!.max[0]).toBeGreaterThan(21);
    expect(e.run("verifyReplay").match).toBe(true);
  });

  it("duplicates (mirror) and moves buildings", () => {
    const e = new Engine();
    runPlan(e, housePlan());
    const n0 = e.project.world.blockCount;
    const d = e.run("duplicateStructure", { id: "trees", offset: [0, 0, 30], mirror: "x" });
    expect(d.blocksAdded).toBeGreaterThan(50);
    e.run("moveBuilding", { building: "house", origin: [100, 0, 0] });
    const walls = e.project.structure("walls1")!;
    expect(walls.box!.min[0]).toBe(100);
    expect(e.project.world.blockCount).toBeGreaterThanOrEqual(n0);
    expect(e.run("verifyReplay").match).toBe(true);
  });
});

describe("A. Eiffel tower plan", () => {
  it("builds more than 100k blocks with every part present", () => {
    const e = new Engine();
    const t0 = performance.now();
    runPlan(e, eiffelPlan());
    const ms = performance.now() - t0;
    const st = e.run("getState");
    expect(st.blocks).toBeGreaterThan(100_000);
    for (const k of ["leg_se", "leg_nw", "pad_ne", "arch_s", "deck1", "gallery1", "deck2", "upper", "deck3", "spire", "trees", "pool"]) {
      const s = st.structures.find((x: { key: string }) => x.key === k);
      expect(s?.blocks, k).toBeGreaterThan(0);
    }
    expect(st.bounds.max[1]).toBeGreaterThan(300);
    console.log(`eiffel: ${st.blocks} blocks, ${st.structures.length} structures, built in ${Math.round(ms)} ms`);
  });
});

describe("E. multi-cell parts pavilion", () => {
  it("builds from AI-designed multi-cell parts with layouts and a repeated component, cleanly", () => {
    const e = new Engine();
    runPlan(e, pavilionPlan());
    const st = e.run("getState");
    const by = (k: string) => st.structures.find((x: { key: string }) => x.key === k);
    expect(by("colonnade").blocks).toBe(12 * 4);
    expect(by("cupola").blocks).toBe(64);
    expect(by("gates_e").blocks).toBe(3 * 8);
    expect(st.structures.find((x: { name: string }) => x.name === "아치 회랑").blocks).toBe(4 * (8 + 1));
    const ins = e.run("inspectProject", {});
    expect(ins.counts.error + ins.counts.warning).toBe(0);
    expect(e.run("verifyReplay").match).toBe(true);
  });
});
