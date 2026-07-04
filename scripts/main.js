import { startTimer, getRemainingTime, openTimerManager } from "./TimerAlarm.js";
import { archiveNonPinnedNow } from "./chatArchive.js";
import { jfsRollForInitiative } from "./rollInitiative.js";
import { DL } from "./settings.js";
const MOD_ID = "joes-foundry-stuff";


/* ==========================================================================
            {READY HOOK + API EXPOSURE}
========================================================================== */
// Suppress spammy "does not exist" error notifications (e.g. stale Marshal aura item refs).
// v13 Notifications.notify signature: notify(message, type, options)
// Patched on both prototype and instance in ready to cover whichever is used.
function _jfsSuppressNotify(original) {
	// If the message contains any of these substrings, it will be suppressed (not shown to the user)
	const SUPPRESSED_NOTIFICATIONS = [
		"does not exist",
		"lacks permission to update Item",
		"not found in any core collection"
	];
    return function(message, type, options) {
        if (typeof message === "string" && SUPPRESSED_NOTIFICATIONS.some(s => message.includes(s))) {
            DL("main.js | _jfsSuppressNotify(): message suppressed:]", message);
            return;
        }
        return original.call(this, message, type, options);
    };
}

Hooks.once("ready", function() {
    if (Notifications?.prototype?.notify) {
        Notifications.prototype.notify = _jfsSuppressNotify(Notifications.prototype.notify);
        console.log("[jfs] Patched Notifications.prototype.notify");
    }
    if (ui?.notifications?.notify) {
        ui.notifications.notify = _jfsSuppressNotify(ui.notifications.notify.bind(ui.notifications));
        console.log("[jfs] Patched ui.notifications instance");
    }
});

Hooks.once("ready", async () => {

    // Find or create the Compendium folder and move all Joe's packs into it
    const FOLDER_NAME = "!Joes";
    const FOLDER_COLOR = "#00ccff";
	let joesFolder = game.folders.find(f =>
		f.type === "Compendium" && f.name === FOLDER_NAME
	);

	if (!joesFolder) {
		joesFolder = await Folder.create({
			name: FOLDER_NAME,
			type: "Compendium",
			parent: null,
			color: FOLDER_COLOR
		});
	} else {
		const currentColor = (typeof joesFolder.color === "string")
			? joesFolder.color.toLowerCase()
			: "";

		if (currentColor !== FOLDER_COLOR.toLowerCase()) {
			await joesFolder.update({ color: FOLDER_COLOR });
		}
	}

	for (const pack of game.packs) {
		if (!pack.metadata?.label?.startsWith("Joe's")) continue;
		if (pack.folder?.id === joesFolder.id) continue;
		await pack.configure({ folder: joesFolder.id });
		DL(`Moved pack ${pack.metadata.label} to 'Joes' folder`);
	}

    // Expose API
    const mod = game.modules.get(MOD_ID);
    Object.assign((mod.api ??= {}), {
        startTimer,
        timerMacro: openTimerManager,
        getRemainingTime,
        archiveNonPinnedNow,
        rollForInitiative: jfsRollForInitiative
    });
    DL(`API exposed under game.modules.get("${MOD_ID}").api`);
});

/*
	Scene Directory Sidebar: Left click = VIEW scene (load it)
	Shift + Left click (GM) = PRELOAD scene
	Alt + Left click (GM) = allow CONFIG (no suppression)
	Also adds user indicators (colored initials) for who is currently viewing each scene.
*/

Hooks.once("ready", () => {
	DL("Scene sidebar click override ready");

	// Patch SceneDirectory click
	const dirProto = CONFIG?.ui?.scenes?.prototype;
	if (!dirProto?._onClickEntry) {
		DL("ERROR: Could not locate CONFIG.ui.scenes.prototype._onClickEntry");
		return;
	}

	const original = dirProto._onClickEntry;

	dirProto._onClickEntry = async function(event, ...args) {
		try {
			// Only handle left-click
			if (event?.button !== 0) return original.call(this, event, ...args);

			// Find the scene <li>
			const li = event?.target?.closest?.("li.scene");
			const sceneId = li?.dataset?.entryId;
			const scene = sceneId ? game.scenes.get(sceneId) : null;

			// If we can't resolve a scene, fall back to default behavior
			if (!scene) return original.call(this, event, ...args);

			// Ignore clicks on controls (gear, context, etc.)
			if (event.target?.closest?.(".entry-controls, .control, button, input, label, i")) {
				return original.call(this, event, ...args);
			}

			// Alt+Click (GM) = allow config (do NOT override)
			if (game.user?.isGM && event.altKey) {
				return original.call(this, event, ...args);
			}

			// Stop Foundry's default click behavior
			event.preventDefault();
			event.stopPropagation();

			// Shift+Click (GM) = PRELOAD
			if (game.user?.isGM && event.shiftKey) {
				if (typeof game?.scenes?.preload !== "function") {
					DL("PRELOAD not available (game.scenes.preload is not a function)");
					ui.notifications?.warn("Scene preload is not available on this Foundry build.");
					return;
				}

				// IMPORTANT: use the dataset entryId we pulled from the directory
				DL(`SceneDirectory shift-click: preload "${scene.name}" | sceneId=${sceneId}`);

				// Explicitly pass push=true so wrappers know this is an intentional preload and not to suppress it
				DL(`SceneDirectory shift-click: preload (push) "${scene.name}" | sceneId=${sceneId}`);
				await game.scenes.preload(sceneId, true);
				return;
			}

			// Everyone: normal click views (loads)
			DL(`SceneDirectory click: view "${scene.name}"`);
			await scene.view();
			return;

		} catch (err) {
			DL(`ERROR in SceneDirectory click override: ${err?.message ?? err}`);
			// If something goes sideways, don't brick the directory
			return original.call(this, event, ...args);
		}
	};

	DL("Patched CONFIG.ui.scenes.prototype._onClickEntry");

	// ------------------------------------------------
	// 2) Add "who is viewing this scene" indicators
	// ------------------------------------------------
	Hooks.on("renderSceneDirectory", (app, html) => {
		try {
			// v13 sometimes passes an HTMLElement instead of jQuery
			const root = (html instanceof HTMLElement) ? html : html?.[0];
			if (!root) return;

			// Remove old indicators (avoid duplicates on rerender)
			root.querySelectorAll(".jfs-scene-users").forEach(e => e.remove());

			const sceneLis = root.querySelectorAll("li.scene");
			for (const li of sceneLis) {
				const sceneId = li?.dataset?.entryId;
				const scene = sceneId ? game.scenes.get(sceneId) : null;
				if (!scene) continue;

				// Identify viewers (best-effort across versions)
				const viewers = game.users.filter(u => {
					const viewed =
						u.viewedScene ??
						u.viewedSceneId ??
						u._viewedScene ??
						u?.flags?.core?.scene;

					return u.active && (viewed === scene.id);
				});

				if (!viewers.length) continue;

				const wrap = document.createElement("div");
				wrap.className = "jfs-scene-users";
				wrap.style.display = "flex";
				wrap.style.gap = "4px";
				wrap.style.position = "absolute";
				wrap.style.right = "6px";
				wrap.style.top = "50%";
				wrap.style.transform = "translateY(-50%)";

				for (const u of viewers) {
					const badge = document.createElement("div");
					badge.title = u.name;
					badge.textContent = (u.name?.[0] ?? "?").toUpperCase();
					badge.style.width = "18px";
					badge.style.height = "18px";
					badge.style.borderRadius = "50%";
					badge.style.display = "flex";
					badge.style.alignItems = "center";
					badge.style.justifyContent = "center";
					badge.style.fontSize = "12px";
					badge.style.fontWeight = "700";
					badge.style.color = "#000";
					badge.style.background = u.color || "#999";
					badge.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.5)";
					wrap.appendChild(badge);
				}

				// Make sure the li can position absolute children
				if (!li.style.position) li.style.position = "relative";
				li.appendChild(wrap);
			}
		} catch (err) {
			DL(`ERROR in renderSceneDirectory indicators: ${err?.message ?? err}`);
		}
	});

	// Re-render Scene Directory when users change viewed scenes so the badges update
	let jfsSceneDirRerenderTimeout = null;

	function jfsRerenderSceneDirectory() {
		clearTimeout(jfsSceneDirRerenderTimeout);
		jfsSceneDirRerenderTimeout = setTimeout(() => {
			ui?.scenes?.render?.();
		}, 50);
	}

	// When any user updates (including viewed scene changes), refresh the directory
	Hooks.on("updateUser", (user, changes) => {
		// v13 commonly uses flags.core.scene or similar for "currently viewed scene"
		const touchedViewedScene =
			("viewedScene" in (changes ?? {})) ||
			("viewedSceneId" in (changes ?? {})) ||
			(changes?.flags?.core?.scene !== undefined);

		if (touchedViewedScene) jfsRerenderSceneDirectory();
	});

	// When the canvas changes to a different scene on this client, refresh badges too
	Hooks.on("canvasReady", () => {
		jfsRerenderSceneDirectory();
	});

});
