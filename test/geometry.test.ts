import { describe, it, expect } from "vitest";
import { BUILTIN_SHAPES } from "../src/engine/assets/builtin";
import { buildGeometry, validateGeometry } from "../src/engine/geometry/recipes";
import { triangulate } from "../src/engine/geometry/triangulate";
import { solidMask, rotMatrix, applyM3 } from "../src/render/orient";
import { Engine } from "../src/engine";
import { meshChunk } from "../src/render/mesher";
import { buildPalette } from "../src/render/palette";

describe("geometry recipes", () => {
  it("every builtin shape builds valid geometry inside the unit cell", () => {
    for (const s of BUILTIN_SHAPES) {
      const g = buildGeometry(s.recipe);
      expect(validateGeometry(g), s.id).toEqual([]);
      expect(g.triangles, s.id).toBeGreaterThan(0);
    }
  });

  it("convex shapes have outward-facing triangles", () => {
    for (const id of ["builtin.cube", "builtin.slab", "builtin.wedge", "builtin.pillar", "builtin.beam"]) {
      const def = BUILTIN_SHAPES.find((s) => s.id === id)!;
      const g = buildGeometry(def.recipe);
      const [x0, y0, z0, x1, y1, z1] = g.bounds;
      const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      for (let t = 0; t < g.triangles; t++) {
        const i = t * 9;
        const cx = (g.positions[i] + g.positions[i + 3] + g.positions[i + 6]) / 3 - c[0];
        const cy = (g.positions[i + 1] + g.positions[i + 4] + g.positions[i + 7]) / 3 - c[1];
        const cz = (g.positions[i + 2] + g.positions[i + 5] + g.positions[i + 8]) / 3 - c[2];
        const dot = cx * g.normals[i] + cy * g.normals[i + 1] + cz * g.normals[i + 2];
        expect(dot, `${id} tri ${t}`).toBeGreaterThan(-1e-9);
      }
    }
    // the wedge slope (through the centre) must face up and toward +z (tall side is north/-z)
    const w = buildGeometry(BUILTIN_SHAPES.find((s) => s.id === "builtin.wedge")!.recipe);
    let slope = 0;
    for (let t = 0; t < w.triangles; t++) {
      const ny = w.normals[t * 9 + 1], nz = w.normals[t * 9 + 2];
      if (Math.abs(ny) > 0.1 && Math.abs(nz) > 0.1) { slope++; expect(ny).toBeGreaterThan(0); expect(nz).toBeGreaterThan(0); }
    }
    expect(slope).toBe(2);
  });

  it("triangulates a concave stair profile", () => {
    const tris = triangulate([[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]]);
    expect(tris.length).toBe(4);
  });
});

describe("orientation", () => {
  it("facing east turns the north side to +x", () => {
    expect(applyM3(rotMatrix(1), 0, 0, -1).map(Math.round)).toEqual([1, 0, 0]);
    expect(applyM3(rotMatrix(2), 0, 0, -1).map(Math.round)).toEqual([0, 0, 1]);
  });
  it("rotates solid faces", () => {
    // stair: solid -y and -z (north). facing east -> -y and +x ; upside down north -> +y and -z
    expect(solidMask(["-y", "-z"], 1)).toBe((1 << 3) | (1 << 0));
    expect(solidMask(["-y", "-z"], 4)).toBe((1 << 2) | (1 << 5));
  });
});

describe("mesher", () => {
  it("culls faces between neighbouring cubes and skips enclosed instances", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [2, 2, 2], material: "stone" });
    const pal = buildPalette(e.project);
    const d = meshChunk(e.project.world, 0, 0, 0, pal);
    // a 3x3x3 solid cube shows only its 6 outer 3x3 faces = 54 quads
    expect(d.buckets[0]!.indices.length / 6).toBe(54);
    expect(d.visible).toBe(26); // the centre block is hidden
    e.run("editBlocks", { ops: [{ op: "set", at: [1, 1, 1], material: "stone", shape: "truss" }] });
    const d2 = meshChunk(e.project.world, 0, 0, 0, buildPalette(e.project));
    expect(d2.instances.length).toBe(0); // enclosed truss is not drawn
  });

  it("does not cull faces behind glass", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [0, 0, 0], material: "stone" });
    e.run("fillRegion", { from: [1, 0, 0], to: [1, 0, 0], material: "glass" });
    const d = meshChunk(e.project.world, 0, 0, 0, buildPalette(e.project));
    expect(d.buckets[0]!.indices.length / 6).toBe(6); // stone keeps its face toward the glass
    expect(d.buckets[1]!.indices.length / 6).toBe(5); // glass hides the face toward opaque stone
  });
});
