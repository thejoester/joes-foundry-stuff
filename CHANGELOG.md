# Changelog

All notable changes to Joe's Foundry Stuff are documented here. Versioning is date-based (`YYYY.MM.DD`; a fourth segment is added for a second build on the same day).

## 2026.07.28

    ### Added

    - **Initiative Timer** — the countdown sound is now configurable in module settings with a file-browser picker (`Initiative Timer Sound`). Leave it blank for no sound. Defaults to the previous `hub-intro-sound.mp3`.

    ### Changed

    - **Initiative Timer** — replaced the full-screen dark overlay with a compact banner. It no longer darkens the canvas or sidebar, sits 30% down the screen (centered), and still renders above all other UI without blocking clicks.

    ### Fixed

    - **Combat Turn Timer** — a combatant's turn no longer posts a chat message if its token is hidden at the end of the turn. Visibility is now evaluated when the turn ends (not when it starts), so unhiding a token mid-turn lets its message post as normal.

## 2026.07.24-2

    ### Added

    - **Timer** — the GM can now double-click anywhere in the player timer window to open the Timer Manager.
    - Added Random Name roll tables to compendium.

    ### Fixed

    - Fixed several macros including Advanced Pull to Scene, Group Roll, and Show-XP

## 2026.07.24

    ### Fixed

    - **Play Sound macro** — replaced v12-era globals with their v13+ namespaced forms so it no longer throws `AudioHelper is not defined`: `AudioHelper` -> `foundry.audio.AudioHelper`, `FilePicker` -> `foundry.applications.apps.FilePicker.implementation`. Also switched from the global `renderDialogV2` hook to DialogV2's own `render` callback via `.wait()`, and the Browse button now seeds the picker from the current field value.
    - **Overlay** — file-picker Browse button now uses `foundry.applications.apps.FilePicker.implementation` instead of the removed bare `FilePicker` global.

## 2026.07.18

    ### Added

    - Added Changelog file
    - updated to v14 compatibility in module.json

## 2026.07.17

    ### Added

    - **Keybinding Locks** feature — force chosen keybindings to stay cleared or set on every load. GM baseline locks (install-level data file, cross-world, pushed to players) plus per-user personal locks; searchable action picker.
    - GitHub release pipeline (source-controlled compendium packs compiled in CI).
    - Started with release-date versioning theme.
    - `README.md`.

    ### Removed

    - Non-functional Audio Auto Mix feature.
