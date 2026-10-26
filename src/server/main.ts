// npm run serve  ->  studio + AI API on http://127.0.0.1:7878
//   --port 7878   --project projects/current.vox.json   --no-studio
import { startServer } from "./server";

const argv = process.argv.slice(2);
const val = (f: string) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
const s = await startServer({
  port: val("--port") ? Number(val("--port")) : undefined,
  projectPath: val("--project"),
  studio: !argv.includes("--no-studio"),
});
console.log(`[vox] open ${s.url} in your browser. AI agents: POST ${s.url}/api/command, MCP: npm run mcp`);
const stop = async () => { await s.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
