
/* =====================================================================
	These macros are not used by the module itself, but are intended 
	for testing, debugging, and utility purposes. They may be called 
	from the browser console or from user-created macros. They are not 
	guaranteed to be stable across module updates, and may be removed 
	without deprecation if they are no longer needed.

	Use at your own risk, and always make backups of your world before 
	running any macros!
	- These are not intended for use in production or by non-technical users.
	- They may be removed without warning in future updates.
	- They may cause errors if used incorrectly or in the wrong context. 
===================================================================== */

/* MACRO to archive all current NON-PINNED chat messages now */
(async () => {
	if (!game.user.isGM) return ui.notifications.warn("GM only.");
	const mod = game.modules.get("joes-foundry-stuff");
	if (!mod?.api?.archiveNonPinnedNow) return ui.notifications.error("API not found: joes-foundry-stuff.api.archiveNonPinnedNow");
	await mod.api.archiveNonPinnedNow({ confirm: true });
})();


/* // Log the size of each page in the "Chat Archive" journal entry, and the total size. */
(() => {
	const entry = game.journal.getName("Chat Archive");
	if (!entry) {
		ui.notifications.warn("No 'Chat Archive' found.");
		return;
	}

	let totalChars = 0, pages = 0;
	for (const p of entry.pages) {
		const len = p.text?.content?.length ?? 0;
		pages++;
		console.log(`${p.name}: ${(len / 1024).toFixed(1)} KB`);
		totalChars += len;
	}
	console.log(`Total pages: ${pages}, Total size: ${(totalChars / 1024).toFixed(1)} KB`);
})();


/* Log the size of every JournalEntry and each of its pages */
(() => {
	// Get all journal entries in the world
	const journals = game.journal.contents;
	if (!journals.length) {
		ui.notifications.warn("No journals found in this world.");
		return;
	}

	let grandTotal = 0;
	let grandPages = 0;

	// For each journal entry
	for (const entry of journals) {
		let totalChars = 0, pages = 0;
		// For each page in the journal entry
		for (const p of entry.pages) {

			const len = p.text?.content?.length ?? 0;
			if (len > 0) {
				console.log(`${entry.name} → ${p.name}: ${(len / 1024).toFixed(1)} KB`);
			}
			totalChars += len;
			pages++;
		}
		// Log summary for this journal
		const kb = (totalChars / 1024).toFixed(1);
		console.log(`%c${entry.name}: ${pages} pages, ${kb} KB total`, "color: cyan;");
		grandTotal += totalChars;
		grandPages += pages;
	}

	console.log(`%cAll Journals: ${grandPages} total pages, ${(grandTotal / 1024).toFixed(1)} KB overall`, "color: yellow; font-weight: bold;");
})();
