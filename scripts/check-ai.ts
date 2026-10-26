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
let TOKEN = "";
const post = async (base: string, body: unknown) => (await fetch(`${base}/api/command`, { method: "POST", headers: { "content-type": "application/json", "x-vox-token": TOKEN }, body: JSON.stringify(body) })).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const srv = await startServer({ port: 0, projectPath: path.join(tmp, "current.vox.json"), log: () => {} });
const base = srv.url;
TOKEN = srv.token;
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

  // ---- 6b. two studio tabs + an AI editing at the same time, then a disconnect
  const tabA = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const tabB = await browser.newPage({ viewport: { width: 900, height: 700 } });
  for (const t of [tabA, tabB]) {
    t.on("pageerror", (e) => console.error("[tab]", e.message));
    await t.goto(base);
    await t.waitForFunction(() => (window as any).studio?.link, null, { timeout: 60000 });
  }
  await sleep(800);
  const edits = (tag: number) => Array.from({ length: 15 }, (_, i) => ({ cmd: "editBlocks", args: { ops: [{ op: "set", at: [40 + tag * 3, 1 + i, 0], material: tag === 0 ? "brick" : "stone" }] } }));
  const aiEdits = Array.from({ length: 15 }, (_, i) => post(base, { cmd: "editBlocks", args: { ops: [{ op: "set", at: [50, 1 + i, 0], material: "glass" }] } }));
  await Promise.all([
    tabA.evaluate((list) => { for (const c of list) (window as any).studio.exec(c); }, edits(0)),
    tabB.evaluate((list) => { for (const c of list) (window as any).studio.exec(c); }, edits(1)),
    ...aiEdits,
  ]);
  for (const t of [tabA, tabB]) await t.evaluate(() => (window as any).studio.link.flush());
  const settle = async () => {
    for (let i = 0; i < 60; i++) {
      const hs = await Promise.all([tabA, tabB].map((t) => t.evaluate(() => { const s = (window as any).studio; return s.link.pending === 0 ? s.engine.project.stateHash() : "busy"; })));
      if (hs.every((h) => h === srv.engine.project.stateHash())) return true;
      await sleep(250);
    }
    return false;
  };
  ok(await settle(), "two tabs + AI editing concurrently converge to the server state (blocks, ownership, metadata)");
  const counts = [40, 43, 50].map((x) => Array.from({ length: 15 }, (_, i) => srv.engine.project.world.get(x, 1 + i, 0) ? 1 : 0).reduce((a: number, b: number) => a + b, 0));
  ok(counts.every((c) => c === 15), `no edit lost or duplicated (columns: ${counts.join(", ")} of 15)`);
  const logLen = srv.engine.project.log.length;
  // undo from a tab acts on the shared server history
  await tabA.evaluate(() => (window as any).studio.exec({ cmd: "undo" }));
  await sleep(600);
  ok(srv.engine.project.log.length === logLen - 1, "undo in a tab undoes the latest change on the server");
  ok(await settle(), "after undo both tabs match the server");
  // disconnect: tab B goes offline, edits locally, comes back
  await tabB.context().setOffline(true);
  await tabB.evaluate(() => { const s = (window as any).studio; for (let i = 0; i < 5; i++) s.exec({ cmd: "editBlocks", args: { ops: [{ op: "set", at: [60, 1 + i, 0], material: "wood_oak" }] } }); });
  await post(base, { cmd: "editBlocks", args: { ops: [{ op: "set", at: [62, 1, 0], material: "brick" }] } });
  await sleep(1200);
  await tabB.context().setOffline(false);
  await tabB.evaluate(() => (window as any).studio.link.flush());
  ok(await settle(), "after reconnecting, the offline edits reached the server exactly once and every tab matches");
  const col = Array.from({ length: 5 }, (_, i) => (srv.engine.project.world.get(60, 1 + i, 0) ? 1 : 0)).reduce((a: number, b: number) => a + b, 0);
  ok(col === 5 && !!srv.engine.project.world.get(62, 1, 0), `offline edits kept (${col}/5) and the AI edit made meanwhile kept`);
  await tabA.close();
  await tabB.close();
  await sleep(300);

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
  // MCP: new project + plan that fails half way -> nothing changes (atomic), library untouched
  const beforeFail = srv.engine.project.stateHash();
  const broken = housePlan() as any;
  broken.buildings[0].structures[4].args.material = "no_such_material";
  const failed = await mcp.callTool({ name: "execute_plan", arguments: { plan: broken } });
  ok(failed.isError && (failed.content as any)[0].text.includes("floor2"), "MCP execute_plan (newProject) that fails reports the failing structure");
  ok(srv.engine.project.stateHash() === beforeFail, "…and leaves the server project unchanged (no half-made new project)");
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
  await mcp2.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server/mcp.ts"], env: { ...process.env, VOX_PORT: freePort, VOX_PROJECT: path.join(tmp, "embedded.vox.json") } as Record<string, string>, stderr: "ignore" }));
  const st = await mcp2.callTool({ name: "open_project", arguments: { new: true, name: "embedded" } });
  ok(!st.isError, "MCP embedded server: new project");
  const b = await mcp2.callTool({ name: "run_command", arguments: { cmd: "createTower", args: { center: [0, 0, 0], height: 20, baseSize: 7, topSize: 3, style: "lattice", material: "iron_mid" } } });
  ok(!b.isError, `MCP embedded server: ${(b.content as any)[0].text.split("\n")[0]}`);
  const { readServerToken } = await import("../src/server/server");
  const et = readServerToken(Number(freePort));
  const st2 = await (await fetch(`http://127.0.0.1:${freePort}/api/state`, { headers: { "x-vox-token": et?.token ?? "" } })).json();
  ok(st2.result?.blocks > 0, `embedded MCP also serves the studio/API on :${freePort} (${st2.result?.blocks} blocks, token from .vox/token-${freePort}.json)`);
  const unauth = await fetch(`http://127.0.0.1:${freePort}/api/state`);
  ok(unauth.status === 401, "embedded server refuses calls without the token");
  await mcp2.close();
} finally {
  await browser.close();
  await srv.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall AI-side checks passed");
process.exit(failed ? 1 : 0);
