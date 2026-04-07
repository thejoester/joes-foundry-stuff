import { DL } from "./settings.js";

const MOD_ID = "joes-foundry-stuff";
const STATE_KEY = "combatTurnTimerState";
const TEMPLATE = "modules/joes-foundry-stuff/templates/combat-timer-config.hbs";

// ── settings window ───────────────────────────────────────────────────────────

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class CombatTimerConfig extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "jfs-combat-timer-config",
        tag: "form",
        window: { title: "Combat Timer Settings", icon: "fas fa-stopwatch", resizable: false },
        position: { width: 440, height: "auto" },
        actions: { close: function() { this.close(); } },
        form: { handler: CombatTimerConfig.#onSubmit, closeOnSubmit: true }
    };

    static PARTS = { main: { template: TEMPLATE } };

    async _prepareContext(options) {
        const visibility = game.settings.get(MOD_ID, "combatTurnTimerVisibility");
        return {
            enabled:       game.settings.get(MOD_ID, "combatTurnTimerEnabled"),
            visibility,
            visGM:         visibility === "gmonly",
            visAll:        visibility === "everyone",
            sarcasm:       game.settings.get(MOD_ID, "combatTurnTimerSarcasm"),
            longThreshold: game.settings.get(MOD_ID, "combatTurnTimerLongThreshold"),
            quickThreshold: game.settings.get(MOD_ID, "combatTurnTimerQuickThreshold"),
        };
    }

    _onRender(context, options) {
        const sarcasmCheck   = this.element.querySelector('[name="sarcasm"]');
        const thresholdBlock = this.element.querySelector("#jfs-ctt-sarcasm-thresholds");

        sarcasmCheck?.addEventListener("change", () => {
            if (thresholdBlock) thresholdBlock.style.display = sarcasmCheck.checked ? "" : "none";
        });

        for (const [name, valId] of [["longThreshold", "jfs-ctt-long-val"], ["quickThreshold", "jfs-ctt-quick-val"]]) {
            const range = this.element.querySelector(`[name="${name}"]`);
            const val   = this.element.querySelector(`#${valId}`);
            range?.addEventListener("input", () => { if (val) val.textContent = `${range.value}m`; });
        }
    }

    static async #onSubmit(event, form, formData) {
        const d = formData.object;
        await Promise.all([
            game.settings.set(MOD_ID, "combatTurnTimerEnabled",          !!d.enabled),
            game.settings.set(MOD_ID, "combatTurnTimerVisibility",        d.visibility ?? "gmonly"),
            game.settings.set(MOD_ID, "combatTurnTimerSarcasm",           !!d.sarcasm),
            game.settings.set(MOD_ID, "combatTurnTimerLongThreshold",     Number(d.longThreshold) || 5),
            game.settings.set(MOD_ID, "combatTurnTimerQuickThreshold",    Number(d.quickThreshold) || 1),
        ]);
        DL("CombatTimerConfig: settings saved");
    }
}

Hooks.once("init", () => {
    game.settings.registerMenu(MOD_ID, "combatTimerMenu", {
        name: "Combat Timer",
        label: "Open Settings",
        hint: "Configure the combat turn timer.",
        icon: "fas fa-stopwatch",
        type: CombatTimerConfig,
        restricted: true
    });
});

// ── state helpers ─────────────────────────────────────────────────────────────
/*
  Persisted state shape:
  {
    combatId:    string,
    combatStart: number,   // ms timestamp of combat start
    round:       number,   // current round index (for dedup guard)
    turn:        number,   // current turn index (for dedup guard)
    currentTurn: { name: string, adjustedStart: number } | null,
    previousTurn: { name: string, elapsed: number } | null
      // elapsed = ms already accumulated when turn was suspended (for resumption)
  }
*/

function _getState() {
    try { return game.settings.get(MOD_ID, STATE_KEY) ?? {}; }
    catch { return {}; }
}

function _saveState(data) {
    game.settings.set(MOD_ID, STATE_KEY, data).catch(err =>
        DL(3, `CombatTurnTimer: failed to save state: ${err}`)
    );
}

function _clearState() { _saveState({}); }

// ── formatting ────────────────────────────────────────────────────────────────

function _fmt(ms) {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec} second${totalSec === 1 ? "" : "s"}`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m} minute${m === 1 ? "" : "s"}`;
}

// ── chat ──────────────────────────────────────────────────────────────────────

const LONG_QUIPS = [
    "It better have been productive!",
    "Did you fall asleep? No judgment... okay, some judgment.",
    "Somewhere, a dragon just died of old age.",
    "The bard started writing a ballad about this turn. It's an epic.",
    "The enemy goblins filed their taxes while they waited.",
    "That was so long the dungeon reset.",
    "I've seen glaciers move faster.",
    "Even the gods grew impatient.",
    "Your hourglass called. It retired.",
    "The torch burned out. Twice.",
];

const QUICK_QUIPS = [
    "Lightning round! Someone actually came prepared.",
    "Blink and you'd miss it.",
    "Decisive! Or desperate. Hard to tell.",
    "Speed like that should be illegal.",
    "The enemy didn't even have time to be scared.",
    "Was that a turn or a sneeze?",
    "Quick as a halfling stealing a snack.",
    "Did you even read your character sheet, or just vibe?",
];

function _longThresholdMs() {
    try { return (game.settings.get(MOD_ID, "combatTurnTimerLongThreshold") || 5) * 60 * 1000; }
    catch { return 5 * 60 * 1000; }
}

function _quickThresholdMs() {
    try { return (game.settings.get(MOD_ID, "combatTurnTimerQuickThreshold") || 1) * 60 * 1000; }
    catch { return 1 * 60 * 1000; }
}

function _chat(content, elapsedMs = null) {
    let whisper = [];
    try {
        const v = game.settings.get(MOD_ID, "combatTurnTimerVisibility");
        if (v !== "everyone") whisper = game.users.filter(u => u.isGM).map(u => u.id);
    } catch { /* default to [] */ }

    let fullContent = content;
    try {
        if (game.settings.get(MOD_ID, "combatTurnTimerSarcasm") && elapsedMs !== null) {
            let quip = null;
            if (elapsedMs >= _longThresholdMs()) {
                quip = LONG_QUIPS[Math.floor(Math.random() * LONG_QUIPS.length)];
            } else if (elapsedMs < _quickThresholdMs()) {
                quip = QUICK_QUIPS[Math.floor(Math.random() * QUICK_QUIPS.length)];
            }
            if (quip) fullContent += `<br><br><em>${quip}</em>`;
        }
    } catch { /* skip sarcasm */ }

    ChatMessage.create({ content: fullContent, speaker: { alias: "Combat Timer" }, whisper });
}

// ── core logic ────────────────────────────────────────────────────────────────

function _startCombat(combat) {
    const combatant = combat?.combatant;
    const name = combatant?.actor?.name ?? combatant?.name ?? "Unknown";
    const now = Date.now();
    _saveState({
        combatId: combat.id,
        combatStart: now,
        round: combat.round,
        turn: combat.turn,
        currentTurn: { name, adjustedStart: now },
        previousTurn: null
    });
    DL(`CombatTurnTimer: combat started, first turn: "${name}"`);
}

function _advanceTurn(combat) {
    const state = _getState();
    if (!state.combatId) return;
    if (combat.round === state.round && combat.turn === state.turn) return;

    const now = Date.now();
    const elapsed = now - (state.currentTurn?.adjustedStart ?? now);
    const prevName = state.currentTurn?.name ?? "Unknown";

    _chat(`${prevName}'s turn took ${_fmt(elapsed)}.`, elapsed);
    DL(`CombatTurnTimer: "${prevName}" turn ended after ${_fmt(elapsed)}`);

    const combatant = combat?.combatant;
    const name = combatant?.actor?.name ?? combatant?.name ?? "Unknown";

    _saveState({
        ...state,
        round: combat.round,
        turn: combat.turn,
        currentTurn: { name, adjustedStart: now },
        previousTurn: { name: prevName, elapsed }
    });
}

function _retreatTurn(combat) {
    const state = _getState();
    if (!state.combatId) return;
    if (combat.round === state.round && combat.turn === state.turn) return;

    DL(`CombatTurnTimer: retreating, cancelling "${state.currentTurn?.name ?? "?"}"`);

    if (state.previousTurn) {
        const { name, elapsed } = state.previousTurn;
        const resumedStart = Date.now() - elapsed;
        DL(`CombatTurnTimer: resuming "${name}" with ${_fmt(elapsed)} already elapsed`);
        _saveState({
            ...state,
            round: combat.round,
            turn: combat.turn,
            currentTurn: { name, adjustedStart: resumedStart },
            previousTurn: null
        });
    } else {
        const combatant = combat?.combatant;
        const name = combatant?.actor?.name ?? combatant?.name ?? "Unknown";
        DL(`CombatTurnTimer: no previous stored, starting fresh for "${name}"`);
        _saveState({
            ...state,
            round: combat.round,
            turn: combat.turn,
            currentTurn: { name, adjustedStart: Date.now() },
            previousTurn: null
        });
    }
}

function _endCombat() {
    const state = _getState();
    if (!state.combatId) return;

    const now = Date.now();
    if (state.currentTurn) {
        const elapsed = now - state.currentTurn.adjustedStart;
        _chat(`${state.currentTurn.name}'s turn took ${_fmt(elapsed)}.`, elapsed);
    }
    if (state.combatStart) {
        _chat(`Total combat time: ${_fmt(now - state.combatStart)}.`);
    }
    _clearState();
}

// ── hooks ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
    const state = _getState();
    if (state.combatId && !game.combats.get(state.combatId)) {
        DL(`CombatTurnTimer: stale state found for combat ${state.combatId}, clearing`);
        _clearState();
    }
});

function _isEnabled() {
    try { return game.settings.get(MOD_ID, "combatTurnTimerEnabled"); }
    catch { return false; }
}

Hooks.on("updateCombat", (combat, updateData, options, userId) => {
    if (!game.user.isGM || !_isEnabled()) return;

    const turnChanged = "turn" in updateData || "round" in updateData;
    const combatStarted = updateData.active === true;
    const state = _getState();

    if (turnChanged) {
        if (!state.combatId || state.combatId !== combat.id) {
            _startCombat(combat);
        } else {
            const direction = options?.direction ?? 1;
            if (direction < 0) _retreatTurn(combat);
            else _advanceTurn(combat);
        }
    } else if (combatStarted && (!state.combatId || state.combatId !== combat.id)) {
        _startCombat(combat);
    }
});

Hooks.on("deleteCombat", (combat, options, userId) => {
    if (!game.user.isGM || !_isEnabled()) return;
    const state = _getState();
    if (state.combatId === combat.id) _endCombat();
});
