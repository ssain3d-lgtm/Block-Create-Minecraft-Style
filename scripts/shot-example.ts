// Render one studio example to PNG files: npx tsx scripts/shot-example.ts <exampleIndex> <outDir> [views...]
import fs from "node:fs";
import path from "node:path";
import { openStudio, waitMeshed } from "./browser";

const [idx = "0", out = "out/shots", ...views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const s = await openStudio();
try {
  await s.page.evaluate((i) => {
    const st = (window as any).studio;
    (window as any).confirm = () => true;
    const sel = document.getElementById("examples") as HTMLSelectElement;
    sel.value = String(i);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return st.engine.project.world.blockCount;
  }, Number(idx));
  await waitMeshed(s.page, 600000);
  for (const v of views.length ? views : ["all"]) {
    await s.page.evaluate((view) => (window as any).studio.viewport.view(view, false), v);
    await s.page.waitForTimeout(400);
    await s.page.screenshot({ path: path.join(out, `ex${idx}-${v}.png`) });
  }
  const info = await s.page.evaluate(() => {
    const st = (window as any).studio;
    return { blocks: st.engine.project.world.blockCount, ...st.viewport.chunks.stats(), out: document.getElementById("out")?.textContent?.slice(0, 300) };
  });
  console.log(JSON.stringify(info));
} finally {
  await s.close();
}
