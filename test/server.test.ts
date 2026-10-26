// Security, data-integrity and transaction tests for the HTTP server and the file host.
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startServer, VoxServer, LIMITS } from "../src/server/server";
import { createNodeEngine } from "../src/node/host";
import { writeFileAtomic, resolveSafe } from "../src/node/fsx";
import { Engine } from "../src/engine";
import { housePlan } from "../examples/plans";
import { SCENES } from "../bench/scenes";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vox-srv-"));
const servers: VoxServer[] = [];
afterEach(async () => { while (servers.length) await servers.pop()!.close(); });

async function start(dir = tmp(), extra: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({ port: 0, studio: false, projectPath: path.join(dir, "current.vox.json"), tokenFile: path.join(dir, "token.json"), log: () => {}, headlessRender: false, ...extra });
  servers.push(s);
  return s;
}

/** raw request (lets us set Host / Origin headers that fetch would not allow) */
function raw(s: VoxServer, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  const u = new URL(s.url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let body: any = text;
        try { body = JSON.parse(text); } catch { /* text */ }
        resolve({ status: res.statusCode!, body, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const auth = (s: VoxServer) => ({ "content-type": "application/json", "x-vox-token": s.token });
const post = (s: VoxServer, body: unknown) => raw(s, { method: "POST", path: "/api/command", headers: auth(s), body: JSON.stringify(body) });

describe("API security", () => {
  it("refuses requests without the token, with a foreign Host, from another origin or cross-site", async () => {
    const s = await start();
    expect((await raw(s, { path: "/api/health" })).status).toBe(200);
    expect((await raw(s, { path: "/api/state" })).status).toBe(401);
    expect((await raw(s, { path: "/api/state", headers: { "x-vox-token": "nope" } })).status).toBe(401);
    expect((await raw(s, { path: "/api/state", headers: { "x-vox-token": s.token } })).status).toBe(200);
    // DNS rebinding: attacker.example resolving to 127.0.0.1
    expect((await raw(s, { path: "/api/health", headers: { host: "attacker.example:7878" } })).status).toBe(403);
    // a page on another site
    const evil = await raw(s, { method: "POST", path: "/api/command", headers: { ...auth(s), origin: "https://evil.example" }, body: JSON.stringify({ cmd: "getState" }) });
    expect(evil.status).toBe(403);
    expect((await raw(s, { path: "/api/state", headers: { "x-vox-token": s.token, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    // the token is only handed to same-origin browser pages
    expect((await raw(s, { path: "/api/session" })).status).toBe(403);
    expect((await raw(s, { path: "/api/session", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const ses = await raw(s, { path: "/api/session", headers: { "sec-fetch-site": "same-origin" } });
    expect(ses.body.token).toBe(s.token);
    // no CORS at all
    const pre = await raw(s, { method: "OPTIONS", path: "/api/command", headers: { origin: s.url } });
    expect(pre.status).toBe(403);
    expect(ses.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("only binds to loopback", async () => {
    await expect(startServer({ host: "0.0.0.0", port: 0, studio: false, tokenFile: false, log: () => {} })).rejects.toThrow(/loopback/);
  });

  it("requires JSON bodies and enforces size limits", async () => {
    const s = await start();
    expect((await raw(s, { method: "POST", path: "/api/command", headers: { "x-vox-token": s.token, "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await raw(s, { method: "POST", path: "/api/command", headers: auth(s), body: "{not json" })).status).toBe(400);
    const big = "x".repeat(LIMITS.command + 10);
    expect((await raw(s, { method: "POST", path: "/api/command", headers: auth(s), body: JSON.stringify({ cmd: "getState", args: { pad: big } }) })).status).toBe(413);
    const many = Array.from({ length: LIMITS.requestsPerCall + 1 }, () => ({ cmd: "getState" }));
    expect((await post(s, many)).status).toBe(413);
  });

  it("sandboxes file paths used by commands", async () => {
    const s = await start();
    const bad = ["../../etc/passwd.json", "/etc/passwd", "projects/../../x.vox.json", "projects/a\0b.json", "out/evil.sh", "src/server/server.ts"];
    for (const p of bad) {
      const r = await post(s, { cmd: "loadProject", args: { path: p } });
      expect(r.body.responses[0].ok, p).toBe(false);
      const w = await post(s, { cmd: "saveProject", args: { path: p } });
      expect(w.body.responses[0].ok, p).toBe(false);
      expect(w.body.responses[0].error.code, p).toBe("PATH_DENIED");
    }
    const ok = await post(s, { cmd: "saveProject", args: { path: "sandbox-test.vox.json" } }); // bare name -> projects/
    expect(ok.body.responses[0].ok).toBe(true);
    for (const f of fs.readdirSync("projects")) if (f.startsWith("sandbox-test.vox.json")) fs.rmSync(path.join("projects", f));
  });

  it("resolveSafe blocks symlink escapes", () => {
    const d = tmp(), outside = tmp();
    fs.mkdirSync(path.join(d, "projects"));
    fs.symlinkSync(outside, path.join(d, "projects", "link"));
    expect(() => resolveSafe(d, "projects/link/x.json", { read: [path.join(d, "projects")], write: [path.join(d, "projects")] }, "write")).toThrow(/outside/);
    expect(resolveSafe(d, "projects/x.json", { read: [path.join(d, "projects")], write: [path.join(d, "projects")] }, "write")).toBe(path.join(d, "projects", "x.json"));
  });
});

describe("data integrity", () => {
  it("keeps the last change when the server stops right after it", async () => {
    const dir = tmp();
    const s = await start(dir);
    await post(s, { cmd: "fillRegion", args: { from: [0, 0, 0], to: [3, 3, 3], material: "stone" } });
    const hash = s.engine.project.stateHash();
    await servers.pop()!.close(); // before the 400 ms autosave timer fires
    const s2 = await start(dir);
    expect(s2.engine.project.stateHash()).toBe(hash);
  });

  it("writes atomically: a failed write leaves the old file intact and no temp files", () => {
    const dir = tmp();
    const f = path.join(dir, "p.json");
    writeFileAtomic(f, "old", 2);
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(() => writeFileAtomic(f, "new", 2)).toThrow(/disk full/);
    spy.mockRestore();
    expect(fs.readFileSync(f, "utf8")).toBe("old");
    expect(fs.readdirSync(dir).filter((x) => x.endsWith(".tmp"))).toEqual([]);
    writeFileAtomic(f, "v2", 2);
    writeFileAtomic(f, "v3", 2);
    expect(fs.readFileSync(`${f}.bak1`, "utf8")).toBe("v2");
    expect(fs.readFileSync(`${f}.bak2`, "utf8")).toBe("old");
  });

  it("recovers from a damaged project file using the newest good backup", async () => {
    const dir = tmp();
    const s = await start(dir);
    await post(s, { cmd: "fillRegion", args: { from: [0, 0, 0], to: [2, 2, 2], material: "brick" } });
    s.saveNow();
    await post(s, { cmd: "fillRegion", args: { from: [5, 0, 0], to: [6, 1, 1], material: "stone" } });
    const good = s.engine.project.stateHash();
    await servers.pop()!.close(); // saves; previous version becomes .bak1
    const file = path.join(dir, "current.vox.json");
    // simulate a crash mid-write of some other tool: truncated JSON
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").slice(0, 200));
    const s2 = await start(dir);
    expect(s2.engine.project.world.blockCount).toBe(27); // from .bak1 (the older good save)
    expect(fs.readdirSync(dir).some((x) => x.includes(".corrupt-"))).toBe(true);
    expect(good).not.toBe(s2.engine.project.stateHash());
  });

  it("detects a file whose blocks do not match its checksum", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [2, 2, 2], material: "brick", structure: { name: "a", type: "x" } });
    const file = e.project.toFile(true);
    // tamper with the metadata only
    file.meta.structures[0].name = "renamed by hand";
    expect(() => new Engine().loadFile(file)).toThrow(/checksum/);
  });

  it("still opens project files saved before checksums existed", () => {
    const e = new Engine();
    e.run("fillRegion", { from: [0, 0, 0], to: [3, 1, 3], material: "brick", structure: { name: "a", type: "x" } });
    const file = e.project.toFile(true) as any;
    delete file.checksum;
    const e2 = new Engine();
    e2.loadFile(JSON.parse(JSON.stringify(file)));
    expect(e2.project.world.blockCount).toBe(32);
    expect(e2.run("verifyReplay").match).toBe(true);
  });

  it("keeps working after a failed autosave and saves on the next change", async () => {
    const dir = tmp();
    let fail = true;
    const writes: string[] = [];
    const s = await start(dir, { writer: (f, d) => { if (fail) throw new Error("EIO"); writes.push(d); fs.writeFileSync(f, d); } });
    await post(s, { cmd: "fillRegion", args: { from: [0, 0, 0], to: [1, 1, 1], material: "stone" } });
    expect(s.saveNow()).toBe(false);
    expect(s.lastSaveError).toBe("EIO");
    fail = false;
    expect(s.saveNow()).toBe(true); // still dirty -> retried
    expect(writes.length).toBe(1);
  });

  it("100k-block scene: save -> load -> replay are identical", () => {
    const dir = tmp();
    const e = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    SCENES.find((x) => x.id === "synthetic-100k")!.build(e);
    expect(e.project.world.blockCount).toBeGreaterThan(100_000);
    const h = e.project.stateHash();
    e.run("saveProject", { path: "big.vox.json" });
    const e2 = createNodeEngine({ baseDir: dir, libraryDir: path.join(dir, "lib") });
    e2.run("loadProject", { path: "big.vox.json" });
    expect(e2.project.stateHash()).toBe(h);
    expect(e2.run("verifyReplay").match).toBe(true);
  });
});

describe("plan transactions and the shared library", () => {
  const brokenPlan = () => {
    const p = housePlan() as any;
    p.buildings[0].structures[4].args.material = "no_such_material"; // fails after the assets were created
    return p;
  };

  it("a failed plan leaves the project AND the shared library untouched", () => {
    const dir = tmp();
    const lib = path.join(dir, "library");
    const e = createNodeEngine({ baseDir: dir, libraryDir: lib });
    e.run("fillRegion", { from: [0, 0, 0], to: [1, 0, 1], material: "stone" });
    const before = e.project.stateHash();
    const r = e.execute({ cmd: "executePlan", args: brokenPlan() });
    expect(r.ok).toBe(false);
    expect(e.project.stateHash()).toBe(before); // newProject did not happen either (atomic)
    expect(fs.existsSync(path.join(lib, "shapes", "ai.shingle.json"))).toBe(false);
    expect(e.assets.findShape("ai.shingle")).toBeUndefined();
    const plain = { ...brokenPlan(), newProject: false };
    expect(e.execute({ cmd: "executePlan", args: plain }).ok).toBe(false);
    expect(e.project.stateHash()).toBe(before);
    expect(fs.existsSync(lib)).toBe(false);
  });

  it("dry runs have no external side effects", () => {
    const dir = tmp();
    const lib = path.join(dir, "library");
    const e = createNodeEngine({ baseDir: dir, libraryDir: lib });
    const before = e.project.stateHash();
    for (const plan of [{ ...housePlan(), dryRun: true }, { ...housePlan(), newProject: false, dryRun: true }]) {
      const r = e.execute({ cmd: "executePlan", args: plan });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.result.dryRun).toBe(true);
    }
    expect(e.project.stateHash()).toBe(before);
    expect(e.assets.findShape("ai.shingle")).toBeUndefined();
    expect(fs.existsSync(lib)).toBe(false);
    expect(e.canUndo).toBe(false);
  });

  it("new project + plan is one atomic command and commits the library on success", () => {
    const dir = tmp();
    const lib = path.join(dir, "library");
    const e = createNodeEngine({ baseDir: dir, libraryDir: lib });
    const r = e.execute({ cmd: "executePlan", args: housePlan() });
    expect(r.ok).toBe(true);
    expect(e.project.meta.name).toBe("AI 테스트 하우스");
    expect(e.project.log.length).toBe(1);
    expect(fs.existsSync(path.join(lib, "shapes", "ai.shingle.json"))).toBe(true);
    expect(e.run("verifyReplay").match).toBe(true);
  });

  it("a library write failure rolls back the project change and earlier library writes", () => {
    const e = new Engine({
      library: {
        load: () => ({ shapes: [], materials: [], components: [] }),
        save: (kind) => { if (kind === "material") throw new Error("read-only disk"); },
        remove: () => {},
      },
    });
    const before = e.project.stateHash();
    const r = e.execute({ cmd: "runBatch", args: { commands: [
      { cmd: "createShape", args: { id: "ai.x", name: "x", recipe: { type: "box", min: [0, 0, 0], max: [1, 0.5, 1] } } },
      { cmd: "createMaterial", args: { id: "ai.m", name: "m", color: "#112233" } },
      { cmd: "fillRegion", args: { from: [0, 0, 0], to: [2, 0, 2], shape: "ai.x", material: "ai.m" } },
    ] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LIBRARY_WRITE_FAILED");
    expect(e.project.stateHash()).toBe(before);
    expect(e.assets.findShape("ai.x")).toBeUndefined();
  });
});

describe("state hash", () => {
  it("detects worlds that differ only in structure ownership", () => {
    const a = new Engine(), b = new Engine();
    a.run("fillRegion", { from: [0, 0, 0], to: [1, 0, 0], material: "stone", structure: { name: "s", type: "x" } });
    b.run("fillRegion", { from: [0, 0, 0], to: [1, 0, 0], material: "stone", structure: { name: "s", type: "x" } });
    expect(a.project.stateHash()).toBe(b.project.stateHash());
    // same blocks, but cell [1,0,0] now belongs to a second structure in b
    b.run("fillRegion", { from: [1, 0, 0], to: [1, 0, 0], material: "stone", structure: { name: "t", type: "x" } });
    a.run("fillRegion", { from: [9, 9, 9], to: [9, 9, 9], material: "stone", structure: { name: "t", type: "x" } });
    a.run("removeRegion", { from: [9, 9, 9], to: [9, 9, 9] });
    expect(a.project.world.blockCount).toBe(b.project.world.blockCount);
    expect(a.project.world.hash()).not.toBe(b.project.world.hash());
  });
});
