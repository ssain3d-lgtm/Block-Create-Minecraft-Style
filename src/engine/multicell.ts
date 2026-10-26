// Multi-cell shapes: a shape whose size is larger than one cell (e.g. 2x4x1, 4x4x4).
// Storage: the anchor cell (min corner of the rotated footprint) holds the shape; every other
// covered cell holds "builtin.occupied" with aux = offset to the anchor. Rendering, picking,
// collisions, undo and saving all work on plain cells, so files stay compatible.
import type { Vec3 } from "./coords";
import type { ShapeDef } from "./types";

export const OCCUPIED_ID = "builtin.occupied";
export const MAX_SHAPE_DIM = 16;

export function shapeSize(def: ShapeDef | undefined): Vec3 {
  const s = def?.size;
  return s ? [s[0], s[1], s[2]] : [1, 1, 1];
}

export function isMulti(def: ShapeDef | undefined): boolean {
  const s = def?.size;
  return !!s && (s[0] > 1 || s[1] > 1 || s[2] > 1);
}

/** footprint [w, h, d] in world axes after rotation (quarter turns swap w and d) */
export function rotatedSize(size: Vec3, rot: number): Vec3 {
  return (rot & 1) ? [size[2], size[1], size[0]] : [size[0], size[1], size[2]];
}

/** every cell covered by a shape whose anchor (min corner) is `a` */
export function footprintCells(a: Vec3, size: Vec3, rot: number): Vec3[] {
  const [w, h, d] = rotatedSize(size, rot);
  const out: Vec3[] = [];
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push([a[0] + x, a[1] + y, a[2] + z]);
  return out;
}

export function packOffset(dx: number, dy: number, dz: number): number {
  return (dx & 15) | ((dy & 15) << 4) | ((dz & 15) << 8);
}

export function unpackOffset(aux: number): Vec3 {
  return [aux & 15, (aux >> 4) & 15, (aux >> 8) & 15];
}
