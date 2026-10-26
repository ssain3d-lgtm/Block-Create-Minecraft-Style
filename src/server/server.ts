// HTTP server: JSON command API for AI agents + live link to studio tabs (Server-Sent Events)
// + the studio itself (Vite middleware), all on one port (default http://127.0.0.1:7878).
//
//   GET  /api/health            {ok, name, blocks, clients}
//   GET  /api/guide             markdown guide for LLMs
//   GET  /api/commands          command list ; GET /api/commands/<name> -> JSON schema
//   GET  /api/state             getState
//   GET  /api/project           full project file (JSON)
//   POST /api/project           replace the project with a posted project file
//   POST /api/command           {cmd,args} | [..] | {commands:[..]} | BuildingPlan  -> responses
//   GET  /api/events            SSE stream for studio tabs (cmd / reload / render events)
//   POST /api/render-result     studio tab answers a render request
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createNodeEngine, repoRoot } from "../node/host";
import type { CommandRequest, CommandResponse } from "../engine/engine";
import type { ProjectFile } from "../engine/project";
import { toRequests } from "../cli/input";
import { guideText } from "../engine/guide";
import { zRenderArgs } from "../engine/commands/output";
import { launchHeadlessViewer, HeadlessViewer } from "./headless";

export interface ServerOptions {
  port?: number;
  host?: string;
  projectPath?: string; // autosaved project file
  studio?: boolean; // serve the studio UI through Vite (default true)
  log?: (...a: unknown[]) => void;
  headlessRender?: boolean; // open a headless browser when no studio tab is connected (default true)
}

interface Client { id: string; res: http.ServerResponse; headless: boolean }

export async function startServer(opts: ServerOptions = {}) {
  const root = repoRoot();
  const log = opts.log ?? ((...a: unknown[]) => console.log("[vox]", ...a));
  const projectPath = opts.projectPath ?? path.join(root, "projects", "current.vox.json");
  const engine = createNodeEngine({ baseDir: root });
  if (fs.existsSync(projectPath)) {
    try {
      engine.loadFile(JSON.parse(fs.readFileSync(projectPath, "utf8")));
      log(`loaded ${path.relative(root, projectPath)} (${engine.project.world.blockCount} blocks)`);
    } catch (e) {
      log(`could not load ${projectPath}: ${(e as Error).message}`);
    }
  }
  let seq = 0;
  const clients = new Map<string, Client>();
  const pendingRenders = new Map<string, (data: unknown) => void>();
  let headless: HeadlessViewer | null = null;
  let saveTimer: NodeJS.Timeout | undefined;
  let baseUrl = ""; // set once listening

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(projectPath), { recursive: true });
      fs.writeFileSync(projectPath, JSON.stringify(engine.project.toFile(true)));
    }, 400);
  };

  const send = (c: Client, event: string, data: unknown) => {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (event: string, data: unknown, except?: string) => {
    for (const c of clients.values()) if (c.id !== except) send(c, event, data);
  };

  const MIRRORED = new Set(["undo", "redo", "newProject"]);
  const isMutating = (cmd: string) => engine.commands.get(cmd)?.mutates || MIRRORED.has(cmd);

  async function render(args: unknown): Promise<CommandResponse> {
    const parsed = zRenderArgs.safeParse(args ?? {});
    if (!parsed.success) return { ok: false, cmd: "renderScene", error: { code: "INVALID_ARGS", message: parsed.error.issues[0].message } };
    let target = [...clients.values()].find((c) => !c.headless) ?? [...clients.values()].find((c) => c.headless);
    if (!target && opts.headlessRender !== false) {
      try {
        headless ??= await launchHeadlessViewer(`${baseUrl}/?headless=1`, log);
        await headless.ready();
        target = [...clients.values()].find((c) => c.headless);
      } catch (e) {
        return { ok: false, cmd: "renderScene", error: { code: "NO_VIEWER", message: `no studio tab is open and the headless browser failed: ${(e as Error).message}`, hint: `open ${baseUrl} in a browser, or run: npx playwright install chromium` } };
      }
    }
    if (!target) return { ok: false, cmd: "renderScene", error: { code: "NO_VIEWER", message: "no viewer connected", hint: `open ${baseUrl} in a browser` } };
    const id = Math.random().toString(36).slice(2);
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pendingRenders.delete(id); reject(new Error("render timed out (180 s)")); }, 180_000);
      pendingRenders.set(id, (d) => { clearTimeout(timer); resolve(d); });
      send(target!, "render", { id, args: parsed.data });
    }).catch((e) => ({ error: (e as Error).message }));
    if (result.error) return { ok: false, cmd: "renderScene", error: { code: "RENDER_FAILED", message: result.error } };
    // save PNGs
    const dir = path.join(root, "shots", new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {};
    for (const [view, url] of Object.entries(result.images as Record<string, string>)) {
      const f = path.join(dir, `${view}.png`);
      fs.writeFileSync(f, Buffer.from(url.split(",")[1], "base64"));
      files[view] = f;
    }
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...result, images: undefined, files }, null, 2));
    return {
      ok: true, cmd: "renderScene", warnings: [],
      result: { dir, files, meta: result.meta, size: result.size, visibleStructures: result.visibleStructures, images: result.images, viewer: target.headless ? "headless" : "studio" },
      summary: `rendered ${Object.keys(files).length} view(s) -> ${path.relative(root, dir)}`,
    };
  }

  /** Executes requests in order (stops at the first error) and mirrors changes to studio tabs. */
  async function handle(reqs: CommandRequest[], origin?: string): Promise<{ responses: CommandResponse[]; seq: number; hash?: string }> {
    const responses: CommandResponse[] = [];
    let changed = false;
    for (const req of reqs) {
      if (req.cmd === "renderScene") {
        responses.push(await render(req.args));
        continue;
      }
      const r = engine.execute(req);
      responses.push(r);
      if (!r.ok) break;
      if (req.cmd === "loadProject") { seq++; broadcast("reload", { seq }); changed = true; continue; }
      if (isMutating(req.cmd)) {
        seq++;
        changed = true;
        if (req.cmd === "newProject") broadcast("reload", { seq }, origin);
        else broadcast("cmd", { seq, req, hash: engine.project.world.hash(), origin }, origin);
      }
    }
    if (changed) save();
    return { responses, seq, hash: changed ? engine.project.world.hash() : undefined };
  }

  // ---------------- HTTP ----------------
  const port = opts.port ?? Number(process.env.VOX_PORT ?? 7878);
  const host = opts.host ?? "127.0.0.1";
  let vite: import("vite").ViteDevServer | undefined;
  if (opts.studio !== false) {
    const { createServer } = await import("vite");
    vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa", logLevel: "silent" });
  }

  const readBody = (req: http.IncomingMessage) => new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; if (n > 200 * 1024 * 1024) reject(new Error("body too large")); else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

  const json = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "content-type" });
        return res.end();
      }
      if (!url.pathname.startsWith("/api/")) {
        if (vite) return vite.middlewares(req, res, () => { res.statusCode = 404; res.end("not found"); });
        res.statusCode = 404;
        return res.end("studio disabled");
      }
      const p = url.pathname;
      if (p === "/api/health" && req.method === "GET") return json(res, 200, { ok: true, app: "ai-voxel-studio", name: engine.project.meta.name, blocks: engine.project.world.blockCount, clients: clients.size, seq });
      if (p === "/api/guide") { res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" }); return res.end(guideText(engine)); }
      if (p === "/api/commands") return json(res, 200, engine.commandList());
      if (p.startsWith("/api/commands/")) {
        const s = engine.commandSchema(decodeURIComponent(p.slice("/api/commands/".length)));
        return s ? json(res, 200, s) : json(res, 404, { error: "unknown command" });
      }
      if (p === "/api/state") return json(res, 200, engine.execute({ cmd: "getState", args: { verbose: url.searchParams.has("verbose") } }));
      if (p === "/api/project" && req.method === "GET") { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(JSON.stringify({ seq, file: engine.project.toFile(true) })); }
      if (p === "/api/project" && req.method === "POST") {
        const body = JSON.parse(await readBody(req)) as { file: ProjectFile; client?: string };
        engine.loadFile(body.file);
        seq++;
        broadcast("reload", { seq }, body.client);
        save();
        return json(res, 200, { ok: true, seq, blocks: engine.project.world.blockCount });
      }
      if (p === "/api/command" && req.method === "POST") {
        const raw = JSON.parse(await readBody(req));
        const client = typeof raw?.client === "string" ? raw.client : undefined;
        const payload = raw && typeof raw === "object" && "requests" in raw ? raw.requests : raw;
        let reqs: CommandRequest[];
        try { reqs = toRequests(payload); } catch (e) { return json(res, 400, { ok: false, error: { code: "BAD_REQUEST", message: (e as Error).message } }); }
        const out = await handle(reqs, client);
        return json(res, 200, out);
      }
      if (p === "/api/events" && req.method === "GET") {
        const id = url.searchParams.get("client") ?? Math.random().toString(36).slice(2);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
        const c: Client = { id, res, headless: url.searchParams.has("headless") };
        clients.set(id, c);
        send(c, "hello", { seq, client: id });
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => { clearInterval(ping); clients.delete(id); headless?.clientGone(id); });
        if (c.headless) headless?.clientReady(id);
        return;
      }
      if (p === "/api/render-result" && req.method === "POST") {
        const body = JSON.parse(await readBody(req));
        pendingRenders.get(body.id)?.(body);
        pendingRenders.delete(body.id);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: `no route ${req.method} ${p}` } });
    } catch (e) {
      return json(res, 500, { ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const realPort = typeof addr === "object" && addr ? addr.port : port;
  const base = `http://${host}:${realPort}`;
  baseUrl = base;
  log(`studio + API on ${base}  (guide: ${base}/api/guide)`);
  return {
    engine,
    url: base,
    handle,
    clients,
    async close() {
      clearTimeout(saveTimer);
      for (const c of clients.values()) c.res.end();
      await headless?.close();
      await vite?.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export type VoxServer = Awaited<ReturnType<typeof startServer>>;
