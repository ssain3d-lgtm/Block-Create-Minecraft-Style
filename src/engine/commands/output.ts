// Output commands: guide for LLMs, GLB export, and the renderScene request (fulfilled by a viewer).
import { z } from "zod";
import { CmdError, defineCommand } from "./framework";
import { guideText } from "../guide";
import { exportGLB } from "../../export/glb";

export const getGuide = defineCommand({
  name: "getGuide",
  group: "meta",
  description: "One-page guide for AI agents: units, coordinates, anchors, plan format, workflow, materials, shapes and every command with an example.",
  schema: z.object({}),
  mutates: false,
  example: {},
  run: (ctx) => ({ guide: guideText(ctx.engine) }),
  summarize: (r) => `guide (${r.guide.length} chars)`,
});

export const exportGLBCmd = defineCommand({
  name: "exportGLB",
  group: "io",
  description: "Export the scene (or some structures) as a .glb 3D model in metres (vertex colours, hidden faces removed).",
  schema: z.object({ path: z.string().min(1), structures: z.array(z.string()).optional() }),
  mutates: false,
  example: { path: "out/eiffel.glb" },
  run(ctx, a) {
    if (!ctx.host?.writeBytes) throw new CmdError("NO_HOST", "exporting needs a file host (CLI/server); in the studio use the GLB button");
    const nums = a.structures?.map((id) => {
      const s = ctx.project.structure(id);
      if (!s) throw new CmdError("UNKNOWN_STRUCTURE", `structure "${id}" not found`);
      return s.num;
    });
    const { bytes, triangles } = exportGLB(ctx.project, { structures: nums });
    ctx.host.writeBytes(a.path, bytes);
    return { path: a.path, bytes: bytes.length, triangles };
  },
  summarize: (r) => `exported ${r.path} (${r.triangles.toLocaleString()} triangles, ${Math.round(r.bytes / 1024)} KB)`,
});

export const VIEWS = ["front", "back", "left", "right", "top", "iso"] as const;

export const zRenderArgs = z.object({
  views: z.array(z.enum(VIEWS)).default(["front", "back", "left", "right", "top", "iso"]),
  isolate: z.array(z.string()).optional().describe("only show these structures"),
  labels: z.boolean().default(false).describe("draw structure ids on the images (helps a vision model point at parts)"),
  width: z.number().int().min(256).max(2048).default(1024),
  height: z.number().int().min(256).max(2048).default(768),
});

export const renderScene = defineCommand({
  name: "renderScene",
  group: "inspect",
  description:
    "Screenshots from front/back/left/right/top/iso (+ meta: camera and visible structures) for a vision model. Needs a viewer: the studio (linked to the server) or the headless renderer used by the server/MCP.",
  schema: zRenderArgs,
  mutates: false,
  example: { views: ["front", "iso"], labels: true },
  run() {
    // The HTTP server and the MCP server intercept renderScene and render it in a viewer
    // (a linked studio tab, or a headless browser). A bare engine has no screen.
    throw new CmdError("NO_VIEWER", "renderScene needs a viewer", "send it to the server (POST /api/command), use the MCP render_views tool, or `npm run vox -- render --project <file>`");
  },
});
