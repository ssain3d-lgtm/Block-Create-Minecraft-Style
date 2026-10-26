// Flattens project palette + asset definitions into typed arrays for the mesher.
import type { Project } from "../engine/project";
import type { MaterialDef } from "../engine/types";
import { solidMask } from "./orient";

export const PATTERNS = ["noise", "grain", "plank", "brick", "tile", "grid", "none", "leaf"] as const;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const VARIANTS_PER_PATTERN = 4; // tile index = pattern * 4 + variant (32 tiles)

export const BUCKET_OPAQUE = 0, BUCKET_TRANSPARENT = 1, BUCKET_GLOW = 2;

export interface PaletteInfo {
  key: string;
  shapeIds: string[];
  shapeIsCube: Uint8Array;
  shapeSolid: Uint8Array; // [shape * 8 + rot] -> world face mask
  matColor: Float32Array; // linear-ish rgb 0..1 (sRGB values, converted by renderer)
  matAlpha: Float32Array;
  matBucket: Uint8Array;
  matPattern: Uint8Array;
  matVarLight: Float32Array;
  matVarCount: Uint8Array;
  hidden: Set<number>; // hidden structure numbers
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function patternIndex(m: MaterialDef | undefined): number {
  if (!m) return 0;
  if (m.kind === "plant" && (!m.pattern || m.pattern.type === "noise")) return PATTERNS.indexOf("leaf");
  const t = m.pattern?.type ?? "noise";
  const i = PATTERNS.indexOf(t as (typeof PATTERNS)[number]);
  return i < 0 ? 0 : i;
}

export function buildPalette(p: Project, only?: Set<number> | null): PaletteInfo {
  const shapes = p.meta.palette.shapes, mats = p.meta.palette.materials;
  const shapeIsCube = new Uint8Array(shapes.length);
  const shapeSolid = new Uint8Array(shapes.length * 8);
  shapes.forEach((id, i) => {
    if (i === 0) return;
    const def = p.assets.findShape(id, p.meta.assets.shapes);
    shapeIsCube[i] = id === "builtin.cube" ? 1 : 0;
    for (let r = 0; r < 8; r++) shapeSolid[i * 8 + r] = def ? solidMask(def.solidFaces, r) : 0;
  });
  const matColor = new Float32Array(mats.length * 3);
  const matAlpha = new Float32Array(mats.length);
  const matBucket = new Uint8Array(mats.length);
  const matPattern = new Uint8Array(mats.length);
  const matVarLight = new Float32Array(mats.length);
  const matVarCount = new Uint8Array(mats.length);
  mats.forEach((id, i) => {
    const def = i === 0 ? undefined : p.assets.findMaterial(id, p.meta.assets.materials);
    // vertex/instance colours are linear in Three.js -> convert from sRGB hex
    const [r, g, b] = hexToRgb(def?.color ?? "#ff00ff").map(srgbToLinear);
    matColor[i * 3] = r; matColor[i * 3 + 1] = g; matColor[i * 3 + 2] = b;
    matAlpha[i] = def?.opacity ?? 1;
    matBucket[i] = def?.emissive ? BUCKET_GLOW : (def?.opacity ?? 1) < 0.99 ? BUCKET_TRANSPARENT : BUCKET_OPAQUE;
    matPattern[i] = patternIndex(def);
    matVarLight[i] = def?.variants?.lightness ?? 0.06;
    matVarCount[i] = Math.max(1, Math.min(8, def?.variants?.count ?? 4));
  });
  const hidden = new Set(p.meta.structures.filter((s) => !s.visible || (only && !only.has(s.num))).map((s) => s.num));
  if (only) hidden.add(0); // blocks that belong to no structure
  const assetKey = JSON.stringify([p.meta.assets.materials.map((m) => [m.id, m.version, m.color, m.opacity]), p.meta.assets.shapes.map((s) => [s.id, s.version, JSON.stringify(s.recipe).length])]);
  return {
    key: `${shapes.join("|")}#${mats.join("|")}#${[...hidden].join(",")}#${assetKey}`,
    shapeIds: shapes, shapeIsCube, shapeSolid, matColor, matAlpha, matBucket, matPattern, matVarLight, matVarCount, hidden,
  };
}
