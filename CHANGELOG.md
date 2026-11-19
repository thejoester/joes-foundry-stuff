# Changelog

All notable changes to Joe's Foundry Stuff are documented here. Versioning is date-based and SemVer-valid, so segments carry no leading zeros (`YYYY.M.D`, e.g. `2026.11.5`; a `-N` suffix is added for a second build on the same day). Headings follow Keep a Changelog format, `## [YYYY.M.D] - YYYY-MM-DD` (the bracketed version plus a zero-padded ISO date), and the release tag must match the bracketed version.

## [2026.11.18] - 2026-11-18

### Added

- **Connection Logger** - new "Hide Connection Errors from Players" setting. When on, the "lost connection to the server" and "connection re-established" popups no longer show to players; the GM still sees them, so you can quiet the spam on the players' screens while keeping an eye on it yourself.

### Changed

- **Connection Logger** - connection blips are now always recorded; the separate "Enable Connection Logger" toggle has been removed. The Connection Log page is written whenever players drop and reconnect, with no setup needed.

## [2026.11.17] - 2026-11-17

### Changed

- **Macros:** Updated macro comendium to include radial macro icons

### Fixed

- **Error Logger** - deleting the "Error Logs" journal to start fresh now brings it right back on the next error or connection blip, instead of staying gone until the GM reloaded. If a player runs into an error in that brief window after a reset, their message is sent to the GM and written out safely, so nothing slips through the cracks.

## [2026.11.11] - 2026-11-11

### Added

- **Connection Logger** - a new optional tool that records every player's "lost connection / reconnected" blips to a shared "Connection Log" page in the Error Logs journal: who dropped, when, why, and how long they were gone. Handy for tracking down reconnect spam. Off by default; turn it on with the new Enable Connection Logger setting, and turn it back off once you've got what you need.

## [2026.11.5] - 2026-11-05

### Fixed

- **Notification suppression** - updated for current Foundry versions so the hiding of harmless "does not exist" and permission error popups keeps working, and no longer logs a deprecation warning in the console.

## [2026.11.1] - 2026-11-01

### Removed

- **Keybinding Locks** - this feature has moved to [Big Bad Module Manager (BBMM)](https://github.com/thejoester/bbmm). Install BBMM if you want to keep forcing keybindings to stay cleared or set on every load.

## [2026.10.7] - 2026-10-07

### Added

- **Initiative Timer** - new Initiative Timer Volume slider (1 to 10) to set how loud the timer sound plays.

## [2026.10.1] - 2026-10-01

### Added

- **Error Logger** - captures player-side error and warning messages into a shared "Error Logs" journal, one page per player, so the GM can see what players ran into. Turn it on with the new Enable Error Logger setting. (It used to live in Joe's PF2e Stuff; it now works in any game system.)

### Removed

- The personal Scenes, Roll Tables, Playlists, and Journals compendiums have been removed. The reusable Macros compendium stays.

## [2026.9.18] - 2026-09-18

### Fixed

- **Initiative Timer** - fixed not hiding tokens not owned by any player in combat tracker. 

## [2026.9.15] - 2026-09-15

### Changed

- **Initiative Timer** - will automatically open the combat tracker.
- **Macro** - Fixed 'find and replace` macro.

## [2026.7.28] - 2026-07-28

### Added

- **Initiative Timer** - the countdown sound is now configurable in module settings with a file-browser picker (`Initiative Timer Sound`). Leave it blank for no sound. Defaults to the previous `hub-intro-sound.mp3`.

### Changed

- **Initiative Timer** - replaced the full-screen dark overlay with a compact banner. It no longer darkens the canvas or sidebar, sits 30% down the screen (centered), and still renders above all other UI without blocking clicks.

### Fixed

- **Combat Turn Timer** - a combatant's turn no longer posts a chat message if its token is hidden at the end of the turn. Visibility is now evaluated when the turn ends (not when it starts), so unhiding a token mid-turn lets its message post as normal.

## [2026.7.24] - 2026-07-24

### Fixed

- **Play Sound macro** - replaced v12-era globals with their v13+ namespaced forms so it no longer throws `AudioHelper is not defined`: `AudioHelper` -> `foundry.audio.AudioHelper`, `FilePicker` -> `foundry.applications.apps.FilePicker.implementation`. Also switched from the global `renderDialogV2` hook to DialogV2's own `render` callback via `.wait()`, and the Browse button now seeds the picker from the current field value.
- **Overlay** - file-picker Browse button now uses `foundry.applications.apps.FilePicker.implementation` instead of the removed bare `FilePicker` global.

## [2026.7.18] - 2026-07-18

### Added

- Added Changelog file
- updated to v14 compatibility in module.json

## [2026.7.17] - 2026-07-17

### Added

- **Keybinding Locks** feature - force chosen keybindings to stay cleared or set on every load. GM baseline locks (install-level data file, cross-world, pushed to players) plus per-user personal locks; searchable action picker.
- GitHub release pipeline (source-controlled compendium packs compiled in CI).
- Started with release-date versioning theme.
- `README.md`.

### Removed

- Non-functional Audio Auto Mix feature.
