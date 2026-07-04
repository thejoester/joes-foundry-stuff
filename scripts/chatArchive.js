import { DL } from "./settings.js";

const MOD_ID = "joes-foundry-stuff";

/* Archive all current NON-PINNED chat messages =========================== */
export async function archiveNonPinnedNow(opts = {}) {
	const { confirm = true } = opts;
	if (!game.user.isGM) {
		ui.notifications.warn("Only a GM can archive chat.");
		return 0;
	}

	// Oldest → newest
	const all = [...game.messages.contents].sort((a, b) => a.timestamp - b.timestamp);
	if (!all.length) {
		ui.notifications.info("No chat messages to archive.");
		return 0;
	}

	// Respect *non-pinned* only
	const domPinned = getDomPinnedIds?.() ?? new Set();
	const nonPinned = all.filter(m => !isPinned(m, domPinned));
	if (!nonPinned.length) {
		ui.notifications.info("Nothing to archive (only pinned messages present).");
		return 0;
	}

	if (confirm) {
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Archive Non-Pinned Chat" },
			content: `Archive <strong>${nonPinned.length}</strong> non-pinned chat messages to the Journal, then delete them?`,
			rejectClose: true,
			modal: true
		});
		if (!ok) return 0;
	}

	// Group by YYYY-MM-DD
	const byDay = new Map();
	for (const msg of nonPinned) {
		const day = ymd(msg.timestamp);
		if (!byDay.has(day)) byDay.set(day, []);
		byDay.get(day).push(msg);
	}

	// Append to journal pages
	for (const [day, list] of byDay.entries()) {
		const { page } = await getArchiveEntryAndPage(day);
		const appendHTML = buildArchiveHTML(list);
		const newContent = (page.text?.content ?? "") + appendHTML;
		await page.update({ text: { content: newContent } });
	}

	// Delete from chat
	const ids = nonPinned.map(m => m.id);
	try {
		await ChatMessage.deleteDocuments(ids);
	} catch (err) {
		DL(2, "Error deleting chat messages during archive trim:", err);
	}

	ui.notifications.info(`Archived and cleared ${ids.length} non-pinned messages.`);
	return ids.length;
}

/* ==========================================================================
	{HELPER FUNCTIONS}
========================================================================== */

// Check if the chat archiver is enabled, defaulting to true if the setting is not found or an error occurs
function archiverEnabled() {
	try { return !!game.settings.get(MOD_ID, "enableChatArchiver"); }
	catch { return true; }
}

// Check if the "save to journal" setting is enabled, defaulting to true if the setting is not found or an error occurs
function saveToJournal() {
	try { return !!game.settings.get(MOD_ID, "saveToJournal"); }
	catch { return true; }
}

// Determine a label for a damage instance based on its type and category, with special handling for precision and persistent damage
function labelForInstance(i) {
	const type = i.type || i.damageType || "untyped";
	const cat = i.category || (i.persistent ? "persistent" : undefined);
	if (i.persistent || cat === "persistent") return `persistent ${type !== "untyped" ? type : "damage"}`;
	if (cat === "precision") return "precision";
	return type;
}

// Summarize a damage roll by totaling values by damage type and category (e.g. "10 slashing + 5 persistent fire + 3 precision")
function summarizeDamageRoll(roll) {
	const byLabel = new Map();
	const inst = roll?.instances ?? [];
	if (inst.length) {
		for (const i of inst) {
			const label = labelForInstance(i);
			const value = Number(i.total ?? 0);
			if (!Number.isFinite(value) || value === 0) continue;
			byLabel.set(label, (byLabel.get(label) ?? 0) + value);
		}
	} else {
		const visit = (t) => {
			if (!t) return;
			const type = t?.options?.damageType || "untyped";
			const isPersistent = !!t?.options?.persistent;
			const cat = isPersistent ? "persistent" : t?.options?.category;
			const label = cat === "precision" ? "precision" : isPersistent ? `persistent ${type}` : type;
			const value = Number(t?.total ?? 0);
			if (Number.isFinite(value) && value !== 0) byLabel.set(label, (byLabel.get(label) ?? 0) + value);
			if (Array.isArray(t?.terms)) t.terms.forEach(visit);
		};
		try { roll?.terms?.forEach?.(visit); } catch {}
	}
	if (!byLabel.size) return "";
	const orderKey = (k) => (k === "precision" ? 2 : k.startsWith("persistent ") ? 3 : 1);
	const parts = [...byLabel.entries()].sort((a, b) => orderKey(a[0]) - orderKey(b[0])).map(([k, v]) => `${v} ${k}`);
	return ` (${parts.join(" + ")})`;
}


// Heuristic to determine if a roll is a damage roll, since not all systems properly flag them and the data structure can vary
function isDamageRoll(roll, msg) {
	if (!roll) return false;
	if (roll.constructor?.name === "DamageRoll") return true;
	if (msg?.flags?.pf2e?.damageRoll === true) return true;
	return /\b(bludgeoning|piercing|slashing|fire|cold|acid|electricity|poison|sonic|force|negative|positive|precision|persistent)\b/i.test(roll.formula ?? "");
}

// check if message is pinned
function isPinned(msg, domPinnedIds) {
	if (msg?.pinned || msg?.flags?.core?.pinned) return true;
	for (const v of Object.values(msg?.flags ?? {})) {
		if (v && (v.pinned || v.isPinned || v.pin)) return true;
	}
	return domPinnedIds?.has?.(msg.id);
}

// Get IDs of currently pinned messages by querying the DOM, since the pinned state can be stored in various flags or the message itself, and may not be reliably accessible via the data model alone
function getDomPinnedIds() {
	try {
		const nodes = document.querySelectorAll("li.chat-message.pinned-message[data-message-id]");
		return new Set(Array.from(nodes, (li) => li.dataset.messageId));
	} catch {
		return new Set();
	}
}

// Format a timestamp as YYYY-MM-DD for grouping messages by day
function ymd(ts) {
	const d = new Date(ts ?? Date.now());
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

// Clean message content HTML by stripping out interactive elements and sensitive data attributes
function cleanHtml(html) {
	try {
		if (!html) return "";
		const doc = new DOMParser().parseFromString(html, "text/html");
		const root = doc.body || doc;

		root.querySelectorAll(".pf2e-chances-chatcard-container, .pf2e-chances-chatcard-bar").forEach((n) => n.remove());
		root.querySelectorAll(".dice-tooltip, .message-buttons, button, [data-action], .card-buttons").forEach((n) => n.remove());

		// Force all headings dark — pf2e and pf2e-hud set heading colors for dark themes.
		root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => { h.style.color = "#000"; });

		// Convert pf2e-hud recall knowledge grids to inline-styled tables.
		// These divs use CSS grid (--nb-rows) that requires the pf2e-hud stylesheet.
		// Variants: div.rk (basic), div.rk-skills, div.rk-lores, div.rk-lores-rolls (targeted).
		// Spans may be direct children or wrapped in a <p> by pf2e-hud, so use querySelectorAll.
		// Column count is derived from the leading run of .header spans.
		root.querySelectorAll("div.rk, div.rk-skills, div.rk-lores, div.rk-lores-rolls").forEach((rk) => {
			const spans = [...rk.querySelectorAll("span")];
			if (!spans.length) return;

			let colCount = 0;
			while (colCount < spans.length && spans[colCount].classList.contains("header")) colCount++;
			if (colCount === 0) return;

			const table = doc.createElement("table");
			table.style.cssText = "border-collapse:collapse; width:100%; margin:0.5em 0; font-size:0.9em;";

			const headerRow = doc.createElement("tr");
			for (let j = 0; j < colCount; j++) {
				const th = doc.createElement("th");
				th.innerHTML = spans[j].innerHTML.trim();
				th.style.cssText = "padding:2px 8px; border:1px solid #888; text-align:left; background:#444; color:#eee;";
				headerRow.appendChild(th);
			}
			table.appendChild(headerRow);

			for (let i = colCount; i < spans.length; i += colCount) {
				const tr = doc.createElement("tr");
				for (let j = 0; j < colCount && i + j < spans.length; j++) {
					const span = spans[i + j];
					const td = doc.createElement("td");
					td.innerHTML = span.innerHTML.trim();
					td.style.cssText = "padding:2px 8px; border:1px solid #888; text-align:left;";
					const cl = span.classList;
					if (cl.contains("critical-success")) td.style.color = "#00c000";
					else if (cl.contains("success")) td.style.color = "#00a000";
					else if (cl.contains("critical-failure")) td.style.color = "#cc0000";
					else if (cl.contains("failure")) td.style.color = "#aa0000";
					tr.appendChild(td);
				}
				table.appendChild(tr);
			}

			rk.replaceWith(table);
		});

		// Inline-style tag pills (.tag spans) so they render without external CSS.
		root.querySelectorAll(".tags .tag, span.tag").forEach((tag) => {
			tag.style.cssText = "display:inline-block; background:#555; color:#eee; border-radius:3px; padding:1px 6px; margin:2px; font-size:0.85em;";
			tag.removeAttribute("data-slug");
			tag.removeAttribute("data-description");
		});

		root.querySelectorAll("img").forEach((img) => {
			img.style.maxWidth = "32px";
			img.style.maxHeight = "32px";
		});

		root.querySelectorAll("*").forEach((el) => {
			[...el.attributes].forEach((a) => {
				const n = a.name;
				if (n === "title" || n === "draggable" || n === "inert" || n === "onclick" ||
					n.startsWith("data-tooltip") || n.startsWith("data-pf2") ||
					n === "data-item-uuid" || n === "data-pack" || n === "data-type" || n === "data-id")
					el.removeAttribute(n);
			});
		});

		let out = root.innerHTML;
		out = out.replace(/<span\s+style="[^"]*background-color:\s*#1d1c1a[^"]*">/gi, "<span>");
		return out;
	} catch (e) {
		DL(2, "cleanHtml failed:", e);
		return html ?? "";
	}
}

// Build HTML for a list of messages to append to the journal page
function buildArchiveHTML(messages) {
	let out = "";
	let currentAuthor = null;

	for (const msg of messages) {
		// Use author / userId instead of deprecated msg.user
		const authorUser = msg.author ?? (msg.userId ? game.users.get(msg.userId) : null);
		const author = authorUser?.name ?? "Unknown";

		const speaker = msg.speaker?.alias || msg.speaker?.actor || "";
		const pinnedNote = msg.pinned ? " (pinned)" : "";
		const flavor = msg.flavor ? `<div class="message-flavor">${cleanHtml(msg.flavor)}</div>` : "";
		const time = new Date(msg.timestamp).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		});

		const cleaned = cleanHtml(msg.content ?? "");

		let rollHTML = "";
		if (msg.rolls?.length) {
			for (const roll of msg.rolls) {
				const formula = roll.formula ?? "";
				const total = roll.total ?? "";
				const breakdown = isDamageRoll(roll, msg) ? summarizeDamageRoll(roll) : "";
				rollHTML += `
					<div class="chat-archive-roll" style="margin-left:1em; margin-top:0.2em;">
						<code style="color:#555;">${formula}</code> → <strong>${total}</strong>${breakdown}
					</div>`;
			}
		}

		if (author !== currentAuthor) {
			currentAuthor = author;
			out += `<h3 style="margin-top:1em; border-bottom:1px solid #666; color:#1a1a1a;">${author}</h3>`;
		}

		out += `
			<article class="chat-archive-message" style="margin-left:0.5em; background:#f5f5f0; color:#1a1a1a; padding:0.4em 0.75em; border-radius:4px; margin-bottom:0.4em;">
				<header style="color:#333;"><strong>${time}</strong>${speaker ? ` — <em>${speaker}</em>` : ""}${pinnedNote}</header>
				${flavor}
				<div class="message-content" style="color:#1a1a1a;">${cleaned}</div>
				${rollHTML}
			</article>`;
	}

	return out;
}

// Get or create the JournalEntry and JournalEntryPage for a given day (YYYY-MM-DD)
async function getArchiveEntryAndPage(dayName) {
	let entry = game.journal.getName("Chat Archive");
	if (!entry) {
		DL(`Creating new JournalEntry: Chat Archive`);
		entry = await JournalEntry.create({
			name: "Chat Archive",
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
			folder: null,
		}, { renderSheet: false });
	}
	let datePages = (await entry.getFlag(MOD_ID, "datePages")) ?? {};
	let page = datePages[dayName] ? entry.pages.get(datePages[dayName]) : null;
	if (!page) page = entry.pages.find((p) => p.name === dayName && p.type === "text");
	if (!page) {
		DL(`Creating new page for ${dayName}`);
		const [created] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
			name: dayName,
			type: "text",
			text: { content: "", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
		}]);
		page = created;
		datePages[dayName] = page.id;
		await entry.setFlag(MOD_ID, "datePages", datePages);
	} else if (!datePages[dayName]) {
		datePages[dayName] = page.id;
		await entry.setFlag(MOD_ID, "datePages", datePages);
	}
	return { entry, page };
}

// prune old pages (30+ days) on startup to prevent bloat over time
async function pruneOldArchivePages() {
	if (!game.user.isGM) return;
	const entry = game.journal.getName("Chat Archive");
	if (!entry) return;

	const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
	const toDelete = [];

	for (const page of entry.pages) {
		const pageDate = Date.parse(page.name);
		if (!isNaN(pageDate) && pageDate < cutoff) {
			toDelete.push(page.id);
			DL(`Pruning old archive page: ${page.name}`);
		}
	}

	if (!toDelete.length) {
		DL("No old archive pages to prune.");
		return;
	}

	await entry.deleteEmbeddedDocuments("JournalEntryPage", toDelete);

	// Clean up the datePages flag so stale IDs don't linger
	const datePages = (await entry.getFlag(MOD_ID, "datePages")) ?? {};
	for (const [day, id] of Object.entries(datePages)) {
		if (toDelete.includes(id)) delete datePages[day];
	}
	await entry.setFlag(MOD_ID, "datePages", datePages);

	DL(`Pruned ${toDelete.length} archive page(s) older than 30 days.`);
}

// Main function to check if archiving is needed and perform it
async function trimAndArchiveIfNeeded() {
	if (!game.user.isGM) return;
	if (!archiverEnabled()) return;
	const keep = Number(game.settings.get(MOD_ID, "keepCount")) || 100;
	const all = [...game.messages.contents].sort((a, b) => a.timestamp - b.timestamp);
	if (all.length <= keep) return;
	const domPinnedIds = getDomPinnedIds();
	const nonPinned = all.filter((m) => !isPinned(m, domPinnedIds));
	if (nonPinned.length <= keep) return;

	const toRemoveCount = nonPinned.length - keep;
	const toArchive = nonPinned.slice(0, toRemoveCount);
	const byDay = new Map();
	for (const msg of toArchive) {
		const d = ymd(msg.timestamp);
		if (!byDay.has(d)) byDay.set(d, []);
		byDay.get(d).push(msg);
	}

	if (saveToJournal()) {
		for (const [d, list] of byDay.entries()) {
			const { page } = await getArchiveEntryAndPage(d);
			const appendHTML = buildArchiveHTML(list);
			const newContent = (page.text?.content ?? "") + appendHTML;
			await page.update({ text: { content: newContent } });
		}
	}
	const ids = toArchive.map((m) => m.id);
	try {
		await ChatMessage.deleteDocuments(ids);
	} catch (err) {
		DL("Error deleting chat messages during archive trim:", err);
	}
	DL(`Archive process complete. Removed ${ids.length} messages.`);
}

/* ==========================================================================
	{READY + HOOKS}
========================================================================== */
Hooks.once("ready", async () => {
	if (!game.user.isGM) return;

	Hooks.once("renderChatLog", async () => {
		if (!archiverEnabled()) return;
		try {
			DL("Performing initial archive check...");
			await trimAndArchiveIfNeeded();
			DL("Initial archive check complete.");
		} catch (err) { DL(3, "Initial trim error:", err); }
	});

	try {
		await pruneOldArchivePages();
	} catch (err) { DL(3, "Archive prune error:", err); }
});

Hooks.on("createChatMessage", async () => {
	if (!game.user.isGM) return;
	if (!archiverEnabled()) return;
	try { await trimAndArchiveIfNeeded(); }
	catch (err) { DL(3, "Trim error:", err); }
});