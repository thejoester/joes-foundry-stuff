import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const packs = Array.isArray(moduleJson.packs) ? moduleJson.packs : [];

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

// remove everything inside dir EXCEPT the _source folder
function cleanPackDirButKeepSource(dir) {
	ensureDir(dir);
	for (const entry of fs.readdirSync(dir)) {
		if (entry === "_source") continue;
		const full = path.join(dir, entry);
		fs.rmSync(full, { recursive: true, force: true });
	}
}

if (!packs.length) {
	process.stdout.write("No packs declared in module.json\n");
	process.exit(0);
}

for (const p of packs) {
	const packDir = path.resolve(ROOT, p.path);			// e.g., packs/alchemist-duct-tape-items
	const srcDir = path.join(packDir, "_source");		// packs/.../_source

	// A pack with no _source (or an empty one) is treated as an intentionally EMPTY
	// pack. Git can't track an empty _source dir, so a legitimately empty compendium
	// shows up as "missing" here - compile it to a valid empty LevelDB rather than fail.
	const hasSource = fs.existsSync(srcDir)
		&& fs.readdirSync(srcDir).some(f => f.endsWith(".json") && f !== "index.json");

	// clean LevelDB outputs but keep _source intact
	cleanPackDirButKeepSource(packDir);

	if (!hasSource) {
		ensureDir(srcDir); // compilePack needs a source dir; empty in -> empty pack out
		process.stdout.write(`Compiling EMPTY pack -> ${packDir}\n`);
		await compilePack(srcDir, packDir, { log: true });

		// An empty LevelDB has a MANIFEST/CURRENT/.log but no .ldb yet - that's valid.
		const files = fs.readdirSync(packDir);
		if (!files.some(n => /^MANIFEST-\d+$/i.test(n))) {
			throw new Error(`Empty pack looks incomplete: ${packDir} (no MANIFEST)`);
		}
		continue;
	}

	process.stdout.write(`Compiling ${srcDir} -> ${packDir}\n`);
	await compilePack(srcDir, packDir, { log: true });

	// sanity check: must have a MANIFEST and at least one .ldb
	const files = fs.readdirSync(packDir);
	const hasManifest = files.some(n => /^MANIFEST-\d+$/i.test(n));
	const hasLdb = files.some(n => /\.ldb$/i.test(n));
	if (!hasManifest || !hasLdb) {
		throw new Error(`Pack looks incomplete: ${packDir} (manifest=${hasManifest}, ldb=${hasLdb})`);
	}
}

process.stdout.write("Done.\n");
