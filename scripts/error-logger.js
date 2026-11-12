import { DL } from './settings.js';
console.log("%cJoe's Foundry Stuff | error-logger.js loaded","color: yellow; font-weight: bold;");

Hooks.once("ready", async () => {

	// Check settings
	const enableErrorLogs = game.settings.get("joes-foundry-stuff", "enableErrorLogs");
	const enableConnectionLogs = game.settings.get("joes-foundry-stuff", "enableConnectionLogs");
	DL(`enableErrorLogs: ${enableErrorLogs} | enableConnectionLogs: ${enableConnectionLogs}`);
	if (!enableErrorLogs && !enableConnectionLogs) return;

	// GM: ensure the "Error Logs" journal exists and all players have OWNER write permission
	if (game.user.isGM) {
		let journal = game.journal.find(j => j.name === "Error Logs");
		if (!journal) journal = await JournalEntry.create({ name: "Error Logs", pages: [] });
		const ownership = journal.ownership ?? {};
		for (const user of game.users.contents) {
			if (!user.isGM) ownership[user.id] = 3; // OWNER permission
		}
		await journal.update({ ownership });
	}

	// Append a timestamped line to the current player's own page in the Error Logs journal.
	const writeToJournal = async (type, message) => {
		// message may not be a string (pf2e and others pass objects/errors)
		const msg = typeof message === "string" ? message : String(message ?? "");
		const journalName = "Error Logs";
		const pageName = game.user.name;

		let journal = game.journal.find(j => j.name === journalName);
		if (!journal) return;

		let page = journal.pages.find(p => p.name === pageName);
		let content = "";

		if (page) {
			content = page.text?.content || "";
		} else {
			page = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: pageName, type: "text", text: { content: "" } }]);
			page = page[0];
		}

		const timestamp = new Date().toLocaleString();
		const newLine = `[${timestamp}] (${type.toUpperCase()}) ${game.user.name}: ${msg}`;
		content += `\n${newLine}`;

		// Check for ID inside brackets and try to resolve it
		const idMatch = msg.match(/(?:\[|")([a-zA-Z0-9]{16})(?:\]|")/);
		if (idMatch) {
			const id = idMatch[1];
			let found = null;
			for (const collection of [game.actors, game.items, game.scenes, game.combats, game.journal, game.messages, game.tables, game.macros, game.playlists, game.users]) {
				found = collection.get(id);
				if (found) break;
			}
			if (found) {
				content += `\n  ↳ ID [${id}] resolved to: ${found.name || found.constructor.name}`;
			} else {
				// Settings live in their own store, not a document collection; check it too
				let settingDoc = null;
				try {
					settingDoc = game.settings.storage.get("world")?.get?.(id)
						?? game.settings.storage.get("world")?.find?.(d => d.id === id);
				} catch { /* store shape varies by core version */ }
				if (settingDoc?.key) {
					content += `\n  ↳ ID [${id}] resolved to Setting: ${settingDoc.key}`;
				} else {
					content += `\n  ↳ ID [${id}] not found in any core collection.`;
				}
			}
		}

		await page.update({ "text.content": `<pre>${content}</pre>` });
	};

	/* ==========================================================================
		{ERROR LOGGING - wrap notifications + settings.set}
	========================================================================== */
	if (enableErrorLogs) {

		const captureAndWrite = (originalFunc, type) => {
			return function (message, ...args) {
				Promise.resolve(writeToJournal(type, message)).catch(err => DL(`error-logger writeToJournal failed: ${err}`));
				return originalFunc.call(this, message, ...args);
			};
		};

		ui.notifications.error = captureAndWrite(ui.notifications.error, 'error');
		ui.notifications.warn = captureAndWrite(ui.notifications.warn, 'warning');

		// Wrap settings.set so a failed write names the exact setting + scope.
		// The core permission error only carries the new (never-created) Setting
		// doc id, which resolves to nothing; this captures the key at throw time.
		if (!game.settings.__jfsSetWrapped) {
			const _origSet = game.settings.set.bind(game.settings);
			game.settings.set = async function (namespace, key, value, options) {
				try {
					return await _origSet(namespace, key, value, options);
				} catch (err) {
					try {
						const cfg = game.settings.settings.get(`${namespace}.${key}`);
						let preview = "";
						try { preview = JSON.stringify(value); } catch { preview = String(value); }
						if (preview.length > 200) preview = preview.slice(0, 200) + "…";
						const detail = `settings.set failed: "${namespace}.${key}" (scope=${cfg?.scope ?? "unregistered"}) value=${preview} — ${err?.message ?? err}`;
						Promise.resolve(writeToJournal("error", detail)).catch(e => DL(`error-logger settings.set capture failed: ${e}`));
					} catch (e) {
						DL(`error-logger settings.set wrap failed: ${e}`);
					}
					throw err; // preserve original behavior for callers
				}
			};
			game.settings.__jfsSetWrapped = true;
			DL("error-logger: wrapped game.settings.set for failure capture");
		}

		// Expose helpers globally
		game.joesFoundryStuff ??= {};

		game.joesFoundryStuff.getCapturedLogs = async () => {
			const journal = game.journal.find(j => j.name === "Error Logs");
			if (!journal) return [];
			const page = journal.pages.find(p => p.name === game.user.name);
			if (!page) return [];
			const text = page.text?.content || "";
			return text.replace(/<[^>]+>/g, '').split('\n').filter(line => line.trim());
		};

		game.joesFoundryStuff.clearCapturedLogs = async () => {
			const PERMS = {
				NONE: 0,
				LIMITED: 1,
				OBSERVER: 2,
				OWNER: 3
			};

			const journal = game.journal.find(j => j.name === "Error Logs");

			if (game.user.isGM) {
				if (journal) await journal.delete();

				// Grant OWNER to all non-GM users
				const ownership = {
					default: PERMS.NONE,
					[game.user.id]: PERMS.OWNER // GM
				};
				for (const user of game.users) {
					if (!ownership[user.id]) {
						ownership[user.id] = PERMS.OWNER;
					}
				}

				await JournalEntry.create({
					name: "Error Logs",
					ownership
				});

				ui.notifications.info("Error Logs journal reset. Players will have write access.");
			}
		};
	}

	/* ==========================================================================
		{CONNECTION LOGGING - socket blips, one shared page via the GM}
	========================================================================== */
	if (enableConnectionLogs) {
		const SOCKET_NS = "module.joes-foundry-stuff";
		const CONN_PAGE = "Connection Log";
		const s = game.socket;

		// Every client's lines funnel through the primary GM, so one shared page
		// stays chronological and read-modify-write never clobbers a simultaneous blip.
		const isWriter = () => game.user === game.users.activeGM;

		// Read live, not cached: socket.io rebuilds the engine on every reconnect.
		const transportName = () => {
			try { return game.socket.io.engine.transport.name; } catch { return "?"; }
		};

		// GM-side serialized append to the single shared "Connection Log" page.
		let writeChain = Promise.resolve();
		const appendConnLog = async (text) => {
			const journal = game.journal.find(j => j.name === "Error Logs");
			if (!journal) return;
			let page = journal.pages.find(p => p.name === CONN_PAGE);
			if (!page) {
				page = (await journal.createEmbeddedDocuments("JournalEntryPage",
					[{ name: CONN_PAGE, type: "text", text: { content: "" } }]))[0];
			}
			const prev = (page.text?.content || "").replace(/^<pre>/, "").replace(/<\/pre>$/, "");
			await page.update({ "text.content": `<pre>${prev}\n${text}</pre>` });
		};
		const enqueueWrite = (text) => {
			writeChain = writeChain.then(() => appendConnLog(text))
				.catch(err => DL(`connection-logger write failed: ${err}`));
			return writeChain;
		};

		// Primary GM receives relayed lines from other clients and writes them.
		if (game.user.isGM) {
			game.socket.on(SOCKET_NS, (data) => {
				if (data?.action === "jfsConnLog" && typeof data.text === "string" && isWriter()) {
					enqueueWrite(data.text);
				}
			});
		}

		// Socket drops cannot be written while down; buffer then flush on reconnect.
		const queue = [];
		let downAt = 0;
		const flushConn = () => {
			if (!queue.length) return;
			const text = queue.splice(0, queue.length).join("\n");
			if (isWriter()) enqueueWrite(text);
			else game.socket.emit(SOCKET_NS, { action: "jfsConnLog", text });
		};

		if (s) {
			// reason is socket.io's taxonomy: ping timeout | transport close | transport error | io server/client disconnect
			s.on("disconnect", (reason) => {
				downAt = Date.now();
				queue.push(`[${new Date().toLocaleTimeString()}] ${game.user.name}: DISCONNECT reason="${reason}" transport=${transportName()}`);
			});

			// Manager "reconnect" fires only on re-connections, not the initial connect.
			s.io?.on?.("reconnect", (attempt) => {
				const downMs = downAt ? Date.now() - downAt : 0;
				queue.push(`[${new Date().toLocaleTimeString()}] ${game.user.name}: RECONNECTED after ${attempt} attempt(s) · down ${downMs}ms · transport=${transportName()}`);
				flushConn();
			});

			s.io?.on?.("reconnect_error", (err) => {
				queue.push(`    ${game.user.name}: reconnect_error "${err?.message ?? err}"`);
			});

			DL(`connection-logger: armed (transport=${transportName()}, writer=${isWriter()})`);
		} else {
			DL(2, "connection-logger: game.socket missing, not armed");
		}
	}
});
