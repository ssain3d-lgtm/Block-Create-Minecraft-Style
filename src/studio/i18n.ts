// Studio UI language (Korean / English). Project data (names, descriptions written by people or
// AI) is shown as written; only the interface and builtin asset names are translated.
export type Lang = "ko" | "en";

const KEY = "ai-voxel-studio.lang";

function detect(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ko" || q === "en") return q;
  try {
    const s = localStorage.getItem(KEY);
    if (s === "ko" || s === "en") return s;
  } catch { /* blocked storage */ }
  return (navigator.language || "en").toLowerCase().startsWith("ko") ? "ko" : "en";
}

export let lang: Lang = detect();

export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
}

type Dict = Record<string, { ko: string; en: string }>;

const D: Dict = {
  appName: { ko: "작은 세계 건축소", en: "Small World Atelier" },
  appSub: { ko: "Voxel architecture studio", en: "Voxel architecture studio" },
  "tb.new": { ko: "새로", en: "New" }, "tb.new.t": { ko: "새 프로젝트", en: "New project" },
  "tb.open": { ko: "열기", en: "Open" }, "tb.open.t": { ko: "프로젝트 파일 열기", en: "Open a project file" },
  "tb.save": { ko: "저장", en: "Save" }, "tb.save.t": { ko: "프로젝트 파일 저장 (Ctrl+S)", en: "Save the project file (Ctrl+S)" },
  "tb.glb.t": { ko: "3D 모델(.glb) 내보내기", en: "Export a 3D model (.glb)" },
  "tb.undo.t": { ko: "되돌리기 (Ctrl+Z)", en: "Undo (Ctrl+Z)" }, "tb.redo.t": { ko: "다시하기 (Ctrl+Y)", en: "Redo (Ctrl+Y)" },
  "tb.lang.t": { ko: "Switch to English", en: "한국어로 바꾸기" },
  shot: { ko: "사진 저장", en: "Save image" },
  "help.view": { ko: "드래그로 회전 · 휠로 확대 · 우클릭으로 이동 · 클릭으로 구조물 확인", en: "Drag to orbit · wheel to zoom · right-drag to pan · click to identify a structure" },
  "help.add": { ko: "클릭으로 블록 추가 · R 회전 · Shift+R 뒤집기 · Esc 감상", en: "Click to add · R rotate · Shift+R flip · Esc view mode" },
  "help.remove": { ko: "클릭으로 블록 삭제 · Esc 감상", en: "Click to remove · Esc view mode" },
  "help.paint": { ko: "클릭으로 재료 칠하기 · Esc 감상", en: "Click to paint · Esc view mode" },
  "sec.view": { ko: "둘러보기", en: "Camera" },
  "view.all": { ko: "전체", en: "All" }, "view.main": { ko: "탑체", en: "Main" }, "view.front": { ko: "정면", en: "Front" },
  "view.side": { ko: "측면", en: "Side" }, "view.top": { ko: "위에서", en: "Top" },
  "sec.light": { ko: "빛과 분위기", en: "Light & mood" },
  "amb.day": { ko: "맑은 낮", en: "Day" }, "amb.dusk": { ko: "해 질 녘", en: "Dusk" }, "amb.moon": { ko: "달빛", en: "Moonlight" },
  "chk.rot": { ko: "천천히 회전", en: "Slow orbit" }, "chk.shadow": { ko: "그림자", en: "Shadows" }, "chk.grid": { ko: "격자", en: "Grid" },
  "sec.edit": { ko: "블록 편집", en: "Block editing" }, facing: { ko: "방향", en: "Facing" }, flipped: { ko: "뒤집힘", en: "flipped" },
  "mode.view": { ko: "감상", en: "View" }, "mode.add": { ko: "추가", en: "Add" }, "mode.remove": { ko: "삭제", en: "Remove" }, "mode.paint": { ko: "칠하기", en: "Paint" },
  "shape.cube": { ko: "큐브", en: "Cube" }, "shape.slab": { ko: "반블록", en: "Slab" }, "shape.stair": { ko: "계단", en: "Stair" },
  "shape.wedge": { ko: "경사", en: "Slope" }, "shape.floor": { ko: "마루", en: "Floor" },
  moreShapes: { ko: "다른 형상 ({n}) …", en: "More shapes ({n}) …" },
  rotateHint: { ko: "블록 방향 회전 · 뒤집기 Shift+R", en: "Rotate block · flip with Shift+R" },
  "sec.mat": { ko: "재료", en: "Materials" },
  "sec.struct": { ko: "구조물", en: "Structures" }, count: { ko: "{n}개", en: "{n}" },
  noStructs: { ko: "구조물이 없습니다. AI 명령이나 예제로 건물을 지어 보세요.", en: "No structures yet. Build with an AI command or load an example." },
  "s.focus": { ko: "카메라 맞추기", en: "Focus camera" }, "s.vis": { ko: "숨김/표시", en: "Hide/show" },
  "s.shown": { ko: "보임", en: "Shown" }, "s.hidden": { ko: "숨김", en: "Hidden" },
  "s.lock": { ko: "잠금", en: "Lock" }, "s.locked": { ko: "잠김", en: "Locked" },
  "s.rebuild": { ko: "재시공", en: "Rebuild" }, "s.rebuild.t": { ko: "같은 설정으로 다시 짓기", en: "Rebuild with the same settings" },
  "s.del": { ko: "삭제", en: "Delete" },
  confirmDel: { ko: "{name} ({id}) 를 삭제할까요? 되돌리기로 복구할 수 있습니다.", en: "Delete {name} ({id})? You can undo it." },
  grid: { ko: "{n}m 격자", en: "{n} m grid" },
  defaultDesc: { ko: "{b}블록, {s}개 구조물", en: "{b} blocks, {s} structures" },
  "sec.ai": { ko: "AI 명령", en: "AI commands" }, "ai.kind": { ko: "JSON · 플랜", en: "JSON · plans" },
  loadExample: { ko: "예제 불러오기 …", en: "Load an example …" },
  run: { ko: "실행", en: "Run" }, inspect: { ko: "검수", en: "Inspect" },
  "inspect.t": { ko: "떠 있는 블록·누락·빈 구조물 자동 검사", en: "Automatic checks: floating blocks, missing parts, empty structures" },
  commands: { ko: "명령 목록", en: "List" },
  jsonError: { ko: "JSON 오류: {m}", en: "JSON error: {m}" },
  confirmExample: { ko: "현재 프로젝트를 닫고 \"{name}\" 예제를 열까요? (저장하지 않은 작업은 자동 저장본에만 남습니다)", en: "Close the current project and open the \"{name}\" example? (unsaved work stays only in the autosave)" },
  exampleBuilt: { ko: "예제 \"{name}\" {b}블록 ({ms}ms)", en: "Example \"{name}\": {b} blocks ({ms} ms)" },
  newName: { ko: "새 프로젝트 이름", en: "New project name" }, newNameDefault: { ko: "새 건축", en: "New build" },
  glbDone: { ko: "GLB 내보내기 완료 ({n} 삼각형)", en: "GLB exported ({n} triangles)" },
  opened: { ko: "{f} 열기 완료 ({b}블록)", en: "Opened {f} ({b} blocks)" }, openFailed: { ko: "열기 실패: {m}", en: "Could not open: {m}" },
  saved: { ko: "프로젝트 파일을 저장했습니다", en: "Project file saved" },
  noStructure: { ko: "구조물 없음", en: "no structure" },
  "st.blocks": { ko: "블록", en: "blocks" }, "st.visible": { ko: "표시", en: "visible" }, "st.edit": { ko: "편집", en: "edit" }, "st.meshes": { ko: "메시", en: "meshes" },
  meshing: { ko: "블록 메시 생성 중 · 청크 {n}개 남음", en: "Building meshes · {n} chunks left" },
  autosaveFailed: { ko: "자동 저장 실패 (브라우저 저장소)", en: "Autosave failed (browser storage)" },
  restored: { ko: "마지막 작업을 불러왔습니다", en: "Restored your last session" },
  linked: { ko: "서버 연결", en: "Server linked" },
  "link.synced": { ko: "서버와 동기화됨 · {b}블록", en: "Synced with the server · {b} blocks" },
  "link.waiting": { ko: "서버 연결 대기 중 — 편집 내용은 보관 중이며 연결되면 전송합니다", en: "Waiting for the server — your edits are kept and will be sent when it is back" },
  "link.connected": { ko: "서버에 연결됨 (AI 명령이 실시간으로 반영됩니다)", en: "Connected to the server (AI commands appear live)" },
  "link.lost": { ko: "서버 연결 끊김 — 다시 연결 중…", en: "Connection lost — reconnecting…" },
  historyFailed: { ko: "{cmd} 실패: {m}", en: "{cmd} failed: {m}" }, serverSide: { ko: "서버", en: "server" },
  benchPrefix: { ko: "벤치마크", en: "Benchmark" },
  "bench.building": { ko: "{s}: 짓는 중…", en: "{s}: building…" },
  "bench.fps": { ko: "{s}: {n}초 동안 회전하며 FPS 측정…", en: "{s}: measuring FPS while orbiting for {n} s…" },
  "bench.edit": { ko: "{s}: 블록 1000개 편집 측정…", en: "{s}: measuring a 1000-block edit…" },
  "bench.title": { ko: "벤치마크 결과 (실측)", en: "Benchmark results (measured)" },
  "bench.shadows": { ko: "그림자", en: "shadows" }, on: { ko: "켬", en: "on" }, off: { ko: "끔", en: "off" },
  "bench.orbit": { ko: "{n}초 회전", en: "{n} s orbit" },
  "bench.cols": { ko: "장면|블록|메시ms|첫 프레임ms|평균 FPS|1% low|draw|삼각형|편집1000ms", en: "Scene|Blocks|Mesh ms|First frame ms|Avg FPS|1% low|Draw calls|Triangles|1000-edit ms" },
  "bench.save": { ko: "결과 JSON 저장", en: "Save results (JSON)" }, close: { ko: "닫기", en: "Close" },
  "ex.A": { ko: "A. 에펠탑 (iron lace)", en: "A. Eiffel tower (iron lace)" },
  "ex.B": { ko: "B. 일본 성곽", en: "B. Japanese castle" },
  "ex.C": { ko: "C. 비대칭 모던하우스", en: "C. Asymmetric modern house" },
  "ex.D": { ko: "D. AI 테스트 하우스 (JSON 명령만)", en: "D. AI test house (JSON commands only)" },
  "ex.E": { ko: "E. 다중 셀 부품 정자 (2x4x1 아치 · 4x4x4 돔)", en: "E. Multi-cell parts pavilion (2x4x1 arch · 4x4x4 dome)" },
  "ex.demo": { ko: "작은 광장 (기본 명령 데모)", en: "Small plaza (basic command demo)" },
  "ex.showcase": { ko: "형상·재질 견본 (AI 사용자 정의 블록 포함)", en: "Shapes & materials showcase (incl. AI-made blocks)" },
};

/** English names of builtin assets (their stored names are Korean) */
const ASSET_EN: Record<string, string> = {
  iron_lower: "Iron (lower)", iron_mid: "Iron (middle)", iron_dark: "Dark iron", iron_black: "Black iron", iron_shadow: "Iron (shade)",
  wood_oak: "Oak", coal: "Coal stone", stone: "Stone", steel: "Steel", lamp: "Lamp light", sand: "Sand", brick: "Brick",
  stone_dark: "Dark stone", stone_light: "Light stone", concrete: "Concrete", slate: "Slate", paving: "Paving", grass: "Grass",
  leaf_dark: "Dark leaves", leaf: "Leaves", wood_gold: "Golden wood", leaf_teal: "Teal leaves", wood_dark: "Dark wood", water: "Water",
  glass: "Glass", asphalt: "Asphalt", moss: "Moss", terracotta: "Terracotta", roof_tile: "Roof tile", plaster: "Plaster",
  concrete_white: "White concrete", rail_red: "Red rail", bark: "Bark",
  cube: "Cube", slab: "Slab", floor: "Floor plate", stair: "Stair", wedge: "Slope", wedge_half: "Gentle slope", wedge_half_hi: "Gentle slope (top)",
  roof_plate: "Roof plate", pillar: "Pillar", post: "Post", beam: "Beam", arch: "Arch", fence: "Fence", truss: "Truss", lattice: "Lattice",
  pane: "Pane", leaves: "Leaf block", lamp_post: "Street lamp",
};

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const e = D[key];
  let s = e ? e[lang] : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** display name of an asset: English for builtin assets when the UI is English */
export function assetName(def: { id: string; name: string }): string {
  if (lang === "en" && def.id.startsWith("builtin.")) return ASSET_EN[def.id.slice(8)] ?? def.name;
  return def.name;
}
