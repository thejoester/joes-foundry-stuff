import { DL } from "./settings.js";

const MOD_ID = "joes-foundry-stuff";
const SOCKET_NS = `module.${MOD_ID}`;
const TEMPLATE = "modules/joes-foundry-stuff/templates/keybinding-locks-config.hbs";
const ADD_TEMPLATE = "modules/joes-foundry-stuff/templates/keybinding-lock-add.hbs";

const PERSONAL_KEY = "keybindLocksPersonal";   // user scope: per-user, server-side, survives cache/browser changes

// GM baseline is stored as an install-level data file, NOT a world setting, so it
// is shared by every world on this Foundry install (persists between worlds).
// Only the GM can write it (Foundry blocks non-GM uploads); players fetch to read.
const DATA_DIR = "joes-foundry-stuff-data";
const BASELINE_FILE = "keybind-locks.json";
const BASELINE_URL = `${DATA_DIR}/${BASELINE_FILE}`;

/* ==========================================================================
    {DATA HELPERS}
    A "lock" entry: { id, namespace, action, mode: "clear"|"set", bindings: [] }
      - id        = full action id, e.g. "core.elevateToken"
      - namespace = portion before the first "." (used by keybindings.set)
      - action    = portion after the first "."
      - mode       = "clear" (unbind) or "set" (force to bindings)
      - bindings  = [{ key, modifiers }] , only used when mode === "set"
========================================================================== */
function _readLocks(key) {
    try {
        const v = game.settings.get(MOD_ID, key);
        return Array.isArray(v) ? v : [];
    } catch { return []; }
}

function _clone(arr) {
    try { return structuredClone(arr); }
    catch { return JSON.parse(JSON.stringify(arr ?? [])); }
}

// Collapse duplicate locks for the same action id (last occurrence wins).
// Cleans up cruft from older builds that could store the same action twice.
function _dedupeById(arr) {
    const m = new Map();
    for (const l of (arr ?? [])) if (l?.id) m.set(l.id, l);
    return [...m.values()];
}

/* ==========================================================================
    {BASELINE FILE I/O}
    Install-level data file shared by all worlds. GM-write / everyone-read.
========================================================================== */
async function _readBaseline() {
    try {
        const res = await fetch(BASELINE_URL, { cache: "no-store" });
        if (!res.ok) return [];
        const data = await res.json();
        if (Array.isArray(data)) return data;                       // plain array
        if (data && Array.isArray(data.baseline)) return data.baseline;
        return [];
    } catch { return []; }
}

async function _ensureDataDir() {
    try {
        await foundry.applications.apps.FilePicker.implementation.createDirectory("data", DATA_DIR);
    } catch (err) {
        const msg = String(err?.message ?? err).toLowerCase();
        if (!msg.includes("exist")) DL(2, `keybindingLocks: createDirectory failed: ${err?.message ?? err}`);
    }
}

async function _writeBaseline(arr) {
    await _ensureDataDir();
    const payload = JSON.stringify({ baseline: arr ?? [] }, null, 2);
    const f = new File([payload], BASELINE_FILE, { type: "application/json" });
    const res = await foundry.applications.apps.FilePicker.implementation.upload("data", DATA_DIR, f, { notify: false });
    if (!res || (!res.path && !res.url)) throw new Error("baseline upload returned no path/url");
    DL(`keybindingLocks: baseline written (${(arr ?? []).length} lock(s))`);
}

// Split a full action id into { namespace, action }. Package ids cannot contain
// dots, so splitting on the first "." always reconstructs the original id.
function _splitId(id) {
    const dot = String(id).indexOf(".");
    if (dot < 0) return { namespace: id, action: "" };
    return { namespace: id.slice(0, dot), action: id.slice(dot + 1) };
}

function _bindingsEqual(a, b) {
    const A = Array.isArray(a) ? a : [];
    const B = Array.isArray(b) ? b : [];
    if (A.length !== B.length) return false;
    for (let i = 0; i < A.length; i++) {
        if ((A[i]?.key ?? "") !== (B[i]?.key ?? "")) return false;
        const ma = [...(A[i]?.modifiers ?? [])].sort().join(",");
        const mb = [...(B[i]?.modifiers ?? [])].sort().join(",");
        if (ma !== mb) return false;
    }
    return true;
}

/* ==========================================================================
    {KEY DISPLAY HELPERS}
========================================================================== */
function _modName(m) {
    switch (m) {
        case "Control": return "Ctrl";
        case "Shift":   return "Shift";
        case "Alt":     return "Alt";
        case "Meta":    return "Meta";
        default:        return m;
    }
}

function _fallbackKeyName(code) {
    if (!code) return "";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
    if (code.startsWith("Arrow")) return code.slice(5);
    return code;
}

function _humanizeBinding(b) {
    if (!b || !b.key) return "(none)";
    let keyStr = b.key;
    try {
        const KM = foundry.helpers?.interaction?.KeyboardManager;
        if (KM?.getKeycodeDisplayString) keyStr = KM.getKeycodeDisplayString(b.key);
    } catch { /* fall through */ }
    if (keyStr === b.key) keyStr = _fallbackKeyName(b.key);
    const mods = (b.modifiers ?? []).map(_modName);
    return [...mods, keyStr].join(" + ");
}

function _currentBindingLabel(namespace, action) {
    try {
        const bindings = game.keybindings.get(namespace, action) ?? [];
        if (!bindings.length) return "unbound";
        return bindings.map(_humanizeBinding).join(", ");
    } catch { return "?"; }
}

/* ==========================================================================
    {APPLY LOCKS}
    Merges baseline (everyone) + personal (this client); personal wins on
    conflicts. Re-applies desired binding state via game.keybindings.set.
========================================================================== */
export async function jfsApplyKeybindLocks() {
    if (!game.keybindings?.actions) return;

    const baseline = await _readBaseline();
    const personal = _readLocks(PERSONAL_KEY);

    const merged = new Map();
    for (const l of baseline) if (l?.id) merged.set(l.id, l);
    for (const l of personal) if (l?.id) merged.set(l.id, l); // personal overrides

    DL(`jfsApplyKeybindLocks() | loading locks (baseline: ${baseline.length}, personal: ${personal.length}, effective: ${merged.size})`);

    let applied = 0, unchanged = 0, missing = 0, failed = 0;
    for (const lock of merged.values()) {
        if (!game.keybindings.actions.has(lock.id)) {
            missing++; // action not registered this session (module disabled, etc.)
            DL(2, `jfsApplyKeybindLocks(): skipped "${lock.id}" (action not registered this session)`);
            continue;
        }

        const { namespace, action } = lock.namespace != null && lock.action != null
            ? lock
            : _splitId(lock.id);

        const desired = lock.mode === "set" ? (Array.isArray(lock.bindings) ? lock.bindings : []) : [];
        const current = game.keybindings.get(namespace, action) ?? [];
        if (_bindingsEqual(current, desired)) { unchanged++; continue; }

        try {
            await game.keybindings.set(namespace, action, desired);
            applied++;
            DL(`jfsApplyKeybindLocks(): ${lock.mode === "set" ? "set" : "cleared"} "${lock.id}"`);
        } catch (err) {
            failed++;
            DL(3, `jfsApplyKeybindLocks(): failed for "${lock.id}": ${err?.message ?? err}`);
        }
    }

    DL(`jfsApplyKeybindLocks() | done (applied: ${applied}, already-correct: ${unchanged}, missing: ${missing}, failed: ${failed})`);
}

/* ==========================================================================
    {SHARED ACTION HELPERS}
========================================================================== */
// Localized label for a namespace (module title, or "Core").
function _nsLabel(ns) {
    if (ns === "core") return "Core";
    try { return game.modules.get(ns)?.title ?? ns; } catch { return ns; }
}

// Sorted list of all registered keybinding actions: { id, namespace, action, name }.
function _actionList() {
    const out = [];
    for (const [id, cfg] of game.keybindings.actions.entries()) {
        const { namespace, action } = _splitId(id);
        let name = id;
        try { name = cfg?.name ? game.i18n.localize(cfg.name) : id; } catch {}
        out.push({ id, namespace, action, name });
    }
    out.sort((a, b) => {
        if (a.namespace !== b.namespace) {
            if (a.namespace === "core") return -1;
            if (b.namespace === "core") return 1;
            return _nsLabel(a.namespace).localeCompare(_nsLabel(b.namespace));
        }
        return a.name.localeCompare(b.name);
    });
    return out;
}

/* ==========================================================================
    {CONFIG UI}
========================================================================== */
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class KeybindLocksConfig extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "jfs-keybind-locks-config",
        tag: "form",
        window: { title: "Keybinding Locks", icon: "fas fa-lock", resizable: true },
        position: { width: 760, height: "auto" },
        actions: { close: function() { this.close(); } },
        form: { handler: KeybindLocksConfig.#onSubmit, closeOnSubmit: true }
    };

    static PARTS = { main: { template: TEMPLATE } };

    constructor(...args) {
        super(...args);
        this._working = null; // populated in _prepareContext (baseline read is async)
        this._capturing = false;
    }

    async _prepareContext(options) {
        if (!this._working) {
            this._working = {
                // Non-GM cannot edit or see the baseline, so don't load it for them.
                baseline: game.user.isGM ? _dedupeById(_clone(await _readBaseline())) : [],
                personal: _dedupeById(_clone(_readLocks(PERSONAL_KEY)))
            };
        }
        return { isGM: game.user.isGM };
    }

    // Read-only row for one active lock: action label + mode/key summary + remove.
    _makeRow(scope, lock) {
        const row = document.createElement("div");
        row.className = "jfs-kbl-row";

        const info = this._nameById?.get(lock.id);
        const name = info?.name ?? lock.id;
        const nsTxt = _nsLabel(lock.namespace ?? _splitId(lock.id).namespace);

        // action label (was a huge dropdown before)
        const label = document.createElement("span");
        label.className = "jfs-kbl-actionlabel";
        label.innerHTML = `<strong>${name}</strong> <span class="jfs-kbl-ns">${nsTxt}</span>`;
        label.dataset.tooltip = `${name} — ${nsTxt} (${lock.id})`;

        // mode / key summary badge
        const summary = document.createElement("span");
        summary.className = "jfs-kbl-summary";
        if (lock.mode === "set") {
            const keyTxt = _humanizeBinding(lock.bindings?.[0]);
            summary.innerHTML = `<i class="fas fa-keyboard"></i> ${keyTxt}`;
            summary.dataset.tooltip = `Forced to ${keyTxt}`;
            summary.classList.add("is-set");
        } else {
            summary.innerHTML = `<i class="fas fa-ban"></i> Cleared`;
            summary.dataset.tooltip = "Kept unbound";
            summary.classList.add("is-clear");
        }

        // remove button
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "jfs-kbl-remove";
        rm.innerHTML = `<i class="fas fa-trash"></i>`;
        rm.dataset.tooltip = "Remove this lock";
        rm.addEventListener("click", () => {
            const arr = this._working[scope];
            const idx = arr.indexOf(lock);
            if (idx >= 0) arr.splice(idx, 1);
            this._renderRows(scope);
        });

        row.append(label, summary, rm);
        return row;
    }

    _renderRows(scope) {
        const list = this.element.querySelector(`.jfs-kbl-list[data-scope="${scope}"]`);
        if (!list) return;
        list.replaceChildren();
        const arr = this._working[scope];
        if (!arr.length) {
            const empty = document.createElement("p");
            empty.className = "jfs-kbl-empty";
            empty.textContent = "No locks yet. Click Add to create one.";
            list.appendChild(empty);
            return;
        }
        for (const lock of arr) list.appendChild(this._makeRow(scope, lock));
    }

    // Called by the Add dialog. Inserts or replaces a lock for the given action.
    _addLock(scope, lock) {
        const arr = this._working[scope];
        const existing = arr.find(l => l.id === lock.id);
        if (existing) {
            existing.mode = lock.mode;
            existing.bindings = lock.bindings;
            existing.namespace = lock.namespace;
            existing.action = lock.action;
        } else {
            arr.push(lock);
        }
        this._renderRows(scope);
    }

    _openAddDialog(scope) {
        new KeybindLockAddDialog(this, scope).render(true);
    }

    _onRender(context, options) {
        // Map of action id -> { name, namespace, ... } for row labels
        this._nameById = new Map(_actionList().map(a => [a.id, a]));

        for (const scope of ["baseline", "personal"]) {
            const list = this.element.querySelector(`.jfs-kbl-list[data-scope="${scope}"]`);
            if (!list) continue; // baseline section absent for non-GM
            this._renderRows(scope);
        }

        for (const btn of this.element.querySelectorAll(".jfs-kbl-add")) {
            btn.addEventListener("click", () => this._openAddDialog(btn.dataset.scope));
        }
    }

    static async #onSubmit(event, form, formData) {
        const working = this._working ?? { baseline: [], personal: [] };

        const clean = (arr) => _dedupeById((arr ?? [])
            .filter(l => l && l.id && game.keybindings.actions.has(l.id))
            .map(l => {
                const { namespace, action } = _splitId(l.id);
                const mode = l.mode === "set" ? "set" : "clear";
                return {
                    id: l.id, namespace, action, mode,
                    bindings: mode === "set" ? (Array.isArray(l.bindings) ? l.bindings : []) : []
                };
            }));

        await game.settings.set(MOD_ID, PERSONAL_KEY, clean(working.personal));
        if (game.user.isGM) {
            await _writeBaseline(clean(working.baseline));
        }

        await jfsApplyKeybindLocks();

        if (game.user.isGM) game.socket.emit(SOCKET_NS, { action: "jfsKeybindLocksRefresh" });

        ui.notifications.info("Keybinding locks saved and applied.");
        DL("KeybindLocksConfig: saved and applied");
    }
}

/* ==========================================================================
    {ADD LOCK DIALOG}
    Searchable picker: namespace filter + search (matches action name AND the
    action's current key), pick an action, choose Clear or Set-to-key, then Add.
========================================================================== */
class KeybindLockAddDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "jfs-keybind-lock-add",
        window: { title: "Add Keybinding Lock", icon: "fas fa-plus", resizable: true },
        position: { width: 640, height: 560 }
    };

    static PARTS = { main: { template: ADD_TEMPLATE } };

    constructor(parent, scope) {
        super();
        this._parent = parent;
        this._scope = scope;
        this._filter = "";
        this._ns = "__ALL__";
        this._selected = null;     // { id, namespace, action, name }
        this._mode = "clear";
        this._bindings = [];
        this._capturing = false;
    }

    async _prepareContext(options) {
        return { isBaseline: this._scope === "baseline" };
    }

    // Namespaces that actually have registered actions, core first.
    _namespaces() {
        const seen = new Map();
        for (const a of this._actions) if (!seen.has(a.namespace)) seen.set(a.namespace, _nsLabel(a.namespace));
        const arr = [...seen.entries()].map(([ns, label]) => ({ ns, label }));
        arr.sort((a, b) => {
            if (a.ns === "core") return -1;
            if (b.ns === "core") return 1;
            return a.label.localeCompare(b.label);
        });
        return arr;
    }

    _matches(a) {
        if (this._ns !== "__ALL__" && a.namespace !== this._ns) return false;
        const q = this._filter.trim().toLowerCase();
        if (!q) return true;
        const current = _currentBindingLabel(a.namespace, a.action).toLowerCase();
        return a.name.toLowerCase().includes(q)
            || a.id.toLowerCase().includes(q)
            || current.includes(q);
    }

    _renderList() {
        const list = this.element.querySelector(".jfs-kbla-list");
        if (!list) return;
        list.replaceChildren();

        const matches = this._actions.filter(a => this._matches(a));
        if (!matches.length) {
            const empty = document.createElement("p");
            empty.className = "jfs-kbla-empty";
            empty.textContent = "No actions match your search.";
            list.appendChild(empty);
            return;
        }

        for (const a of matches) {
            const row = document.createElement("div");
            row.className = "jfs-kbla-row";
            if (this._selected?.id === a.id) row.classList.add("selected");

            const current = _currentBindingLabel(a.namespace, a.action);
            row.innerHTML =
                `<span class="jfs-kbla-name"><strong>${a.name}</strong></span>` +
                `<span class="jfs-kbla-nscol">${_nsLabel(a.namespace)}</span>` +
                `<span class="jfs-kbla-cur">${current}</span>`;
            row.dataset.tooltip = `${a.name} — ${_nsLabel(a.namespace)} (${a.id})\nCurrently: ${current}`;

            row.addEventListener("click", () => {
                this._selected = a;
                this._renderList();
                this._syncFooter();
            });
            list.appendChild(row);
        }
    }

    _syncFooter() {
        const selInfo = this.element.querySelector(".jfs-kbla-selinfo");
        const addBtn = this.element.querySelector(".jfs-kbla-add");
        const keyWrap = this.element.querySelector(".jfs-kbla-keywrap");

        if (selInfo) {
            selInfo.textContent = this._selected
                ? `${this._selected.name} (${_nsLabel(this._selected.namespace)})`
                : "Select an action above…";
        }
        if (keyWrap) keyWrap.style.display = this._mode === "set" ? "" : "none";

        const ready = !!this._selected && (this._mode === "clear" || this._bindings.length > 0);
        if (addBtn) addBtn.disabled = !ready;
    }

    _beginCapture(btn, keyDisp) {
        if (this._capturing) return;
        this._capturing = true;
        const prev = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-keyboard"></i> Press a key…`;

        const MOD_ONLY = new Set([
            "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
            "AltLeft", "AltRight", "MetaLeft", "MetaRight"
        ]);

        const handler = (ev) => {
            if (MOD_ONLY.has(ev.code)) return;
            ev.preventDefault();
            ev.stopPropagation();
            document.removeEventListener("keydown", handler, true);
            this._capturing = false;

            if (ev.code === "Escape") { btn.innerHTML = prev; return; }

            const modifiers = [];
            if (ev.ctrlKey)  modifiers.push("Control");
            if (ev.shiftKey) modifiers.push("Shift");
            if (ev.altKey)   modifiers.push("Alt");
            this._bindings = [{ key: ev.code, modifiers }];
            const txt = _humanizeBinding(this._bindings[0]);
            keyDisp.textContent = txt;
            keyDisp.dataset.tooltip = txt;
            btn.innerHTML = `<i class="fas fa-keyboard"></i> Change`;
            this._syncFooter();
        };
        document.addEventListener("keydown", handler, true);
    }

    _onRender(context, options) {
        this._actions = _actionList();

        // Namespace filter
        const nsSel = this.element.querySelector(".jfs-kbla-ns");
        if (nsSel) {
            nsSel.replaceChildren();
            const all = document.createElement("option");
            all.value = "__ALL__"; all.textContent = "All namespaces";
            nsSel.appendChild(all);
            for (const { ns, label } of this._namespaces()) {
                const o = document.createElement("option");
                o.value = ns; o.textContent = label;
                nsSel.appendChild(o);
            }
            nsSel.value = this._ns;
            nsSel.addEventListener("change", () => { this._ns = nsSel.value; this._renderList(); });
        }

        // Search
        const search = this.element.querySelector(".jfs-kbla-search");
        if (search) {
            search.value = this._filter;
            search.addEventListener("input", () => { this._filter = search.value; this._renderList(); });
        }

        // Mode + capture
        const modeSel = this.element.querySelector(".jfs-kbla-mode");
        const keyDisp = this.element.querySelector(".jfs-kbla-keydisp");
        const captureBtn = this.element.querySelector(".jfs-kbla-capture");
        if (modeSel) {
            modeSel.value = this._mode;
            modeSel.addEventListener("change", () => { this._mode = modeSel.value; this._syncFooter(); });
        }
        if (captureBtn && keyDisp) {
            captureBtn.addEventListener("click", () => this._beginCapture(captureBtn, keyDisp));
        }

        // Cancel / Add
        this.element.querySelector(".jfs-kbla-cancel")?.addEventListener("click", () => this.close());
        this.element.querySelector(".jfs-kbla-add")?.addEventListener("click", () => this._commit());

        this._renderList();
        this._syncFooter();
    }

    _commit() {
        const a = this._selected;
        if (!a) return;
        if (this._mode === "set" && !this._bindings.length) {
            ui.notifications.warn("Capture a key first, or choose Clear.");
            return;
        }
        this._parent._addLock(this._scope, {
            id: a.id, namespace: a.namespace, action: a.action,
            mode: this._mode,
            bindings: this._mode === "set" ? this._bindings : []
        });
        DL(`KeybindLockAddDialog: added ${this._mode} lock for "${a.id}" (${this._scope})`);
        this.close();
    }
}

/* ==========================================================================
    {REGISTRATION}
========================================================================== */
Hooks.once("init", () => {
    // Personal locks: user scope. Stored server-side per user, so they survive
    // browser changes and cache clears and follow the player across devices.
    // Non-GM users can write their own user-scope settings. Trade-off vs client
    // scope: user settings live in the world DB, so they are per-world (a player
    // sets them once in each world). Baseline is a data file, not a setting.
    game.settings.register(MOD_ID, PERSONAL_KEY, {
        scope: "user", config: false, type: Array, default: []
    });

    // Not restricted: players can open it to manage their own personal locks.
    game.settings.registerMenu(MOD_ID, "keybindLocksMenu", {
        name: "Keybinding Locks",
        label: "Manage Locks",
        hint: "Force certain keybindings to stay cleared (unbound) or set to a specific key on every load. GMs can set a baseline for all players; everyone can add personal locks.",
        icon: "fas fa-lock",
        type: KeybindLocksConfig,
        restricted: false
    });
});

Hooks.once("ready", async () => {
    // Re-apply on refresh broadcasts (GM changed the baseline)
    game.socket.on(SOCKET_NS, (data) => {
        if (data?.action === "jfsKeybindLocksRefresh") {
            DL("keybindingLocks: received refresh broadcast");
            jfsApplyKeybindLocks();
        }
    });

    // Ensure the shared data folder exists so the GM's first save can write it.
    if (game.user.isGM) await _ensureDataDir();

    // Apply locks on load, this is what stops bindings from reverting.
    jfsApplyKeybindLocks();
});

// Expose for macro/console use
Hooks.once("ready", () => {
    const mod = game.modules.get(MOD_ID);
    if (mod) Object.assign((mod.api ??= {}), { applyKeybindLocks: jfsApplyKeybindLocks });
});
