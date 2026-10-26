import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine";
import { buildGeometry, validateGeometry } from "../src/engine/geometry/recipes";
import { roofPieceDef, roofPieceId, RoofPieceType } from "../src/engine/geometry/roofPiece";

/** signed volume of a triangle soup (positive when it is closed and faces outward) */
function meshVolume(p: Float32Array) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

describe("roof pieces", () => {
  it("are closed, outward-facing solids with the expected volume", () => {
    const cl = (v: number) => Math.min(1, Math.max(0, v));
    let checked = 0;
    for (const type of ["s", "o", "i"] as RoofPieceType[])
      for (let lo = -2; lo <= 1.25; lo += 0.375)
        for (let hi = lo; hi <= lo + 3; hi += 0.625)
          for (const t of [undefined, 1, 2]) {
            const id = roofPieceId(type, lo, hi, t);
            if (!id?.startsWith("builtin.roofp_")) continue;
            const def = roofPieceDef(id)!;
            expect(def, id).toBeTruthy();
            const g = buildGeometry(def.recipe);
            expect(validateGeometry(g), id).toEqual([]);
            const h = (x: number, z: number) => lo + (hi - lo) * (type === "s" ? 1 - z : type === "o" ? Math.min(x, 1 - z) : Math.max(x, 1 - z));
            let want = 0;
            const n = 100;
            for (let a = 0; a < n; a++)
              for (let b = 0; b < n; b++) {
                const hv = h((a + 0.5) / n, (b + 0.5) / n);
                want += cl(hv) - (t === undefined ? 0 : cl(hv - t));
              }
            want /= n * n;
            expect(meshVolume(g.positions), id).toBeCloseTo(want, 2);
            checked++;
          }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("placeShape line layout", () => {
  it("warns when the spacing is not a whole number (rows would drift)", () => {
    const e = new Engine();
    const bad = e.execute({ cmd: "placeShape", args: { shape: "pillar", material: "stone", at: [-30, 0, 0], layout: { type: "line", to: [31, 0, 0], count: 13 } } });
    expect(bad.ok && bad.warnings.some((w) => w.includes("not a whole number") && w.includes("x=30"))).toBe(true);
    const good = e.execute({ cmd: "placeShape", args: { shape: "pillar", material: "stone", at: [-30, 2, 0], layout: { type: "line", to: [30, 2, 0], count: 13 } } });
    expect(good.ok && good.warnings.some((w) => w.includes("not a whole number"))).toBe(false);
  });
});

describe("createRoof", () => {
  const roofColumns = (e: Engine, sid: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
    const s = e.project.meta.structures.find((x) => x.id === sid)!;
    let empty = 0;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        let hit = false;
        for (let y = y0; y <= y1 && !hit; y++) hit = e.project.world.get(x, y, z)?.structure === s.num;
        if (!hit) empty++;
      }
    return empty;
  };

  it("covers every column of a hip roof at an odd pitch and uses hip-corner pieces", () => {
    const e = new Engine();
    e.run("createWall", { key: "w", loop: { at: [0, 0, 0], size: [27, 15] }, height: 4, material: "stone" });
    const r = e.execute({ cmd: "createRoof", args: { key: "r", area: { on: { ref: "w" } }, style: "hip", pitch: 0.55, overhang: 2, solid: false, material: "roof_tile" } });
    expect(r.ok).toBe(true);
    const sid = (r as any).result.structureId;
    expect(roofColumns(e, sid, -2, 28, -2, 16, 4, 20)).toBe(0);
    expect(e.project.meta.palette.shapes.some((id) => id.startsWith("builtin.roofp_o_"))).toBe(true);
  });

  it("joins a wing roof into the main roof (covered columns + filled valleys)", () => {
    const e = new Engine();
    e.run("createWall", { key: "main", loop: { at: [0, 0, 0], size: [41, 15] }, height: 4, material: "stone" });
    e.run("createWall", { key: "wing", loop: { at: [13, 0, 14], size: [15, 21] }, height: 4, material: "stone" });
    e.run("createRoof", { key: "rm", area: { on: { ref: "main" } }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile" });
    const r = e.execute({ cmd: "createRoof", args: { key: "rw", area: { at: [13, 4, 7], size: [15, 28] }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile" } });
    expect(r.ok).toBe(true);
    const res = (r as any).result;
    expect(res.coveredColumns).toBeGreaterThan(0);
    expect(res.joinedColumns).toBeGreaterThan(0);
    // every column of the wing roof (outside the main block) is roofed by one of the two roofs
    const nums = new Set(e.project.meta.structures.filter((s) => s.type === "roof").map((s) => s.num));
    let empty = 0;
    for (let x = 11; x <= 29; x++)
      for (let z = 7; z <= 36; z++) {
        let hit = false;
        for (let y = 4; y <= 20 && !hit; y++) { const c = e.project.world.get(x, y, z); hit = !!c && nums.has(c.structure!); }
        if (!hit) empty++;
      }
    expect(empty).toBe(0);
  });
});
