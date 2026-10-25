import type { CommandDef } from "./framework";
import * as basic from "./basic";
import * as assets from "./assets";
import * as generators from "./generators";
import * as structure from "./structure";

const isCommand = (v: unknown): v is CommandDef<any> =>
  !!v && typeof v === "object" && "schema" in (v as object) && "run" in (v as object) && "name" in (v as object);

const seen = new Set<string>();
export const ALL_COMMANDS: CommandDef<any>[] = [basic, assets, generators, structure]
  .flatMap((m) => Object.values(m))
  .filter(isCommand)
  .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
