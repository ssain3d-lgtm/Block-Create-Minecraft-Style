// Safe file helpers: path sandboxing and atomic writes with backups.
import fs from "node:fs";
import path from "node:path";
import { CmdError } from "../engine/project";

/** true when `child` is `root` or inside it (both absolute, already resolved) */
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath of the nearest existing ancestor + the rest (follows symlinks that already exist) */
function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  let real = cur;
  try { real = fs.realpathSync.native(cur); } catch { /* keep */ }
  return path.join(real, ...rest);
}

export interface Sandbox {
  /** directories that may be read */
  read: string[];
  /** directories that may be written */
  write: string[];
  /** allowed extensions for writing (lower case, with dot) */
  writeExt?: string[];
  readExt?: string[];
}

/**
 * Resolves a user/AI supplied path against baseDir and checks it against the sandbox.
 * Rejects NUL bytes, escapes with "..", absolute paths outside the allowed roots and symlink escapes.
 */
export function resolveSafe(baseDir: string, p: string, sb: Sandbox, mode: "read" | "write"): string {
  if (typeof p !== "string" || !p.trim()) throw new CmdError("PATH_DENIED", "empty path");
  if (p.includes("\0")) throw new CmdError("PATH_DENIED", "path contains a NUL byte");
  if (p.length > 512) throw new CmdError("PATH_DENIED", "path too long");
  const abs = path.resolve(baseDir, p);
  const roots = (mode === "read" ? sb.read : sb.write).map((r) => realish(path.resolve(r)));
  const real = realish(abs);
  if (!roots.some((r) => isInside(r, real))) {
    throw new CmdError("PATH_DENIED", `path "${p}" is outside the allowed folders`, `use a path inside: ${roots.map((r) => path.relative(baseDir, r) || ".").join(", ")}`);
  }
  const exts = mode === "write" ? sb.writeExt : sb.readExt;
  if (exts && !exts.some((e) => abs.toLowerCase().endsWith(e))) {
    throw new CmdError("PATH_DENIED", `file type not allowed for ${mode}: ${path.basename(abs)}`, `allowed: ${exts.join(", ")}`);
  }
  return abs;
}

/**
 * Atomic write: data goes to a temp file in the same folder, is flushed to disk, then renamed over
 * the target. With keepBackups > 0 the previous file is rotated to <file>.bak1 .. .bakN first.
 */
export function writeFileAtomic(file: string, data: string | Uint8Array, keepBackups = 0) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  fs.closeSync(fd);
  try {
    if (keepBackups > 0 && fs.existsSync(file)) {
      for (let i = keepBackups; i > 1; i--) {
        const from = `${file}.bak${i - 1}`, to = `${file}.bak${i}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.copyFileSync(file, `${file}.bak1`);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export function backupsOf(file: string, max = 9): string[] {
  const out: string[] = [];
  for (let i = 1; i <= max; i++) if (fs.existsSync(`${file}.bak${i}`)) out.push(`${file}.bak${i}`);
  return out;
}
