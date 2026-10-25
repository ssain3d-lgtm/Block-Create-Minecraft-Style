// Studio entry: wires the engine, the viewport and the sidebar (layout follows docs/ref/*.png).
import { Engine, CommandRequest, CommandResponse } from "../engine/engine";
import type { Vec3 } from "../engine/coords";
import { FACINGS } from "../engine/coords";
import type { ProjectFile } from "../engine/project";
import { toRequests } from "../cli/input";
import { Viewport, ViewPreset, Ambience } from "./viewport";
import { idbGet, idbPut, localStorageLibrary, downloadText, pickFile } from "./storage";
import { buildDemo, EXAMPLES } from "./examples";

type Mode = "view" | "add" | "remove" | "paint";

const engine = new Engine({ library: localStorageLibrary() });

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
  <div class="brand"><b>작은 세계 건축소</b><span>Voxel architecture studio</span></div>
  <div class="spacer"></div>
  <div class="toolbar">
    <button data-act="new" title="새 프로젝트">새로</button>
    <button data-act="open" title="프로젝트 파일 열기">열기</button>
    <button data-act="save" title="프로젝트 파일 저장 (Ctrl+S)">저장</button>
    <button data-act="undo" title="되돌리기 (Ctrl+Z)">↶</button>
    <button data-act="redo" title="다시하기 (Ctrl+Y)">↷</button>
  </div>
  <div class="places" id="places"></div>
</header>
<aside class="side" id="side"></aside>
<main class="view" id="view">
  <div class="tag" id="tag"></div>
  <svg class="compass" viewBox="0 0 40 52"><text x="20" y="9" text-anchor="middle" font-size="8" fill="currentColor">N</text><g id="needle"><line x1="20" y1="44" x2="20" y2="16" stroke="currentColor" stroke-width="1.2"/></g></svg>
  <div class="helptext" id="helptext">드래그로 회전 · 휠로 확대 · 우클릭으로 이동</div>
  <div class="busy" id="busy" hidden></div>
  <div class="toast" id="toast"></div>
  <button class="shot" id="shot">사진 저장 &nbsp;↗</button>
</main>
<footer class="status" id="status"></footer>`;

const $ = (id: string) => document.getElementById(id)!;
const viewport = new Viewport($("view"), engine);
(window as unknown as { studio: unknown }).studio = { engine, viewport, exec, state };

// ---------------- command helpers ----------------
function exec(req: CommandRequest, echo = false): CommandResponse {
  const r = engine.execute(req);
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
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------------- sidebar ----------------
const PRIMARY_SHAPES = [
  ["builtin.cube", "큐브"], ["builtin.slab", "반블록"], ["builtin.stair", "계단"], ["builtin.wedge", "경사"], ["builtin.floor", "마루"],
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
  const deg = state.yaw * 90 + (state.upsideDown ? " · 뒤집힘" : "");

  const structs = m.structures;
  const byBuilding = new Map<string, typeof structs>();
  for (const s of structs) {
    const k = s.buildingId ?? "";
    if (!byBuilding.has(k)) byBuilding.set(k, []);
    byBuilding.get(k)!.push(s);
  }
  const treeHtml = structs.length === 0
    ? `<div class="empty">구조물이 없습니다. AI 명령이나 예제로 건물을 지어 보세요.</div>`
    : [...byBuilding.entries()].map(([bid, list]) => {
        const b = m.buildings.find((x) => x.id === bid);
        const head = b ? `<div class="node bld"><span class="nm">${esc(b.name)}</span></div>` : "";
        return head + list.map((s) => {
          const n = p.world.structIndex.get(s.num)?.size ?? 0;
          return `<div class="node ${state.selected === s.id ? "sel" : ""}" data-sid="${s.id}">
            <span class="nm">${esc(s.name)}<small>${esc(s.type)} · ${n.toLocaleString()}</small></span>
            <span class="acts">
              <button data-sact="focus" title="카메라 맞추기">◎</button>
              <button data-sact="vis" class="${s.visible ? "" : "off"}" title="숨김/표시">${s.visible ? "보임" : "숨김"}</button>
              <button data-sact="lock" class="${s.locked ? "off" : ""}" title="잠금">${s.locked ? "잠김" : "잠금"}</button>
              ${s.source && engine.commands.has("rebuildStructure") ? `<button data-sact="rebuild" title="같은 설정으로 다시 짓기">재시공</button>` : ""}
              <button data-sact="del" title="삭제">✕</button>
            </span></div>`;
        }).join("");
      }).join("");

  $("side").innerHTML = `
    <div class="crumb">${esc(m.name)} / ${m.settings.cellSize}m 격자</div>
    <h1 class="title">${esc(m.title || m.name)}</h1>
    <p class="desc">${esc(m.description || `${p.world.blockCount.toLocaleString()}블록, ${structs.length}개 구조물`)}</p>

    <div class="sec">
      <div class="sec-h"><b>둘러보기</b></div>
      <div class="row c2">
        <button class="btn ${state.view === "all" ? "on" : ""}" data-view="all">전체</button>
        <button class="btn ${state.view === "main" ? "on" : ""}" data-view="main">탑체</button>
      </div>
      <div class="row c3">
        <button class="btn ${state.view === "front" ? "on" : ""}" data-view="front">정면</button>
        <button class="btn ${state.view === "side" ? "on" : ""}" data-view="side">측면</button>
        <button class="btn ${state.view === "top" ? "on" : ""}" data-view="top">위에서</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>빛과 분위기</b></div>
      <div class="row c3">
        <button class="btn ${state.ambience === "day" ? "on" : ""}" data-amb="day">맑은 낮</button>
        <button class="btn ${state.ambience === "dusk" ? "on" : ""}" data-amb="dusk">해 질 녘</button>
        <button class="btn ${state.ambience === "moon" ? "on" : ""}" data-amb="moon">달빛</button>
      </div>
      <div class="checks">
        <label><input type="checkbox" id="chk-rot" ${state.autoRotate ? "checked" : ""}/>천천히 회전</label>
        <label><input type="checkbox" id="chk-shadow" ${state.shadows ? "checked" : ""}/>그림자</label>
        <label><input type="checkbox" id="chk-grid" ${state.grid ? "checked" : ""}/>격자</label>
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>블록 편집</b><span>방향 ${deg}°</span></div>
      <div class="row c4">
        ${(["view", "add", "remove", "paint"] as Mode[]).map((md) => `<button class="btn ${state.mode === md ? "on" : ""}" data-mode="${md}">${{ view: "감상", add: "추가", remove: "삭제", paint: "칠하기" }[md]}</button>`).join("")}
      </div>
      <div class="row c5">
        ${PRIMARY_SHAPES.map(([id, nm]) => `<button class="btn sm ${state.shape === id ? "on" : ""}" data-shape="${id}">${nm}</button>`).join("")}
      </div>
      <select class="more" id="more-shapes">
        <option value="">다른 형상 (${extra.length}) …</option>
        ${extra.map((s) => `<option value="${s.id}" ${state.shape === s.id ? "selected" : ""}>${esc(s.name)} — ${esc(s.id)}</option>`).join("")}
      </select>
      <div class="hint"><span>블록 방향 회전 · 뒤집기 Shift+R</span><kbd>R</kbd></div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>재료</b><span>${esc(matName)}</span></div>
      <div class="swatches">
        ${mats.map((mt) => `<button class="sw ${mt.id === state.material ? "on" : ""} ${(mt.opacity ?? 1) < 1 ? "glass" : ""}" data-mat="${mt.id}" title="${esc(mt.name)} (${mt.id})" style="background-color:${mt.color}"></button>`).join("")}
      </div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>구조물</b><span>${structs.length}개</span></div>
      <div class="tree">${treeHtml}</div>
    </div>

    <div class="sec">
      <div class="sec-h"><b>AI 명령</b><span>JSON · 플랜</span></div>
      <select class="more" id="examples">
        <option value="">예제 불러오기 …</option>
        ${EXAMPLES.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join("")}
      </select>
      <textarea class="cmd" id="cmd" spellcheck="false" placeholder='{"cmd":"fillRegion","args":{"from":[0,0,0],"to":[4,0,4],"material":"stone"}}'></textarea>
      <div class="row c2" style="margin-top:5px">
        <button class="btn on" id="run">실행</button>
        <button class="btn" id="cmds">명령 목록</button>
      </div>
      <div class="out" id="out">${state.output.map((o) => `<div class="${o.ok ? "ok" : "err"}">${esc(o.text)}</div>`).join("")}</div>
    </div>`;

  // keep textarea content across re-renders
  ($("cmd") as HTMLTextAreaElement).value = cmdDraft;
  ($("cmd") as HTMLTextAreaElement).oninput = (e) => (cmdDraft = (e.target as HTMLTextAreaElement).value);

  $("places").innerHTML = m.tags.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join("");
  $("tag").innerHTML = `<i></i>${esc(m.name)}${m.title ? " · " + esc(m.title) : ""} <em>v${p.log.length}</em>`;
  document.querySelectorAll<HTMLButtonElement>("[data-act=undo]").forEach((b) => (b.disabled = !engine.canUndo));
  document.querySelectorAll<HTMLButtonElement>("[data-act=redo]").forEach((b) => (b.disabled = !engine.canRedo));
}
let cmdDraft = "";

// ---------------- sidebar events (delegated) ----------------
$("side").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest("button") as HTMLButtonElement | null;
  if (!btn) {
    const node = t.closest("[data-sid]") as HTMLElement | null;
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
    if (d.sact === "del" && confirm(`${s.name} (${s.id}) 를 삭제할까요? 되돌리기로 복구할 수 있습니다.`)) exec({ cmd: "deleteStructure", args: { id: sid } }, true);
    state.selected = sid;
  } else if (btn.id === "run") runCommandText();
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
    state.output.unshift({ ok: false, text: `✗ JSON 오류: ${(err as Error).message}` });
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
  if (engine.project.world.blockCount > 0 && !confirm(`현재 프로젝트를 닫고 "${ex.name}" 예제를 열까요? (저장하지 않은 작업은 자동 저장본에만 남습니다)`)) return;
  const t0 = performance.now();
  ex.build(engine, (r) => log(r));
  state.output.unshift({ ok: true, text: `✓ 예제 "${ex.name}" ${engine.project.world.blockCount.toLocaleString()}블록 (${Math.round(performance.now() - t0)}ms)` });
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
  if (act === "new") {
    const name = prompt("새 프로젝트 이름", "새 건축");
    if (name === null) return;
    exec({ cmd: "newProject", args: { name } }, true);
    viewport.chunks.reset();
    afterBigChange();
    viewport.view("all", false);
  } else if (act === "save") saveFile();
  else if (act === "open") {
    const f = await pickFile(".json,.vox.json");
    if (!f) return;
    try {
      const file = JSON.parse(await f.text()) as ProjectFile;
      engine.loadFile(file);
      viewport.chunks.reset();
      afterBigChange();
      viewport.view("all", false);
      toast(`${f.name} 열기 완료 (${engine.project.world.blockCount.toLocaleString()}블록)`);
    } catch (err) {
      toast(`열기 실패: ${(err as Error).message}`);
    }
  } else if (act === "undo") exec({ cmd: "undo" }, true);
  else if (act === "redo") exec({ cmd: "redo" }, true);
  renderSide();
});

function saveFile() {
  const name = (engine.project.meta.name || "project").replace(/[\\/:*?"<>|]+/g, "_");
  downloadText(`${name}.vox.json`, JSON.stringify(engine.project.toFile(true)));
  toast("프로젝트 파일을 저장했습니다");
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
  const t = targetFor(x, y);
  if (state.mode === "add") {
    viewport.showHighlight(t.place ?? null, "#2a7a5f");
    viewport.showGhost(t.place ?? null, state.shape, rot());
  } else {
    viewport.showGhost(null, state.shape, 0);
    viewport.showHighlight(t.hit ?? null, state.mode === "remove" ? "#a33a2c" : "#1f5e4c");
  }
}

function clickAt(x: number, y: number) {
  const t = targetFor(x, y);
  if (state.mode === "view") {
    if (t.hit) {
      const b = engine.project.blockAt(...t.hit);
      state.selected = b?.structure;
      if (b) toast(`${b.structure ?? "구조물 없음"} · ${b.shape.replace("builtin.", "")} · ${b.material.replace("builtin.", "")}  [${t.hit.join(", ")}]`);
      renderSide();
    }
    return;
  }
  let r: CommandResponse | undefined;
  if (state.mode === "add" && t.place) {
    r = exec({ cmd: "editBlocks", args: { ops: [{ op: "set", at: t.place, shape: state.shape, material: state.material, facing: FACINGS[state.yaw], upsideDown: state.upsideDown }] } });
  } else if (state.mode === "remove" && t.hit) {
    r = exec({ cmd: "editBlocks", args: { ops: [{ op: "remove", at: t.hit }] } });
  } else if (state.mode === "paint" && t.hit) {
    r = exec({ cmd: "replaceInRegion", args: { from: t.hit, to: t.hit, material: state.material } });
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

function updateHelp() {
  $("helptext").textContent = {
    view: "드래그로 회전 · 휠로 확대 · 우클릭으로 이동 · 클릭으로 구조물 확인",
    add: "클릭으로 블록 추가 · R 회전 · Shift+R 뒤집기 · Esc 감상",
    remove: "클릭으로 블록 삭제 · Esc 감상",
    paint: "클릭으로 재료 칠하기 · Esc 감상",
  }[state.mode];
}

// ---------------- status bar + compass + autosave ----------------
let lastStatus = "";
viewport.frameHooks.push(() => {
  const c = viewport.chunks;
  const s = `${engine.project.world.blockCount.toLocaleString()} 블록 <span class="sep">/</span> ${c.visibleBlocks.toLocaleString()} 표시 <span class="sep">/</span> ${Math.round(viewport.fps)} FPS <span class="sep">/</span> 편집 ${engine.lastEditMs.toFixed(1)}ms <span class="sep">/</span> 메시 ${c.stats().meshes} <span class="right">Minecraft-inspired · WebGL</span>`;
  if (s !== lastStatus) { $("status").innerHTML = s; lastStatus = s; }
  $("needle").setAttribute("transform", `rotate(${(-viewport.azimuth() * 180) / Math.PI} 20 30)`);
  const busy = $("busy");
  if (c.pending > 0) { busy.hidden = false; busy.textContent = `블록 메시 생성 중 · 청크 ${c.pending}개 남음`; } else busy.hidden = true;
});

let saveTimer = 0;
engine.onChange((e) => {
  if (e.type === "load") viewport.chunks.reset();
  renderSide();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    idbPut("autosave", JSON.stringify(engine.project.toFile(true))).catch(() => toast("자동 저장 실패 (브라우저 저장소)"));
  }, 1200);
});

// ---------------- boot ----------------
async function boot() {
  let restored = false;
  try {
    const saved = await idbGet("autosave");
    if (saved) {
      engine.loadFile(JSON.parse(saved));
      restored = engine.project.world.blockCount > 0 || engine.project.meta.structures.length > 0;
    }
  } catch { /* first run or blocked storage */ }
  if (!restored) buildDemo(engine);
  viewport.chunks.reset();
  afterBigChange();
  viewport.view("all", false);
  renderSide();
  updateHelp();
  if (restored) toast("마지막 작업을 불러왔습니다");
}
boot();
