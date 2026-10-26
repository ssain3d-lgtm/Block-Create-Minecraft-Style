// Benchmark scenes shared by the Node and browser benchmarks.
import type { Engine } from "../src/engine/engine";
import { toRequests } from "../src/cli/input";
import { eiffelPlan } from "../examples/plans";

export interface Scene {
  id: string;
  label: string;
  build(e: Engine): void;
}

/**
 * Synthetic city block field: ~70% cubes (walls, floors) and ~30% other shapes
 * (stairs, slabs, wedges, pillars, trusses, panes), deterministic.
 */
function synthetic(target: number) {
  return (e: Engine) => {
    e.run("newProject", { name: `synthetic ${target}`, cellSize: 1, bounds: { min: [-1024, -64, -1024], max: [1023, 1023, 1023] } });
    const side = Math.ceil(Math.sqrt(target / 60));
    const others = ["slab", "stair", "wedge", "pillar", "truss", "pane", "beam", "fence"];
    const mats = ["stone", "brick", "concrete", "wood_oak", "iron_lower", "plaster", "glass", "roof_tile"];
    const cmds: { cmd: string; args: unknown }[] = [];
    let placed = 0;
    let i = 0;
    for (let gx = 0; gx < side && placed < target; gx++)
      for (let gz = 0; gz < side && placed < target; gz++) {
        // one 6x10x6 hollow tower per grid cell (~60% of a full block)
        const x = gx * 8 - side * 4, z = gz * 8 - side * 4;
        const h = 6 + ((gx * 7 + gz * 13) % 9);
        const kind = (gx + gz * 3) % 10;
        if (kind < 7) {
          cmds.push({ cmd: "fillRegion", args: { from: [x, 0, z], to: [x + 5, h, z + 5], material: mats[i++ % mats.length], hollow: true } });
          placed += 6 * 6 * (h + 1) - 4 * 4 * (h - 1);
        } else {
          const shape = others[i++ % others.length];
          cmds.push({ cmd: "fillRegion", args: { from: [x, 0, z], to: [x + 5, h, z + 5], material: mats[i % mats.length], shape, hollow: true, facing: ["north", "east", "south", "west"][i % 4] } });
          placed += 6 * 6 * (h + 1) - 4 * 4 * (h - 1);
        }
      }
    e.run("runBatch", { commands: cmds });
  };
}

export const SCENES: Scene[] = [
  { id: "synthetic-100k", label: "합성 10만 블록 (큐브 70% + 기타 형상 30%)", build: synthetic(100_000) },
  { id: "synthetic-300k", label: "합성 30만 블록", build: synthetic(300_000) },
  {
    id: "eiffel", label: "에펠탑 예제",
    build: (e) => { for (const r of toRequests(eiffelPlan())) { const res = e.execute(r); if (!res.ok) throw new Error(res.error.message); } },
  },
];
