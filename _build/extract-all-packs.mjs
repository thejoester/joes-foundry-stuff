import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPack } from "@foundryvtt/foundryvtt-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const packs = Array.isArray(moduleJson.packs) ? moduleJson.packs : [];

// Optional CLI arg: a "packs" directory to read the compiled LevelDB from.
// Defaults to this repo's own packs/. Use it to extract from a live Foundry
// install elsewhere, e.g.:
//   npm run extract -- "G:\dev\foundryvtt\joes-pf2e-stuff\packs"
// The extracted _source JSON is always written back into THIS repo.
const argSrc = process.argv[2];
const SRC_PACKS_ROOT = argSrc ? path.resolve(argSrc) : path.join(ROOT, "packs");

// Build a short, safe _source filename from a document. The CLI default uses the
// full document name, which can blow past the Windows 260-char path limit when an
// entry has a huge name (e.g. a roll-table row whose text lives in `name`). Cap the
// readable slug and always append the id so filenames stay unique and short.
function packEntryFileName(doc) {
	const id = doc?._id ?? String(doc?._key ?? "").split("!").pop() ?? "unknown";
	const slug = String(doc?.name ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 40);
	return `${slug ? slug + "_" : ""}${id}.json`;
}

if (!packs.length) {
	process.stdout.write("No packs declared in module.json\n");
	process.exit(0);
}

process.stdout.write(`Reading LevelDB packs from: ${SRC_PACKS_ROOT}\n`);

for (const p of packs) {
	const packName = path.basename(p.path);					// e.g. "joes-actors-pf2"
	const srcPackDir = path.join(SRC_PACKS_ROOT, packName);		// LevelDB source
	if (!fs.existsSync(srcPackDir)) {
		process.stdout.write(`Skip (missing): ${srcPackDir}\n`);
		continue;
	}
	const outDir = path.join(ROOT, p.path, "_source");			// always write into this repo
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	process.stdout.write(`Extracting ${srcPackDir} -> ${outDir}\n`);
	// LevelDB: no nedb option needed. transformName keeps filenames short (Windows MAX_PATH).
	await extractPack(srcPackDir, outDir, { log: true, transformName: packEntryFileName });
}

process.stdout.write("Done.\n");
