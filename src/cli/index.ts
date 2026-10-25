#!/usr/bin/env node
// vox - command line front-end for the voxel engine (no LLM needed).
//
//   vox cmd '{"cmd":"fillRegion","args":{...}}' --project my.vox.json
//   vox run examples/house.plan.json --project out/house.vox.json
//   vox commands | vox describe fillRegion | vox state --project my.vox.json
import fs from "node:fs";
import { createNodeEngine } from "../node/host";
import type { CommandRequest, CommandResponse } from "../engine/engine";
import { toRequests } from "./input";

function usage(): never {
  console.log(`vox - AI Voxel Architecture Studio CLI

usage:
  vox cmd <json> [--project <file>]      run one command / array of commands / plan
  vox run <file.json> [--project <file>] run commands from a file
  vox commands                            list commands
  vox describe <command>                  JSON schema of a command
  vox state --project <file>              project summary
  vox verify --project <file>             rebuild from the command log and compare

options:
  --project <file>   load this project first (if it exists) and save it afterwards
  --quiet            print only summaries
`);
  process.exit(0);
}

function main(argv: string[]) {
  const args = [...argv];
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const projectPath = flag("--project");
  const quietIdx = args.indexOf("--quiet");
  const quiet = quietIdx >= 0;
  if (quiet) args.splice(quietIdx, 1);
  const [sub, payload] = args;
  if (!sub || sub === "help" || sub === "--help") usage();

  const engine = createNodeEngine();
  if (projectPath && fs.existsSync(projectPath)) {
    const r = engine.execute({ cmd: "loadProject", args: { path: projectPath } });
    if (!r.ok) fail(r);
  }

  let requests: CommandRequest[] = [];
  switch (sub) {
    case "cmd":
      if (!payload) usage();
      requests = toRequests(JSON.parse(payload));
      break;
    case "run":
      if (!payload) usage();
      requests = toRequests(JSON.parse(fs.readFileSync(payload, "utf8")));
      break;
    case "commands":
      requests = [{ cmd: "listCommands" }];
      break;
    case "describe":
      requests = [{ cmd: "describeCommand", args: { name: payload } }];
      break;
    case "state":
      requests = [{ cmd: "getState" }];
      break;
    case "verify":
      requests = [{ cmd: "verifyReplay" }];
      break;
    default:
      usage();
  }

  const logBefore = engine.project.log.length;
  let failed = false;
  for (const req of requests) {
    const r = engine.execute(req);
    print(r, quiet);
    if (!r.ok) { failed = true; break; }
  }
  const changed = engine.project.log.length !== logBefore;
  if (projectPath && changed && !failed) {
    const r = engine.execute({ cmd: "saveProject", args: { path: projectPath } });
    print(r, quiet);
  }
  process.exit(failed ? 1 : 0);
}

function print(r: CommandResponse, quiet: boolean) {
  if (quiet) console.log(r.ok ? `ok  ${r.summary}${r.warnings.length ? "  (warn: " + r.warnings.join("; ") + ")" : ""}` : `ERR ${r.cmd}: ${r.error.code} ${r.error.message}${r.error.hint ? "  hint: " + r.error.hint : ""}`);
  else console.log(JSON.stringify(r));
}

function fail(r: CommandResponse): never {
  print(r, false);
  process.exit(1);
}

main(process.argv.slice(2));
