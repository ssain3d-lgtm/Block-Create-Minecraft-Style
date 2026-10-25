import type { MaterialDef, ShapeDef, Recipe } from "../types";

// ---------- materials (palette follows the reference screenshots) ----------
const m = (id: string, name: string, kind: MaterialDef["kind"], color: string, extra: Partial<MaterialDef> = {}): MaterialDef => ({
  id: `builtin.${id}`,
  name,
  kind,
  color,
  roughness: kind === "metal" ? 0.55 : kind === "glass" || kind === "water" ? 0.1 : 0.85,
  metalness: kind === "metal" ? 0.35 : 0,
  opacity: 1,
  pattern: {
    type: kind === "wood" ? "plank" : kind === "brick" ? "brick" : kind === "tile" ? "tile" : kind === "glass" ? "grid" : "noise",
    contrast: 0.18,
  },
  variants: { count: 4, lightness: kind === "glass" || kind === "water" ? 0.02 : 0.07 },
  version: 1,
  ...extra,
});

export const BUILTIN_MATERIALS: MaterialDef[] = [
  m("iron_lower", "철재 하부", "metal", "#6b5d4f", { tags: ["iron", "eiffel"] }),
  m("iron_mid", "철재 중부", "metal", "#5e5140", { tags: ["iron", "eiffel"] }),
  m("iron_dark", "철재 짙음", "metal", "#4b4038", { tags: ["iron"] }),
  m("iron_black", "흑철", "metal", "#2e2824", { tags: ["iron"] }),
  m("iron_shadow", "철재 그늘", "metal", "#3a332e", { tags: ["iron"] }),
  m("wood_oak", "참나무", "wood", "#8f6e50"),
  m("coal", "숯돌", "stone", "#2a2522"),
  m("stone", "석재", "stone", "#77736e"),
  m("steel", "강철", "metal", "#8f8e92"),
  m("lamp", "등불", "custom", "#f2c46b", { emissive: "#f2b44b", pattern: { type: "none" } }),
  m("sand", "모래", "stone", "#efe0b3"),
  m("brick", "벽돌", "brick", "#8e3a2c"),
  m("stone_dark", "짙은 석재", "stone", "#6e6a64"),
  m("stone_light", "밝은 석재", "stone", "#c4b8a6"),
  m("concrete", "콘크리트", "concrete", "#a89f94"),
  m("slate", "슬레이트", "stone", "#55565a"),
  m("paving", "포장석", "stone", "#cfc5b0"),
  m("grass", "잔디", "plant", "#6f9a54"),
  m("leaf_dark", "짙은 잎", "plant", "#3e5e3c"),
  m("leaf", "잎", "plant", "#4e8a3e"),
  m("wood_gold", "황목", "wood", "#9b7a3a"),
  m("leaf_teal", "청록 잎", "plant", "#2f5e4c"),
  m("wood_dark", "짙은 목재", "wood", "#5a4433"),
  m("water", "물", "water", "#4a90a8", { opacity: 0.78, pattern: { type: "noise", contrast: 0.08 } }),
  m("glass", "유리", "glass", "#d6e8ef", { opacity: 0.45 }),
  m("asphalt", "아스팔트", "stone", "#4f4f4c"),
  m("moss", "이끼", "plant", "#6a8a4a"),
  m("terracotta", "테라코타", "brick", "#6e4e3a"),
  m("roof_tile", "기와", "tile", "#4d5560"),
  m("plaster", "회벽", "concrete", "#efece6"),
  m("concrete_white", "흰 콘크리트", "concrete", "#d8d6d0"),
  m("rail_red", "붉은 레일", "metal", "#9c2f25"),
  m("bark", "나무껍질", "wood", "#5b4330"),
];

// ---------- shapes ----------
// Profiles for extrude are (z, y) points inside the unit cell, extruded along x.
// Facing north (rot 0) = the "high/back" side is at z = 0.
const s = (id: string, name: string, recipe: Recipe, solidFaces: ShapeDef["solidFaces"], tags: string[], description: string): ShapeDef => ({
  id: `builtin.${id}`, name, recipe, solidFaces, tags, description, version: 1,
});

function archProfile(): [number, number][] {
  const pts: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0.85]];
  const r = 0.85, n = 8;
  for (let i = 1; i < n; i++) {
    const a = (Math.PI / 2) * (i / n);
    pts.push([1 - r * Math.sin(a), r * Math.cos(a)]);
  }
  pts.push([0.15, 0]);
  return pts;
}

/** cube edges + X braces on the 4 vertical sides, as an 8^3 sub-voxel mask */
function trussMask(n = 8): string[][] {
  const layers: string[][] = [];
  for (let y = 0; y < n; y++) {
    const rows: string[] = [];
    for (let z = 0; z < n; z++) {
      let row = "";
      for (let x = 0; x < n; x++) {
        const ex = x === 0 || x === n - 1, ey = y === 0 || y === n - 1, ez = z === 0 || z === n - 1;
        const edge = (ex && ey) || (ey && ez) || (ex && ez);
        const diagX = (ez) && (x === y || x === n - 1 - y); // braces on z faces
        const diagZ = (ex) && (z === y || z === n - 1 - y); // braces on x faces
        row += edge || diagX || diagZ ? "#" : ".";
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return layers;
}

function latticeMask(n = 8): string[][] {
  const layers: string[][] = [];
  for (let y = 0; y < n; y++) {
    const rows: string[] = [];
    for (let z = 0; z < n; z++) {
      let row = "";
      for (let x = 0; x < n; x++) {
        const plane = z === 3 || z === 4;
        row += plane && (x % 2 === 0 || y === 0 || y === n - 1) ? "#" : ".";
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return layers;
}

function leavesMask(n = 8): string[][] {
  // rounded leaf ball with a few holes (deterministic)
  const layers: string[][] = [];
  for (let y = 0; y < n; y++) {
    const rows: string[] = [];
    for (let z = 0; z < n; z++) {
      let row = "";
      for (let x = 0; x < n; x++) {
        const hole = ((x * 7 + y * 13 + z * 5) % 11) === 0;
        row += hole ? "." : "#";
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  return layers;
}

export const BUILTIN_SHAPES: ShapeDef[] = [
  s("cube", "큐브", { type: "box", min: [0, 0, 0], max: [1, 1, 1] }, ["+x", "-x", "+y", "-y", "+z", "-z"], ["basic", "solid"], "Full block."),
  s("slab", "반블록", { type: "box", min: [0, 0, 0], max: [1, 0.5, 1] }, ["-y"], ["basic", "floor"], "Half-height block. upsideDown puts it at the top half."),
  s("floor", "마루", { type: "box", min: [0, 0, 0], max: [1, 0.125, 1] }, ["-y"], ["basic", "floor", "deck"], "Thin floor plate (1/8 height)."),
  s("stair", "계단", { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] }, ["-y", "-z"], ["basic", "stair"], "Stair step; the tall side faces the 'facing' direction."),
  s("wedge", "경사", { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [0, 1]] }, ["-y", "-z"], ["basic", "slope", "roof"], "45 degree slope; tall side faces the 'facing' direction."),
  s("wedge_half", "완경사", { type: "extrude", axis: "x", profile: [[0, 0], [1, 0], [0, 0.5]] }, ["-y"], ["slope", "roof"], "Half-height slope (about 27 degrees)."),
  s("roof_plate", "지붕판", { type: "extrude", axis: "x", profile: [[0, 1], [0, 0.82], [1, -0.0], [1, 0.18]] }, [], ["roof", "slope"], "Thin sloped roof plate, high at the facing side."),
  s("pillar", "기둥", { type: "box", min: [0.25, 0, 0.25], max: [0.75, 1, 0.75] }, [], ["column", "structure"], "Half-width vertical column."),
  s("post", "가는 기둥", { type: "box", min: [0.375, 0, 0.375], max: [0.625, 1, 0.625] }, [], ["column", "thin"], "Thin post."),
  s("beam", "보", { type: "box", min: [0, 0.3, 0.3], max: [1, 0.7, 0.7] }, [], ["beam", "structure"], "Horizontal beam along x (rotate with facing)."),
  s("arch", "아치", { type: "extrude", axis: "x", profile: archProfile() }, ["+y", "-z"], ["arch"], "Quarter-arch block; curve opens toward +z (rotate to orient)."),
  s("fence", "울타리", {
    type: "composite", parts: [
      { recipe: { type: "box", min: [0.4, 0, 0.4], max: [0.6, 1, 0.6] } },
      { recipe: { type: "box", min: [0, 0.35, 0.45], max: [1, 0.48, 0.55] } },
      { recipe: { type: "box", min: [0, 0.75, 0.45], max: [1, 0.88, 0.55] } },
    ],
  }, [], ["fence", "railing"], "Post with two rails along x."),
  s("truss", "트러스", { type: "subvoxel", size: 8, mask: trussMask() }, [], ["truss", "iron", "lattice"], "Open iron lattice cell: cube edges plus X braces."),
  s("lattice", "창살", { type: "subvoxel", size: 8, mask: latticeMask() }, [], ["window", "grille"], "Thin vertical grille panel (x-y plane)."),
  s("pane", "판유리", { type: "box", min: [0, 0, 0.45], max: [1, 1, 0.55] }, [], ["window", "glass"], "Thin full pane in the x-y plane."),
  s("leaves", "잎덩이", { type: "subvoxel", size: 8, mask: leavesMask() }, [], ["plant", "tree"], "Leafy block with small holes."),
  s("lamp_post", "가로등", {
    type: "composite", parts: [
      { recipe: { type: "box", min: [0.42, 0, 0.42], max: [0.58, 0.8, 0.58] } },
      { recipe: { type: "box", min: [0.32, 0.8, 0.32], max: [0.68, 1, 0.68] } },
    ],
  }, [], ["lamp", "street"], "Small street lamp (use with an emissive material)."),
];

export const BUILTIN_ALIASES: Record<string, string> = {
  큐브: "builtin.cube", 반블록: "builtin.slab", 계단: "builtin.stair", 경사: "builtin.wedge", 마루: "builtin.floor",
};
