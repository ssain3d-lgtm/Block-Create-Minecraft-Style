// Runs the in-browser benchmark (?bench) in Chromium via Playwright and saves the result.
//   npm run bench:browser [-- --gpu] [-- --headed] [-- --seconds 10] [-- --scenes eiffel,synthetic-100k]
// Without --gpu this uses SwiftShader (software GL): FPS from that mode is NOT a GPU measurement.
import fs from "node:fs";
import { openStudio } from "../scripts/browser";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
const gpu = has("--gpu");
const seconds = Number(val("--seconds") ?? 10);
const scenes = val("--scenes") ?? "1";

const s = await openStudio({ gpu, headless: !has("--headed"), query: `bench=${scenes}&seconds=${seconds}` });
try {
  await s.page.waitForFunction(() => (window as any).__bench, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const data = await s.page.evaluate(() => (window as any).__bench);
  data.env.mode = gpu ? "gpu" : "software (SwiftShader) - not a GPU measurement";
  fs.mkdirSync("bench/results", { recursive: true });
  const file = `bench/results/browser-${gpu ? "gpu" : "swiftshader"}-${data.env.date.slice(0, 10)}.json`;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  for (const r of data.results) console.log(JSON.stringify(r));
  console.log("GPU:", data.env.gpu);
  console.log("wrote", file);
} finally {
  await s.close();
}
