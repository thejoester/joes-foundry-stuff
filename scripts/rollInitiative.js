/* ==========================================================================
    {ROLL FOR INITIATIVE}
    Adds selected tokens to the active combat, hides NPC combatants, and
    rolls NPC initiative. Optionally shows a countdown overlay ("Roll for
    Initiative!") and auto-rolls initiative for any players who haven't
    rolled by the time it expires.
========================================================================== */

import { DL } from "./settings.js";

const MOD_ID = "joes-foundry-stuff";
const SOCKET_NS = "module.joes-foundry-stuff";
const OVERLAY_ID = "jfs-init-overlay";
const OVERLAY_Z = 999000;

let _initInterval = null;
let _activeEndTime = null;

/* ── core: add tokens to combat, hide NPCs, roll NPC initiative ─────────── */

export async function jfsRollForInitiative() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can do this.");
        return;
    }

    if (_activeEndTime) {
        _cancelInitiativeTimer();
        return;
    }

    const tokens = canvas.tokens.controlled.map(t => t.document);
    if (!tokens.length) {
        ui.notifications.warn("Select one or more tokens first.");
        return;
    }

    const combatants = await TokenDocument.implementation.createCombatants(tokens);

    const npcIds = combatants.filter(c => c.isNPC).map(c => c.id);
    if (npcIds.length) {
        await game.combat.updateEmbeddedDocuments("Combatant", npcIds.map(id => ({ _id: id, hidden: true })));
    }

    await game.combat.rollNPC({ messageMode: "blindroll", skipDialog: true });
    DL(`rollInitiative.js | jfsRollForInitiative(): added ${combatants.length} combatant(s), rolled NPC initiative`);

    if (game.settings.get(MOD_ID, "initiativeTimerEnabled")) {
        _startInitiativeTimer();
    }
}

/* ── countdown overlay ────────────────────────────────────────────────── */

function _startInitiativeTimer() {
    const seconds = game.settings.get(MOD_ID, "initiativeTimerSeconds") || 30;
    const endTime = Date.now() + seconds * 1000;

    _activeEndTime = endTime;
    _showOverlay(endTime);
    game.socket.emit(SOCKET_NS, { action: "jfsInitTimerStart", endTime });
    DL(`rollInitiative.js | _startInitiativeTimer(): started, ${seconds}s`);
}

function _cancelInitiativeTimer() {
    _activeEndTime = null;
    _hideOverlay();
    game.socket.emit(SOCKET_NS, { action: "jfsInitTimerStop" });
    ui.notifications.info("Initiative timer cancelled.");
    DL("rollInitiative.js | _cancelInitiativeTimer(): cancelled by GM");
}

function _showOverlay(endTime) {
    _hideOverlay();

    const sound = game.settings.get(MOD_ID, "initiativeTimerSound");
    if (sound) foundry.audio.AudioHelper.play({ src: sound, volume: 0.8, autoplay: true, loop: false }, false);
    ui.sidebar.changeTab("combat", "primary");

    const wrap = document.createElement("div");
    wrap.id = OVERLAY_ID;
    Object.assign(wrap.style, {
        position: "fixed",
        top: "30%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: String(OVERLAY_Z),
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "10px 24px",
        borderRadius: "12px",
        border: "2px solid #5f574e",
        background: "rgba(0,0,0,0.85)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        pointerEvents: "none"
    });
    wrap.innerHTML = `
        <div style="font-size:1.8vw; font-weight:900; color:#fff; text-shadow:0 0 8px #000; letter-spacing:1px; white-space:nowrap;">
            Roll for Initiative!
        </div>
        <div data-jfs-init-timer style="font-size:2.4vw; font-weight:900; color:#ffcc00; text-shadow:0 0 10px #000; font-variant-numeric:tabular-nums; min-width:2ch; text-align:center;">
            --
        </div>
    `;
    document.body.appendChild(wrap);

    const timerEl = wrap.querySelector("[data-jfs-init-timer]");

    function tick() {
        if (game.user.isGM && _allPlayersRolled()) {
            _hideOverlay();
            _activeEndTime = null;
            game.socket.emit(SOCKET_NS, { action: "jfsInitTimerStop" });
            ui.notifications.info("Everyone has rolled initiative!");
            DL("rollInitiative.js | tick(): all players rolled, timer stopped early");
            return;
        }

        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        timerEl.textContent = remaining;
        if (remaining <= 0) {
            _hideOverlay();
            if (game.user.isGM) {
                _activeEndTime = null;
                _rollRemainingInitiative();
            }
        }
    }

    tick();
    _initInterval = setInterval(tick, 250);
}

function _hideOverlay() {
    if (_initInterval) {
        clearInterval(_initInterval);
        _initInterval = null;
    }
    document.getElementById(OVERLAY_ID)?.remove();
}

function _allPlayersRolled() {
    const combat = game.combat;
    if (!combat) return false;
    const pending = combat.combatants.filter(c => !c.isNPC && (c.initiative === null || c.initiative === undefined));
    return !pending.length;
}

async function _rollRemainingInitiative() {
    const combat = game.combat;
    if (!combat) return;

    const pending = combat.combatants.filter(c => !c.isNPC && (c.initiative === null || c.initiative === undefined));
    if (!pending.length) return;

    DL(`rollInitiative.js | _rollRemainingInitiative(): auto-rolling for ${pending.length} combatant(s)`);
    await combat.rollInitiative(pending.map(c => c.id), { skipDialog: true });
    ui.notifications.info("Time's up! Rolled initiative for remaining combatants.");
}

/* ── socket: sync the countdown overlay to all clients ───────────────────── */

Hooks.once("ready", () => {
    game.socket.on(SOCKET_NS, (data) => {
        if (!data?.action) return;
        if (data.action === "jfsInitTimerStart") _showOverlay(data.endTime);
        if (data.action === "jfsInitTimerStop") _hideOverlay();
    });
    DL("rollInitiative.js | ready hook ran, socket listener registered");
});
