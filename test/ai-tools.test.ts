import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine";
import { exportGLB } from "../src/export/glb";
import { toRequests } from "../src/cli/input";
import { housePlan } from "../examples/plans";

function house() {
  const e = new Engine();
  for (const r of toRequests(housePlan())) e.execute(r);
  return e;
}

describe("inspection", () => {
  it("finds floating blocks and gives a fix hint", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [4, 0, 4], material: "stone", structure: { name: "ground", type: "terrain" } });
    e.run("fillRegion", { from: [0, 6, 0], to: [1, 6, 1], material: "brick", structure: { name: "cloud", type: "custom" } });
    const r = e.run("inspectProject", {});
    const f = r.issues.find((i: { code: string }) => i.code === "FLOATING");
    expect(f).toBeDefined();
    expect(f.structureId).toBe("s-2");
    expect(f.fixHint.cmd).toBe("createPillar");
    expect(r.ok).toBe(true); // 4 blocks -> warning, not error
  });

  it("reports cells a structure lost to a later one, and empty structures", () => {
    const e = house();
    e.run("fillRegion", { from: [-2, 2, -2], to: [20, 6, 13], material: "glass", structure: { name: "glass box", type: "custom" } });
    e.run("removeRegion", { from: [0, 0, 0], to: [30, 30, 30], structure: "chimney" });
    const r = e.run("inspectProject", {});
    const walls = r.issues.find((i: { code: string; structureId: string }) => i.code === "MISSING_CELLS" && i.structureId === e.project.structure("walls1")!.id);
    expect(walls.severity).toBe("error");
    expect(walls.message).toContain("s-13");
    expect(r.issues.some((i: { code: string }) => i.code === "EMPTY_STRUCTURE")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("measures mirror symmetry", () => {
    const e = new Engine();
    e.run("createTower", { center: [0, 0, 0], height: 30, baseSize: 15, topSize: 5, style: "lattice", material: "iron_mid" });
    expect(e.run("inspectProject", { symmetry: { axis: "x", center: 0 } }).symmetry.score).toBe(1);
    e.run("fillRegion", { from: [3, 0, 10], to: [3, 5, 10], material: "stone" });
    expect(e.run("inspectProject", { symmetry: { axis: "x", center: 0 } }).symmetry.score).toBeLessThan(1);
  });
});

describe("outputs", () => {
  it("exports a valid GLB", () => {
    const e = house();
    const { bytes, triangles } = exportGLB(e.project);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(bytes.length);
    const jsonLen = dv.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.meshes[0].primitives.length).toBeGreaterThan(0);
    expect(triangles).toBeGreaterThan(1000);
    const roofOnly = exportGLB(e.project, { structures: [e.project.structure("roof")!.num] });
    expect(roofOnly.triangles).toBeLessThan(triangles);
  });

  it("guide lists every command with an example", () => {
    const e = new Engine();
    const g = e.run("getGuide").guide as string;
    for (const c of e.commandList()) expect(g, c.name).toContain(`**${c.name}**`);
    expect(g).toContain("BuildingPlan");
  });

  it("every command has a valid example (schema accepts it)", () => {
    const e = new Engine();
    for (const c of e.commands.values()) {
      const r = c.schema.safeParse(c.example);
      expect(r.success, `${c.name}: ${r.success ? "" : r.error.issues[0].message}`).toBe(true);
    }
  });
});
