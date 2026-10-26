// Live link between a studio tab and the vox server (same origin).
// Local-first: the tab executes its own commands immediately and mirrors them to the server;
// commands from AI agents arrive as events and are replayed locally. A world hash after every
// command detects divergence, which is healed by reloading the server's project.
import type { Engine, CommandRequest } from "../engine/engine";
import type { Viewport } from "./viewport";

export interface Link {
  client: string;
  mirror(req: CommandRequest): void;
  replaceProject(): Promise<void>;
}

const MIRRORED = new Set(["undo", "redo", "newProject"]);

export async function connectServer(engine: Engine, viewport: Viewport, opts: { headless: boolean; onStatus: (s: string) => void; onRemote: (summary: string) => void }): Promise<Link | null> {
  try {
    const h = await fetch("/api/health", { cache: "no-store" });
    if (!h.ok || (await h.json()).app !== "ai-voxel-studio") return null;
  } catch {
    return null;
  }
  const client = Math.random().toString(36).slice(2, 10);
  let lastSeq = 0;
  let queue = Promise.resolve();

  const reload = async () => {
    const r = await fetch("/api/project", { cache: "no-store" });
    const { seq, file } = await r.json();
    engine.loadFile(file);
    lastSeq = seq;
    opts.onStatus(`서버와 동기화됨 · ${engine.project.world.blockCount.toLocaleString()}블록`);
  };
  await reload();

  const es = new EventSource(`/api/events?client=${client}${opts.headless ? "&headless=1" : ""}`);
  es.addEventListener("cmd", (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { seq: number; req: CommandRequest; hash: string };
    if (d.seq <= lastSeq) return;
    if (d.seq !== lastSeq + 1) { reload(); return; }
    const r = engine.execute(d.req);
    lastSeq = d.seq;
    if (!r.ok || engine.project.world.hash() !== d.hash) { reload(); return; }
    opts.onRemote(r.summary);
  });
  es.addEventListener("reload", () => { reload(); });
  es.addEventListener("render", async (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { id: string; args: { views: string[]; isolate?: string[]; labels?: boolean; width?: number; height?: number } };
    try {
      const out = viewport.renderViews(d.args);
      await fetch("/api/render-result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: d.id, ...out }) });
    } catch (e) {
      await fetch("/api/render-result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: d.id, error: (e as Error).message }) });
    }
  });
  es.onerror = () => opts.onStatus("서버 연결 끊김 — 다시 연결 중…");
  es.onopen = () => opts.onStatus("서버에 연결됨 (AI 명령이 실시간으로 반영됩니다)");

  return {
    client,
    mirror(req) {
      const def = engine.commands.get(req.cmd);
      if (!def || !(def.mutates || MIRRORED.has(req.cmd))) return;
      const localHash = engine.project.world.hash();
      queue = queue.then(async () => {
        try {
          const r = await fetch("/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client, requests: [req] }) });
          const out = await r.json();
          const res = out.responses?.[0];
          if (!res?.ok || (out.hash && out.hash !== localHash)) { await reload(); return; }
          lastSeq = Math.max(lastSeq, out.seq);
        } catch {
          opts.onStatus("서버로 보내지 못했습니다 — 다시 연결되면 서버 기준으로 맞춥니다");
        }
      });
    },
    async replaceProject() {
      await fetch("/api/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client, file: engine.project.toFile(true) }) });
    },
  };
}
