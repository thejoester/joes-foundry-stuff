import { DL } from './settings.js';
console.log("%cJoe's Foundry Stuff | error-logger.js loaded","color: yellow; font-weight: bold;");

Hooks.once("ready", async () => {

	// Check setting
	const enableErrorLogs = game.settings.get("joes-foundry-stuff", "enableErrorLogs");
	DL(`enableErrorLogs: ${enableErrorLogs}`);
	if (enableErrorLogs){

		// If GM,
		if (game.user.isGM) {

			// ensure "Error Logs" journal exists and all players have OWNER write permission
			let journal = game.journal.find(j => j.name === "Error Logs");
			if (!journal) {
				journal = await JournalEntry.create({ name: "Error Logs", pages: [] });
			}

			// Build ownership object with write permission for all players
			const ownership = journal.ownership ?? {};
			for (const user of game.users.contents) {
				if (!user.isGM) ownership[user.id] = 3; // OWNER permission
			}
			// update journal
			await journal.update({ ownership });
		}

		const writeToJournal = async (type, message) => {
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
			const newLine = `[${timestamp}] (${type.toUpperCase()}) ${game.user.name}: ${message}`;
			content += `\n${newLine}`;

			// Check for ID inside brackets and try to resolve it
			const idMatch = message.match(/(?:\[|")([a-zA-Z0-9]{16})(?:\]|")/);
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
					content += `\n  ↳ ID [${id}] not found in any core collection.`;
				}
			}

			await page.update({ "text.content": `<pre>${content}</pre>` });
		};

		const captureAndWrite = (originalFunc, type) => {
			return function (message, ...args) {
				writeToJournal(type, message);
				return originalFunc.call(this, message, ...args);
			};
		};

		ui.notifications.error = captureAndWrite(ui.notifications.error, 'error');
		if (game.settings.get("joes-foundry-stuff", "enableErrorLogs")) {
			ui.notifications.warn = captureAndWrite(ui.notifications.warn, 'warning');
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
});
