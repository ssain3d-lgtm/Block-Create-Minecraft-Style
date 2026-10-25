import type { CommandRequest } from "../engine/engine";

/**
 * Accepts the shapes an LLM or a human is likely to send:
 *  - {cmd, args}
 *  - [{cmd, args}, ...]
 *  - {commands:[...]}  (batch)
 *  - a BuildingPlan {plan, buildings:[...]}  -> executePlan
 */
export function toRequests(input: unknown): CommandRequest[] {
  if (Array.isArray(input)) return input.map((x) => toRequest(x));
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.buildings) || typeof o.plan === "string") {
      const pre: CommandRequest[] = o.newProject ? [{ cmd: "newProject", args: { name: (o.name as string) ?? (o.plan as string) ?? "plan", cellSize: (o.cellSize as number) ?? 1 } }] : [];
      return [...pre, { cmd: "executePlan", args: o }];
    }
    if (Array.isArray(o.commands) && !o.cmd) return (o.commands as unknown[]).map((x) => toRequest(x));
  }
  return [toRequest(input)];
}

function toRequest(x: unknown): CommandRequest {
  if (!x || typeof x !== "object" || typeof (x as CommandRequest).cmd !== "string") {
    throw new Error(`not a command: ${JSON.stringify(x).slice(0, 200)} (expected {"cmd": "...", "args": {...}})`);
  }
  return x as CommandRequest;
}
