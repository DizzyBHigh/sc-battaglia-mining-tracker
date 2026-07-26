# SC Battaglia Mining Tracker (Electron)

Desktop app for tracking **Recco Battaglia** scan missions in Star Citizen, with **shared progress** and **Tesseract.js OCR** (no system Tesseract install).

## Features

- Watches `Game.log` for mission accepts and objective completions
- Shared scan progress across all active missions
- OCR contract screenshots via **Tesseract.js** (downloads from CDN on first use)
- Native desktop window (Electron)
- Persistent mission data in the app user-data folder

## Requirements

- **Node.js 18+** (includes npm)
- Internet on first OCR use (Tesseract.js model download)

## Install & run

```bat
cd sc_mining_tracker_electron
npm install
npm start
```

### Dev mode (with DevTools)

```bat
npm run dev
```

### Build a Windows installer / portable exe

```bat
npm run dist
```

Output goes to `dist/`.

## Game.log

The app auto-detects common paths such as:

`%LOCALAPPDATA%\\StarCitizen\\LIVE\\Game.log`

If it cannot find the log, click **Log file…** in the header and pick `Game.log` manually.

You can also set:

```bat
set SC_GAME_LOG=C:\\path\\to\\Game.log
npm start
```

## How to use

1. Accept Battaglia scan contracts in-game — they appear automatically.
2. Open a contract → screenshot DETAILS / PRIMARY OBJECTIVES (Win+Shift+S) → **From Clipboard** (or Upload / Ctrl+V).
3. OCR fills requirements (Tesseract.js in the window).
4. When you scan an asteroid, choose the resource → **Record Scan**.
5. Progress applies to every active mission that still needs that resource.

## Project layout

```
main.js              Electron main process
preload.js           Secure IPC bridge
server/              Express API + log watcher + store
renderer/            UI (HTML + Tesseract.js)
```

## License

Personal use. Not affiliated with CIG / RSI.

## In-game overlay

Shows **remaining resources to scan** in a small transparent window over Star Citizen.

| Action | How |
|--------|-----|
| Show / hide | **Overlay** button in the main app, or **Ctrl+Shift+O** |
| Move | Drag the overlay panel |
| Click-through | On by default (mouse goes to the game). **Ctrl+Shift+P** toggles click-through so you can interact with the overlay |

The overlay reads the same live totals as the main UI and refreshes every 2 seconds.

**Tip:** Run Star Citizen in **Borderless** window mode so the overlay can sit on top cleanly. Exclusive fullscreen can hide always-on-top windows on some systems.

## Automatic OCR (once per new mission)

When a new Battaglia mission card is created from `Game.log`, the app runs **one** screen capture + Tesseract.js OCR and fills that mission’s requirements.

- Keep the contract **DETAILS / PRIMARY OBJECTIVES** panel open when accepting.
- If auto OCR misses the panel, use **From Clipboard**, **Upload**, or **OCR this mission** on the card.
- There is **no** continuous interval scanning.

## GitHub Actions

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **CI** | Push / PR to `main` | `npm install`, Node syntax check, file presence |
| **Build Windows** | Tag `v*` or manual **Run workflow** | `electron-builder` on `windows-latest`, uploads `.exe` artifacts |

### Manual Windows build

1. Open **Actions** → **Build Windows** → **Run workflow**
2. Download the **windows-build** artifact when finished

### Release build

```bash
git tag v1.0.0
git push origin v1.0.0
```

The Windows workflow builds installers and attaches them to the GitHub Release for that tag.
