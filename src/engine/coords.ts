// Grid coordinates, cell keys and chunk math.
// y is up (same as Three.js). One cell = project.settings.cellSize meters.

export const CHUNK = 16;
export const CHUNK_VOL = CHUNK * CHUNK * CHUNK;
const OFF = 2048;
const S = 4096;

export type Vec3 = [number, number, number];

/** Packs an integer cell position into one safe JS number (36 bits used). */
export function cellKey(x: number, y: number, z: number): number {
  return ((x + OFF) * S + (y + OFF)) * S + (z + OFF);
}

export function keyToCell(k: number): Vec3 {
  const z = (k % S) - OFF;
  const t = Math.floor(k / S);
  const y = (t % S) - OFF;
  const x = Math.floor(t / S) - OFF;
  return [x, y, z];
}

export function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK);
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

export function localIndex(x: number, y: number, z: number): number {
  const lx = x - Math.floor(x / CHUNK) * CHUNK;
  const ly = y - Math.floor(y / CHUNK) * CHUNK;
  const lz = z - Math.floor(z / CHUNK) * CHUNK;
  return (ly * CHUNK + lz) * CHUNK + lx;
}

export function normBox(a: Vec3, b: Vec3): { min: Vec3; max: Vec3 } {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

export const FACINGS = ["north", "east", "south", "west"] as const;
export type Facing = (typeof FACINGS)[number];

/**
 * Orientation byte: low 2 bits = yaw (0..3, 90deg steps around +y, 0 = facing north/-z),
 * bit 2 = upside down. 8 orientations cover stairs, wedges and roofs.
 */
export function makeRot(facing: Facing | number = 0, upsideDown = false): number {
  const yaw = typeof facing === "number" ? ((facing % 4) + 4) % 4 : FACINGS.indexOf(facing);
  return (yaw & 3) | (upsideDown ? 4 : 0);
}

export function rotYaw(rot: number): number {
  return rot & 3;
}

export function rotFlip(rot: number): boolean {
  return (rot & 4) !== 0;
}
