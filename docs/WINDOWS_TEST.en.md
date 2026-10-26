<p align="right"><b>English</b> · <a href="WINDOWS_TEST.md">한국어</a></p>

# Testing on Windows · RTX 5090

> These checks are meant to be run **on your own PC**. In the development environment (cloud, no GPU) only the
> automatic checks in sections 1–2 were run; section 3 (GPU performance) was not.

## 0. Setup (once)

1. Install [Node.js](https://nodejs.org) 20 or newer (LTS recommended)
2. Open a command prompt (cmd) in the repository folder
3. `npm install`
4. For the browser checks: `npx playwright install chromium`

## 1. Automatic checks (about 5–10 minutes)

| Command | Checks | Passes when |
|---|---|---|
| `npm run typecheck` | type errors | no output |
| `npm test` | engine, security, saving, transactions, sync, multi-cell parts | `Tests  N passed` |
| `npm run check:studio` | add / remove / undo / autosave / language switch in a real browser | every line starts with `ok` |
| `npm run check:ai` | HTTP API, live sync (two tabs + AI editing, reconnect), screenshots, MCP | `all AI-side checks passed` |
| `npm run build` | production build | `built in …` |

On Windows these checks open the browser with your **real GPU** (also in headless mode).

## 2. Manual checks (about 10 minutes)

1. Run `run.bat` → http://127.0.0.1:7878 opens and the status bar shows `● Server linked`
2. **AI commands → Load an example → A. Eiffel tower** → the tower appears within a second or two
3. Add a few blocks, close the `run.bat` window (Ctrl+C), start it again → your blocks are still there (final save on shutdown)
4. Open **two** browser tabs; a block placed in one appears in the other
5. **Ctrl+Z** in one tab → both tabs go back (undo is the server's shared history)
6. Open `projects\current.vox.json` in Notepad, keep only the beginning and save (deliberate damage) → restart `run.bat` → it reports "recovered from current.vox.json.bak1" and opens the previous state
7. The API is closed to other sites: open `http://127.0.0.1:7878/api/state` in the address bar → `NO_TOKEN` (401) is correct
8. **EN / 한국어** button switches the interface language and is remembered after a reload

## 3. RTX 5090 performance (about 3 minutes)

1. Run `bench.bat` → the browser opens with `?bench=1`; keep the window in front and wait.
2. When the table appears, click **Save results (JSON)**.
3. Put the file into `bench/results/` and commit it, or attach it in the chat.

| Column | Meaning | Target (design 9.3) |
|---|---|---|
| Mesh ms | blocks → renderable meshes | — |
| First frame ms | time to the first picture | under 3 s |
| Avg FPS / 1% low | average / slowest 1% during a 10 s orbit | around 60 |
| Draw calls | draw calls per frame | lower is better |
| 1000-edit ms | a 1000-block edit shown on screen | under 100 ms |

> On laptops with two GPUs, set the browser to "High performance" (RTX) in Windows Settings → Display → Graphics before measuring.

## 4. MCP (local LLM)

1. Keep `run.bat` running.
2. Put the example from the README into the MCP settings of LM Studio / Claude Desktop / Qwen Code.
3. Ask: *"Read get_guide from voxel-studio and build a small house. Check it with inspect and render_views when done."*
4. The house appearing live in the open studio means everything works.
