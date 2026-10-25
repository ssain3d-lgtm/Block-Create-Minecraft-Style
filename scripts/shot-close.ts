// Close-up of an example: npx tsx scripts/shot-close.ts <exampleIndex> <out.png> <minX,minY,minZ> <maxX,maxY,maxZ> <dirX,dirY,dirZ>
import { openStudio, waitMeshed } from "./browser";
const [idx, out, a, b, d] = process.argv.slice(2);
const v3 = (s: string) => s.split(",").map(Number);
const s = await openStudio();
try {
  await s.page.evaluate((i) => { (window as any).confirm = () => true; const sel = document.getElementById("examples") as HTMLSelectElement; sel.value = String(i); sel.dispatchEvent(new Event("change", { bubbles: true })); }, Number(idx));
  await waitMeshed(s.page, 600000);
  await s.page.evaluate(([a, b, d]) => { const v = (window as any).studio.viewport; v.focusBox(a, b, new (v.camera.position.constructor)(...d), false); }, [v3(a), v3(b), v3(d)]);
  await s.page.waitForTimeout(400);
  await s.page.locator("#view").screenshot({ path: out });
} finally { await s.close(); }
