// Procedural 16x16 pixel texture atlas (no image files): 8 patterns x 4 variants.
// Values are grey (multiplied by the per-vertex material colour).
import * as THREE from "three";
import { ATLAS_COLS, ATLAS_ROWS, PATTERNS, VARIANTS_PER_PATTERN } from "./palette";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function tile(pattern: string, variant: number): number[] {
  const r = rng(1234 + variant * 977 + pattern.length * 31);
  const px: number[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let v = 1;
      const n = r();
      switch (pattern) {
        case "noise": v = 0.8 + n * 0.2; break;
        case "leaf": v = 0.68 + n * 0.32 - ((x * 3 + y * 5 + variant) % 7 === 0 ? 0.12 : 0); break;
        case "grain": v = 0.82 + 0.1 * Math.sin((y + variant * 3) * 1.3 + Math.sin(x * 0.7) * 1.5) + n * 0.06; break;
        case "plank": {
          const row = Math.floor((y + variant * 2) / 4);
          const seam = (y + variant * 2) % 4 === 0 || (x + row * 5 + variant * 3) % 16 === 0;
          v = seam ? 0.66 : 0.84 + n * 0.12;
          break;
        }
        case "brick": {
          const row = Math.floor(y / 4);
          const off = row % 2 ? 4 : 0;
          const mortar = y % 4 === 0 || (x + off) % 8 === 0;
          v = mortar ? 0.92 + n * 0.05 : 0.74 + n * 0.16;
          break;
        }
        case "tile": {
          const row = Math.floor(y / 4);
          const curve = Math.abs(((x + (row % 2) * 2) % 4) - 1.5) / 1.5;
          v = y % 4 === 3 ? 0.62 : 0.78 + (1 - curve) * 0.16 + n * 0.05;
          break;
        }
        case "grid": v = x === 0 || y === 0 || x === 15 || y === 15 ? 0.7 : x === 8 || y === 8 ? 0.85 : 0.98 + n * 0.02; break;
        case "none": v = 1; break;
      }
      px.push(Math.max(0, Math.min(1, v)));
    }
  return px;
}

export function createAtlasTexture(): THREE.DataTexture {
  const W = 16 * ATLAS_COLS, H = 16 * ATLAS_ROWS;
  const data = new Uint8Array(W * H * 4);
  PATTERNS.forEach((p, pi) => {
    for (let v = 0; v < VARIANTS_PER_PATTERN; v++) {
      const t = pi * VARIANTS_PER_PATTERN + v;
      const col = t % ATLAS_COLS, row = Math.floor(t / ATLAS_COLS);
      const px = tile(p, v);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          // DataTexture row 0 is the bottom (flipY false) -> tile rows counted from the top
          const gx = col * 16 + x, gy = H - 1 - (row * 16 + y);
          const o = (gy * W + gx) * 4;
          const g = Math.round(px[y * 16 + x] * 255);
          data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
        }
    }
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace; // grey multipliers, keep them linear
  tex.needsUpdate = true;
  return tex;
}
