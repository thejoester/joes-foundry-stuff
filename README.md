# Joe's Foundry Stuff

A personal FoundryVTT module containing Joe's collection of compendiums, macros, and quality-of-life scripts.

**Compatibility:** FoundryVTT v11–v13

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

### Audio Auto Mix
GM-controlled world audio levels that are automatically applied to all connected clients. Sets per-sound playback volume on track start without touching individual player volume settings.

### Chat Archive
Archives all non-pinned chat messages to a log file, keeping your chat clean between sessions. GM-only.

### Image Overlay
Shows a fullscreen image overlay to all connected players simultaneously. Supports configurable size, opacity, and blur. Useful for revealing maps, handouts, or dramatic moments.

### Scene Directory Enhancements
- **Shift+Click** (GM) a scene in the Scene Directory to preload it for all players without switching the viewed scene.
- **Alt+Click** (GM) bypasses the click override for normal scene configuration.
- Shows colored initials next to each scene indicating which connected users are currently viewing it.
- Compendium packs are auto-organized into a `!Joes` compendium folder on load.

---

## Compendiums

| Pack | Type |
|------|------|
| Joe's Scenes | Scenes |
| Joe's Macros | Macros |
| Joe's Roll Tables | Roll Tables |
| Joe's Playlists | Playlists |
| Joe's Journals | Journal Entries |

---

## Installation

Manifest URL:
```
https://raw.githubusercontent.com/thejoester/joes-foundry-stuff/main/module.json
```

---

## Author

**thejoester** — Discord: `thejoester`
