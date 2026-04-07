import { DL } from "./settings.js"; // debug logger

const moduleName = "joes-foundry-stuff";
const settingKey = "activeTimers";
const playerPosKey = "playerTimerWindowPos";

// Global references to open windows
let TA_TIMER_MANAGER = null;
let TA_PLAYER_WINDOW = null;
let TA_PLAYER_STYLES_INJECTED = false;

// Inject player timer styles to flash red when expired
function ta_injectPlayerTimerStyles() {
	if (TA_PLAYER_STYLES_INJECTED) return; // Only inject once per client session
	TA_PLAYER_STYLES_INJECTED = true;

	const style = document.createElement("style");
	style.id = "ta-player-timer-styles";
	style.textContent = `
		.ta-timer-ended {
			animation: taEndedFlash 20s linear infinite;
		}

		/* 1s red, 1s normal, repeat */
		@keyframes taEndedFlash {
			0%, 49.999% {
				background: rgba(255, 0, 0, 0.45);
			}
			50%, 100% {
				background: transparent;
			}
		}
	`;
	document.head.appendChild(style);
	DL("TimerAlarm.js | ta_injectPlayerTimerStyles: Injected player timer styles");
}

// Simple ID generator using crypto or fallback
function generateTimerId() {
	DL("TimerAlarm.js | generateTimerId(): Generating new timer ID");
	return `timer-${crypto.randomUUID?.() || Math.floor(Math.random() * 1e9)}`;
}

// On ready, restore timers and setup socket listeners
Hooks.once("ready", () => {
	const mod = game.modules.get(moduleName);
	mod.api ??= {};

	mod.api.startTimer = startTimer;
	mod.api.timerMacro = openTimerManager; // legacy name, still supported
	mod.api.getRemainingTime = getRemainingTime;
	mod.api.openTimerManager = openTimerManager;

	const timers = game.settings.get(moduleName, settingKey) || {}; 

	// Schedule timeouts for existing timers that haven't expired yet
	for (const [id, timer] of Object.entries(timers)) {
		const now = Date.now();
		if (timer.endTime > now) {
			setTimeout(() => onTimerEnd(id), timer.endTime - now);
		}
	}

	// Listen for socket messages to open/refresh player timer windows
	game.socket.on(`module.${moduleName}`, (data) => {
		if (!data?.action) return; // Ignore messages without an action

		// Open player timer window on demand
		if (data.action === "taPlayerTimersOpen") {
			ta_openPlayerTimerWindow();
			return;
		}

		// Refresh player windows (GM and players) when timers change
		if (data.action === "taPlayerTimersRefresh") { 
			if (TA_PLAYER_WINDOW?.rendered) TA_PLAYER_WINDOW._taUpdate();
			return;
		}
	});

	// If timers already exist when a client loads, show the player window
	// (GM sees all, players only see showToPlayers timers)
	{
		const timers = game.settings.get(moduleName, settingKey) || {};
		const now = Date.now();

		const hasVisibleTimers = Object.values(timers).some(t => t.endTime > now && (game.user.isGM || t.showToPlayers));
		if (hasVisibleTimers) {
			ta_openPlayerTimerWindow();
		}
	}
	DL("TimerAlarm.js | Ready hook completed, timers restored, socket listeners set up");
});

// Start a new timer
export async function startTimer(title, minutes, showToPlayers = true) {
	DL("TimerAlarm.js | startTimer() called with", { title, minutes, showToPlayers });
	// GM only
	if (!game.user.isGM) {
		ui.notifications.warn("Only the GM can start timers.");
		return;
	}

	const id = generateTimerId();
	const now = Date.now();
	const endTime = now + minutes * 60_000;

	const timerData = {
		id,
		title,
		showToPlayers: !!showToPlayers,
		endTime,
		createdAt: now,
		minutes,
		createdBy: game.user.id
	};

	const timers = game.settings.get(moduleName, settingKey) || {};
	timers[id] = timerData;
	await game.settings.set(moduleName, settingKey, timers);

	ui.notifications.info(`⏱ Timer set for ${minutes}m: "${title}"`);

	// Also show the player window for the GM immediately
	ta_openPlayerTimerWindow();

	// Refresh GM manager if it's open
	if (TA_TIMER_MANAGER?.rendered) TA_TIMER_MANAGER._taUpdate();

	// Tell all clients to open/refresh player window
	game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });
	game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });

	setTimeout(() => onTimerEnd(id), minutes * 60_000);
}

// Handle timer end
async function onTimerEnd(id) {
	DL("TimerAlarm.js | onTimerEnd() called for timer ID:", id);
	const timers = game.settings.get(moduleName, settingKey) || {};
	const timer = timers[id];
	if (!timer || timer.endTime > Date.now()) return;

	// Only show dialog if this user created it
	if (timer.createdBy !== game.user.id) return;

	AudioHelper.play({
		src: "modules/joes-foundry-stuff/assets/sound/bonus.mp3",
		volume: 0.8,
		autoplay: true,
		loop: false
	});

	new foundry.applications.api.DialogV2({
		window: { title: "Timer Ended" },
		content: `<p>⏳ <strong>${timer.title}</strong></p><p>The timer is complete.</p>`,
		buttons: [
			{
				action: "restart",
				label: "Restart Timer",
				default: true,
				callback: async () => {
					DL("TimerAlarm.js | Restarting timer ID:", id);
					const timers2 = game.settings.get(moduleName, settingKey) || {};
					const t2 = timers2[id];
					if (!t2) return;

					const now = Date.now();
					t2.createdAt = now;
					t2.endTime = now + (t2.minutes * 60_000);

					await game.settings.set(moduleName, settingKey, timers2);

					// Refresh GM manager if it's open
					if (TA_TIMER_MANAGER?.rendered) TA_TIMER_MANAGER._taUpdate();

					// Make sure GM also sees player window
					ta_openPlayerTimerWindow();

					// Tell all clients to refresh/open player window
					game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });
					game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });

					// Schedule the new end
					setTimeout(() => onTimerEnd(id), t2.endTime - now);
				}
			},
			{
				action: "stop",
				label: "Stop Timer",
				callback: async () => {
					DL("TimerAlarm.js | Stopping timer ID:", id);
					const timers2 = game.settings.get(moduleName, settingKey) || {};
					delete timers2[id];
					await game.settings.set(moduleName, settingKey, timers2);

					// Refresh GM manager if it's open
					if (TA_TIMER_MANAGER?.rendered) TA_TIMER_MANAGER._taUpdate();

					// Refresh player windows too
					game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });
				}
			}
		]
	}).render(true);
}

// Open GM Timer Manager window
export function openTimerManager() {
	DL("TimerAlarm.js | openTimerManager() called");
	if (!game.user.isGM) {
		ui.notifications.warn("Only the GM can open the Timer Manager.");
		return;
	}

	if (!TA_TIMER_MANAGER) TA_TIMER_MANAGER = new TA_TimerManagerApp();

	TA_TIMER_MANAGER.render(true);

	// Center using the REAL rendered height (auto height lies until after DOM exists)
	setTimeout(() => {
		try {
			const el = TA_TIMER_MANAGER.element;
			if (!el) return;

			const rect = el.getBoundingClientRect();
			const width = rect.width || (TA_TIMER_MANAGER.position.width ?? 360);
			const height = rect.height || 260;

			const left = Math.floor((window.innerWidth / 2) - (width / 2));
			const top = Math.floor((window.innerHeight / 2) - (height / 2));

			TA_TIMER_MANAGER.setPosition({
				left: Math.max(10, left),
				top: Math.max(10, top)
			});
		} catch (e) {}
	}, 0);
}

// GM Timer Manager window
class TA_TimerManagerApp extends foundry.applications.api.ApplicationV2 {

	static DEFAULT_OPTIONS = {
		id: "ta-timer-manager",
		classes: ["ta-timer-manager"],
		window: {
			title: "Timer Manager",
			resizable: false,
			minimizable: true
		},
		position: {
			width: 440, // +80px so text + buttons stop fighting each other
			height: "auto"
		}
	};

	_taInterval = null;

	async _renderHTML(context, options) {
		const el = document.createElement("div");
		el.style.cssText = `
			padding: 10px;
			font-variant-numeric: tabular-nums;
		`;

		el.innerHTML = `
			<form data-ta-form style="display:grid; grid-template-columns: 1fr 90px; gap: 8px; align-items:end;">
				<div style="display:flex; flex-direction:column;">
					<label style="font-size: 0.85em; margin-bottom: 2px;">Timer Name</label>
					<input type="text" name="title" value="Hero Points Timer" style="padding:4px; border-radius:4px;">
				</div>

				<div style="display:flex; flex-direction:column;">
					<label style="font-size: 0.85em; margin-bottom: 2px;">Minutes</label>
					<input type="number" name="minutes" value="60" min="1" style="padding:4px; border-radius:4px;">
				</div>

				<div style="grid-column: 1 / span 2; display:flex; gap:10px; align-items:center; margin-top:6px;">
					<label style="display:flex; align-items:center; gap:6px; font-size:0.9em;">
						<input type="checkbox" name="showToPlayers" checked>
						Show to Players
					</label>

					<button type="button" data-ta-openplayers style="margin-left:auto;">
						Open Player Window
					</button>

					<button type="submit">
						Add Timer
					</button>
				</div>
			</form>

			<hr style="opacity: 0.2; margin: 10px 0;">

			<div data-ta-list></div>
		`;

		return el;
	}

	_replaceHTML(result, content, options) {

		// result is whatever _renderHTML returned; for us it should be an HTMLElement.
		// content is the application's content container (HTMLElement).
		content.innerHTML = "";

		if (result instanceof HTMLElement) {
			content.append(result);
			return;
		}

		// Fallbacks, just in case someone changes _renderHTML later
		if (result instanceof DocumentFragment) {
			content.append(result);
			return;
		}

		if (typeof result === "string") {
			content.innerHTML = result;
			return;
		}

		// If we got here, your _renderHTML returned something weird.
		console.error("TA_TimerManagerApp._replaceHTML(): Unexpected render result", result);
	}

	_onRender(context, options) {
		super._onRender(context, options);

		// Reset any header hacks so the GM window is draggable normally
		try {
			const header = this.window?.header;
			if (header) {
				header.style.position = "";
				header.style.top = "";
				header.style.left = "";
				header.style.right = "";
				header.style.height = "";
				header.style.minHeight = "";
				header.style.maxHeight = "";
				header.style.padding = "";
				header.style.margin = "";
				header.style.border = "";
				header.style.opacity = "";
				header.style.overflow = "";
				header.style.zIndex = "";
				header.style.pointerEvents = "";

				// Make sure header buttons are not hidden for GM manager
				header.querySelectorAll("button").forEach(b => b.style.display = "");
			}
		} catch (e) {}

		const form = this.element.querySelector("[data-ta-form]");
		form.addEventListener("submit", async (ev) => {
			ev.preventDefault();

			const title = (form.elements.title?.value ?? "").trim();
			const minutes = parseInt(form.elements.minutes?.value ?? "0", 10);
			const showToPlayers = !!form.elements.showToPlayers?.checked;

			if (!title || isNaN(minutes) || minutes < 1) {
				ui.notifications.warn("Please enter a valid timer name and minutes.");
				return;
			}

			await startTimer(title, minutes, showToPlayers);
			this._taUpdate();
		});

		// Open Player Window button
		const btnOpenPlayers = this.element.querySelector("[data-ta-openplayers]");
		if (btnOpenPlayers) {
			btnOpenPlayers.addEventListener("click", () => {

				const timers = game.settings.get(moduleName, settingKey) || {};
				const now = Date.now();
				const hasVisible = Object.values(timers).some(t => t.endTime > now && t.showToPlayers);

				if (!hasVisible) {
					ui.notifications.warn("No active timers are marked 'Show to Players'.");
					return;
				}

				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });
				
				// GM should also open it locally
				ta_openPlayerTimerWindow();
			});
		}

		this._taUpdate();

		if (!this._taInterval) {
			this._taInterval = setInterval(() => this._taUpdate(), 1000);
		}
	}

	close(options) {
		if (this._taInterval) {
			clearInterval(this._taInterval);
			this._taInterval = null;
		}
		return super.close(options);
	}

	_taUpdate() {
		const root = this.element;
		if (!root) return;

		const now = Date.now();

		// Reuse same flashing style for GM too
		ta_injectPlayerTimerStyles();

		const timers = Object.values(game.settings.get(moduleName, settingKey) || {})
			// show all timers (including expired) so GM can clean them up
			.sort((a, b) => a.endTime - b.endTime);

		const listEl = root.querySelector("[data-ta-list]");
		if (!listEl) return;

		if (!timers.length) {
			listEl.innerHTML = `<div style="opacity:0.8;">No timers.</div>`;
			return;
		}

		listEl.innerHTML = timers.map(t => {
			const remainingRaw = t.endTime - now;
			const ended = remainingRaw <= 0;

			const totalSeconds = Math.max(0, Math.floor(remainingRaw / 1000));
			const mins = Math.floor(totalSeconds / 60);
			const secs = totalSeconds % 60;

			return `
				<div class="${ended ? "ta-timer-ended" : ""}"
					style="display:grid; grid-template-columns: 1fr auto auto; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.08); border-radius:6px;">
					<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-left:2px;">
						<strong>${t.title}</strong>
						${t.showToPlayers === false ? `<span style="opacity:0.75; font-size:0.9em;"> (GM only)</span>` : ``}
						${ended ? `<span style="opacity:0.85; font-size:0.9em;"> (ENDED)</span>` : ``}
					</div>

					<div style="white-space:nowrap;">
						${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}
					</div>

					<div style="display:flex; gap:8px; align-items:center;">
						<button type="button" data-ta-toggle="${t.id}" title="${t.showToPlayers === false ? "Show players" : "Hide from players"}"
							style="background:none; border:none; cursor:pointer; font-size:1.1em; color:${t.showToPlayers === false ? "#aaa" : "#8f8"};">
							<i class="fas fa-users"></i>
						</button>

						<button type="button" data-ta-chat="${t.id}" title="Send to Chat"
							style="background:none; border:none; cursor:pointer; font-size:1.1em; color:#88f;">
							<i class="fas fa-comment-alt"></i>
						</button>

						<button type="button" data-ta-cancel="${t.id}" title="Delete Timer"
							style="background:none; border:none; cursor:pointer; font-size:1.1em; color:#ff5555;">
							<i class="fas fa-trash"></i>
						</button>
					</div>
				</div>
			`;
		}).join("");

		// Delete timer (active or expired)
		listEl.querySelectorAll("button[data-ta-cancel]").forEach(btn => {
			btn.addEventListener("click", async () => {
				const id = btn.getAttribute("data-ta-cancel");
				const timersObj = game.settings.get(moduleName, settingKey) || {};
				delete timersObj[id];
				await game.settings.set(moduleName, settingKey, timersObj);

				// Refresh player windows
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });

				this._taUpdate();
			});
		});

		// Send timer to chat (00:00 if expired)
		listEl.querySelectorAll("button[data-ta-chat]").forEach(btn => {
			btn.addEventListener("click", () => {
				const id = btn.getAttribute("data-ta-chat");
				const timersObj = game.settings.get(moduleName, settingKey) || {};
				const t = timersObj[id];
				if (!t) return;

				const remaining = Math.max(0, t.endTime - Date.now());
				const mins = Math.floor(remaining / 60000).toString().padStart(2, "0");
				const secs = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");

				ChatMessage.create({
					content: `🕒 ${mins}:${secs} left on <strong>${t.title}</strong> timer!`
				});
			});
		});

		// Toggle showToPlayers
		listEl.querySelectorAll("button[data-ta-toggle]").forEach(btn => {
			btn.addEventListener("click", async () => {
				const id = btn.getAttribute("data-ta-toggle");
				const timersObj = game.settings.get(moduleName, settingKey) || {};
				const t = timersObj[id];
				if (!t) return;

				t.showToPlayers = !t.showToPlayers;
				await game.settings.set(moduleName, settingKey, timersObj);

				// Tell clients to refresh and open if needed
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });

				this._taUpdate();
			});
		});
	}
}

// Open player timer window
function ta_openPlayerTimerWindow() {
	DL("TimerAlarm.js | ta_openPlayerTimerWindow() called");
	if (!TA_PLAYER_WINDOW) TA_PLAYER_WINDOW = new TA_PlayerTimerWindowApp();
	TA_PLAYER_WINDOW.render(true);
}

// Player timer window
class TA_PlayerTimerWindowApp extends foundry.applications.api.ApplicationV2 {

	static DEFAULT_OPTIONS = {
		id: "ta-player-timers",
		classes: ["ta-player-timers"],
		window: {
			title: "",
			resizable: false,
			minimizable: false
		},
		position: {
			width: 260,
			height: "auto"
		}
	};

	_taInterval = null;

	async _renderHTML(context, options) {
		const el = document.createElement("div");
		el.style.cssText = `
			padding: 8px 10px 6px 10px;
			font-variant-numeric: tabular-nums;
		`;

		el.innerHTML = `
			<div data-ta-list></div>
		`;

		return el;
	}

	_replaceHTML(result, content, options) {
		content.innerHTML = "";
		content.append(result);
	}

	_onRender(context, options) {
		super._onRender(context, options);

		// Restore saved position on first render; otherwise default top-center
		if (!this._taPositioned) {
			this._taPositioned = true;

			try {
				const saved = game.settings.get(moduleName, playerPosKey);
				if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
					this.setPosition({ left: saved.left, top: saved.top });
				} else {
					const width = this.position.width ?? 260;
					const left = Math.floor((window.innerWidth / 2) - (width / 2));
					const top = 60;
					this.setPosition({ left, top });
				}
			} catch (e) {}
		}

		// Player window: header stays for dragging, but we only show our corner close button
		try {
			const header = this.window?.header;
			if (header) {
				// Make the header a thin draggable strip, but NOT invisible
				header.style.position = "absolute";
				header.style.top = "0";
				header.style.left = "0";
				header.style.right = "0";
				header.style.height = "14px";
				header.style.minHeight = "14px";
				header.style.maxHeight = "14px";
				header.style.padding = "0";
				header.style.margin = "0";
				header.style.border = "0";
				header.style.background = "transparent";
				header.style.boxShadow = "none";
				header.style.overflow = "visible";
				header.style.pointerEvents = "auto";
				header.style.zIndex = "50";
				header.style.opacity = "1";

				// Remove everything in the header so only our button remains
				header.innerHTML = "";

				// Add the close button in the true window corner
				const btn = document.createElement("button");
				btn.type = "button";
				btn.title = "Close";
				btn.textContent = "X";
				btn.style.cssText = `
					position: absolute;
					top: 6px;
					right: 6px;
					width: 26px;
					height: 26px;
					line-height: 24px;
					border-radius: 6px;
					padding: 0;
					pointer-events: auto;
					z-index: 999;
				`;
				btn.addEventListener("click", () => this.close());
				header.appendChild(btn);

				// Save position when drag ends (mouseup/touchend)
				if (!this._taPosBound) {
					this._taPosBound = true;

					const savePos = async () => {
						try {
							const left = this.position?.left;
							const top = this.position?.top;
							if (!Number.isFinite(left) || !Number.isFinite(top)) return;
							await game.settings.set(moduleName, playerPosKey, { left, top });
						} catch (e) {}
					};

					header.addEventListener("mouseup", savePos);
					header.addEventListener("touchend", savePos, { passive: true });
				}
			}
		} catch (e) {}

		// Remove top spacing that assumes a visible header
		try {
			const content = this.window?.content;
			if (content) {
				content.style.paddingTop = "0";
				content.style.marginTop = "0";
			}
		} catch (e) {}

		this._taUpdate();

		if (!this._taInterval) {
			this._taInterval = setInterval(() => this._taUpdate(), 1000);
		}
	}

	close(options) {
		if (this._taInterval) {
			clearInterval(this._taInterval);
			this._taInterval = null;
		}
		return super.close(options);
	}

	// Update timer list
	_taUpdate() {
		const root = this.element;
		if (!root) return;

		const now = Date.now();

		// Inject flashing styles once
		ta_injectPlayerTimerStyles();

		const all = Object.values(game.settings.get(moduleName, settingKey) || {});
		const visible = all
			.filter(t => game.user.isGM || t.showToPlayers)
			.sort((a, b) => a.endTime - b.endTime);

		const listEl = root.querySelector("[data-ta-list]");
		if (!listEl) return;

		if (!visible.length) {
			listEl.innerHTML = `<div style="opacity:0.8;">No active timers.</div>`;
			return;
		}

		// Reserve space so content never goes under the close button
		listEl.style.paddingRight = "34px";

		listEl.innerHTML = visible.map((t, idx) => {
			const remaining = t.endTime - now;
			const ended = remaining <= 0;

			const totalSeconds = Math.max(0, Math.floor(remaining / 1000));
			const mins = Math.floor(totalSeconds / 60);
			const secs = totalSeconds % 60;

			return `
				<div
					class="${ended ? "ta-timer-ended" : ""}"
					style="
						display:grid;
						grid-template-columns: 1fr auto;
						gap:10px;
						align-items:center;
						padding:${idx === 0 ? "2px" : "4px"} 0;
						${idx === 0 ? "" : "border-top:1px solid rgba(255,255,255,0.08);"}
					"
				>
					<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
						<strong>${t.title}</strong>
					</div>
					<div style="white-space:nowrap;">
						${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}
					</div>
				</div>
			`;
		}).join("");

		// Tighten window height to content
		try {
			const content = this.window?.content;
			if (content) {
				const h = Math.max(50, Math.ceil(content.scrollHeight) - 6);
				this.setPosition({ height: h });
			}
		} catch (e) {}
	}
}

// Returns array of {id, title, remaining, minutes} for active timers
export function getRemainingTime() {
	DL("TimerAlarm.js | getRemainingTime() called");
	const timers = game.settings.get(moduleName, settingKey) || {};
	const now = Date.now();

	return Object.values(timers)
		.map(timer => {
			const remaining = timer.endTime - now;
			return {
				id: timer.id,
				title: timer.title,
				remaining,
				minutes: timer.minutes
			};
		})
		.filter(t => t.remaining > 0);
}