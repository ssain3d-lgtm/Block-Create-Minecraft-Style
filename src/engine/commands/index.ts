import type { CommandDef } from "./framework";
import * as basic from "./basic";

export const ALL_COMMANDS: CommandDef<any>[] = [...Object.values(basic)] as CommandDef<any>[];
