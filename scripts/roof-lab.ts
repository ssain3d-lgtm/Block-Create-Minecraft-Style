// Roof QA lab: builds a row of roofs (pitches / styles / a T-junction) and renders close-ups.
//   npx tsx scripts/roof-lab.ts <outDir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createNodeEngine } from "../src/node/host";
import { startServer } from "../src/server/server";
import { waitMeshed } from "./browser";

const [outDir = "out/roof-lab"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vox-roof-"));

const e = createNodeEngine({ baseDir: tmp });
const run = (cmd: string, args: Record<string, unknown>) => {
  const r = e.execute({ cmd, args });
  if (!r.ok) throw new Error(`${cmd}: ${JSON.stringify(r.error)}`);
  return r;
};
run("fillRegion", { from: [-10, -1, -10], to: [230, -1, 70], material: "grass" });
const cases: [string, number, Record<string, unknown>][] = [
  ["hip055", 0, { style: "hip", pitch: 0.55 }],
  ["hip08", 40, { style: "hip", pitch: 0.8 }],
  ["hip1", 80, { style: "hip", pitch: 1 }],
  ["gable07", 120, { style: "gable", pitch: 0.7 }],
  ["hip15", 160, { style: "hip", pitch: 1.5 }],
];
for (const [key, x, roof] of cases) {
  run("createWall", { key: `w_${key}`, loop: { at: [x, 0, 0], size: [27, 15] }, height: 6, material: "stone_light" });
  run("createRoof", { key: `r_${key}`, area: { on: { ref: `w_${key}` } }, overhang: 2, solid: false, material: "roof_tile", ridgeMaterial: "brick", ...roof });
}
// T-junction like the palace: long block + perpendicular wing roofs overlapping
run("createWall", { key: "w_main", loop: { at: [0, 0, 30], size: [61, 15] }, height: 6, material: "stone_light" });
run("createWall", { key: "w_wing", loop: { at: [40, 0, 44], size: [15, 25] }, height: 6, material: "stone_light" });
run("createRoof", { key: "r_main", area: { on: { ref: "w_main" } }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile" });
run("createRoof", { key: "r_wing", area: { on: { ref: "w_wing" } }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile" });
// T-junction done right: the wing roof area runs into the main block up to its ridge, merge cuts it
run("createWall", { key: "w_main2", loop: { at: [100, 0, 30], size: [61, 15] }, height: 6, material: "stone_light" });
run("createWall", { key: "w_wing2", loop: { at: [140, 0, 44], size: [15, 25] }, height: 6, material: "stone_light" });
run("createRoof", { key: "r_main2", area: { on: { ref: "w_main2" } }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile", ridgeMaterial: "brick" });
run("createRoof", { key: "r_wing2", area: { at: [140, 6, 37], size: [15, 32] }, style: "hip", pitch: 0.6, overhang: 2, solid: false, material: "roof_tile", ridgeMaterial: "brick" });
const vox = path.join(tmp, "lab.vox.json");
run("saveProject", { path: vox });

const s = await startServer({ port: 0, projectPath: vox, log: () => {} });
const base = (s as any).baseUrl ?? (s as any).url;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (err) => console.error("[page error]", err.message));
await page.goto(`${base}/?headless=1`);
await page.waitForFunction(() => (window as any).studio?.engine, null, { timeout: 90000 });
await waitMeshed(page, 300000);
const shots: [string, number[], number[], number[]][] = [
  ...cases.map(([key, x]) => [key, [x - 3, 0, -3], [x + 29, 22, 17], [0.8, 0.7, 1]] as [string, number[], number[], number[]]),
  ["junction", [-3, 0, 27], [63, 18, 71], [1, 0.8, 1.2]],
  ["junction_top", [30, 4, 27], [63, 16, 60], [0.2, 1.4, 0.6]],
  ["junction_close", [34, 4, 38], [60, 14, 54], [1, 0.9, 1.3]],
  ["tjunction", [97, 0, 27], [163, 18, 71], [1, 0.8, 1.2]],
  ["tjunction_close", [134, 4, 36], [160, 14, 54], [1, 0.9, 1.3]],
  ["eave_under", [80, 0, -3], [108, 10, 4], [0.25, 0.12, -1]],
  ["gable_end", [118, 0, -3], [150, 14, 17], [1, 0.3, 0.15]],
];
for (const [name, a, b, cam] of shots) {
  await page.evaluate(([a, b, cam]) => {
    const v = (window as any).studio.viewport;
    v.focusBox(a, b, new (v.camera.position.constructor)(...cam), false);
  }, [a, b, cam]);
  await page.waitForTimeout(500);
  await page.locator("#view").screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("ok", name);
}
await browser.close();
await s.close();
process.exit(0);
