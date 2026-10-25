// Shared helper: start the Vite dev server and open the studio in Chromium (Playwright).
// Uses PLAYWRIGHT_CHROMIUM / CHROME_PATH when set, otherwise Playwright's own browser.
import { chromium, Browser, Page } from "playwright";
import { createServer, ViteDevServer } from "vite";
import fs from "node:fs";

export interface Studio {
  server: ViteDevServer;
  browser: Browser;
  page: Page;
  url: string;
  close(): Promise<void>;
}

function findChrome(): string | undefined {
  const env = process.env.PLAYWRIGHT_CHROMIUM || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const candidates = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"];
  return candidates.find((c) => fs.existsSync(c));
}

export async function openStudio(opts: { headless?: boolean; width?: number; height?: number; gpu?: boolean; query?: string } = {}): Promise<Studio> {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === "object" && addr ? addr.port : 5173;
  const url = `http://127.0.0.1:${port}/${opts.query ? "?" + opts.query : ""}`;
  const args = opts.gpu
    ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
    : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const browser = await chromium.launch({ headless: opts.headless ?? true, executablePath: findChrome(), args });
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 960 } });
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("[console]", m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => (window as any).studio?.engine, null, { timeout: 60000 });
  return {
    server, browser, page, url,
    async close() { await browser.close(); await server.close(); },
  };
}

/** Waits until every dirty chunk has been meshed. */
export async function waitMeshed(page: Page, timeout = 120000) {
  await page.waitForFunction(() => {
    const s = (window as any).studio;
    return s.viewport.chunks.pending === 0 && s.engine.project.world.dirty.size === 0;
  }, null, { timeout, polling: 100 });
}
