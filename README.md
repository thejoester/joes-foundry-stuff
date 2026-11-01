# Joe's Foundry Stuff

A personal FoundryVTT module containing Joe's collection of compendiums, macros, and quality-of-life scripts.

> [!NOTE] 
> This is a personal module.** It's shared mainly so others can reuse the scripts and features, and is provided as-is with no support or update guarantees. The **compendium content ships without images**: image paths in the compendium items point to art I don't redistribute, so scenes/items/etc. will appear blank or with broken image links. The scripts and functionality work fully regardless; swap in your own art as needed.

**Compatibility:** FoundryVTT v13–v14

**Versioning:** Date-based (`YYYY.MM.DD`), e.g. `2026.07.16` is a build from July 16, 2026. Each release's version is the date it was published. If two builds ship on the same day, a fourth segment is added (`YYYY.MM.DD.1`).

---

## Features

### Combat Turn Timer
Displays a countdown timer during combat turns. Configurable per-session with options for visibility (GM only or all players), duration, and alarm behavior.

### Roll for Initiative
GM macro helper (`game.modules.get("joes-foundry-stuff").api.rollForInitiative()`) that adds the currently selected tokens to combat, hides NPC combatants from the players, and blind-rolls their initiative. If the initiative timer setting is enabled, it also:
- Shows a synced "Roll for Initiative!" countdown overlay to all connected players.
- Plays a sound and switches every client's sidebar to the Combat Tracker.
- When the countdown ends, automatically rolls initiative for any players who haven't rolled yet.
- Running the macro again while a countdown is active cancels it instead of re-adding tokens.

Configurable via **Enable Initiative Timer** and **Initiative Timer Duration (seconds)** (default 30) in module settings.

### Timer / Alarm Manager
GM-managed countdown timers with a lightweight, draggable player-facing window. The GM can start named timers (optionally hidden from players), see all active timers with remaining time, send a timer's remaining time to chat, and get a dialog (with sound) when a timer ends, with the option to restart or stop it. Exposed via the module API (`startTimer`, `getRemainingTime`, `openTimerManager`/`timerMacro`).

### Chat Archive
Archives all non-pinned chat messages to a log file, keeping your chat clean between sessions. GM-only.

### Image Overlay
Shows a fullscreen image overlay to all connected players simultaneously. Supports configurable size, opacity, and blur. Useful for revealing maps, handouts, or dramatic moments.

### Scene Directory Enhancements
- **Shift+Click** (GM) a scene in the Scene Directory to preload it for all players without switching the viewed scene.
- **Alt+Click** (GM) bypasses the click override for normal scene configuration.
- Shows colored initials next to each scene indicating which connected users are currently viewing it.
- Compendium packs are auto-organized into a `!Joes` compendium folder on load.

### Error Logger
Captures player-side `ui.notifications` errors (and warnings) into a shared **Error Logs** journal, one page per player, so the GM can review issues players hit. Attempts to resolve any 16-character document ID found in a message to its named document. Toggle via **Enable Error Logger** in module settings. Console helpers: `game.joesFoundryStuff.getCapturedLogs()` and `game.joesFoundryStuff.clearCapturedLogs()`.

### Keybinding Locks (moved to BBMM)
Keybinding Locks is no longer part of this module. It now lives in [Big Bad Module Manager (BBMM)](https://github.com/thejoester/bbmm) — install BBMM if you want to force keybindings to stay cleared or set on every load.

---

## Compendiums

| Pack | Type |
|------|------|
| Joe's Macros | Macros |

Personal content (scenes, roll tables, playlists, journals) has moved to Joe's separate private `joes-compendiums` module; only the reusable macros pack ships here.

---

## Installation

Manifest URL:
```
https://raw.githubusercontent.com/thejoester/joes-foundry-stuff/main/module.json
```

---

## Author

**thejoester** — Discord: `thejoester`
