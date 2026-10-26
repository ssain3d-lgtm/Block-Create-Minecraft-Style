// MCP server (stdio) — lets any MCP client (Claude Desktop, Qwen Code, LM Studio, OpenCode ...) use the engine.
// If a vox server is already running (npm run serve / run.bat) the tools act on it, so the studio tab
// shows the AI's work live. Otherwise this process starts its own server (studio + API) on VOX_PORT.
//
// stdout belongs to the MCP protocol: every log goes to stderr.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CommandRequest, CommandResponse } from "../engine/engine";

console.log = (...a: unknown[]) => console.error(...a);
const PORT = Number(process.env.VOX_PORT ?? 7878);
const BASE = `http://127.0.0.1:${PORT}`;

interface Backend {
  run(reqs: CommandRequest[]): Promise<CommandResponse[]>;
  guide(): Promise<string>;
}

async function remoteBackend(): Promise<Backend | null> {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok || (await r.json()).app !== "ai-voxel-studio") return null;
  } catch {
    return null;
  }
  console.error(`[vox-mcp] using the running server at ${BASE}`);
  return {
    async run(reqs) {
      const r = await fetch(`${BASE}/api/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requests: reqs }) });
      return (await r.json()).responses;
    },
    async guide() { return (await fetch(`${BASE}/api/guide`)).text(); },
  };
}

async function embeddedBackend(): Promise<Backend> {
  const { startServer } = await import("./server");
  const s = await startServer({ port: PORT, log: (...a) => console.error("[vox]", ...a) });
  console.error(`[vox-mcp] started studio + API at ${s.url} — open it in a browser to watch`);
  const { guideText } = await import("../engine/guide");
  return {
    async run(reqs) { return (await s.handle(reqs)).responses; },
    async guide() { return guideText(s.engine); },
  };
}

const backend: Backend = (await remoteBackend()) ?? (await embeddedBackend());

// ---------------- tools (15) ----------------
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const anyObj = { type: "object", additionalProperties: true };

const TOOLS = [
  { name: "get_guide", description: "Read this first: units, coordinates, anchors, BuildingPlan format, workflow, materials, shapes and every command with an example.", inputSchema: obj({}) },
  { name: "list_commands", description: "List engine commands (optionally one group: build, structure, asset, inspect, blocks, project, io, meta).", inputSchema: obj({ group: { type: "string" } }) },
  { name: "describe_command", description: "JSON schema + example of one command's args.", inputSchema: obj({ name: { type: "string" } }, ["name"]) },
  { name: "run_command", description: 'Run any engine command. Example: {"cmd":"createWall","args":{"loop":{"on":{"ref":"base"}},"height":4,"material":"brick"}}', inputSchema: obj({ cmd: { type: "string" }, args: anyObj }, ["cmd"]) },
  { name: "run_batch", description: "Run several commands as one undo step (all or nothing).", inputSchema: obj({ commands: { type: "array", items: obj({ cmd: { type: "string" }, args: anyObj }, ["cmd"]) } }, ["commands"]) },
  { name: "execute_plan", description: "Build from a BuildingPlan ({plan, newProject, assets, buildings:[{name, origin, structures:[{key, cmd, args}]}], after}). Use dry_run first to validate.", inputSchema: obj({ plan: anyObj, dry_run: { type: "boolean" } }, ["plan"]) },
  { name: "get_state", description: "Project summary: blocks, bounds, buildings, structures with ids/keys/boxes.", inputSchema: obj({ verbose: { type: "boolean" } }) },
  { name: "inspect", description: "Automatic checks (floating parts, missing cells, empty structures, broken assets, optional symmetry). Issues include a fixHint command.", inputSchema: obj({ ids: { type: "array", items: { type: "string" } }, symmetry: anyObj }) },
  { name: "render_views", description: "Screenshots (front, back, left, right, top, iso) as images for visual checking. isolate = only some structures; labels = draw structure ids.", inputSchema: obj({ views: { type: "array", items: { type: "string", enum: ["front", "back", "left", "right", "top", "iso"] } }, isolate: { type: "array", items: { type: "string" } }, labels: { type: "boolean" }, width: { type: "integer" }, height: { type: "integer" } }) },
  { name: "search_assets", description: "Find shapes / materials / components by words or tags before creating new ones.", inputSchema: obj({ text: { type: "string" }, tags: { type: "array", items: { type: "string" } }, kind: { type: "string", enum: ["shape", "material", "component"] } }) },
  { name: "create_asset", description: "Create and register a reusable asset. kind shape -> createShape args (recipe), material -> createMaterial args, component -> createComponent args, custom_block -> createCustomBlock args.", inputSchema: obj({ kind: { type: "string", enum: ["shape", "material", "component", "custom_block"] }, args: anyObj }, ["kind", "args"]) },
  { name: "modify_structure", description: 'Change some args of one structure and rebuild only it (cascade: also what sits on it). Example: {"id":"roof","args":{"pitch":0.5}}', inputSchema: obj({ id: { type: "string" }, args: anyObj, cascade: { type: "boolean" } }, ["id", "args"]) },
  { name: "history", description: "Undo or redo the last change.", inputSchema: obj({ action: { type: "string", enum: ["undo", "redo"] } }, ["action"]) },
  { name: "save_project", description: "Save the project to a .vox.json file (path relative to the repo), and optionally export a .glb model.", inputSchema: obj({ path: { type: "string" }, glb: { type: "string" } }, ["path"]) },
  { name: "open_project", description: "Open a saved .vox.json project, or start a new empty one (new=true).", inputSchema: obj({ path: { type: "string" }, new: { type: "boolean" }, name: { type: "string" }, cellSize: { type: "number" } }) },
];

function text(t: string, isError = false) {
  return { content: [{ type: "text" as const, text: t }], isError };
}

function brief(r: CommandResponse) {
  if (!r.ok) return `ERROR ${r.cmd}: ${r.error.code} ${r.error.message}${r.error.path ? ` (at ${r.error.path})` : ""}${r.error.hint ? `\nhint: ${r.error.hint}` : ""}`;
  return `${r.summary}${r.warnings.length ? `\nwarnings: ${r.warnings.join("; ")}` : ""}`;
}

async function call(name: string, a: Record<string, any>) {
  const one = async (cmd: string, args: unknown = {}, full = true) => {
    const [r] = await backend.run([{ cmd, args }]);
    if (!r) return text(`no response for ${cmd}`, true);
    if (!r.ok) return text(brief(r), true);
    return text(full ? `${brief(r)}\n${JSON.stringify(r.result, null, 1).slice(0, 60000)}` : brief(r));
  };
  switch (name) {
    case "get_guide": return text(await backend.guide());
    case "list_commands": return one("listCommands", a.group ? { group: a.group } : {});
    case "describe_command": return one("describeCommand", { name: a.name });
    case "run_command": return one(a.cmd, a.args ?? {});
    case "run_batch": return one("runBatch", { commands: a.commands }, false);
    case "execute_plan": {
      const plan = { ...(a.plan ?? {}), dryRun: !!a.dry_run };
      // dry runs of a newProject plan are checked in a scratch project by executePlan itself
      const reqs: CommandRequest[] = plan.newProject && !a.dry_run ? [{ cmd: "newProject", args: { name: plan.name ?? plan.plan ?? "plan", cellSize: plan.cellSize ?? 1 } }] : [];
      reqs.push({ cmd: "executePlan", args: plan });
      const rs = await backend.run(reqs);
      const last = rs[rs.length - 1];
      const steps = last?.ok ? (last.result.steps as { key: string; structureId: string; blocks: number; warnings: string[] }[]).map((s) => `${s.key}=${s.structureId} +${s.blocks}${s.warnings?.length ? ` (${s.warnings.join("; ")})` : ""}`).join("\n") : "";
      return text(rs.map(brief).join("\n") + (steps ? `\n${steps}` : ""), !last?.ok);
    }
    case "get_state": return one("getState", { verbose: !!a.verbose });
    case "inspect": return a.ids?.length ? one("inspectStructure", { ids: a.ids }) : one("inspectProject", a.symmetry ? { symmetry: a.symmetry } : {});
    case "render_views": {
      const [r] = await backend.run([{ cmd: "renderScene", args: { views: a.views ?? ["front", "iso"], isolate: a.isolate, labels: a.labels ?? true, width: a.width ?? 960, height: a.height ?? 720 } }]);
      if (!r?.ok) return text(r ? brief(r) : "render failed", true);
      const images = Object.entries(r.result.images as Record<string, string>).map(([view, url]) => [
        { type: "text" as const, text: `${view}: ${r.result.files[view]}` },
        { type: "image" as const, data: url.split(",")[1], mimeType: "image/png" },
      ]).flat();
      const labels = Object.fromEntries(Object.entries(r.result.meta as Record<string, { labels: unknown }>).map(([v, m]) => [v, m.labels]));
      return { content: [{ type: "text" as const, text: `${r.summary}\nlabels (structure id -> pixel position): ${JSON.stringify(labels).slice(0, 4000)}` }, ...images] };
    }
    case "search_assets": return one("searchAssets", { text: a.text, tags: a.tags, kind: a.kind });
    case "create_asset": {
      const cmd = { shape: "createShape", material: "createMaterial", component: "createComponent", custom_block: "createCustomBlock" }[a.kind as string];
      if (!cmd) return text(`unknown kind ${a.kind}`, true);
      return one(cmd, a.args, false);
    }
    case "modify_structure": return one("modifyStructure", { id: a.id, args: a.args, cascade: a.cascade ?? true }, false);
    case "history": return one(a.action === "redo" ? "redo" : "undo", {}, false);
    case "save_project": {
      const rs = await backend.run([{ cmd: "saveProject", args: { path: a.path } }, ...(a.glb ? [{ cmd: "exportGLB", args: { path: a.glb } }] : [])]);
      return text(rs.map(brief).join("\n"), rs.some((r) => !r.ok));
    }
    case "open_project":
      return a.new ? one("newProject", { name: a.name ?? "untitled", cellSize: a.cellSize ?? 1 }, false) : one("loadProject", { path: a.path }, false);
    default: return text(`unknown tool ${name}`, true);
  }
}

const server = new Server({ name: "ai-voxel-studio", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return await call(req.params.name, (req.params.arguments ?? {}) as Record<string, any>);
  } catch (e) {
    return text(`tool failed: ${(e as Error).message}`, true);
  }
});
await server.connect(new StdioServerTransport());
console.error("[vox-mcp] ready (15 tools)");
