// End-to-end check of the AI side: HTTP API, live studio link, rendering, MCP (remote + embedded).
// Usage: npx tsx scripts/check-ai.ts [outDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer } from "../src/server/server";
import { housePlan } from "../examples/plans";

const out = process.argv[2] ?? "out/check-ai";
fs.mkdirSync(out, { recursive: true });
let failed = 0;
const ok = (c: unknown, m: string) => { if (c) console.log("ok  ", m); else { console.error("FAIL:", m); failed++; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vox-ai-"));
const post = async (base: string, body: unknown) => (await fetch(`${base}/api/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const srv = await startServer({ port: 0, projectPath: path.join(tmp, "current.vox.json"), log: () => {} });
const base = srv.url;
const exe = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  // ---- 1. studio tab links to the server
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(base);
  await page.waitForFunction(() => (window as any).studio?.engine, null, { timeout: 60000 });
  await sleep(1500);
  ok(srv.clients.size === 1, `studio tab connected (${srv.clients.size} client)`);
  const demoBlocks = await page.evaluate(() => (window as any).studio.engine.project.world.blockCount);
  ok(demoBlocks > 0 && srv.engine.project.world.blockCount === demoBlocks, `first-run demo built in the tab was mirrored to the server (${demoBlocks})`);

  // ---- 2. an AI agent builds through HTTP -> appears in the tab
  const r = await post(base, housePlan());
  ok(r.responses.every((x: any) => x.ok), `HTTP plan: ${r.responses.map((x: any) => x.summary ?? x.error?.message).join(" | ")}`);
  await page.waitForFunction((h) => (window as any).studio.engine.project.world.hash() === h, srv.engine.project.world.hash(), { timeout: 30000 });
  ok(true, "the open studio tab shows the AI's house (same world hash as the server)");

  // ---- 3. the person edits in the tab -> server follows
  const before = srv.engine.project.world.blockCount;
  await page.evaluate(() => (window as any).studio.exec({ cmd: "fillRegion", args: { from: [30, 1, 0], to: [32, 3, 2], material: "brick", structure: { name: "hand-made", type: "custom" } } }));
  await sleep(800);
  ok(srv.engine.project.world.blockCount === before + 27, `edit made in the tab reached the server (${before} -> ${srv.engine.project.world.blockCount})`);
  await page.evaluate(() => (window as any).studio.exec({ cmd: "undo" }));
  await sleep(600);
  ok(srv.engine.project.world.blockCount === before, "undo in the tab reached the server");

  // ---- 4. modify only the roof via HTTP while the tab watches
  const m = await post(base, { cmd: "modifyStructure", args: { id: "roof", args: { style: "hip" } } });
  ok(m.responses[0].ok, `modifyStructure over HTTP: ${m.responses[0].summary}`);
  await page.waitForFunction((h) => (window as any).studio.engine.project.world.hash() === h, srv.engine.project.world.hash(), { timeout: 30000 });

  // ---- 5. render through the studio tab
  const rr = await post(base, { cmd: "renderScene", args: { views: ["front", "iso", "top"], labels: true, width: 800, height: 600 } });
  const rs = rr.responses[0];
  ok(rs.ok && rs.result.viewer === "studio" && Object.keys(rs.result.files).length === 3, `renderScene via studio tab: ${rs.summary ?? rs.error?.message}`);
  if (rs.ok) for (const [v, f] of Object.entries(rs.result.files as Record<string, string>)) fs.copyFileSync(f, path.join(out, `studio-${v}.png`));
  const iso = await post(base, { cmd: "renderScene", args: { views: ["iso"], isolate: ["roof", "walls2"], labels: true, width: 640, height: 480 } });
  ok(iso.responses[0].ok, "renderScene isolate (roof + walls2)");
  if (iso.responses[0].ok) fs.copyFileSync(iso.responses[0].result.files.iso, path.join(out, "isolate-roof.png"));

  // ---- 6. no tab open -> headless viewer renders
  await page.close();
  await sleep(500);
  const hr = await post(base, { cmd: "renderScene", args: { views: ["iso"], width: 640, height: 480 } });
  ok(hr.responses[0].ok && hr.responses[0].result.viewer === "headless", `renderScene without a tab uses the headless viewer: ${hr.responses[0].summary ?? hr.responses[0].error?.message}`);
  if (hr.responses[0].ok) fs.copyFileSync(hr.responses[0].result.files.iso, path.join(out, "headless-iso.png"));

  // ---- 7. MCP client -> remote mode (talks to this server)
  const port = new URL(base).port;
  const mcp = new Client({ name: "check", version: "1" });
  await mcp.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server/mcp.ts"], env: { ...process.env, VOX_PORT: port } as Record<string, string>, stderr: "ignore" }));
  const tools = await mcp.listTools();
  ok(tools.tools.length === 15, `MCP lists ${tools.tools.length} tools`);
  const g = await mcp.callTool({ name: "get_guide", arguments: {} });
  ok(((g.content as any)[0].text as string).includes("BuildingPlan"), "MCP get_guide");
  const dry = await mcp.callTool({ name: "execute_plan", arguments: { plan: housePlan(), dry_run: true } });
  ok(!dry.isError && (dry.content as any)[0].text.includes("DRY RUN"), `MCP execute_plan dry run: ${(dry.content as any)[0].text.split("\n")[0]}`);
  const bad = await mcp.callTool({ name: "run_command", arguments: { cmd: "createWall", args: { height: 3, material: "brick" } } });
  ok(bad.isError && (bad.content as any)[0].text.includes("hint"), "MCP returns validation errors with a hint");
  const ins = await mcp.callTool({ name: "inspect", arguments: {} });
  ok(!ins.isError, `MCP inspect: ${(ins.content as any)[0].text.split("\n")[0]}`);
  const shot = await mcp.callTool({ name: "render_views", arguments: { views: ["iso"], width: 512, height: 384 } });
  const img = (shot.content as any[]).find((c) => c.type === "image");
  ok(!shot.isError && img && img.data.length > 1000, "MCP render_views returns a PNG image");
  if (img) fs.writeFileSync(path.join(out, "mcp-iso.png"), Buffer.from(img.data, "base64"));
  await mcp.close();

  // ---- 8. MCP embedded mode (no server running on that port)
  const mcp2 = new Client({ name: "check2", version: "1" });
  const freePort = String(20000 + Math.floor(Math.random() * 20000));
  await mcp2.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server/mcp.ts"], env: { ...process.env, VOX_PORT: freePort } as Record<string, string>, stderr: "ignore" }));
  const st = await mcp2.callTool({ name: "open_project", arguments: { new: true, name: "embedded" } });
  ok(!st.isError, "MCP embedded server: new project");
  const b = await mcp2.callTool({ name: "run_command", arguments: { cmd: "createTower", args: { center: [0, 0, 0], height: 20, baseSize: 7, topSize: 3, style: "lattice", material: "iron_mid" } } });
  ok(!b.isError, `MCP embedded server: ${(b.content as any)[0].text.split("\n")[0]}`);
  const health = await (await fetch(`http://127.0.0.1:${freePort}/api/health`)).json();
  ok(health.blocks > 0, `embedded MCP also serves the studio/API on :${freePort} (${health.blocks} blocks)`);
  await mcp2.close();
} finally {
  await browser.close();
  await srv.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall AI-side checks passed");
process.exit(failed ? 1 : 0);
