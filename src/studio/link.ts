// Live link between a studio tab and the vox server (same origin).
//
// Rules (server is the source of truth):
//  - every change on the server has a revision number `rev`; events arrive with it and are applied
//    strictly in order (duplicates ignored, a gap triggers a resync)
//  - the tab executes its own edits immediately (local-first) and sends them with a unique opId;
//    unsent edits stay queued and are retried after a disconnect, the server never applies an opId twice
//  - undo / redo are server-side (global history): sent first, applied locally only if nothing interleaved
//  - after every remote command the full state hash (blocks + ownership + metadata) is compared;
//    any mismatch -> resync (one at a time; events received meanwhile are buffered)
import type { Engine, CommandRequest, CommandResponse } from "../engine/engine";
import type { Viewport } from "./viewport";

export interface Link {
  client: string;
  /** called after a successful LOCAL execution of req */
  mirror(req: CommandRequest): void;
  /** undo / redo: executed on the server first */
  serverHistory(cmd: "undo" | "redo"): Promise<CommandResponse | undefined>;
  replaceProject(): Promise<void>;
  /** resolves when every queued edit has been accepted by the server */
  flush(): Promise<void>;
  readonly rev: number;
  readonly pending: number;
}

interface Op { opId: string; req: CommandRequest; baseRev: number; localHash: string }

const MIRRORED = new Set(["newProject"]);

export async function connectServer(engine: Engine, viewport: Viewport, opts: { headless: boolean; onStatus: (s: string) => void; onRemote: (summary: string) => void }): Promise<Link | null> {
  let token = "";
  try {
    const h = await fetch("/api/health", { cache: "no-store" });
    if (!h.ok) return null;
    const hj = await h.json().catch(() => null);
    if (hj?.app !== "ai-voxel-studio") return null;
    const s = await fetch("/api/session", { cache: "no-store" });
    if (!s.ok) return null;
    token = (await s.json()).token;
  } catch {
    return null;
  }
  const headers = { "content-type": "application/json", "x-vox-token": token };
  const client = Math.random().toString(36).slice(2, 10);
  let rev = 0;
  const queue: Op[] = []; // local edits not yet confirmed by the server
  let sending = false;
  let syncing: Promise<void> | null = null;
  const buffered: { rev: number; req: CommandRequest; hash: string }[] = [];
  let opCounter = 0;

  const api = async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) }, cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };

  /** Loads the server project. Serialized: concurrent callers share one reload. */
  const resync = (): Promise<void> => {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        // our own unsent edits must reach the server first, otherwise the reload would drop them
        await drain();
        const d = await api("/api/project");
        engine.loadFile(d.file);
        rev = d.rev;
        opts.onStatus(`서버와 동기화됨 · ${engine.project.world.blockCount.toLocaleString()}블록`);
      } finally {
        syncing = null;
      }
      // events that arrived during the reload
      const pendingEvents = buffered.splice(0).filter((e) => e.rev > rev).sort((a, b) => a.rev - b.rev);
      for (const e of pendingEvents) applyRemote(e);
    })();
    return syncing;
  };

  const applyRemote = (d: { rev: number; req: CommandRequest; hash: string }) => {
    if (syncing) { buffered.push(d); return; }
    if (d.rev <= rev) return; // duplicate / already included
    if (d.rev !== rev + 1 || queue.length) { buffered.push(d); void resync(); return; }
    const r = engine.execute(d.req);
    rev = d.rev;
    if (!r.ok || engine.project.stateHash() !== d.hash) { void resync(); return; }
    opts.onRemote(r.summary);
  };

  /** sends queued local edits one by one; retries the same opId until the server answers */
  const drain = async (): Promise<void> => {
    if (sending) {
      while (sending) await new Promise((r) => setTimeout(r, 30));
      return;
    }
    sending = true;
    try {
      while (queue.length) {
        const op = queue[0];
        let out: any;
        for (let attempt = 0; ; attempt++) {
          try {
            out = await api("/api/command", { method: "POST", body: JSON.stringify({ client, opId: op.opId, baseRev: op.baseRev, requests: [op.req] }) });
            break;
          } catch {
            opts.onStatus("서버 연결 대기 중 — 편집 내용은 보관 중이며 연결되면 전송합니다");
            await new Promise((r) => setTimeout(r, Math.min(5000, 300 * 2 ** attempt)));
          }
        }
        queue.shift();
        const res = out.responses?.[0];
        const inOrder = op.baseRev === rev && out.rev === rev + 1;
        if (res?.ok && inOrder && out.hash === op.localHash) rev = out.rev;
        else if (!syncing) {
          // the server applied it on top of other changes (or refused it): take the server state
          queueMicrotask(() => void resync());
          rev = Math.max(rev, out.rev ?? rev);
        }
      }
    } finally {
      sending = false;
    }
  };

  await resync();

  const es = new EventSource(`/api/events?client=${client}&token=${encodeURIComponent(token)}${opts.headless ? "&headless=1" : ""}`);
  es.addEventListener("hello", (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { rev: number; hash: string };
    // (re)connected: if anything happened while we were away, resync (after our queued edits)
    if (d.rev !== rev || d.hash !== engine.project.stateHash()) void resync();
    opts.onStatus("서버에 연결됨 (AI 명령이 실시간으로 반영됩니다)");
  });
  es.addEventListener("cmd", (ev) => applyRemote(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("reload", () => void resync());
  es.addEventListener("render", async (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { id: string; args: { views: string[]; isolate?: string[]; labels?: boolean; width?: number; height?: number } };
    let body: unknown;
    try { body = { id: d.id, ...viewport.renderViews(d.args) }; } catch (e) { body = { id: d.id, error: (e as Error).message }; }
    await api("/api/render-result", { method: "POST", body: JSON.stringify(body) }).catch(() => {});
  });
  es.onerror = () => opts.onStatus("서버 연결 끊김 — 다시 연결 중…");

  return {
    client,
    get rev() { return rev; },
    get pending() { return queue.length; },
    mirror(req) {
      const def = engine.commands.get(req.cmd);
      if (!def || !(def.mutates || MIRRORED.has(req.cmd))) return;
      queue.push({ opId: `${client}-${Date.now().toString(36)}-${opCounter++}`, req, baseRev: rev + queue.length, localHash: engine.project.stateHash() });
      void drain();
    },
    async serverHistory(cmd) {
      await drain();
      const before = rev;
      const out = await api("/api/command", { method: "POST", body: JSON.stringify({ client, opId: `${client}-h-${Date.now().toString(36)}-${opCounter++}`, baseRev: rev, requests: [{ cmd }] }) });
      const res = out.responses?.[0] as CommandResponse | undefined;
      if (!res?.ok) return res;
      // apply locally only when our history matches the server's (nothing interleaved)
      if (out.rev === before + 1 && !syncing) {
        engine.execute({ cmd });
        if (engine.project.stateHash() === out.hash) { rev = out.rev; return res; }
      }
      await resync();
      return res;
    },
    async replaceProject() {
      await drain();
      const out = await api("/api/project", { method: "POST", body: JSON.stringify({ client, file: engine.project.toFile(true) }) });
      rev = out.rev;
    },
    async flush() {
      await drain();
      if (syncing) await syncing;
    },
  };
}
