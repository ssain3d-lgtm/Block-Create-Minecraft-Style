// Smoke test of the studio UI in a real browser:
//   load -> demo scene renders -> add/remove blocks by clicking -> undo -> reload restores autosave
// Usage: npx tsx scripts/check-studio.ts [outDir]
import fs from "node:fs";
import path from "node:path";
import { openStudio, waitMeshed } from "./browser";

const out = process.argv[2] ?? "out/check";
fs.mkdirSync(out, { recursive: true });

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok  ", msg);
}

const s = await openStudio();
const { page } = s;
try {
  await waitMeshed(page);
  await page.waitForTimeout(800);
  const blocks = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  assert(blocks > 500, `demo scene has blocks (${blocks})`);
  const stats = await page.evaluate(() => (window as any).studio.viewport.chunks.stats());
  assert(stats.visible > 0 && stats.meshes > 0, `renderer built meshes (${JSON.stringify(stats)})`);
  await page.screenshot({ path: path.join(out, "01-demo.png") });

  // camera presets
  for (const v of ["main", "front", "top"]) {
    await page.click(`[data-view=${v}]`);
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(out, "02-top.png") });
  await page.click(`[data-view=all]`);
  await page.waitForTimeout(800);

  // add mode: click the centre of the viewport
  await page.click(`[data-mode=add]`);
  await page.click(`[data-shape="builtin.stair"]`);
  const box = (await page.locator("#view canvas").boundingBox())!;
  const before = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  assert(after === before + 1, `click in add mode placed a block (${before} -> ${after})`);

  // undo with keyboard
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  const undone = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  assert(undone === before, `Ctrl+Z undid it (${undone})`);

  // remove mode
  await page.click(`[data-mode=remove]`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const removed = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  assert(removed === before - 1, `click in remove mode removed a block (${removed})`);

  // ambience presets
  await page.click(`[data-amb=dusk]`);
  await waitMeshed(page);
  await page.screenshot({ path: path.join(out, "03-dusk.png") });
  await page.click(`[data-amb=moon]`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "04-moon.png") });
  await page.click(`[data-amb=day]`);

  // AI command panel
  await page.fill("#cmd", JSON.stringify({ cmd: "fillRegion", args: { from: [12, 1, -4], to: [14, 6, -2], material: "brick", structure: { name: "벽돌 기둥", type: "pillar" } } }));
  await page.click("#run");
  await page.waitForTimeout(200);
  const out1 = await page.textContent("#out");
  assert(out1?.includes("+54 blocks"), `AI command panel ran a command (${out1?.slice(0, 60)})`);

  // language switch (Korean <-> English), remembered after reload
  const label1 = await page.textContent("[data-view=all]");
  await page.click("[data-act=lang]");
  await page.waitForTimeout(200);
  const label2 = await page.textContent("[data-view=all]");
  const english = label2 === "All" ? true : label1 === "All" ? false : null;
  assert(label1 !== label2 && english !== null, `language toggle switches the UI (${label1} -> ${label2})`);
  if (english === false) { await page.click("[data-act=lang]"); await page.waitForTimeout(200); }
  // now English
  assert((await page.textContent("#app-name")) === "Small World Atelier", "English header");
  await page.screenshot({ path: path.join(out, "06-english.png") });

  // autosave + reload restores
  await page.waitForTimeout(1800);
  const hash = await page.evaluate(() => (window as any).studio.engine.project.world.hash());
  await page.reload();
  await page.waitForFunction(() => (window as any).studio?.engine?.project.world.blockCount > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const hash2 = await page.evaluate(() => (window as any).studio.engine.project.world.hash());
  assert(hash === hash2, `reload restored the autosave (${hash2})`);
  assert((await page.textContent("[data-view=all]")) === "All", "the language choice is remembered after reload");
  await waitMeshed(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "05-restored.png") });
} finally {
  await s.close();
}
