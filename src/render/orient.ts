// Orientation math shared by the mesher, picking and the instanced renderer.
// rot byte: low 2 bits = yaw k (facing north/east/south/west), bit 2 = upside down.
// Local shapes have their "back/tall" side at -z (north). World transform:
//   p' = Ry(-k * 90deg) * Rz(flip ? 180deg : 0) * (p - 0.5) + 0.5

export type M3 = [number, number, number, number, number, number, number, number, number]; // row-major

export function rotMatrix(rot: number): M3 {
  const k = rot & 3;
  const flip = (rot & 4) !== 0;
  const th = (-k * Math.PI) / 2;
  const c = Math.round(Math.cos(th)), s = Math.round(Math.sin(th));
  // Ry(th) = [[c,0,s],[0,1,0],[-s,0,c]]
  const ry: M3 = [c, 0, s, 0, 1, 0, -s, 0, c];
  if (!flip) return ry;
  // Rz(pi) = diag(-1,-1,1)
  return [-ry[0], -ry[1], ry[2], -ry[3], -ry[4], ry[5], -ry[6], -ry[7], ry[8]];
}

export function applyM3(m: M3, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

// face order used everywhere: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
export const FACE_DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACE_NAMES = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;

export function dirToFace(d: [number, number, number]): number {
  if (d[0] > 0.5) return 0;
  if (d[0] < -0.5) return 1;
  if (d[1] > 0.5) return 2;
  if (d[1] < -0.5) return 3;
  if (d[2] > 0.5) return 4;
  return 5;
}

/** 6-bit mask of world faces that are solid for a shape with local solid faces, rotated by rot. */
export function solidMask(localSolid: readonly string[], rot: number): number {
  const m = rotMatrix(rot);
  let mask = 0;
  for (const name of localSolid) {
    const fi = FACE_NAMES.indexOf(name as (typeof FACE_NAMES)[number]);
    if (fi < 0) continue;
    mask |= 1 << dirToFace(applyM3(m, ...FACE_DIRS[fi]));
  }
  return mask;
}

/**
 * Column-major 4x4 instance matrix for a shape anchored at cell (x,y,z).
 * The shape's local box [0,w]x[0,h]x[0,d] is rotated about its centre and placed so that the
 * rotated footprint's min corner is the anchor (for 1x1x1 this is the plain cell transform).
 */
export function instanceMatrix(x: number, y: number, z: number, rot: number, out: Float32Array, o: number, size: [number, number, number] = [1, 1, 1]) {
  const m = rotMatrix(rot);
  const [w, h, d] = size;
  const c = applyM3(m, w / 2, h / 2, d / 2);
  const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
  const tx = x + W / 2 - c[0], ty = y + h / 2 - c[1], tz = z + D / 2 - c[2];
  out[o] = m[0]; out[o + 1] = m[3]; out[o + 2] = m[6]; out[o + 3] = 0;
  out[o + 4] = m[1]; out[o + 5] = m[4]; out[o + 6] = m[7]; out[o + 7] = 0;
  out[o + 8] = m[2]; out[o + 9] = m[5]; out[o + 10] = m[8]; out[o + 11] = 0;
  out[o + 12] = tx; out[o + 13] = ty; out[o + 14] = tz; out[o + 15] = 1;
}
