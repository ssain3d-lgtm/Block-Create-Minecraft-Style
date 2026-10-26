// HTTP server: JSON command API for AI agents + live link to studio tabs (Server-Sent Events)
// + the studio itself (Vite middleware), all on one loopback port (default http://127.0.0.1:7878).
//
// Security (local tool, but any web page in the user's browser could try to reach it):
//  - binds to loopback only; the Host header must be 127.0.0.1/localhost/[::1]:<port> (DNS rebinding)
//  - cross-site requests are refused (Origin / Sec-Fetch-Site), no CORS headers are ever sent
//  - every /api call except /api/health needs the per-run token (x-vox-token header, or ?token= for SSE).
//    Browsers get it from /api/session (same-origin only); local tools read .vox/token-<port>.json.
//  - POST bodies must be JSON and are size-limited per route
//  - file paths used by commands are sandboxed to projects/ and out/ (src/node/fsx.ts)
//
//   GET  /api/health            {ok, app, rev}                     (no token)
//   GET  /api/session           {token}                            (same-origin browsers only)
//   GET  /api/guide | /api/commands | /api/commands/<name> | /api/state | /api/project
//   POST /api/project           replace the project with a posted project file
//   POST /api/command           {cmd,args} | [..] | {commands:[..]} | BuildingPlan | {requests,client,opId,baseRev}
//   GET  /api/events            SSE stream for studio tabs (hello / cmd / reload / render)
//   POST /api/render-result     studio tab answers a render request
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createNodeEngine, repoRoot, serverSandbox } from "../node/host";
import { writeFileAtomic, backupsOf } from "../node/fsx";
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
  tokenFile?: string | false; // where to publish the API token (default <repo>/.vox/token-<port>.json)
  /** shared asset library folder (default <repo>/library) */
  libraryDir?: string;
  /** only for tests / special setups: write failures are injected here */
  writer?: (file: string, data: string) => void;
}

export const LIMITS = {
  command: 16 * 1024 * 1024,
  project: 96 * 1024 * 1024,
  renderResult: 96 * 1024 * 1024,
  other: 1024 * 1024,
  requestsPerCall: 2000,
};

interface Client { id: string; res: http.ServerResponse; headless: boolean }

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_SAVE_BACKUPS = 3;

/** Reads a project file; if it is missing or damaged, falls back to the newest good backup. */
export function loadWithRecovery(projectPath: string, load: (file: ProjectFile) => void, log: (...a: unknown[]) => void): { from?: string; recovered: boolean } {
  const candidates = [projectPath, ...backupsOf(projectPath, MAX_SAVE_BACKUPS)].filter((f) => fs.existsSync(f));
  let first = true;
  for (const f of candidates) {
    try {
      load(JSON.parse(fs.readFileSync(f, "utf8")) as ProjectFile);
      if (!first) {
        // keep the damaged file for inspection, then restore the good copy as the main file
        if (fs.existsSync(projectPath)) fs.renameSync(projectPath, `${projectPath}.corrupt-${Date.now()}`);
        fs.copyFileSync(f, projectPath);
        log(`project file was damaged — recovered from ${path.basename(f)}`);
      }
      return { from: f, recovered: !first };
    } catch (e) {
      log(`could not load ${path.basename(f)}: ${(e as Error).message}`);
      first = false;
    }
  }
  return { recovered: false };
}

export async function startServer(opts: ServerOptions = {}) {
  const root = repoRoot();
  const log = opts.log ?? ((...a: unknown[]) => console.log("[vox]", ...a));
  const host = opts.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) throw new Error(`refusing to listen on ${host}: the vox server only binds to loopback (127.0.0.1 / ::1)`);
  const projectPath = path.resolve(opts.projectPath ?? path.join(root, "projects", "current.vox.json"));
  const engine = createNodeEngine({ baseDir: root, sandbox: serverSandbox(root), libraryDir: opts.libraryDir ?? process.env.VOX_LIBRARY });
  const loaded = loadWithRecovery(projectPath, (f) => engine.loadFile(f), log);
  if (loaded.from) log(`loaded ${path.relative(root, loaded.from)} (${engine.project.world.blockCount} blocks)`);

  const token = crypto.randomBytes(24).toString("hex");
  // one token file per port, so several servers never overwrite each other's token
  let tokenFile: string | undefined;

  let rev = 0; // server revision: +1 for every applied change
  const clients = new Map<string, Client>();
  const pendingRenders = new Map<string, (data: unknown) => void>();
  const seenOps = new Map<string, unknown>(); // opId -> response (dedupe retries), LRU-ish
  let headless: HeadlessViewer | null = null;
  let baseUrl = "";
  let closing = false;

  // ---------------- saving ----------------
  let saveTimer: NodeJS.Timeout | undefined;
  let dirty = false;
  let lastSaveError: string | undefined;
  const write = opts.writer ?? ((file: string, data: string) => writeFileAtomic(file, data, MAX_SAVE_BACKUPS));
  /** writes the project now (atomic temp file + rename, previous versions kept as .bak1..3) */
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!dirty) return true;
    try {
      write(projectPath, JSON.stringify(engine.project.toFile(true)));
      dirty = false;
      lastSaveError = undefined;
      return true;
    } catch (e) {
      // the previous file is untouched (atomic write); keep dirty so the next save retries
      lastSaveError = (e as Error).message;
      log(`autosave failed: ${lastSaveError}`);
      return false;
    }
  };
  const scheduleSave = () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  };

  // ---------------- events ----------------
  const send = (c: Client, event: string, data: unknown) => {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (event: string, data: unknown, except?: string) => {
    for (const c of clients.values()) if (c.id !== except) send(c, event, data);
  };

  const MIRRORED = new Set(["undo", "redo", "newProject"]);
  const isMutating = (cmd: string) => engine.commands.get(cmd)?.mutates || MIRRORED.has(cmd);
  /** commands after which clients must reload instead of replaying */
  const needsReload = (req: CommandRequest) =>
    req.cmd === "loadProject" || req.cmd === "newProject" || (req.cmd === "executePlan" && !!(req.args as { newProject?: boolean })?.newProject);

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
    const id = crypto.randomBytes(8).toString("hex");
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pendingRenders.delete(id); reject(new Error("render timed out (180 s)")); }, 180_000);
      pendingRenders.set(id, (d) => { clearTimeout(timer); resolve(d); });
      send(target!, "render", { id, args: parsed.data });
    }).catch((e) => ({ error: (e as Error).message }));
    if (result.error) return { ok: false, cmd: "renderScene", error: { code: "RENDER_FAILED", message: String(result.error) } };
    const dir = path.join(root, "shots", new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {};
    for (const [view, url] of Object.entries((result.images ?? {}) as Record<string, string>)) {
      if (!/^[a-z]+$/.test(view) || typeof url !== "string" || !url.startsWith("data:image/png;base64,")) continue;
      const f = path.join(dir, `${view}.png`);
      fs.writeFileSync(f, Buffer.from(url.slice("data:image/png;base64,".length), "base64"));
      files[view] = f;
    }
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ meta: result.meta, size: result.size, visibleStructures: result.visibleStructures, files }, null, 2));
    return {
      ok: true, cmd: "renderScene", warnings: [],
      result: { dir, files, meta: result.meta, size: result.size, visibleStructures: result.visibleStructures, images: result.images, viewer: target.headless ? "headless" : "studio" },
      summary: `rendered ${Object.keys(files).length} view(s) -> ${path.relative(root, dir)}`,
    };
  }

  /**
   * Executes requests in order (stops at the first error) and mirrors changes to studio tabs.
   * Every applied change bumps `rev`; events carry the rev and the full state hash.
   * opId makes retries idempotent (a resent request is answered from cache, not re-applied).
   */
  async function handle(reqs: CommandRequest[], origin?: string, opId?: string): Promise<{ responses: CommandResponse[]; rev: number; seq: number; hash?: string; duplicate?: boolean }> {
    if (opId && seenOps.has(opId)) return { ...(seenOps.get(opId) as { responses: CommandResponse[]; rev: number; seq: number }), duplicate: true };
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
      if (!isMutating(req.cmd) && req.cmd !== "loadProject") continue;
      rev++;
      changed = true;
      if (needsReload(req)) broadcast("reload", { rev }, req.cmd === "newProject" ? origin : undefined);
      else broadcast("cmd", { rev, req, hash: engine.project.stateHash(), origin }, origin);
    }
    if (changed) scheduleSave();
    const out = { responses, rev, seq: rev, hash: changed ? engine.project.stateHash() : undefined };
    if (opId) {
      seenOps.set(opId, out);
      if (seenOps.size > 2000) seenOps.delete(seenOps.keys().next().value!);
    }
    return out;
  }

  // ---------------- HTTP plumbing ----------------
  const port = opts.port ?? Number(process.env.VOX_PORT ?? 7878);
  let vite: import("vite").ViteDevServer | undefined;
  if (opts.studio !== false) {
    const { createServer } = await import("vite");
    vite = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "spa", logLevel: "silent" });
  }

  let allowedHosts = new Set<string>();
  let allowedOrigins = new Set<string>();

  /** Host + Origin + Sec-Fetch-Site checks; throws HttpError when the request must be refused. */
  const checkRequest = (req: http.IncomingMessage, isApi: boolean) => {
    const h = String(req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(h)) throw new HttpError(403, "BAD_HOST", `host "${h}" not allowed`);
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(String(origin).toLowerCase())) throw new HttpError(403, "BAD_ORIGIN", "cross-origin request refused");
    if (isApi) {
      const site = req.headers["sec-fetch-site"];
      if (site !== undefined && site !== "same-origin" && site !== "none") throw new HttpError(403, "CROSS_SITE", "cross-site request refused");
    }
  };

  const tokenOk = (given: unknown) => {
    if (typeof given !== "string" || given.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  };

  const readBody = (req: http.IncomingMessage, limit: number) => new Promise<string>((resolve, reject) => {
    const type = String(req.headers["content-type"] ?? "");
    if (!type.toLowerCase().startsWith("application/json")) return reject(new HttpError(415, "BAD_CONTENT_TYPE", "POST bodies must be application/json"));
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) return reject(new HttpError(413, "TOO_LARGE", `body larger than ${limit} bytes`));
    const chunks: Buffer[] = [];
    let n = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      n += c.length;
      if (n > limit) { failed = true; reject(new HttpError(413, "TOO_LARGE", `body larger than ${limit} bytes`)); req.resume(); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });

  const parseJson = (text: string) => {
    try { return JSON.parse(text); } catch { throw new HttpError(400, "BAD_JSON", "body is not valid JSON"); }
  };

  const json = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify(data));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isApi = url.pathname.startsWith("/api/");
    try {
      checkRequest(req, isApi);
      if (req.method === "OPTIONS") throw new HttpError(403, "NO_CORS", "cross-origin requests are not supported");
      if (!isApi) {
        if (vite) return vite.middlewares(req, res, () => { res.statusCode = 404; res.end("not found"); });
        res.statusCode = 404;
        return res.end("studio disabled");
      }
      const p = url.pathname;
      if (p === "/api/health" && req.method === "GET") return json(res, 200, { ok: true, app: "ai-voxel-studio", rev, auth: "token" });
      if (p === "/api/session" && req.method === "GET") {
        // browsers only, and only same-origin pages (a cross-site page is refused above and cannot read this)
        if (req.headers["sec-fetch-site"] !== "same-origin") throw new HttpError(403, "BROWSER_ONLY", "local tools read the token from .vox/token-<port>.json");
        return json(res, 200, { token });
      }
      const given = req.headers["x-vox-token"] ?? (p === "/api/events" ? url.searchParams.get("token") : undefined);
      if (!tokenOk(given)) throw new HttpError(401, "NO_TOKEN", "missing or wrong x-vox-token (local tools: read .vox/token-<port>.json)");

      if (p === "/api/guide" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
        return res.end(guideText(engine));
      }
      if (p === "/api/commands" && req.method === "GET") return json(res, 200, engine.commandList());
      if (p.startsWith("/api/commands/") && req.method === "GET") {
        const s = engine.commandSchema(decodeURIComponent(p.slice("/api/commands/".length)));
        return s ? json(res, 200, s) : json(res, 404, { ok: false, error: { code: "UNKNOWN_COMMAND", message: "unknown command" } });
      }
      if (p === "/api/state" && req.method === "GET") return json(res, 200, engine.execute({ cmd: "getState", args: { verbose: url.searchParams.has("verbose") } }));
      if (p === "/api/project" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ rev, seq: rev, hash: engine.project.stateHash(), file: engine.project.toFile(true) }));
      }
      if (p === "/api/project" && req.method === "POST") {
        const body = parseJson(await readBody(req, LIMITS.project)) as { file: ProjectFile; client?: string };
        try { engine.loadFile(body.file); } catch (e) { return json(res, 400, { ok: false, error: { code: "BAD_PROJECT", message: (e as Error).message } }); }
        rev++;
        broadcast("reload", { rev }, typeof body.client === "string" ? body.client : undefined);
        scheduleSave();
        return json(res, 200, { ok: true, rev, seq: rev, hash: engine.project.stateHash(), blocks: engine.project.world.blockCount });
      }
      if (p === "/api/command" && req.method === "POST") {
        const raw = parseJson(await readBody(req, LIMITS.command));
        const wrapped = raw && typeof raw === "object" && !Array.isArray(raw) && "requests" in raw;
        const client = wrapped && typeof raw.client === "string" ? raw.client : undefined;
        const opId = wrapped && typeof raw.opId === "string" ? raw.opId.slice(0, 64) : undefined;
        let reqs: CommandRequest[];
        try { reqs = toRequests(wrapped ? raw.requests : raw); } catch (e) { throw new HttpError(400, "BAD_REQUEST", (e as Error).message); }
        if (reqs.length > LIMITS.requestsPerCall) throw new HttpError(413, "TOO_MANY", `more than ${LIMITS.requestsPerCall} commands in one call (use runBatch / executePlan)`);
        const out = await handle(reqs, client, opId);
        return json(res, 200, out);
      }
      if (p === "/api/events" && req.method === "GET") {
        const id = (url.searchParams.get("client") ?? crypto.randomBytes(6).toString("hex")).replace(/[^a-z0-9]/gi, "").slice(0, 32);
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const c: Client = { id, res, headless: url.searchParams.has("headless") };
        clients.get(id)?.res.end(); // a reconnect replaces the old stream of the same tab
        clients.set(id, c);
        send(c, "hello", { rev, seq: rev, client: id, hash: engine.project.stateHash() });
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => { clearInterval(ping); if (clients.get(id) === c) clients.delete(id); headless?.clientGone(id); });
        if (c.headless) headless?.clientReady(id);
        return;
      }
      if (p === "/api/render-result" && req.method === "POST") {
        const body = parseJson(await readBody(req, LIMITS.renderResult));
        const cb = typeof body?.id === "string" ? pendingRenders.get(body.id) : undefined;
        if (!cb) throw new HttpError(404, "UNKNOWN_RENDER", "no such render request");
        pendingRenders.delete(body.id);
        cb(body);
        return json(res, 200, { ok: true });
      }
      throw new HttpError(404, "NOT_FOUND", `no route ${req.method} ${p}`);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { ok: false, error: { code: e.code, message: e.message } });
      return json(res, 500, { ok: false, error: { code: "SERVER_ERROR", message: (e as Error).message } });
    }
  });
  server.requestTimeout = 300_000;
  server.headersTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const realPort = typeof addr === "object" && addr ? addr.port : port;
  allowedHosts = new Set([`127.0.0.1:${realPort}`, `localhost:${realPort}`, `[::1]:${realPort}`]);
  allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  const base = `http://${host === "::1" ? "[::1]" : host}:${realPort}`;
  baseUrl = base;
  tokenFile = opts.tokenFile === false ? undefined : opts.tokenFile ?? tokenPath(root, realPort);
  if (tokenFile) {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    writeFileAtomic(tokenFile, JSON.stringify({ port: realPort, token, pid: process.pid }));
    try { fs.chmodSync(tokenFile, 0o600); } catch { /* windows */ }
  }
  log(`studio + API on ${base}  (guide: ${base}/api/guide)`);

  return {
    engine,
    url: base,
    token,
    handle,
    clients,
    get rev() { return rev; },
    get lastSaveError() { return lastSaveError; },
    saveNow,
    async close() {
      if (closing) return;
      closing = true;
      const saved = saveNow(); // never lose the last change
      for (const c of clients.values()) c.res.end();
      await headless?.close();
      await vite?.close();
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      if (tokenFile) {
        try {
          const cur = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
          if (cur.token === token) fs.unlinkSync(tokenFile);
        } catch { /* gone */ }
      }
      return saved;
    },
  };
}

export type VoxServer = Awaited<ReturnType<typeof startServer>>;

export function tokenPath(root: string, port: number) {
  return path.join(root, ".vox", `token-${port}.json`);
}

/** Token published by the server running on `port` (for local tools such as the MCP bridge). */
export function readServerToken(port: number, root = repoRoot()): { port: number; token: string } | undefined {
  try { return JSON.parse(fs.readFileSync(tokenPath(root, port), "utf8")); } catch { return undefined; }
}
