import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const vox = (args: string[]) => {
  try {
    return { code: 0, out: execFileSync("npx", ["tsx", "src/cli/index.ts", ...args, "--quiet"], { encoding: "utf8" }) };
  } catch (e: any) {
    return { code: e.status as number, out: String(e.stdout) + String(e.stderr) };
  }
};

describe("CLI", () => {
  it("saves when a new-project plan is re-run onto an existing file, and refuses paths outside", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-cli-"));
    const f = path.join(dir, "p.vox.json");
    expect(vox(["run", "examples/house.plan.json", "--project", f]).out).toContain("saved");
    const first = fs.readFileSync(f, "utf8");
    // a different plan of the same log length must still be saved
    const r = vox(["run", "examples/modern.plan.json", "--project", f]);
    expect(r.out).toContain("saved");
    expect(fs.readFileSync(f, "utf8")).not.toBe(first);
    expect(vox(["inspect", "--project", path.join(dir, "missing.vox.json")]).code).toBe(1);
    const bad = vox(["cmd", JSON.stringify({ cmd: "saveProject", args: { path: "../../../../etc/x.vox.json" } })]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("PATH_DENIED");
  }, 120000);
});
