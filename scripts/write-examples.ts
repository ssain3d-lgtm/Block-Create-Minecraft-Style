// Writes examples/*.plan.json from examples/plans.ts (plain JSON for LLMs and the CLI).
import fs from "node:fs";
import * as plans from "../examples/plans";

const out: Record<string, unknown> = {
  "house.plan.json": plans.housePlan(),
  "eiffel.plan.json": plans.eiffelPlan(),
};
for (const [k, fn] of Object.entries(plans)) {
  if (typeof fn !== "function" || ["housePlan", "eiffelPlan"].includes(k)) continue;
  out[`${k.replace(/Plan$/, "")}.plan.json`] = (fn as () => unknown)();
}
for (const [name, plan] of Object.entries(out)) {
  fs.writeFileSync(`examples/${name}`, JSON.stringify(plan, null, 2) + "\n");
  console.log("wrote examples/" + name);
}
