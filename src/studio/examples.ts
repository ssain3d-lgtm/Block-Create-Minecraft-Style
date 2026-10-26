// Example projects reachable from the studio's "예제 불러오기" menu.
import type { Engine, CommandResponse } from "../engine/engine";
import { toRequests } from "../cli/input";
import * as plans from "../../examples/plans";
import { lang } from "./i18n";

/** first-run / showcase content follows the UI language (example plans are data and stay as written) */
const L = (ko: string, en: string) => (lang === "en" ? en : ko);

/** runs one command; the studio passes its exec() so commands are mirrored to a linked server */
export type Run = (req: { cmd: string; args?: unknown }) => CommandResponse;

export interface Example {
  /** i18n key of the menu label (see i18n.ts) */
  name: string;
  build(engine: Engine, log: (r: CommandResponse) => void, run?: Run): void;
}

function runAll(run: Run, cmds: { cmd: string; args: unknown }[], log: (r: CommandResponse) => void) {
  for (const c of cmds) {
    const r = run(c);
    if (!r.ok) { log(r); break; }
  }
}

/** Small first-run scene built only from basic commands. */
export function buildDemo(engine: Engine, log: (r: CommandResponse) => void = () => {}, run: Run = (r) => engine.execute(r)) {
  run({ cmd: "newProject", args: { name: L("첫 작업", "First build"), cellSize: 1 } });
  runAll(run, [
    { cmd: "setProjectInfo", args: { title: L("작은 광장", "small plaza"), description: L("기본 명령만으로 만든 시작 장면.\n블록 편집이나 AI 명령으로 이어서 지어 보세요.", "A starter scene made with basic commands.\nKeep building by hand or with AI commands."), tags: [L("샘플", "Sample")] } },
    { cmd: "fillRegion", args: { from: [-12, 0, -12], to: [12, 0, 12], material: "grass", structure: { name: L("잔디 바닥", "Lawn"), type: "terrain" } } },
    { cmd: "fillRegion", args: { from: [-10, 1, -10], to: [10, 1, 10], material: "paving", shape: "floor", structure: { name: L("광장", "Plaza"), type: "terrain" } } },
    { cmd: "fillRegion", args: { from: [-3, 1, -3], to: [3, 1, 3], material: "stone_light", structure: { name: L("기단", "Plinth"), type: "foundation" } } },
    { cmd: "fillRegion", args: { from: [-2, 2, -2], to: [2, 14, 2], material: "iron_lower", shape: "truss", hollow: true, structure: { name: L("격자 탑", "Lattice tower"), type: "tower", tags: ["main"] } } },
    { cmd: "fillRegion", args: { from: [-2, 15, -2], to: [2, 15, 2], material: "wood_oak", shape: "floor", structure: { name: L("전망대", "Deck"), type: "deck" } } },
    { cmd: "fillRegion", args: { from: [0, 16, 0], to: [0, 18, 0], material: "iron_dark", shape: "post", structure: { name: L("첨탑", "Spire"), type: "spire" } } },
    { cmd: "fillRegion", args: { from: [7, 2, 7], to: [7, 4, 7], material: "bark", shape: "pillar", structure: { name: L("나무", "Tree"), type: "tree" } } },
    { cmd: "fillRegion", args: { from: [6, 5, 6], to: [8, 6, 8], material: "leaf", shape: "leaves", structure: L("나무", "Tree") } },
    { cmd: "fillRegion", args: { from: [-8, 2, 7], to: [-8, 2, 7], material: "lamp", shape: "lamp_post", structure: { name: L("가로등", "Street lamp"), type: "lamp" } } },
    { cmd: "fillRegion", args: { from: [-9, 1, -9], to: [-5, 1, -6], material: "water", structure: { name: L("연못", "Pond"), type: "water" } } },
  ], log);
}

/** Every builtin shape in four orientations + an AI-made custom block, on a plinth. */
export function buildShowcase(engine: Engine, log: (r: CommandResponse) => void = () => {}, run: Run = (r) => engine.execute(r)) {
  run({ cmd: "newProject", args: { name: L("형상 견본", "Shape showcase"), cellSize: 1 } });
  const shapes = engine.assets.builtinShapes_().map((s) => s.id);
  const mats = ["iron_lower", "stone_light", "brick", "wood_oak", "roof_tile", "concrete", "glass", "leaf"];
  const cmds: { cmd: string; args: unknown }[] = [
    { cmd: "setProjectInfo", args: { title: "shapes & materials", description: L("내장 형상 전부와 AI가 만든 사용자 정의 블록.\n각 줄은 북·동·남·서 네 방향.", "Every builtin shape plus AI-made custom blocks.\nEach row shows north, east, south and west."), tags: [L("견본", "Showcase")] } },
    { cmd: "fillRegion", args: { from: [-2, -1, -2], to: [shapes.length * 3 + 2, -1, 18], material: "paving", structure: { name: L("바닥", "Ground"), type: "terrain" } } },
    { cmd: "createShape", args: { id: "ai.curved_tile", name: L("곡선 기와", "Curved tile"), tags: ["roof", "tile", "curved"], recipe: { type: "curve", axis: "x", thickness: 0.16, path: [[0, 0.95], [0.25, 0.78], [0.5, 0.55], [0.75, 0.3], [1, 0.1]] } } },
    { cmd: "createShape", args: { id: "ai.round_column", name: L("둥근 기둥", "Round column"), tags: ["column"], recipe: { type: "lathe", segments: 14, profile: [[0.42, 0], [0.42, 0.12], [0.3, 0.18], [0.3, 0.82], [0.42, 0.88], [0.42, 1]] } } },
    { cmd: "createMaterial", args: { id: "ai.kawara_gray", name: L("회색 기와", "Grey tile"), kind: "tile", color: "#56606e" } },
  ];
  shapes.forEach((id, i) => {
    for (let k = 0; k < 4; k++) {
      cmds.push({ cmd: "editBlocks", args: { ops: [{ op: "set", at: [i * 3, 0, k * 3], shape: id, material: mats[(i + k) % mats.length], facing: ["north", "east", "south", "west"][k] }] } });
    }
  });
  cmds.push({ cmd: "fillRegion", args: { from: [0, 0, 13], to: [8, 0, 13], shape: "ai.curved_tile", material: "ai.kawara_gray", facing: "north", structure: { name: L("AI 곡선 기와", "AI curved tiles"), type: "roof" } } });
  cmds.push({ cmd: "fillRegion", args: { from: [0, 1, 14], to: [8, 1, 14], shape: "ai.curved_tile", material: "ai.kawara_gray", facing: "north", structure: L("AI 곡선 기와", "AI curved tiles") } });
  cmds.push({ cmd: "fillRegion", args: { from: [12, 0, 14], to: [12, 3, 14], shape: "ai.round_column", material: "stone_light", structure: { name: L("AI 둥근 기둥", "AI round columns"), type: "column" } } });
  cmds.push({ cmd: "fillRegion", args: { from: [16, 0, 14], to: [16, 3, 14], shape: "ai.round_column", material: "stone_light", structure: L("AI 둥근 기둥", "AI round columns") } });
  runAll(run, cmds, log);
}

function planExample(name: string, make: () => unknown): Example {
  return {
    name,
    build(engine, log, run = (r) => engine.execute(r)) {
      for (const req of toRequests(make())) {
        const r = run(req);
        log(r);
        if (!r.ok) break;
      }
    },
  };
}

export const EXAMPLES: Example[] = [
  planExample("ex.A", plans.eiffelPlan),
  planExample("ex.B", plans.castlePlan),
  planExample("ex.C", plans.modernPlan),
  planExample("ex.D", plans.housePlan),
  planExample("ex.E", plans.pavilionPlan),
  { name: "ex.demo", build: (e, log, run) => buildDemo(e, log, run) },
  { name: "ex.showcase", build: (e, log, run) => buildShowcase(e, log, run) },
];
