// One-page guide for LLMs (returned by getGuide / the MCP get_guide tool / GET /api/guide).
import type { Engine } from "./engine";

export function guideText(engine: Engine): string {
  const groups = new Map<string, { name: string; description: string; example: unknown }[]>();
  for (const c of engine.commandList()) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group)!.push(c);
  }
  const order = ["build", "structure", "asset", "inspect", "blocks", "project", "io", "meta"];
  const sections = order.filter((g) => groups.has(g)).map((g) => {
    const list = groups.get(g)!.map((c) => `- **${c.name}** — ${c.description}\n  example: \`${JSON.stringify(c.example)}\``).join("\n");
    return `### ${g}\n${list}`;
  }).join("\n\n");
  const mats = engine.assets.allMaterials(engine.project.meta.assets.materials).map((m) => `${m.id.replace("builtin.", "")} (${m.name})`).join(", ");
  const shapes = engine.assets.allShapes(engine.project.meta.assets.shapes).map((s) => s.id.replace("builtin.", "")).join(", ");
  return `# AI Voxel Architecture Studio — guide for AI agents

## How to call
Every action is a JSON command: {"cmd": "<name>", "args": {...}}. Responses are
{"ok":true,"result":...,"summary":"one line","warnings":[...]} or {"ok":false,"error":{"code","message","path","hint"}}.
On an error, read "hint" (it contains a valid example) and retry with fixed args.

## Units and coordinates
- Integer grid, 1 cell = ${engine.project.meta.settings.cellSize} m (project setting). y is UP. North = -z, east = +x, south = +z, west = -x.
- Generators that take "building": positions are relative to that building's origin.
- Instead of computing coordinates, reference earlier structures:
  {"ref":"walls","anchor":"top"} -> the cell above the centre of "walls" (anchors: top, bottom, center, north, south, east, west, min, max, topMin, topMax; optional "offset":[dx,dy,dz]).
  Areas: {"at":[x,y,z],"size":[w,d]} or {"on":{"ref":"base","inset":1}} (sit on top of "base", 1 cell in from its edge).
- Shapes have a "facing": the tall/back side of stairs, wedges and roofs points that way.

## Recommended workflow
1. getGuide (this) -> searchAssets for blocks/materials you need.
2. Missing a block shape? createShape (parametric recipe -> real geometry, saved to the library for reuse).
3. Write a BuildingPlan and run executePlan with "dryRun": true first, then for real.
   Each structure has a "key"; later structures reference it.
4. inspectProject -> fix issues (each issue has a fixHint command).
5. renderScene / render_views (front, back, left, right, top, iso) to look at it; change only what is wrong with
   modifyStructure {"id":"roof","args":{"pitch":0.5}} (rebuilds only that structure and what sits on it).
6. saveProject.

## BuildingPlan shape
{"plan":"name","newProject":true,"title":"...","tags":["..."],"assets":[{"cmd":"createShape","args":{...}}],
 "buildings":[{"name":"house","origin":[0,0,0],"structures":[
   {"key":"base","cmd":"createFoundation","args":{"area":{"at":[0,0,0],"size":[12,9]},"material":"concrete"}},
   {"key":"walls","cmd":"createWall","args":{"loop":{"on":{"ref":"base"}},"height":4,"material":"brick",
     "openings":[{"side":"south","at":5,"width":2,"height":3,"bottom":0,"fill":null}],"windows":{"width":2,"height":2}}},
   {"key":"roof","cmd":"createRoof","args":{"area":{"on":{"ref":"walls"}},"style":"gable","pitch":1,"material":"roof_tile"}}]}],
 "after":[]}
Full examples: examples/eiffel.plan.json, house.plan.json, castle.plan.json, modern.plan.json.

## Shape recipes (createShape)
box {min,max} | extrude {profile:[[u,v]...],axis:"x"|"z"} (axis x: points are (z,y), tall side at z=0) |
lathe {profile:[[radius,y]...] bottom->top} | curve {path:[[u,v]...],thickness} | subvoxel {size,mask[y][z]="#.#."} |
composite {parts:[{recipe,offset,scale,yaw}]} | mesh {positions,indices}. All coordinates inside 0..1.

## Materials available
${mats}

## Shapes available
${shapes}

## Commands
${sections}
`;
}
