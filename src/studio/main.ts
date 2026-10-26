// Studio entry: wires the engine, the viewport and the sidebar (layout follows docs/ref/*.png).
import { Engine, CommandRequest, CommandResponse } from "../engine/engine";
import type { Vec3 } from "../engine/coords";
import { FACINGS } from "../engine/coords";
import type { ProjectFile } from "../engine/project";
import { toRequests } from "../cli/input";
import { Viewport, ViewPreset, Ambience } from "./viewport";
import { idbGet, idbPut, localStorageLibrary, downloadText, pickFile } from "./storage";
import { buildDemo, EXAMPLES } from "./examples";
import { runBench, showBenchPanel } from "./bench";
import { connectServer, Link } from "./link";
import { t, lang, setLang, assetName } from "./i18n";
import { exportGLB } from "../export/glb";

type Mode = "view" | "add" | "remove" | "paint";

const engine = new Engine({ library: localStorageLibrary() });
const params = new URLSearchParams(location.search);
const HEADLESS = params.has("headless");
let link: Link | null = null;

const state = {
  mode: "view" as Mode,
  shape: "builtin.cube",
  material: "builtin.iron_lower",
  yaw: 0,
  upsideDown: false,
  view: "all" as ViewPreset,
  ambience: "day" as Ambience,
  autoRotate: false,
  grid: false,
  shadows: true,
  selected: undefined as string | undefined,
  output: [] as { ok: boolean; text: string }[],
};

// ---------------- DOM skeleton ----------------
const app = document.getElementById("app")!;
app.innerHTML = `
<header class="header">
  <div class="logo">塔</div>
  <div class="brand"><b id="app-name"></b><span id="app-sub"></span></div>
  <div class="spacer"></div>
  <div class="toolbar">
    <button data-act="new"></button>
    <button data-act="open"></button>
    <button data-act="save"></button>
    <button data-act="glb">GLB</button>
    <button data-act="undo">↶</button>
    <button data-act="redo">↷</button>
    <button data-act="lang" id="lang-btn"></button>
  </div>
  <div class="places" id="places"></div>
</header>
<aside class="side" id="side"></aside>
<main class="view" id="view">
  <div class="tag" id="tag"></div>
  <svg class="compass" viewBox="0 0 40 52"><text x="20" y="9" text-anchor="middle" font-size="8" fill="currentColor">N</text><g id="needle"><line x1="20" y1="44" x2="20" y2="16" stroke="currentColor" stroke-width="1.2"/></g></svg>
  <div class="helptext" id="helptext"></div>
  <div class="busy" id="busy" hidden></div>
  <div class="toast" id="toast"></div>
  <button class="shot" id="shot"></button>
</main>
<footer class="status" id="status"></footer>`;

const $ = (id: string) => document.getElementById(id)!;
const viewport = new Viewport($("view"), engine);
(window as unknown as { studio: unknown }).studio = { engine, viewport, exec, state, get link() { return link; } };

// ---------------- command helpers ----------------
function exec(req: CommandRequest, echo = false): CommandResponse {
  if (link && (req.cmd === "undo" || req.cmd === "redo")) {
    // linked: history is the server's (shared with AI agents and other tabs)
    const cmd = req.cmd;
    link.serverHistory(cmd).then((r) => { if (r) log(r); afterBigChange(); renderSide(); }).catch((e) => toast(t("historyFailed", { cmd, m: (e as Error).message })));
    return { ok: true, cmd, result: {}, warnings: [], summary: `${cmd} (${t("serverSide")})` };
  }
  const r = engine.execute(req);
  if (r.ok) link?.mirror(req);
  if (echo || !r.ok) log(r);
  return r;
}

function log(r: CommandResponse) {
  state.output.unshift(r.ok
    ? { ok: true, text: `✓ ${r.summary}${r.warnings.length ? "  ⚠ " + r.warnings.join("; ") : ""}` }
    : { ok: false, text: `✗ ${r.cmd}: ${r.error.message}${r.error.hint ? "  → " + r.error.hint : ""}` });
  state.output = state.output.slice(0, 60);
  if (!r.ok) toast(`${r.error.message}`);
}

let toastTimer = 0;
function toast(text: string) {
  const box = $("toast");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.remove("show"), 2600);
}

// ---------------- sidebar ----------------
const PRIMARY_SHAPES = [
  ["builtin.cube", "shape.cube"], ["builtin.slab", "shape.slab"], ["builtin.stair", "shape.stair"], ["builtin.wedge", "shape.wedge"], ["builtin.floor", "shape.floor"],
] as const;

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function renderSide() {
  const p = engine.project;
  const m = p.meta;
  const mats = engine.assets.allMaterials(m.assets.materials);
  const matName = mats.find((x) => x.id === state.material)?.name ?? state.material;
  const shapes = engine.assets.allShapes(m.assets.shapes);
  const extra = shapes.filter((s) => !PRIMARY_SHAPES.some(([id]) => id === s.id));
  const deg = state.yaw * 90 + (state.upsideDown ? ` · ${t("flipped")}` : "");

  const structs = m.structures;
  const byBuilding = new Map<string, typeof structs>();
  for (const s of structs) {
    const k = s.buildingId ?? "";
    if (!byBuilding.has(k)) byBuilding.set(k, []);
    byBuilding.get(k)!.push(s);
  }
  const treeHtml = structs.length === 0
    ? `<div class="empty">${t("noStructs")}</div>`
    : [...byBuilding.entries()].map(([bid, list]) => {
        const b = m.buildings.find((x) => x.id === bid);
        const head = b ? `<div class="node bld"><span class="nm">${esc(b.name)}</span></div>` : "";
        return head + list.map((s) => {
          const n = p.world.structIndex.get(s.num)?.size ?? 0;
          return `<div class="node ${state.selected === s.id ? "sel" : ""}" data-sid="${s.id}">
            <span class="nm">${esc(s.name)}<small>${esc(s.type)} · ${n.toLocaleString()}</small></span>
            <span class="acts">
              <button data-sact="focus" title="${t("s.focus")}">◎</button>
              <button data-sact="vis" class="${s.visible ? "" : "off"}" title="${t("s.vis")}">${s.visible ? t("s.shown") : t("s.hidden")}</button>
              <button data-sact="lock" class="${s.locked ? "off" : ""}" title="${t("s.lock")}">${s.locked ? t("s.locked") : t("s.lock")}</button>
              ${s.source && engine.commands.has("rebuildStructure") ? `<button data-sact="rebuild" title="${t("s.rebuild.t")}">${t("s.rebuild")}</button>` : ""}
              <button data-sact="del" title="${t("s.del")}">✕</button>
            </span></div>`;
        }).join("");
      }).join("");

  $("side").innerHTML = `
    <div class="crumb">${esc(m.name)} / ${t("grid", { n: m.settings.cellSize })}</div>
    <h1 class="title">${esc(m.title || m.name)}</h1>
    <p class="desc">${esc(m.description || t("defaultDesc", { b: p.world.blockCount.toLocaleString(), s: structs.length }))}</p>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.view")}</b></div>
      <div class="row c2">
        <button class="btn ${state.view === "all" ? "on" : ""}" data-view="all">${t("view.all")}</button>
        <button class="btn ${state.view === "main" ? "on" : ""}" data-view="main">${t("view.main")}</button>
      </div>
      <div class="row c3">
        <button class="btn ${state.view === "front" ? "on" : ""}" data-view="front">${t("view.front")}</button>
        <button class="btn ${state.view === "side" ? "on" : ""}" data-view="side">${t("view.side")}</button>
        <button class="btn ${state.view === "top" ? "on" : ""}" data-view="top">${t("view.top")}</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.light")}</b></div>
      <div class="row c3">
        <button class="btn ${state.ambience === "day" ? "on" : ""}" data-amb="day">${t("amb.day")}</button>
        <button class="btn ${state.ambience === "dusk" ? "on" : ""}" data-amb="dusk">${t("amb.dusk")}</button>
        <button class="btn ${state.ambience === "moon" ? "on" : ""}" data-amb="moon">${t("amb.moon")}</button>
      </div>
      <div class="checks">
        <label><input type="checkbox" id="chk-rot" ${state.autoRotate ? "checked" : ""}/>${t("chk.rot")}</label>
        <label><input type="checkbox" id="chk-shadow" ${state.shadows ? "checked" : ""}/>${t("chk.shadow")}</label>
        <label><input type="checkbox" id="chk-grid" ${state.grid ? "checked" : ""}/>${t("chk.grid")}</label>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.edit")}</b><span>${t("facing")} ${deg}°</span></div>
      <div class="row c4">
        ${(["view", "add", "remove", "paint"] as Mode[]).map((md) => `<button class="btn ${state.mode === md ? "on" : ""}" data-mode="${md}">${t(`mode.${md}`)}</button>`).join("")}
      </div>
      <div class="row c5">
        ${PRIMARY_SHAPES.map(([id, nm]) => `<button class="btn sm ${state.shape === id ? "on" : ""}" data-shape="${id}">${t(nm)}</button>`).join("")}
      </div>
      <select class="more" id="more-shapes">
        <option value="">${t("moreShapes", { n: extra.length })}</option>
        ${extra.map((s) => `<option value="${s.id}" ${state.shape === s.id ? "selected" : ""}>${esc(assetName(s))}${s.size ? ` (${s.size.join("x")})` : ""} — ${esc(s.id)}</option>`).join("")}
      </select>
      <div class="hint"><span>${t("rotateHint")}</span><kbd>R</kbd></div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.mat")}</b><span>${esc(matName)}</span></div>
      <div class="swatches">
        ${mats.map((mt) => `<button class="sw ${mt.id === state.material ? "on" : ""} ${(mt.opacity ?? 1) < 1 ? "glass" : ""}" data-mat="${mt.id}" title="${esc(assetName(mt))} (${mt.id})" style="background-color:${mt.color}"></button>`).join("")}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.struct")}</b><span>${t("count", { n: structs.length })}</span></div>
      <div class="tree">${treeHtml}</div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>${t("sec.ai")}</b><span>${t("ai.kind")}</span></div>
      <select class="more" id="examples">
        <option value="">${t("loadExample")}</option>
        ${EXAMPLES.map((e, i) => `<option value="${i}">${esc(t(e.name))}</option>`).join("")}
      </select>
      <textarea class="cmd" id="cmd" spellcheck="false" placeholder='{"cmd":"fillRegion","args":{"from":[0,0,0],"to":[4,0,4],"material":"stone"}}'></textarea>
      <div class="row c3" style="margin-top:5px">
        <button class="btn on" id="run">${t("run")}</button>
        <button class="btn" id="inspect" title="${t("inspect.t")}">${t("inspect")}</button>
        <button class="btn" id="cmds">${t("commands")}</button>
      </div>
      <div class="out" id="out">${state.output.map((o) => `<div class="${o.ok ? "ok" : "err"}">${esc(o.text)}</div>`).join("")}</div>
    </div>`;

  // keep textarea content across re-renders
  ($("cmd") as HTMLTextAreaElement).value = cmdDraft;
  ($("cmd") as HTMLTextAreaElement).oninput = (e) => (cmdDraft = (e.target as HTMLTextAreaElement).value);

  $("places").innerHTML = m.tags.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join("");
  $("tag").innerHTML = `<i></i>${esc(m.name)}${m.title ? " · " + esc(m.title) : ""} <em>v${p.log.length}</em>`;
  document.querySelectorAll<HTMLButtonElement>("[data-act=undo]").forEach((b) => (b.disabled = !link && !engine.canUndo));
  document.querySelectorAll<HTMLButtonElement>("[data-act=redo]").forEach((b) => (b.disabled = !link && !engine.canRedo));
}
let cmdDraft = "";

// ---------------- sidebar events (delegated) ----------------
$("side").addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const btn = el.closest("button") as HTMLButtonElement | null;
  if (!btn) {
    const node = el.closest("[data-sid]") as HTMLElement | null;
    if (node) { state.selected = node.dataset.sid; renderSide(); }
    return;
  }
  const d = btn.dataset;
  if (d.view) { state.view = d.view as ViewPreset; viewport.view(state.view); }
  else if (d.amb) { state.ambience = d.amb as Ambience; viewport.setAmbience(state.ambience); }
  else if (d.mode) { state.mode = d.mode as Mode; updateHelp(); }
  else if (d.shape) { state.shape = d.shape; if (state.mode === "view") state.mode = "add"; updateHelp(); }
  else if (d.mat) { state.material = d.mat; if (state.mode === "view") state.mode = "paint"; updateHelp(); }
  else if (d.sact) {
    const sid = (btn.closest("[data-sid]") as HTMLElement).dataset.sid!;
    const s = engine.project.structure(sid);
    if (!s) return;
    if (d.sact === "focus" && s.box) viewport.focusBox(s.box.min, s.box.max, viewport.camera.position.clone().sub(viewport.controls.target));
    if (d.sact === "vis") exec({ cmd: "setStructure", args: { id: sid, visible: !s.visible } }, true);
    if (d.sact === "lock") exec({ cmd: "setStructure", args: { id: sid, locked: !s.locked } }, true);
    if (d.sact === "rebuild") exec({ cmd: "rebuildStructure", args: { id: sid } }, true);
    if (d.sact === "del" && confirm(t("confirmDel", { name: s.name, id: s.id }))) exec({ cmd: "deleteStructure", args: { id: sid } }, true);
    state.selected = sid;
  } else if (btn.id === "run") runCommandText();
  else if (btn.id === "inspect") {
    const r = exec({ cmd: "inspectProject" });
    if (r.ok) {
      const issues = r.result.issues as { severity: string; message: string; bounds?: { min: Vec3; max: Vec3 } }[];
      state.output.unshift({ ok: r.result.ok, text: `${r.result.ok ? "✓" : "✗"} ${r.summary}` });
      for (const i of issues.filter((x) => x.severity !== "info").slice(0, 10).reverse()) state.output.unshift({ ok: i.severity !== "error", text: `  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}` });
      const first = issues.find((x) => x.severity !== "info" && x.bounds);
      if (first?.bounds) viewport.focusBox(first.bounds.min, first.bounds.max, viewport.camera.position.clone().sub(viewport.controls.target));
    }
  }
  else if (btn.id === "cmds") {
    const r = exec({ cmd: "listCommands" });
    if (r.ok) state.output.unshift({ ok: true, text: r.result.commands.map((c: { name: string }) => c.name).join(", ") });
  } else return;
  renderSide();
});

$("side").addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (t.id === "chk-rot") { state.autoRotate = (t as HTMLInputElement).checked; viewport.controls.autoRotate = state.autoRotate; }
  if (t.id === "chk-grid") { state.grid = (t as HTMLInputElement).checked; viewport.setGrid(state.grid); }
  if (t.id === "chk-shadow") { state.shadows = (t as HTMLInputElement).checked; viewport.setShadows(state.shadows); }
  if (t.id === "more-shapes" && t.value) { state.shape = t.value; if (state.mode === "view") state.mode = "add"; renderSide(); updateHelp(); }
  if (t.id === "examples" && t.value !== "") { loadExample(Number(t.value)); }
});

function runCommandText() {
  const text = cmdDraft.trim();
  if (!text) return;
  let reqs: CommandRequest[];
  try {
    reqs = toRequests(JSON.parse(text));
  } catch (err) {
    state.output.unshift({ ok: false, text: `✗ ${t("jsonError", { m: (err as Error).message })}` });
    return;
  }
  for (const r of reqs) {
    const res = exec(r, true);
    if (!res.ok) break;
  }
  afterBigChange();
}

function loadExample(i: number) {
  const ex = EXAMPLES[i];
  if (!ex) return;
  if (engine.project.world.blockCount > 0 && !confirm(t("confirmExample", { name: t(ex.name) }))) return;
  const t0 = performance.now();
  ex.build(engine, (r) => log(r), (req) => exec(req));
  state.output.unshift({ ok: true, text: `✓ ${t("exampleBuilt", { name: t(ex.name), b: engine.project.world.blockCount.toLocaleString(), ms: Math.round(performance.now() - t0) })}` });
  viewport.chunks.reset();
  afterBigChange();
  state.view = "all";
  viewport.view("all", false);
  renderSide();
}

function afterBigChange() {
  viewport.fitShadow();
  if (state.grid) viewport.setGrid(true);
}

// ---------------- header toolbar ----------------
document.querySelector(".toolbar")!.addEventListener("click", async (e) => {
  const act = (e.target as HTMLElement).closest("button")?.dataset.act;
  if (act === "lang") {
    setLang(lang === "ko" ? "en" : "ko");
    applyStaticText();
    lastStatus = "";
  } else if (act === "new") {
    const name = prompt(t("newName"), t("newNameDefault"));
    if (name === null) return;
    exec({ cmd: "newProject", args: { name } }, true);
    viewport.chunks.reset();
    afterBigChange();
    viewport.view("all", false);
  } else if (act === "save") saveFile();
  else if (act === "glb") {
    const { bytes, triangles } = exportGLB(engine.project);
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${engine.project.meta.name || "scene"}.glb`;
    a.click();
    toast(t("glbDone", { n: triangles.toLocaleString() }));
  }
  else if (act === "open") {
    const f = await pickFile(".json,.vox.json");
    if (!f) return;
    try {
      const file = JSON.parse(await f.text()) as ProjectFile;
      engine.loadFile(file);
      await link?.replaceProject();
      viewport.chunks.reset();
      afterBigChange();
      viewport.view("all", false);
      toast(t("opened", { f: f.name, b: engine.project.world.blockCount.toLocaleString() }));
    } catch (err) {
      toast(t("openFailed", { m: (err as Error).message }));
    }
  } else if (act === "undo") exec({ cmd: "undo" }, true);
  else if (act === "redo") exec({ cmd: "redo" }, true);
  renderSide();
});

function saveFile() {
  const name = (engine.project.meta.name || "project").replace(/[\\/:*?"<>|]+/g, "_");
  downloadText(`${name}.vox.json`, JSON.stringify(engine.project.toFile(true)));
  toast(t("saved"));
}

$("shot").addEventListener("click", () => {
  const url = viewport.screenshot();
  const a = document.createElement("a");
  a.href = url;
  a.download = `${engine.project.meta.name || "scene"}-${Date.now()}.png`;
  a.click();
});

// ---------------- viewport editing ----------------
const canvas = viewport.renderer.domElement;
let down: { x: number; y: number; b: number } | null = null;
canvas.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, b: e.button }));
canvas.addEventListener("pointerup", (e) => {
  if (!down || down.b !== 0) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
  down = null;
  if (moved) return;
  clickAt(e.clientX, e.clientY);
});
canvas.addEventListener("pointermove", (e) => hoverAt(e.clientX, e.clientY));
canvas.addEventListener("pointerleave", () => { viewport.showHighlight(null); viewport.showGhost(null, state.shape, 0); });

function rot() {
  return state.yaw | (state.upsideDown ? 4 : 0);
}

function targetFor(clientX: number, clientY: number): { place?: Vec3; hit?: Vec3 } {
  const h = viewport.pick(clientX, clientY);
  if (!h) return {};
  const place: Vec3 = [h.cell[0] + h.normal[0], h.cell[1] + h.normal[1], h.cell[2] + h.normal[2]];
  return { place, hit: h.ground ? undefined : h.cell };
}

function hoverAt(x: number, y: number) {
  const tg = targetFor(x, y);
  if (state.mode === "add") {
    viewport.showHighlight(tg.place ?? null, "#2a7a5f");
    viewport.showGhost(tg.place ?? null, state.shape, rot());
  } else {
    viewport.showGhost(null, state.shape, 0);
    viewport.showHighlight(tg.hit ?? null, state.mode === "remove" ? "#a33a2c" : "#1f5e4c");
  }
}

function clickAt(x: number, y: number) {
  const tg = targetFor(x, y);
  if (state.mode === "view") {
    if (tg.hit) {
      const b = engine.project.blockAt(...tg.hit);
      state.selected = b?.structure;
      if (b) toast(`${b.structure ?? t("noStructure")} · ${b.shape.replace("builtin.", "")} · ${b.material.replace("builtin.", "")}  [${tg.hit.join(", ")}]`);
      renderSide();
    }
    return;
  }
  let r: CommandResponse | undefined;
  if (state.mode === "add" && tg.place) {
    r = exec({ cmd: "editBlocks", args: { ops: [{ op: "set", at: tg.place, shape: state.shape, material: state.material, facing: FACINGS[state.yaw], upsideDown: state.upsideDown }] } });
  } else if (state.mode === "remove" && tg.hit) {
    r = exec({ cmd: "editBlocks", args: { ops: [{ op: "remove", at: tg.hit }] } });
  } else if (state.mode === "paint" && tg.hit) {
    r = exec({ cmd: "replaceInRegion", args: { from: tg.hit, to: tg.hit, material: state.material } });
  }
  if (r) { hoverAt(x, y); renderSide(); }
}

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); exec({ cmd: e.shiftKey ? "redo" : "undo" }, true); renderSide(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); exec({ cmd: "redo" }, true); renderSide(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); return; }
  if (e.key === "r" || e.key === "R") {
    if (e.shiftKey) state.upsideDown = !state.upsideDown; else state.yaw = (state.yaw + 1) % 4;
    renderSide();
  }
  if (e.key === "Escape") { state.mode = "view"; renderSide(); updateHelp(); }
  const views: Record<string, ViewPreset> = { "1": "all", "2": "main", "3": "front", "4": "side", "5": "top" };
  if (views[e.key]) { state.view = views[e.key]; viewport.view(state.view); renderSide(); }
});

/** texts outside the sidebar (header, buttons, help line) */
function applyStaticText() {
  document.documentElement.lang = lang;
  $("app-name").textContent = t("appName");
  $("app-sub").textContent = t("appSub");
  const set = (act: string, text: string | null, title: string) => {
    const b = document.querySelector<HTMLButtonElement>(`[data-act=${act}]`)!;
    if (text !== null) b.textContent = text;
    b.title = title;
  };
  set("new", t("tb.new"), t("tb.new.t"));
  set("open", t("tb.open"), t("tb.open.t"));
  set("save", t("tb.save"), t("tb.save.t"));
  set("glb", null, t("tb.glb.t"));
  set("undo", null, t("tb.undo.t"));
  set("redo", null, t("tb.redo.t"));
  set("lang", lang === "ko" ? "EN" : "한국어", t("tb.lang.t"));
  $("shot").innerHTML = `${t("shot")} &nbsp;↗`;
  document.title = `${t("appName")} — AI Voxel Architecture Studio`;
  if (linkStatus) linkStatus = t("linked");
  updateHelp();
}

function updateHelp() {
  $("helptext").textContent = {
    view: t("help.view"),
    add: t("help.add"),
    remove: t("help.remove"),
    paint: t("help.paint"),
  }[state.mode];
}

// ---------------- status bar + compass + autosave ----------------
let lastStatus = "";
let linkStatus = "";
viewport.frameHooks.push(() => {
  const c = viewport.chunks;
  const s = `${linkStatus ? `<span class="link">● ${linkStatus}</span> <span class="sep">/</span> ` : ""}${engine.project.world.blockCount.toLocaleString()} ${t("st.blocks")} <span class="sep">/</span> ${c.visibleBlocks.toLocaleString()} ${t("st.visible")} <span class="sep">/</span> ${Math.round(viewport.fps)} FPS <span class="sep">/</span> ${t("st.edit")} ${engine.lastEditMs.toFixed(1)}ms <span class="sep">/</span> ${t("st.meshes")} ${c.stats().meshes} <span class="right">Minecraft-inspired · WebGL</span>`;
  if (s !== lastStatus) { $("status").innerHTML = s; lastStatus = s; }
  $("needle").setAttribute("transform", `rotate(${(-viewport.azimuth() * 180) / Math.PI} 20 30)`);
  const busy = $("busy");
  if (c.pending > 0) { busy.hidden = false; busy.textContent = t("meshing", { n: c.pending }); } else busy.hidden = true;
});

let saveTimer = 0;
engine.onChange((e) => {
  if (e.type === "load") viewport.chunks.reset();
  renderSide();
  clearTimeout(saveTimer);
  if (HEADLESS) return;
  saveTimer = window.setTimeout(() => {
    idbPut("autosave", JSON.stringify(engine.project.toFile(true))).catch(() => toast(t("autosaveFailed")));
  }, 1200);
});

// ---------------- boot ----------------
async function boot() {
  applyStaticText();
  let restored = false;
  // 1) a vox server on the same origin? (npm run serve / run.bat) -> live link, server is the source of truth
  if (!params.has("bench")) {
    link = await connectServer(engine, viewport, {
      headless: HEADLESS,
      onStatus: (s) => { linkStatus = t("linked"); if (!HEADLESS) toast(s); },
      onRemote: (summary) => { if (!HEADLESS) toast(`AI · ${summary}`); afterBigChange(); renderSide(); },
    });
  }
  if (link) {
    linkStatus = t("linked");
    restored = true;
    if (engine.project.world.blockCount === 0 && engine.project.meta.structures.length === 0 && !HEADLESS) buildDemo(engine, () => {}, (r) => exec(r));
  } else if (!HEADLESS) {
    // 2) standalone: restore the browser autosave
    try {
      const saved = await idbGet("autosave");
      if (saved) {
        engine.loadFile(JSON.parse(saved));
        restored = engine.project.world.blockCount > 0 || engine.project.meta.structures.length > 0;
      }
    } catch { /* first run or blocked storage */ }
    if (!restored) buildDemo(engine);
  }
  viewport.chunks.reset();
  afterBigChange();
  viewport.view("all", false);
  renderSide();
  applyStaticText();
  if (restored && !link) toast(t("restored"));
  const bench = new URLSearchParams(location.search).get("bench");
  if (bench !== null) {
    const ids = bench && bench !== "1" ? bench.split(",") : null;
    const secs = Number(new URLSearchParams(location.search).get("seconds") ?? 10);
    const data = await runBench(engine, viewport, ids, secs, (msg) => { $("helptext").textContent = `${t("benchPrefix")} · ${msg}`; });
    (window as unknown as { __bench: unknown }).__bench = data;
    showBenchPanel($("view"), data);
    renderSide();
  }
}
boot();
