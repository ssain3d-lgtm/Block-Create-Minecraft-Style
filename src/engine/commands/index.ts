import type { CommandDef } from "./framework";
import * as basic from "./basic";
import * as assets from "./assets";

const isCommand = (v: unknown): v is CommandDef<any> => !!v && typeof v === "object" && "schema" in (v as object) && "run" in (v as object);

export const ALL_COMMANDS: CommandDef<any>[] = [...Object.values(basic), ...Object.values(assets)].filter(isCommand);
