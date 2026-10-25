import { z } from "zod";
import { keyToCell } from "./coords";
import { AssetRegistry, AssetStore } from "./assets/registry";
import { Project, ProjectFile, defaultMeta } from "./project";
import { World } from "./world";
import { CmdCtx, CmdError, CommandDef, Diff, Host, Tx } from "./commands/framework";
import type { LogEntry, ProjectMeta } from "./types";
import { ALL_COMMANDS } from "./commands";

export interface CommandRequest {
  cmd: string;
  args?: unknown;
  id?: string;
}

export type CommandResponse =
  | { ok: true; id?: string; cmd: string; result: any; warnings: string[]; summary: string }
  | { ok: false; id?: string; cmd: string; error: { code: string; message: string; path?: string; hint?: string } };

interface HistoryEntry {
  label: string;
  diff: Diff;
  metaBefore: string;
  metaAfter: string;
  logEntry?: LogEntry;
}

const HISTORY_LIMIT = 200;
const HISTORY_CELL_BUDGET = 4_000_000;

export interface EngineOptions {
  host?: Host;
  library?: AssetStore;
  assets?: AssetRegistry;
}

/**
 * The single command executor. UI, CLI, HTTP and MCP all call execute().
 * Every mutating command runs inside a transaction: on error everything is rolled back.
 */
export class Engine {
  readonly assets: AssetRegistry;
  readonly host?: Host;
  project: Project;
  readonly commands = new Map<string, CommandDef>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: { type: string; cmd?: string }) => void>();
  /** last edit apply time in ms (shown in the status bar) */
  lastEditMs = 0;

  constructor(opts: EngineOptions = {}) {
    this.assets = opts.assets ?? new AssetRegistry(opts.library);
    this.host = opts.host;
    this.project = new Project(this.assets);
    for (const c of ALL_COMMANDS) this.commands.set(c.name, c as CommandDef);
  }

  onChange(cb: (e: { type: string; cmd?: string }) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(type: string, cmd?: string) {
    for (const l of this.listeners) l({ type, cmd });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Execute one JSON command. Never throws: errors come back as { ok:false }. */
  execute(req: CommandRequest): CommandResponse {
    const cmd = String(req?.cmd ?? "");
    const def = this.commands.get(cmd);
    if (!def) {
      const near = [...this.commands.keys()].filter((n) => n.toLowerCase().includes(cmd.toLowerCase().slice(0, 5)));
      return {
        ok: false, id: req?.id, cmd,
        error: { code: "UNKNOWN_COMMAND", message: `unknown command "${cmd}"`, hint: near.length ? `did you mean: ${near.join(", ")}? (listCommands shows all)` : "call listCommands" },
      };
    }
    const parsed = def.schema.safeParse(req.args ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false, id: req.id, cmd,
        error: {
          code: "INVALID_ARGS",
          path: ["args", ...issue.path.map(String)].join("."),
          message: issue.message,
          hint: `example: ${JSON.stringify(def.example)}`,
        },
      };
    }
    const t0 = performance.now();
    const warnings: string[] = [];
    const tx = new Tx(this.project);
    const metaBefore = def.mutates ? JSON.stringify(this.project.meta) : "";
    const ctx: CmdCtx = {
      project: this.project,
      tx,
      host: this.host,
      warnings,
      engine: this,
      run: (sub, subArgs) => this.runNested(ctx, sub, subArgs),
    };
    try {
      const result = def.run(ctx, parsed.data);
      if (def.mutates) {
        this.refreshStructureBoxes(tx);
        if (tx.skippedOutOfBounds) warnings.push(`${tx.skippedOutOfBounds} block(s) outside project bounds were skipped`);
        const metaAfter = JSON.stringify(this.project.meta);
        const changed = tx.size > 0 || metaAfter !== metaBefore;
        if (changed) {
          let logEntry: LogEntry | undefined;
          if (def.logged ?? true) {
            logEntry = { seq: ++this.project.seq, cmd, args: req.args ?? {} };
            this.project.log.push(logEntry);
          }
          this.pushHistory({ label: cmd, diff: tx.finalize(), metaBefore, metaAfter, logEntry });
        }
        this.lastEditMs = performance.now() - t0;
        if (changed) this.emit("change", cmd);
      }
      const summary = def.summarize ? def.summarize(result, parsed.data) : defaultSummary(cmd, result);
      return { ok: true, id: req.id, cmd, result: result ?? {}, warnings, summary };
    } catch (e) {
      if (def.mutates) {
        tx.rollback();
        this.project.meta = JSON.parse(metaBefore) as ProjectMeta;
      }
      const err = e instanceof CmdError
        ? { code: e.code, message: e.message, hint: e.hint, path: e.path }
        : { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
      return { ok: false, id: req.id, cmd, error: err };
    }
  }

  /** Throwing variant for internal/script use. */
  run(cmd: string, args: unknown = {}): any {
    const r = this.execute({ cmd, args });
    if (!r.ok) throw new CmdError(r.error.code, `${cmd}: ${r.error.message}`, r.error.hint, r.error.path);
    return r.result;
  }

  private runNested(ctx: CmdCtx, cmd: string, args: unknown): any {
    const def = this.commands.get(cmd);
    if (!def) throw new CmdError("UNKNOWN_COMMAND", `unknown command "${cmd}"`);
    if (["undo", "redo", "newProject", "loadProject"].includes(cmd)) throw new CmdError("NOT_NESTABLE", `${cmd} cannot run inside a batch`);
    const parsed = def.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new CmdError("INVALID_ARGS", `${cmd}: ${issue.message}`, `example: ${JSON.stringify(def.example)}`, [cmd, ...issue.path.map(String)].join("."));
    }
    return def.run(ctx, parsed.data);
  }

  private refreshStructureBoxes(tx: Tx) {
    for (const num of tx.touchedStructures) {
      const s = this.project.structureByNum(num);
      if (s) s.box = this.project.structureBox(s);
    }
  }

  private pushHistory(h: HistoryEntry) {
    this.undoStack.push(h);
    this.redoStack = [];
    let cells = this.undoStack.reduce((n, e) => n + e.diff.keys.length, 0);
    while (this.undoStack.length > HISTORY_LIMIT || (cells > HISTORY_CELL_BUDGET && this.undoStack.length > 1)) {
      cells -= this.undoStack.shift()!.diff.keys.length;
    }
  }

  undo(): { undone?: string } {
    const h = this.undoStack.pop();
    if (!h) return {};
    const w = this.project.world;
    for (let i = h.diff.keys.length - 1; i >= 0; i--) {
      const [x, y, z] = keyToCell(h.diff.keys[i]);
      w.set(x, y, z, h.diff.before[i]);
    }
    this.project.meta = JSON.parse(h.metaBefore);
    if (h.logEntry) this.project.log.pop();
    this.redoStack.push(h);
    this.emit("change", "undo");
    return { undone: h.label };
  }

  redo(): { redone?: string } {
    const h = this.redoStack.pop();
    if (!h) return {};
    const w = this.project.world;
    for (let i = 0; i < h.diff.keys.length; i++) {
      const [x, y, z] = keyToCell(h.diff.keys[i]);
      w.set(x, y, z, h.diff.after[i]);
    }
    this.project.meta = JSON.parse(h.metaAfter);
    if (h.logEntry) this.project.log.push(h.logEntry);
    this.undoStack.push(h);
    this.emit("change", "redo");
    return { redone: h.label };
  }

  /** Replace the current project (new or loaded). Clears history. */
  setProject(p: Project) {
    const oldWorld = this.project.world;
    this.project = p;
    // make renderers rebuild chunks that disappeared
    for (const k of oldWorld.chunks.keys()) p.world.dirty.add(k);
    this.undoStack = [];
    this.redoStack = [];
    this.emit("load");
  }

  newProject(name = "untitled", settings?: Partial<ProjectMeta["settings"]>) {
    const meta = defaultMeta(name);
    if (settings) meta.settings = { ...meta.settings, ...settings };
    this.setProject(new Project(this.assets, meta));
  }

  loadFile(file: ProjectFile): { replayed: boolean } {
    if (file?.app !== "ai-voxel-studio") throw new CmdError("BAD_FILE", "not an ai-voxel-studio project file");
    if (file.world) {
      const p = new Project(this.assets, file.meta);
      p.world = World.deserialize(file.world);
      p.log = file.log ?? [];
      p.seq = p.log.length ? p.log[p.log.length - 1].seq : 0;
      this.setProject(p);
      return { replayed: false };
    }
    // no block snapshot: rebuild by replaying the command log
    const p = Engine.replay(file.log, this.assets, file.meta.settings, file.meta.assets);
    p.meta.name = file.meta.name;
    this.setProject(p);
    return { replayed: true };
  }

  /** Builds a fresh project from a command log (deterministic). */
  static replay(log: LogEntry[], assets: AssetRegistry, settings?: ProjectMeta["settings"], projectAssets?: ProjectMeta["assets"]): Project {
    const e = new Engine({ assets });
    if (settings) e.project.meta.settings = structuredClone(settings);
    // assets referenced by the log must be resolvable even if the shared library is gone
    if (projectAssets) e.project.meta.assets = structuredClone(projectAssets);
    for (const entry of log) {
      const r = e.execute({ cmd: entry.cmd, args: entry.args });
      if (!r.ok) throw new CmdError("REPLAY_FAILED", `replay failed at #${entry.seq} ${entry.cmd}: ${r.error.message}`);
    }
    return e.project;
  }

  commandList() {
    return [...this.commands.values()].map((c) => ({ name: c.name, group: c.group, description: c.description, example: c.example }));
  }

  commandSchema(name: string) {
    const c = this.commands.get(name);
    if (!c) return undefined;
    return { name: c.name, description: c.description, inputSchema: z.toJSONSchema(c.schema, { io: "input", unrepresentable: "any" }), example: c.example };
  }
}

function defaultSummary(cmd: string, result: any): string {
  if (!result || typeof result !== "object") return `${cmd}: ok`;
  const parts: string[] = [];
  if (result.structureId) parts.push(result.structureId);
  if (typeof result.blocksAdded === "number") parts.push(`+${result.blocksAdded} blocks`);
  if (typeof result.blocksRemoved === "number") parts.push(`-${result.blocksRemoved} blocks`);
  if (typeof result.blocksChanged === "number") parts.push(`${result.blocksChanged} changed`);
  return `${cmd}: ${parts.length ? parts.join(", ") : "ok"}`;
}
