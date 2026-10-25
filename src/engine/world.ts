import { CHUNK, CHUNK_VOL, chunkCoord, chunkKey, cellKey, localIndex, Vec3 } from "./coords";
import { bytesToB64, b64ToBytes, rleEncode, rleDecode } from "./util/base64";

/** One stored block. Numbers are palette indices (0 = empty). */
export interface BlockData {
  shape: number;
  material: number;
  rot: number;
  structure: number;
}

export class Chunk {
  readonly shape = new Uint16Array(CHUNK_VOL);
  readonly material = new Uint16Array(CHUNK_VOL);
  readonly rot = new Uint8Array(CHUNK_VOL);
  readonly structure = new Uint32Array(CHUNK_VOL);
  count = 0;
  constructor(readonly cx: number, readonly cy: number, readonly cz: number) {}
  get key() {
    return chunkKey(this.cx, this.cy, this.cz);
  }
}

/**
 * Sparse chunked voxel world (16^3 chunks, empty chunks are not allocated).
 * Keeps a structure index (structure number -> cell keys) and a set of dirty chunks
 * so renderers can rebuild incrementally.
 */
export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly structIndex = new Map<number, Set<number>>();
  readonly dirty = new Set<string>();
  blockCount = 0;
  /** bumped on every change; cheap change detection for UIs */
  version = 0;

  private chunkAt(x: number, y: number, z: number, create: boolean): Chunk | undefined {
    const cx = chunkCoord(x), cy = chunkCoord(y), cz = chunkCoord(z);
    const k = chunkKey(cx, cy, cz);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = new Chunk(cx, cy, cz);
      this.chunks.set(k, c);
    }
    return c;
  }

  getShape(x: number, y: number, z: number): number {
    const c = this.chunkAt(x, y, z, false);
    return c ? c.shape[localIndex(x, y, z)] : 0;
  }

  get(x: number, y: number, z: number): BlockData | null {
    const c = this.chunkAt(x, y, z, false);
    if (!c) return null;
    const i = localIndex(x, y, z);
    if (c.shape[i] === 0) return null;
    return { shape: c.shape[i], material: c.material[i], rot: c.rot[i], structure: c.structure[i] };
  }

  /** Sets (or clears with null) a cell. Returns the previous block. */
  set(x: number, y: number, z: number, b: BlockData | null): BlockData | null {
    const c = this.chunkAt(x, y, z, b !== null);
    if (!c) return null;
    const i = localIndex(x, y, z);
    const prev: BlockData | null =
      c.shape[i] === 0 ? null : { shape: c.shape[i], material: c.material[i], rot: c.rot[i], structure: c.structure[i] };
    if (!prev && !b) return null;
    const key = cellKey(x, y, z);
    if (prev && prev.structure) this.structIndex.get(prev.structure)?.delete(key);
    if (b) {
      c.shape[i] = b.shape;
      c.material[i] = b.material;
      c.rot[i] = b.rot;
      c.structure[i] = b.structure;
      if (!prev) { c.count++; this.blockCount++; }
      if (b.structure) {
        let s = this.structIndex.get(b.structure);
        if (!s) { s = new Set(); this.structIndex.set(b.structure, s); }
        s.add(key);
      }
    } else {
      c.shape[i] = 0; c.material[i] = 0; c.rot[i] = 0; c.structure[i] = 0;
      c.count--; this.blockCount--;
      if (c.count === 0) this.chunks.delete(c.key);
    }
    this.markDirty(x, y, z);
    this.version++;
    return prev;
  }

  private markDirty(x: number, y: number, z: number) {
    const cx = chunkCoord(x), cy = chunkCoord(y), cz = chunkCoord(z);
    this.dirty.add(chunkKey(cx, cy, cz));
    // neighbours share faces with border cells (hidden-face culling)
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0) this.dirty.add(chunkKey(cx - 1, cy, cz));
    if (lx === CHUNK - 1) this.dirty.add(chunkKey(cx + 1, cy, cz));
    if (ly === 0) this.dirty.add(chunkKey(cx, cy - 1, cz));
    if (ly === CHUNK - 1) this.dirty.add(chunkKey(cx, cy + 1, cz));
    if (lz === 0) this.dirty.add(chunkKey(cx, cy, cz - 1));
    if (lz === CHUNK - 1) this.dirty.add(chunkKey(cx, cy, cz + 1));
  }

  clear() {
    for (const k of this.chunks.keys()) this.dirty.add(k);
    this.chunks.clear();
    this.structIndex.clear();
    this.blockCount = 0;
    this.version++;
  }

  structureCells(num: number): number[] {
    return [...(this.structIndex.get(num) ?? [])];
  }

  forEach(cb: (x: number, y: number, z: number, b: BlockData) => void) {
    for (const c of this.chunks.values()) {
      const bx = c.cx * CHUNK, by = c.cy * CHUNK, bz = c.cz * CHUNK;
      for (let i = 0; i < CHUNK_VOL; i++) {
        if (c.shape[i] === 0) continue;
        const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, ly = Math.floor(i / (CHUNK * CHUNK));
        cb(bx + lx, by + ly, bz + lz, { shape: c.shape[i], material: c.material[i], rot: c.rot[i], structure: c.structure[i] });
      }
    }
  }

  bounds(): { min: Vec3; max: Vec3 } | null {
    let min: Vec3 | null = null, max: Vec3 | null = null;
    this.forEach((x, y, z) => {
      if (!min || !max) { min = [x, y, z]; max = [x, y, z]; return; }
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    });
    return min && max ? { min, max } : null;
  }

  /** Order-independent content hash, used to prove that replays are deterministic. */
  hash(): string {
    let h1 = 0x811c9dc5 >>> 0, h2 = 0;
    this.forEach((x, y, z, b) => {
      let v = (cellKey(x, y, z) % 2147483647) ^ (b.shape * 73856093) ^ (b.material * 19349663) ^ (b.rot * 83492791);
      v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
      v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
      h1 = (h1 + (v >>> 0)) >>> 0;
      h2 = (h2 ^ v) >>> 0;
    });
    return `${this.blockCount}-${h1.toString(16)}-${h2.toString(16)}`;
  }

  serialize(): SerializedWorld {
    const chunks: SerializedChunk[] = [];
    for (const c of this.chunks.values()) {
      chunks.push({
        k: c.key,
        shape: enc(new Uint8Array(c.shape.buffer)),
        material: enc(new Uint8Array(c.material.buffer)),
        rot: enc(c.rot),
        structure: enc(new Uint8Array(c.structure.buffer)),
      });
    }
    return { encoding: "chunks-rle-b64-le-v1", chunks };
  }

  static deserialize(data: SerializedWorld): World {
    const w = new World();
    if (data.encoding !== "chunks-rle-b64-le-v1") throw new Error(`unknown world encoding ${data.encoding}`);
    for (const sc of data.chunks) {
      const [cx, cy, cz] = sc.k.split(",").map(Number);
      const c = new Chunk(cx, cy, cz);
      c.shape.set(new Uint16Array(dec(sc.shape, CHUNK_VOL * 2).buffer));
      c.material.set(new Uint16Array(dec(sc.material, CHUNK_VOL * 2).buffer));
      c.rot.set(dec(sc.rot, CHUNK_VOL));
      c.structure.set(new Uint32Array(dec(sc.structure, CHUNK_VOL * 4).buffer));
      const bx = cx * CHUNK, by = cy * CHUNK, bz = cz * CHUNK;
      for (let i = 0; i < CHUNK_VOL; i++) {
        if (c.shape[i] === 0) continue;
        c.count++;
        if (c.structure[i]) {
          const lx = i % CHUNK, lz = Math.floor(i / CHUNK) % CHUNK, ly = Math.floor(i / (CHUNK * CHUNK));
          let s = w.structIndex.get(c.structure[i]);
          if (!s) { s = new Set(); w.structIndex.set(c.structure[i], s); }
          s.add(cellKey(bx + lx, by + ly, bz + lz));
        }
      }
      if (c.count) {
        w.chunks.set(c.key, c);
        w.blockCount += c.count;
        w.dirty.add(c.key);
      }
    }
    return w;
  }
}

export interface SerializedChunk { k: string; shape: string; material: string; rot: string; structure: string }
export interface SerializedWorld { encoding: string; chunks: SerializedChunk[] }

const enc = (b: Uint8Array) => bytesToB64(rleEncode(b));
const dec = (s: string, size: number) => rleDecode(b64ToBytes(s), size);
