// Renders the showcase images in assets/showcase/ from the example plans (one browser session).
// Usage: npx tsx scripts/render-showcase.ts [outDir]
import fs from "node:fs";
import path from "node:path";
import { openStudio, waitMeshed } from "./browser";

const out = process.argv[2] ?? "assets/showcase";
fs.mkdirSync(out, { recursive: true });

type V3 = [number, number, number];
interface Shot { file: string; example: string; lang?: "ko" | "en"; full?: boolean; view?: string; box?: [V3, V3, V3]; ambience?: string }

// example keys = i18n keys in src/studio/examples.ts
const SHOTS: Shot[] = [
  { file: "eiffel-studio.png", example: "ex.A", full: true, view: "main", lang: "ko" },
  { file: "eiffel-studio-en.png", example: "ex.A", full: true, view: "all", lang: "en" },
  { file: "eiffel-dusk.png", example: "ex.A", view: "main", ambience: "dusk" },
  { file: "eiffel-legs.png", example: "ex.A", box: [[-60, 0, 20], [10, 70, 70], [0.9, 0.35, 1.2]] },
  { file: "castle.png", example: "ex.B", box: [[-12, 0, -12], [46, 40, 40], [1, 0.6, 1.3]] },
  { file: "modern-house.png", example: "ex.C", box: [[-14, 0, -6], [30, 14, 22], [0.8, 0.55, 1.2]] },
  { file: "ai-test-house.png", example: "ex.D", box: [[-6, 0, -6], [24, 20, 20], [0.9, 0.7, 1.2]] },
  { file: "pavilion-multicell.png", example: "ex.E", box: [[-9, 0, -6], [9, 13, 16], [0.7, 0.35, 1.2]] },
  { file: "pavilion-overview.png", example: "ex.E", box: [[-24, 0, -24], [24, 14, 24], [1, 0.55, 1.25]] },
];

const s = await openStudio({ width: 1440, height: 960 });
try {
  let loaded = "";
  for (const shot of SHOTS) {
    const want = shot.lang ?? "ko";
    const cur = await s.page.evaluate(() => document.documentElement.lang);
    if (cur !== want) { await s.page.click("[data-act=lang]"); await s.page.waitForTimeout(200); }
    if (loaded !== shot.example) {
      await s.page.evaluate(() => { (window as any).confirm = () => true; });
      // index in EXAMPLES (src/studio/examples.ts)
      const idx = { "ex.A": 0, "ex.B": 1, "ex.C": 2, "ex.D": 3, "ex.E": 4 }[shot.example]!;
      await s.page.evaluate((i) => {
        const sel = document.getElementById("examples") as HTMLSelectElement;
        sel.value = String(i);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, idx);
      await waitMeshed(s.page, 600000);
      loaded = shot.example;
    }
    await s.page.evaluate((amb) => { const b = document.querySelector<HTMLButtonElement>(`[data-amb=${amb}]`); b?.click(); }, shot.ambience ?? "day");
    if (shot.box) {
      await s.page.evaluate(([a, b, d]) => { const v = (window as any).studio.viewport; v.focusBox(a, b, new (v.camera.position.constructor)(...d), false); }, shot.box);
    } else {
      await s.page.evaluate((view) => (window as any).studio.viewport.view(view, false), shot.view ?? "all");
    }
    await waitMeshed(s.page);
    await s.page.waitForTimeout(500);
    const target = shot.full ? s.page : s.page.locator("#view");
    await target.screenshot({ path: path.join(out, shot.file) });
    console.log("wrote", path.join(out, shot.file));
  }
} finally {
  await s.close();
}
