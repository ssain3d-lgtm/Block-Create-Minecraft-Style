// A headless studio tab used for rendering when no real studio tab is connected.
// Uses Playwright: PLAYWRIGHT_CHROMIUM / CHROME_PATH, an installed Chrome (channel "chrome"),
// or Playwright's own Chromium (npx playwright install chromium).
import fs from "node:fs";

export interface HeadlessViewer {
  ready(): Promise<void>;
  clientReady(id: string): void;
  clientGone(id: string): void;
  close(): Promise<void>;
}

export async function launchHeadlessViewer(url: string, log: (...a: unknown[]) => void): Promise<HeadlessViewer> {
  const { chromium } = await import("playwright");
  const exe = [process.env.PLAYWRIGHT_CHROMIUM, process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && fs.existsSync(p));
  const args = process.platform === "win32" || process.platform === "darwin"
    ? ["--ignore-gpu-blocklist", "--enable-gpu"]
    : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: exe, args });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome", args });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on("pageerror", (e) => log("[headless page error]", e.message));
  let resolveReady: () => void;
  const readyP = new Promise<void>((r) => (resolveReady = r));
  let idleTimer: NodeJS.Timeout | undefined;
  const viewer: HeadlessViewer = {
    ready: () => Promise.race([readyP, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("headless viewer did not connect in 90 s")), 90_000))]),
    clientReady: () => resolveReady(),
    clientGone: () => {},
    async close() { clearTimeout(idleTimer); await browser.close().catch(() => {}); },
  };
  await page.goto(url);
  log("headless viewer started for rendering");
  return viewer;
}
