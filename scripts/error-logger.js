import { DL } from './settings.js';
console.log("%cJoe's Foundry Stuff | error-logger.js loaded","color: yellow; font-weight: bold;");

Hooks.once("ready", async () => {

	// Connection logging always runs; error logging is still opt-in.
	const enableErrorLogs = game.settings.get("joes-foundry-stuff", "enableErrorLogs");
	DL(`enableErrorLogs: ${enableErrorLogs} | connection logging: always on`);

	const SOCKET_NS = "module.joes-foundry-stuff";
	const JOURNAL_NAME = "Error Logs";

	// GM-only: (re)create the journal if missing and give every player OWNER write access.
	// Called up front and again on each write so a mid-session delete self-heals on the
	// next log line instead of waiting for a GM reload.
	const ensureErrorJournal = async () => {
		let journal = game.journal.find(j => j.name === JOURNAL_NAME);
		if (!journal) {
			if (!game.user.isGM) return null; // players can't create world journals
			journal = await JournalEntry.create({ name: JOURNAL_NAME, pages: [] });
		}
		const ownership = journal.ownership ?? {};
		let dirty = false;
		for (const user of game.users.contents) {
			if (!user.isGM && ownership[user.id] !== 3) { ownership[user.id] = 3; dirty = true; } // OWNER
		}
		if (dirty) await journal.update({ ownership });
		return journal;
	};

	// GM: ensure the journal exists up front so players have somewhere to write.
	if (game.user.isGM) await ensureErrorJournal();

	// Append a timestamped line to a player's own page in the Error Logs journal.
	// author defaults to this client; the GM passes it when writing a relayed player line.
	const writeToJournal = async (type, message, author = game.user.name) => {
		// message may not be a string (pf2e and others pass objects/errors)
		const msg = typeof message === "string" ? message : String(message ?? "");
		const pageName = author;

		let journal = game.journal.find(j => j.name === JOURNAL_NAME);
		if (!journal) {
			// Journal was deleted mid-session: GM recreates it; players relay to the GM.
			if (game.user.isGM) journal = await ensureErrorJournal();
			else { game.socket.emit(SOCKET_NS, { action: "jfsErrorLog", user: pageName, type, text: msg }); return; }
		}
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
		const newLine = `[${timestamp}] (${type.toUpperCase()}) ${pageName}: ${msg}`;
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

		// Players relay here when they hit a missing journal (e.g. just after a GM deleted
		// it); the GM recreates the journal and writes the player's page on their behalf.
		if (game.user.isGM && !game.__jfsErrorRelayBound) {
			game.socket.on(SOCKET_NS, (data) => {
				if (data?.action === "jfsErrorLog" && typeof data.text === "string") {
					Promise.resolve(writeToJournal(data.type ?? "error", data.text, data.user ?? "Unknown"))
						.catch(err => DL(`error-logger relay write failed: ${err}`));
				}
			});
			game.__jfsErrorRelayBound = true;
		}

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
	{
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
			let journal = game.journal.find(j => j.name === JOURNAL_NAME);
			if (!journal) journal = await ensureErrorJournal();
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
