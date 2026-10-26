// Example BuildingPlans. They are plain JSON (written to examples/*.plan.json by
// `npm run examples`) so an LLM can read, copy or modify them.
type Cmd = { cmd: string; args: Record<string, unknown> };
type S = { key: string; cmd: string; args: Record<string, unknown> };

// ---------------------------------------------------------------- D. AI test house
export function housePlan() {
  return {
    plan: "ai_test_house",
    newProject: true,
    name: "AI 테스트 하우스",
    title: "json house",
    description: "JSON 명령만으로 지은 2층 집.\nAI가 만든 경사 블록(ai.shingle)으로 지붕을 덮었다.",
    tags: ["AI 전용 테스트", "JSON 명령"],
    cellSize: 1,
    assets: [
      {
        cmd: "createShape",
        args: {
          id: "ai.shingle", name: "턱 있는 지붕 경사", tags: ["roof", "slope", "shingle"],
          description: "45도 경사 + 아래쪽 끝에 작은 턱이 있는 지붕널",
          recipe: { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [1, 0.14], [0.86, 0.14], [0, 1]] },
        },
      },
      { cmd: "createMaterial", args: { id: "ai.slate_blue", name: "청회색 슬레이트", kind: "tile", color: "#4c5a6e", tags: ["roof"] } },
    ] as Cmd[],
    buildings: [
      {
        name: "house",
        origin: [0, 0, 0],
        structures: [
          { key: "lawn", cmd: "createTerrain", args: { name: "잔디", area: { at: [-8, 0, -8], size: [34, 30] }, material: "grass", border: { material: "leaf_dark", width: 1 } } },
          { key: "path", cmd: "createTerrain", args: { name: "현관 길", area: { at: [8, 0, 12], size: [2, 9] }, material: "paving", shape: "cube" } },
          { key: "base", cmd: "createFoundation", args: { name: "기초", area: { at: [0, 1, 0], size: [18, 12] }, height: 1, material: "concrete" } },
          {
            key: "walls1", cmd: "createWall", args: {
              name: "1층 벽", loop: { on: { ref: "base" } }, height: 5, material: "brick", corners: "stone_light",
              openings: [{ side: "south", at: 8, width: 2, height: 3, bottom: 0, fill: null }],
              windows: { width: 2, height: 2, bottom: 1, spacing: 2, margin: 2 },
              bands: [{ y: 4, material: "stone_light" }],
            },
          },
          { key: "floor2", cmd: "createFloor", args: { name: "2층 바닥", area: { on: { ref: "walls1" } }, thickness: 1, material: "wood_oak", level: 2 } },
          {
            key: "walls2", cmd: "createWall", args: {
              name: "2층 벽", loop: { on: { ref: "floor2" } }, height: 4, material: "plaster", corners: "wood_dark",
              windows: { width: 2, height: 2, bottom: 1, spacing: 3, margin: 2 },
            },
          },
          { key: "roof", cmd: "createRoof", args: { name: "지붕", area: { on: { ref: "walls2" } }, style: "gable", pitch: 1, overhang: 1, material: "ai.slate_blue", slopeShape: "ai.shingle", fillMaterial: "plaster" } },
          { key: "chimney", cmd: "createPillar", args: { name: "굴뚝", at: [14, 9, 3], height: 9, size: 2, material: "brick", capital: "stone_dark" } },
          { key: "step", cmd: "createStairs", args: { name: "현관 계단", from: [8, 1, 12], facing: "north", steps: 1, width: 2, material: "stone_light" } },
          { key: "trees", cmd: "createTree", args: { name: "나무", positions: [[-4, 1, -4], [22, 1, -4], [-4, 1, 17], [23, 1, 16]], height: 4, crown: 2 } },
          { key: "fence_w", cmd: "createLine", args: { name: "울타리 서", from: [-6, 1, 20], to: [6, 1, 20], shape: "fence", material: "wood_dark" } },
          { key: "fence_e", cmd: "createLine", args: { name: "울타리 동", from: [11, 1, 20], to: [24, 1, 20], shape: "fence", material: "wood_dark" } },
        ] as S[],
      },
    ],
  };
}

// ---------------------------------------------------------------- A. Eiffel tower
/** leg centre offset from the tower axis at height y (curved legs meeting at the 2nd deck) */
function legOffset(y: number) {
  return 17 + 33 * Math.pow(1 - Math.min(1, y / 115), 1.7);
}

export function eiffelPlan() {
  const legs: S[] = [];
  const corners: [number, number, string][] = [[1, 1, "se"], [-1, 1, "sw"], [-1, -1, "nw"], [1, -1, "ne"]];
  for (const [sx, sz, nm] of corners) {
    const path = [3, 18, 36, 57, 76, 96, 115].map((y) => {
      const o = Math.round(legOffset(y));
      return [sx * o, y, sz * o];
    });
    legs.push({
      key: `pad_${nm}`, cmd: "createFoundation",
      args: { name: `기초 ${nm.toUpperCase()}`, area: { at: [sx * 50 - 10, 1, sz * 50 - 10], size: [21, 21] }, height: 2, taper: 1, slope: true, material: "stone_dark", topMaterial: "stone_light" },
    });
    legs.push({
      key: `leg_${nm}`, cmd: "createTruss",
      args: {
        name: `다리 ${nm.toUpperCase()}`, path, width: [21, 11], pattern: "x", period: 4, frameEvery: 6,
        material: "iron_lower", chordMaterial: "iron_dark", columnSize: 2,
        accent: { material: "rail_red", face: sx > 0 ? "-x" : "+x" }, tags: ["main"],
      },
    });
  }
  const arches: S[] = [
    { key: "arch_s", cmd: "createArch", args: { name: "아치 남", from: [-36, 12, 44], to: [36, 12, 44], rise: 42, thickness: 2, depth: 2, material: "iron_mid", tags: ["main"] } },
    { key: "arch_n", cmd: "createArch", args: { name: "아치 북", from: [-36, 12, -45], to: [36, 12, -45], rise: 42, thickness: 2, depth: 2, material: "iron_mid", tags: ["main"] } },
    { key: "arch_e", cmd: "createArch", args: { name: "아치 동", from: [44, 12, -36], to: [44, 12, 36], rise: 42, thickness: 2, depth: 2, material: "iron_mid", tags: ["main"] } },
    { key: "arch_w", cmd: "createArch", args: { name: "아치 서", from: [-45, 12, -36], to: [-45, 12, 36], rise: 42, thickness: 2, depth: 2, material: "iron_mid", tags: ["main"] } },
  ];
  const tower: S[] = [
    { key: "deck1", cmd: "createFloor", args: { name: "1층 전망대 골조", area: { at: [-42, 56, -42], size: [85, 85] }, hole: { size: [41, 41] }, thickness: 2, material: "iron_dark", tags: ["main"] } },
    { key: "deck1_floor", cmd: "createFloor", args: { name: "1층 마루", area: { on: { ref: "deck1", inset: 1 } }, hole: { size: [43, 43] }, thickness: 1, material: "wood_oak", shape: "floor", tags: ["main"] } },
    {
      key: "gallery1", cmd: "createWall", args: {
        name: "1층 회랑", loop: { on: { ref: "deck1" } }, height: 5, material: "iron_mid",
        windows: { width: 3, height: 3, bottom: 1, spacing: 1, margin: 2, fill: "steel", fillShape: "lattice" },
        bands: [{ y: 4, material: "iron_black" }], tags: ["main"],
      },
    },
    { key: "deck2", cmd: "createFloor", args: { name: "2층 전망대 골조", area: { at: [-24, 114, -24], size: [49, 49] }, hole: { size: [17, 17] }, thickness: 2, material: "iron_dark", tags: ["main"] } },
    { key: "deck2_floor", cmd: "createFloor", args: { name: "2층 마루", area: { on: { ref: "deck2", inset: 1 } }, hole: { size: [19, 19] }, thickness: 1, material: "wood_oak", shape: "floor", tags: ["main"] } },
    {
      key: "gallery2", cmd: "createWall", args: {
        name: "2층 회랑", loop: { on: { ref: "deck2" } }, height: 3, material: "iron_mid",
        windows: { width: 2, height: 2, bottom: 0, spacing: 1, margin: 1, fill: "steel", fillShape: "lattice" },
        bands: [{ y: 2, material: "iron_black" }], tags: ["main"],
      },
    },
    {
      key: "upper", cmd: "createTower", args: {
        name: "상부 탑", center: [0, 117, 0], height: 159, baseSize: 33, topSize: 9, profile: "curve", curve: 1.5,
        style: "lattice", material: "iron_mid", braceMaterial: "iron_lower", bracePeriod: 4, frameEvery: 8, columnSize: 3, tags: ["main"],
      },
    },
    { key: "deck3", cmd: "createFloor", args: { name: "꼭대기 전망대", area: { at: [-7, 276, -7], size: [15, 15] }, thickness: 1, material: "iron_dark", tags: ["main"] } },
    { key: "cabin", cmd: "createWall", args: { name: "꼭대기 전망실", loop: { on: { ref: "deck3", inset: 1 } }, height: 4, material: "iron_black", windows: { width: 2, height: 2, bottom: 1, spacing: 1, margin: 1, fill: "glass" }, tags: ["main"] } },
    { key: "cap", cmd: "createRoof", args: { name: "전망실 지붕", area: { on: { ref: "cabin" } }, style: "pyramid", pitch: 1, overhang: 1, material: "iron_dark", tags: ["main"] } },
    { key: "spire", cmd: "createTower", args: { name: "첨탑", center: { ref: "cap", anchor: "top" }, height: 30, baseSize: 3, topSize: 1, profile: "taper", style: "solid", material: "iron_black", tags: ["main"] } },
    { key: "beacon", cmd: "createPillar", args: { name: "등불", at: { ref: "spire", anchor: "top" }, height: 2, shape: "post", material: "lamp", tags: ["main"] } },
  ];
  // landscape (Champ de Mars style)
  const trees: number[][] = [];
  for (let x = 18; x <= 66; x += 8) for (const z of [70, 82]) trees.push([x, 1, z], [-x, 1, z]);
  for (let z = -60; z <= 60; z += 10) for (const x of [-82, 82]) trees.push([x, 1, z]);
  const lamps: number[][] = [];
  for (let i = -60; i <= 60; i += 15) { lamps.push([i, 1, 64], [i, 1, -64], [64, 1, i], [-64, 1, i]); }
  const land: S[] = [
    { key: "lawn", cmd: "createTerrain", args: { name: "잔디밭", area: { at: [-90, 0, -90], size: [181, 181] }, depth: 2, material: "grass", border: { material: "leaf_dark", width: 1 } } },
    { key: "plaza", cmd: "createTerrain", args: { name: "광장", area: { at: [-75, 0, -75], size: [151, 136] }, material: "paving", border: { material: "stone_light", width: 1 } } },
    { key: "garden_w", cmd: "createTerrain", args: { name: "서쪽 화단", area: { at: [-58, 0, -30], size: [8, 60] }, material: "grass", border: { material: "leaf_dark", width: 1 } } },
    { key: "garden_e", cmd: "createTerrain", args: { name: "동쪽 화단", area: { at: [51, 0, -30], size: [8, 60] }, material: "grass", border: { material: "leaf_dark", width: 1 } } },
    { key: "avenue", cmd: "createTerrain", args: { name: "가로수 길", area: { at: [-75, 0, 61], size: [151, 4] }, material: "asphalt" } },
    { key: "pool", cmd: "createCylinder", args: { name: "분수 연못", center: [0, 0, 76], radius: 7, height: 1, material: "water" } },
    { key: "pool_rim", cmd: "createCylinder", args: { name: "연못 테두리", center: [0, 1, 76], radius: 8, height: 1, hollow: true, material: "stone_light" } },
    { key: "trees", cmd: "createTree", args: { name: "가로수", positions: trees, height: 4, crown: 2, material: "leaf" } },
    { key: "trees2", cmd: "createTree", args: { name: "정원수", positions: [[-54, 1, -24], [-54, 1, -6], [-54, 1, 12], [54, 1, -24], [54, 1, -6], [54, 1, 12]], height: 3, crown: 2, material: "leaf_teal", style: "round" } },
    { key: "lamps", cmd: "createPillar", args: { name: "가로등", positions: lamps, height: 1, shape: "lamp_post", material: "lamp" } },
  ];
  return {
    plan: "eiffel_iron_lace",
    newProject: true,
    name: "에펠탑",
    title: "iron lace",
    description: "324블록 철 레이스,\n블록으로 세운 파리의 탑.",
    tags: ["파리, 프랑스", "샹드마르스"],
    cellSize: 1,
    assets: [] as Cmd[],
    buildings: [{ name: "eiffel", origin: [0, 0, 0], structures: [...land, ...legs, ...arches, ...tower] }],
  };
}

// ---------------------------------------------------------------- B. Japanese castle
export function castlePlan() {
  const tier = (n: number, ref: string, inset: number, height: number, roof: Record<string, unknown>): S[] => [
    {
      key: `t${n}`, cmd: "createWall", args: {
        name: `${n}층`, loop: { on: { ref, inset } }, height, material: "plaster", corners: "wood_dark",
        bands: [{ y: height - 1, material: "wood_dark" }],
        windows: { width: 1, height: 2, bottom: 1, spacing: 2, margin: 2, fill: "wood_dark", fillShape: "lattice" },
        tags: ["main"],
      },
    },
    { key: `t${n}_roof`, cmd: "createRoof", args: { name: `${n}층 지붕`, area: { on: { ref: `t${n}` } }, overhang: 2, material: "ai.kawara", slopeShape: "ai.kawara_tile", ridgeMaterial: "roof_tile", solid: true, fillMaterial: "plaster", tags: ["main"], ...roof } },
  ];
  return {
    plan: "japanese_castle",
    newProject: true,
    name: "일본 성곽",
    title: "white heron",
    description: "석축 위 다층 천수각.\nAI가 만든 곡선 기와 블록을 지붕에 사용.",
    tags: ["일본", "성곽"],
    cellSize: 1,
    assets: [
      { cmd: "createMaterial", args: { id: "ai.kawara", name: "짙은 기와", kind: "tile", color: "#3e4652", tags: ["roof", "japanese"] } },
      { cmd: "createShape", args: { id: "ai.kawara_tile", name: "곡선 기와", tags: ["roof", "tile", "japanese", "curved"], recipe: { type: "curve", axis: "x", thickness: 0.22, path: [[0, 0.95], [0.3, 0.72], [0.6, 0.42], [0.85, 0.18], [1, 0.12]] } } },
    ] as Cmd[],
    buildings: [{
      name: "castle", origin: [0, 0, 0], structures: [
        { key: "ground", cmd: "createTerrain", args: { name: "대지", area: { at: [-26, 0, -26], size: [86, 80] }, depth: 2, material: "grass", border: { material: "leaf_dark", width: 1 } } },
        { key: "moat", cmd: "createTerrain", args: { name: "해자", area: { at: [-18, 0, -18], size: [70, 64] }, material: "water", border: { material: "stone_dark", width: 1 } } },
        { key: "island", cmd: "createTerrain", args: { name: "성 안 마당", area: { at: [-12, 0, -12], size: [58, 52] }, material: "sand", border: { material: "stone_dark", width: 1 } } },
        { key: "outer_wall", cmd: "createWall", args: { name: "성벽", loop: { at: [-11, 1, -11], size: [56, 50] }, height: 3, material: "plaster", bands: [{ y: 0, material: "stone_dark" }, { y: 2, material: "roof_tile" }], openings: [{ side: "south", at: 25, width: 4, height: 3, bottom: 0, fill: null }] } },
        { key: "bridge", cmd: "createFloor", args: { name: "다리", area: { at: [14, 1, 38], size: [4, 8] }, material: "wood_dark", shape: "floor" } },
        { key: "base", cmd: "createFoundation", args: { name: "석축", area: { at: [0, 1, 0], size: [34, 28] }, height: 8, taper: 0.5, slope: true, material: "stone", topMaterial: "stone_light", tags: ["main"] } },
        // the stone base tapers 0.5 per layer -> its top layer is 3 cells in; walls sit on it
        ...tier(1, "base", 3, 5, { style: "hip", pitch: 0.5, curve: 0.7 }),
        ...tier(2, "t1", 3, 5, { style: "hip", pitch: 0.5, curve: 0.7 }),
        ...tier(3, "t2", 3, 5, { style: "irimoya", pitch: 0.75, curve: 0.9 }),
        { key: "pines", cmd: "createTree", args: { name: "소나무", positions: [[-6, 1, -6], [40, 1, -6], [-6, 1, 34], [40, 1, 34], [6, 1, 34], [30, 1, -6]], height: 4, crown: 2, style: "cone", material: "leaf_teal" } },
      ] as S[],
    }],
  };
}

// ---------------------------------------------------------------- C. asymmetric modern house
export function modernPlan() {
  return {
    plan: "asymmetric_modern_house",
    newProject: true,
    name: "모던하우스",
    title: "cantilever",
    description: "돌출된 2층 박스, 유리 벽, 콘크리트 외벽,\n높이가 다른 지붕 세 개.",
    tags: ["모던", "주택"],
    cellSize: 1,
    assets: [] as Cmd[],
    buildings: [{
      name: "modern", origin: [0, 0, 0], structures: [
        { key: "lawn", cmd: "createTerrain", args: { name: "잔디", area: { at: [-20, 0, -14], size: [58, 44] }, depth: 2, material: "grass", border: { material: "leaf_dark", width: 1 } } },
        { key: "pool", cmd: "createTerrain", args: { name: "수영장", area: { at: [2, 0, 15], size: [16, 6] }, material: "water", border: { material: "concrete_white", width: 1 } } },
        { key: "deck", cmd: "createFloor", args: { name: "데크", area: { at: [0, 1, 11], size: [22, 3] }, material: "wood_oak", shape: "floor" } },
        { key: "baseA", cmd: "createFoundation", args: { name: "본채 기초", area: { at: [0, 1, 0], size: [22, 11] }, material: "concrete" } },
        {
          key: "wallsA", cmd: "createWall", args: {
            name: "본채 벽", loop: { on: { ref: "baseA" } }, height: 4, material: "concrete_white",
            openings: [
              { side: "south", at: 2, width: 12, height: 4, bottom: 0, fill: "glass" },
              { side: "east", at: 3, width: 4, height: 3, bottom: 0, fill: "glass" },
            ],
            windows: { width: 2, height: 1, bottom: 2, spacing: 3, margin: 2, sides: ["north"] },
          },
        },
        { key: "roofA", cmd: "createRoof", args: { name: "본채 지붕", area: { on: { ref: "wallsA" } }, style: "flat", overhang: 1, material: "concrete", parapet: { height: 1, material: "concrete_white" } } },
        { key: "floorB", cmd: "createFloor", args: { name: "돌출 박스 바닥", area: { at: [8, 7, -4], size: [20, 10] }, thickness: 1, material: "concrete" } },
        {
          key: "wallsB", cmd: "createWall", args: {
            name: "돌출 박스", loop: { on: { ref: "floorB" } }, height: 4, material: "asphalt", corners: "steel",
            openings: [{ side: "east", at: 1, width: 8, height: 3, bottom: 0, fill: "glass" }],
            windows: { width: 3, height: 2, bottom: 1, spacing: 1, margin: 1, sides: ["south", "north"] },
          },
        },
        { key: "roofB", cmd: "createRoof", args: { name: "박스 지붕", area: { on: { ref: "wallsB" } }, style: "flat", overhang: 0, material: "slate" } },
        { key: "baseC", cmd: "createFoundation", args: { name: "별채 기초", area: { at: [-12, 1, 3], size: [11, 8] }, material: "concrete" } },
        { key: "wallsC", cmd: "createWall", args: { name: "별채", loop: { on: { ref: "baseC" } }, height: 3, material: "wood_dark", openings: [{ side: "south", at: 3, width: 5, height: 3, bottom: 0, fill: "glass" }] } },
        { key: "roofC", cmd: "createRoof", args: { name: "별채 경사 지붕", area: { on: { ref: "wallsC" } }, style: "shed", shedFacing: "north", pitch: 0.5, overhang: 1, material: "steel" } },
        { key: "column", cmd: "createPillar", args: { name: "강철 기둥", positions: [[26, 2, 4], [26, 2, -3]], height: 5, material: "steel", shape: "post" } },
        { key: "trees", cmd: "createTree", args: { name: "나무", positions: [[-16, 1, -10], [32, 1, -10], [-16, 1, 24], [33, 1, 22]], height: 5, crown: 2, style: "cone", material: "leaf" } },
      ] as S[],
    }],
  };
}
