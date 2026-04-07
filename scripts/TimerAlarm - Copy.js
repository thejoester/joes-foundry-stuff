const moduleName = "joes-foundry-stuff";
const settingKey = "activeTimers";

// Global references to open windows
let TA_TIMER_MANAGER = null;
let TA_PLAYER_WINDOW = null;

// Simple ID generator using crypto or fallback
function generateTimerId() {
	return `timer-${crypto.randomUUID?.() || Math.floor(Math.random() * 1e9)}`;
}

Hooks.once("init", () => {
	// Register setting to store active timers
	game.settings.register(moduleName, settingKey, {
		name: "Active Timers",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});
});

// On ready, restore timers and setup socket listeners
Hooks.once("ready", () => {
	const mod = game.modules.get(moduleName);
	mod.api ??= {};

	mod.api.startTimer = startTimer;
	mod.api.timerMacro = timerMacro;
	mod.api.getRemainingTime = getRemainingTime;
	mod.api.openTimerManager = openTimerManager;

	const timers = game.settings.get(moduleName, settingKey) || {};
	const now = Date.now();

	for (const [id, timer] of Object.entries(timers)) {
		if (timer.endTime > now) {
			setTimeout(() => onTimerEnd(id), timer.endTime - now);
		}
	}

	game.socket.on(`module.${moduleName}`, (data) => {
		if (!data?.action) return;

		if (data.action === "taPlayerTimersOpen") {
			ta_openPlayerTimerWindow();
			return;
		}

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

});

// Start a new timer
export async function startTimer(title, minutes, showToPlayers = true) {

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

	// Refresh GM manager if it's open
	if (TA_TIMER_MANAGER?.rendered) TA_TIMER_MANAGER._taUpdate();

	// Tell all clients to open/refresh player window
	game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });
	game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });

	setTimeout(() => onTimerEnd(id), minutes * 60_000);
}

// Handle timer end
async function onTimerEnd(id) {
	const timers = game.settings.get(moduleName, settingKey) || {};
	const timer = timers[id];
	if (!timer || timer.endTime > Date.now()) return;

	// ✅ Only show dialog if this user created it
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
					await startTimer(timer.title, timer.minutes);
				}
			},
			{
				action: "stop",
				label: "Stop Timer",
				callback: async () => {
					delete timers[id];
					await game.settings.set(moduleName, settingKey, timers);
				}
			}
		]
	}).render(true);
}

// Open timer management macro
export async function timerMacro() {
	const timers = game.settings.get(moduleName, settingKey) || {};
	const now = Date.now();

	const timerList = Object.values(timers).length
		? Object.values(timers)
			.map(t => {
				const remaining = t.endTime - now;
				if (remaining <= 0) return "";
				const mins = Math.floor(remaining / 60000);
				const secs = Math.floor((remaining % 60000) / 1000);
				return `
					<div style="display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 0.5em; margin-bottom: 6px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03);">
						<div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
							<strong>${t.title}</strong> – ${mins}m ${secs}s remaining
						</div>
						<button type="button" data-chat="${t.id}" title="Send to Chat"
							style="background: none; border: none; font-size: 1.1em; cursor: pointer; color: #88f;">
							<i class="fas fa-comment-alt"></i>
						</button>
						<button type="button" data-id="${t.id}" title="Cancel Timer"
							style="background: none; border: none; color: #ff5555; font-size: 1.1em; cursor: pointer;">
							<i class="fas fa-trash"></i>
						</button>
					</div>`;
			})
			.join("")
		: "<p>No active timers.</p>";

	const dialog = new foundry.applications.api.DialogV2({
		window: { title: "Manage Timers" },
		content: `
			<form>
				<div style="margin-bottom: 1em;">
					${timerList}
				</div>
				<hr style="opacity: 0.2; margin: 10px 0;">
				<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.75em; align-items: end; margin-top: 8px;">
					<div style="display: flex; flex-direction: column;">
						<label for="title" style="font-size: 0.85em; margin-bottom: 2px;">Title</label>
						<input type="text" name="title" id="title" placeholder="Timer name"
							style="padding: 4px; border-radius: 4px; max-width: 220px;" value="Hero Points Timer">
					</div>
					<div style="display: flex; flex-direction: column;">
						<label for="minutes" style="font-size: 0.85em; margin-bottom: 2px;">Minutes</label>
						<input type="number" name="minutes" id="minutes" placeholder="Minutes" min="1"
							style="padding: 4px; border-radius: 4px; max-width: 100px;" value="60">
					</div>
				</div>
			</form>
		`,
		buttons: [
			{
				action: "add",
				label: "Add Timer",
				default: true,
				callback: async (event, button, dialog) => {
					const form = button.form;
					const title = form.title.value.trim();
					const minutes = parseInt(form.minutes.value, 10);
					if (!title || isNaN(minutes) || minutes < 1) {
						ui.notifications.warn("Please enter valid title and minutes.");
						return;
					}
					await startTimer(title, minutes);
				}
			}
		]
	});

	// Use hook to bind button events after actual DOM is rendered
	Hooks.once("renderDialogV2", (app, html) => {
		// 🗑 Cancel timer
		html.querySelectorAll("button[data-id]").forEach(btn => {
			btn.addEventListener("click", async () => {
				const id = btn.dataset.id;
				const timers = game.settings.get(moduleName, settingKey) || {};
				delete timers[id];
				await game.settings.set(moduleName, settingKey, timers);
				ui.notifications.info("⛔ Timer cancelled.");
				app.close();
				timerMacro(); // Re-render dialog
			});
		});

		// 💬 Send to chat
		html.querySelectorAll("button[data-chat]").forEach(btn => {
			btn.addEventListener("click", () => {
				const id = btn.dataset.chat;
				const timers = game.settings.get(moduleName, settingKey) || {};
				const t = timers[id];
				if (!t) return;

				const remaining = Math.max(0, t.endTime - Date.now());
				const mins = Math.floor(remaining / 60000).toString().padStart(2, "0");
				const secs = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
				const message = `🕒 ${mins}:${secs} left on **${t.title}** timer!`;

				ChatMessage.create({ content: message });
			});
		});
	});

	dialog.render(true);
}

// Open GM Timer Manager window
export function openTimerManager() {
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
			width: 360,
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
		const timers = Object.values(game.settings.get(moduleName, settingKey) || {})
			.filter(t => t.endTime > now)
			.sort((a, b) => a.endTime - b.endTime);

		const listEl = root.querySelector("[data-ta-list]");
		if (!listEl) return;

		if (!timers.length) {
			listEl.innerHTML = `<div style="opacity:0.8;">No active timers.</div>`;
			return;
		}

		listEl.innerHTML = timers.map(t => {
			const remaining = Math.max(0, t.endTime - now);
			const totalSeconds = Math.floor(remaining / 1000);
			const mins = Math.floor(totalSeconds / 60);
			const secs = totalSeconds % 60;

			return `
				<div style="display:grid; grid-template-columns: 1fr auto auto; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.08);">
					<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
						<strong>${t.title}</strong>
						${t.showToPlayers === false ? `<span style="opacity:0.75; font-size:0.9em;"> (GM only)</span>` : ``}
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

						<button type="button" data-ta-cancel="${t.id}" title="Cancel Timer"
							style="background:none; border:none; cursor:pointer; font-size:1.1em; color:#ff5555;">
							<i class="fas fa-trash"></i>
						</button>
					</div>
				</div>
			`;
		}).join("");

		// Cancel timer
		listEl.querySelectorAll("button[data-ta-cancel]").forEach(btn => {
			btn.addEventListener("click", async () => {
				const id = btn.getAttribute("data-ta-cancel");
				const timers = game.settings.get(moduleName, settingKey) || {};
				delete timers[id];
				await game.settings.set(moduleName, settingKey, timers);

				// Refresh player window if open
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });

				this._taUpdate();
			});
		});

		// Send timer to chat
		listEl.querySelectorAll("button[data-ta-chat]").forEach(btn => {
			btn.addEventListener("click", () => {
				const id = btn.getAttribute("data-ta-chat");
				const timers = game.settings.get(moduleName, settingKey) || {};
				const t = timers[id];
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
				const timers = game.settings.get(moduleName, settingKey) || {};
				const t = timers[id];
				if (!t) return;

				t.showToPlayers = !t.showToPlayers;
				await game.settings.set(moduleName, settingKey, timers);

				// Tell clients to refresh their view
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersRefresh" });
				game.socket.emit(`module.${moduleName}`, { action: "taPlayerTimersOpen" });

				this._taUpdate();
			});
		});
	}

}

// Open player timer window
function ta_openPlayerTimerWindow() {
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

		// Position top-center on first render (player view)
		if (!this._taPositioned) {
			this._taPositioned = true;
			try {
				const width = this.position.width ?? 260;
				const left = Math.floor((window.innerWidth / 2) - (width / 2));
				const top = 60;
				this.setPosition({ left, top });
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

		const btnClose = this.element.querySelector("[data-ta-close]");
		if (btnClose) btnClose.addEventListener("click", () => this.close());

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
		const all = Object.values(game.settings.get(moduleName, settingKey) || {});
		const visible = all
			.filter(t => t.endTime > now)
			.filter(t => game.user.isGM || t.showToPlayers)
			.sort((a, b) => a.endTime - b.endTime);

		const listEl = root.querySelector("[data-ta-list]");
		if (!listEl) return;

		if (!visible.length) {
			listEl.innerHTML = `<div style="opacity:0.8;">No active timers.</div>`;
			return;
		}

		// Reserve space on the right so content never goes under the corner X button
		listEl.style.paddingRight = "34px";

		listEl.innerHTML = visible.map((t, idx) => {
			const remaining = Math.max(0, t.endTime - now);
			const totalSeconds = Math.floor(remaining / 1000);
			const mins = Math.floor(totalSeconds / 60);
			const secs = totalSeconds % 60;

			return `
				<div style="
					display:grid;
					grid-template-columns: 1fr auto;
					gap: 10px;
					align-items:center;
					padding: ${idx === 0 ? "2px" : "4px"} 0;
					${idx === 0 ? "" : "border-top:1px solid rgba(255,255,255,0.08);"}
				">
					<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><strong>${t.title}</strong></div>
					<div style="white-space:nowrap;">${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}</div>
				</div>
			`;
		}).join("");

		// Tighten height to content
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