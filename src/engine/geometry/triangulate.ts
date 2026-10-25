// Ear-clipping triangulation for simple (possibly concave) 2D polygons.
export type P2 = [number, number];

export function polygonArea(p: P2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return a / 2; // > 0 means counter-clockwise (y up)
}

function cross(o: P2, a: P2, b: P2) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function inTri(p: P2, a: P2, b: P2, c: P2) {
  const d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Returns index triples into `poly` (counter-clockwise output winding). */
export function triangulate(poly: P2[]): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  let idx = [...Array(n).keys()];
  // make counter-clockwise
  if (polygonArea(poly) < 0) idx.reverse();
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(poly[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // self-intersecting input: give up on the rest
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
