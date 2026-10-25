// Environment-independent base64 (works in Node and browsers without Buffer/btoa).
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const R = new Int16Array(128).fill(-1);
for (let i = 0; i < A.length; i++) R[A.charCodeAt(i)] = i;

export function bytesToB64(b: Uint8Array): string {
  const out: string[] = [];
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : "=") + (i + 2 < b.length ? A[n & 63] : "=");
    if (s.length > 8192) { out.push(s); s = ""; }
  }
  out.push(s);
  return out.join("");
}

export function b64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (R[clean.charCodeAt(i)] << 18) | (R[clean.charCodeAt(i + 1)] << 12) |
      ((R[clean.charCodeAt(i + 2)] & 63) << 6) | (R[clean.charCodeAt(i + 3)] & 63);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Byte run-length encoding: [runLength varint][byte] ... (chunk arrays are mostly zeros). */
export function rleEncode(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < b.length) {
    const v = b[i];
    let n = 1;
    while (i + n < b.length && b[i + n] === v) n++;
    let len = n;
    while (len >= 0x80) { out.push((len & 0x7f) | 0x80); len >>>= 7; }
    out.push(len, v);
    i += n;
  }
  return Uint8Array.from(out);
}

export function rleDecode(b: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0, o = 0;
  while (i < b.length) {
    let len = 0, shift = 0, c;
    do { c = b[i++]; len |= (c & 0x7f) << shift; shift += 7; } while (c & 0x80);
    out.fill(b[i++], o, o + len);
    o += len;
  }
  return out;
}
