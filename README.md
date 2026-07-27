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

Download the latest release Portable Zip and run it
Or download the portable Foldere zip, 
extract to a folder on your computer and run SC Battaglia Mining Tracker.exe.

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

## Quick Start Guide

1. Accept Battaglia scan contracts in-game — they appear automatically.
2. Open a contract → screenshot DETAILS / PRIMARY OBJECTIVES (Win+Shift+S) → **From Clipboard** (or Upload / Ctrl+V).
3. OCR fills requirements (Tesseract.js in the window).
4. Click the blue Overlay button to show onscreen what materilas you still need to scan for along with their resource signatures.
(clicking the Allow overlay Drag checkbox allows you to resize and reposistion the overlay)
5. When you scan an asteroid, choose the resource → **Record Scan**.
6. Progress applies to every active mission that still needs that resource.


## How too Use

Log File - Click this to specify the location of your star citizen log file if it it not automatically detected
e.g. D:\Games\Roberts Space Industries\StarCitizen\LIVE\Game.log

### Creating Mission Cards

There a 3 ways to add a new mission card

* Manually
* A screengrab from the clipboard
* A Screengrab from the contracts screen in game.
 
 
### Manual nission creation

In the create mission card area, Enter a name for the mission and click the Create card button.
The mission will apear in the Missions panel.

You will need to add the resources you wish to scan to this mission card using the Add resources to Mission Area.

### Add resources to mission

 Select a resource and ammount you wish to scan, the mission you wish to add the resource too, then click the Add to mission button, The selected resource will appear on the mission card.

 This is udsefull to add items that the OCR may have missed.

## OCR Contract Screen

To create a new mission card the easiest way is to accept a mission in game, a card will be automatically created.
After accepting a mission in game clcik the mission tab in the accepted missions panel on the left, this will populate the screen with the items to scan.

If the items to scan do not automaticaslly appear you can click the Re-OCR button and the items to scan will be scanned for again.

You can click the new contract from screen while you are on the missions screen to read in the mission you are currently veiwing.

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

## Best way to scan for resources.

* Hit V to enter scan mode, uses the mouse wheel to have a 90 degree arx and hit tab to perform a scan.
* YOu will see multiple unknown signals at various distances.
* Point the ship in the direction of a resource to check its signature.
* If the numbers match a resource in the overlay, you have found something you need to scan.
* use the mouse wheel to set the scvan arc to 2 degrees, then Hit V to leave scanning mode. 
(this prevents you from prematurly identifying the rock before the mission has updated)
+ Fly to wards the sigtnal hitting tab to keep it visible.
* When you have arrived at the asteroids, hit V but do not pint directly at the asteroids to avopid scanning to early.
* In your missions panel on the mobi glass make sure a mission requiring the type of asterod you are at needs scanning is being tracked.
* Wait for the yellow Scan Asteroid markers to appear on the asteroids.
(depending on the server lag this can take up top 3 minutes)
* Once the markers appear point at the asteroids and hld down left mouse button to perform a scan, Scan all the asteroids in the cluster.
* Record the scan in the app select the asterod type and amount you have scanned and click the Record Scan Button.

The Overlay will update and show which resources are still needing to be scanned.

Once all the asteroids have been scanned the missions will auto complete.

Iron is only found in the Glacium Ring the inner belt where Levski is. 
Aluminium is found only in the Keeger belt (where the QV Breaker stations are.)
All the other resources can be found in any of the belts.

## Project layout

```
main.js              Electron main process
preload.js           Secure IPC bridge
server/              Express API + log watcher + store
renderer/            UI (HTML + Tesseract.js)
```

## License

Personal use. Not affiliated with CIG / RSI.



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
