// Example projects reachable from the studio's "예제 불러오기" menu.
import type { Engine, CommandResponse } from "../engine/engine";

export interface Example {
  name: string;
  build(engine: Engine, log: (r: CommandResponse) => void): void;
}

function runAll(engine: Engine, cmds: { cmd: string; args: unknown }[], log: (r: CommandResponse) => void) {
  for (const c of cmds) {
    const r = engine.execute(c);
    if (!r.ok) { log(r); break; }
  }
}

/** Small first-run scene built only from basic commands. */
export function buildDemo(engine: Engine, log: (r: CommandResponse) => void = () => {}) {
  engine.execute({ cmd: "newProject", args: { name: "첫 작업", cellSize: 1 } });
  runAll(engine, [
    { cmd: "setProjectInfo", args: { title: "작은 광장", description: "기본 명령만으로 만든 시작 장면.\n블록 편집이나 AI 명령으로 이어서 지어 보세요.", tags: ["샘플"] } },
    { cmd: "fillRegion", args: { from: [-12, 0, -12], to: [12, 0, 12], material: "grass", structure: { name: "잔디 바닥", type: "terrain" } } },
    { cmd: "fillRegion", args: { from: [-10, 1, -10], to: [10, 1, 10], material: "paving", shape: "floor", structure: { name: "광장", type: "terrain" } } },
    { cmd: "fillRegion", args: { from: [-3, 1, -3], to: [3, 1, 3], material: "stone_light", structure: { name: "기단", type: "foundation" } } },
    { cmd: "fillRegion", args: { from: [-2, 2, -2], to: [2, 14, 2], material: "iron_lower", shape: "truss", hollow: true, structure: { name: "격자 탑", type: "tower", tags: ["main"] } } },
    { cmd: "fillRegion", args: { from: [-2, 15, -2], to: [2, 15, 2], material: "wood_oak", shape: "floor", structure: { name: "전망대", type: "deck" } } },
    { cmd: "fillRegion", args: { from: [0, 16, 0], to: [0, 18, 0], material: "iron_dark", shape: "post", structure: { name: "첨탑", type: "spire" } } },
    { cmd: "fillRegion", args: { from: [7, 2, 7], to: [7, 4, 7], material: "bark", shape: "pillar", structure: { name: "나무", type: "tree" } } },
    { cmd: "fillRegion", args: { from: [6, 5, 6], to: [8, 6, 8], material: "leaf", shape: "leaves", structure: "나무" } },
    { cmd: "fillRegion", args: { from: [-8, 2, 7], to: [-8, 2, 7], material: "lamp", shape: "lamp_post", structure: { name: "가로등", type: "lamp" } } },
    { cmd: "fillRegion", args: { from: [-9, 1, -9], to: [-5, 1, -6], material: "water", structure: { name: "연못", type: "water" } } },
  ], log);
}

export const EXAMPLES: Example[] = [
  { name: "작은 광장 (기본 명령 데모)", build: (e, log) => buildDemo(e, log) },
];
