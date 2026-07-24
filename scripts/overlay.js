/* ==========================================================================
	{OVERLAY UTILITY MODULE}
    Provides a simple API to show a topmost image overlay for all users, 
    with options for size, opacity, and blur.
=========================================================================== */

import { DL } from "./settings.js";

const MOD_ID = "joes-foundry-stuff";
const SETTING_KEY = "overlayState";

// Helper functions to get/set the persistent overlay state in world settings (GM only for set)
function getOverlayState() {
    DL("overlay.js | getOverlayState() called");
	try { return game.settings.get(MOD_ID, SETTING_KEY) ?? { enabled: false, payload: null }; }
	catch { return { enabled: false, payload: null }; }
}

// GM-only function to update the persistent overlay state in world settings
async function setOverlayState(state) {
    DL(" overlay.js | setOverlayState() called with", state);
	// Only the GM should update the world setting
	if (!game.user?.isGM) return;
	try { await game.settings.set(MOD_ID, SETTING_KEY, state); }
	catch (err) { console.warn("JFS | Failed to persist overlayState:", err); }
}

// Expose the API under the module's namespace
export const JFS_OVERLAY = {
	SOCKET_NS: "module.joes-foundry-stuff",
	OVERLAY_ID: "jfs-topmost-overlay",
	OVERLAY_Z: 999000,

    // Call this once to set up the socket listener for overlay commands
	initSocket() {
		if (game._jfsOverlayBound) return;
		game.socket.on(this.SOCKET_NS, (msg) => {
            console.log("JFS overlay socket msg", msg);
			if (!msg || !msg.cmd) return;
			if (msg.cmd === "show") this._showLocal(msg.payload);
			if (msg.cmd === "hide") this.hide();
		});
		game._jfsOverlayBound = true;
	},

    // Local function to show the overlay without broadcasting or changing persisted state
	_showLocal({ src, widthPct = 60, opacity = 1, blur = 0 } = {}) {
		this.hide();
		const wrap = document.createElement("div");
		wrap.id = this.OVERLAY_ID;
		Object.assign(wrap.style, {
			position: "fixed",
			left: "50%", top: "50%",
			transform: "translate(-50%, -50%)",
			zIndex: String(this.OVERLAY_Z),
			pointerEvents: "none",
			display: "flex", alignItems: "center", justifyContent: "center"
		});
		const img = document.createElement("img");
		img.src = src;
		img.alt = "overlay";
		img.style.maxWidth = "none";
		img.style.width = `${Math.max(1, Math.min(100, Number(widthPct)))}vw`;
		img.style.opacity = `${Math.max(0, Math.min(1, Number(opacity)))}`;
		img.style.filter = `blur(${Math.max(0, Number(blur))}px)`;
		wrap.appendChild(img);
		document.body.appendChild(wrap);
	},

    // Hide the overlay locally without broadcasting or changing persisted state
	hide() {
		const el = document.getElementById(this.OVERLAY_ID);
		if (el?.parentElement) el.parentElement.removeChild(el);
	},

	show(payload = {}, { broadcast = false, persist = true } = {}) {
        this._showLocal(payload);
        // Persist (GM only) so it survives refresh
        if (persist && game.user.isGM) setOverlayState({ enabled: true, payload });

        if (broadcast && game.user.isGM) {
            game.socket.emit(this.SOCKET_NS, { cmd: "show", payload });
        }
    },

    // Hide for everyone and clear the persisted state (GM only)
	hideAll() {
        this.hide();
        if (game.user.isGM) {
            setOverlayState({ enabled: false, payload: null });
            game.socket.emit(this.SOCKET_NS, { cmd: "hide" });
        }
    },

	// DialogV2 with a working FilePicker
	async openDialog() {
        // Hide any current overlay
        this.hide();

        const DEFAULT_IMG = "assets/images/start-the-timer.webp";
        const DIALOG_Z = this.OVERLAY_Z + 100;

        const content = `
        <form class="flexcol" style="min-width: 440px;">
            <div class="form-group">
                <label>Image Path or URL</label>
                <div class="flexrow" style="gap:8px;align-items:center;">
                    <input type="text" name="src" value="${DEFAULT_IMG}" data-dtype="String" style="flex:1" autofocus>
                    <button type="button" data-action="browse" class="button">Browse…</button>
                </div>
                <p class="notes">Path relative to your Data folder (same as tokens/maps).</p>
            </div>

            <div class="form-group">
                <label>Width (% of viewport)</label>
                <input type="number" name="widthPct" value="60" min="1" max="100" step="1">
            </div>

            <div class="form-group">
                <label>Opacity (0–1)</label>
                <input type="number" name="opacity" value="1" min="0" max="1" step="0.05">
            </div>

            <div class="form-group">
                <label>Blur (px)</label>
                <input type="number" name="blur" value="0" min="0" step="1">
            </div>

            <hr>
            <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" name="broadcast" ${game.user.isGM ? "checked" : ""}>
                <span>Show for all connected users (GM only)</span>
            </label>
        </form>`;

        const dlg = new foundry.applications.api.DialogV2({
            window: { title: "Topmost Overlay Image" },
            content,
            buttons: [{
                action: "show",
                label: "Show Overlay",
                default: true,
                callback: (ev, btn) => {
                    const f = btn.form;
                    const payload = {
                        src: (f.elements.src?.value || "").trim(),
                        widthPct: Number(f.elements.widthPct?.value ?? 60),
                        opacity: Number(f.elements.opacity?.value ?? 1),
                        blur: Number(f.elements.blur?.value ?? 0)
                    };
                    if (!payload.src) throw new Error("Provide an image path/URL.");

                    const broadcast = f.elements.broadcast?.checked && game.user.isGM;
                    // Persist + broadcast according to your existing show() behavior
                    this.show(payload, { broadcast, persist: true });
                    ui.notifications.info(broadcast ? "Overlay shown for everyone." : "Overlay shown.");
                }
            }, {
                action: "hideAll",
                label: "Hide Overlay (All)",
                callback: () => {
                    // Pull it down for everyone & clear the saved state
                    this.hideAll();
                    ui.notifications.info("Overlay hidden for everyone.");
                }
            }, {
                action: "cancel",
                label: "Close"
            }],
            submit: (r) => r
        });

        dlg.render(true);

        requestAnimationFrame(() => {
            const root = dlg.element instanceof jQuery ? dlg.element[0] : dlg.element;
            if (!root) return;

            // Keep dialog above the overlay
            root.style.zIndex = String(this.OVERLAY_Z + 100);

            // ✅ Wire Browse button manually (V12/V13 safe)
            const browseBtn = root.querySelector("[data-action='browse']");
            const input = root.querySelector("input[name='src']");
            if (browseBtn && input) {
                browseBtn.addEventListener("click", () => {
                    new foundry.applications.apps.FilePicker.implementation({
                        type: "image",
                        current: input.value || "assets/images/start-the-timer.webp",
                        callback: (path) => { input.value = path; }
                    }).render(true);
                });
            }
        });
    }

};

Hooks.once("init", () => {

    game.settings.register("joes-foundry-stuff", "overlayState", {
        name: "Overlay State",
        hint: "Persistent overlay info (hidden).",
        scope: "world",
        config: false,	// hidden
        type: Object,
        default: { enabled: false, payload: null }
    });

});

Hooks.once("ready", () => {

    JFS_OVERLAY.initSocket(); // Set up the socket listener for overlay commands

    // Restore persisted overlay for every client
	const state = getOverlayState();
	if (state?.enabled && state.payload) {
		// Local render only; no broadcast, no re-write
		JFS_OVERLAY._showLocal(state.payload);
	}

    DL("overlay.js | ready hook ran, socket initialized");
});

// expose helpers for console
window.JFS_OVERLAY = JFS_OVERLAY;
