import { cpSync, existsSync, mkdirSync } from "fs";

const target = "vaultforge/.obsidian/plugins/vaultforge";

mkdirSync(target, { recursive: true });
cpSync("manifest.json", `${target}/manifest.json`);
cpSync("main.js", `${target}/main.js`);
if (existsSync("styles.css")) {
	cpSync("styles.css", `${target}/styles.css`);
}

// The Claude Agent SDK (chat backend) is marked `external` in esbuild.config.mjs
// and loaded via dynamic import() at runtime, so it must exist as real
// node_modules next to main.js — copy just what's needed (no platform CLI
// binary: that comes from the user's own separately-installed `claude` CLI,
// see the "Anmeldung" setting).
const nodeModuleDirs = [
	"node_modules/@anthropic-ai/claude-agent-sdk",
	"node_modules/@anthropic-ai/sdk",
	"node_modules/standardwebhooks",
	"node_modules/json-schema-to-ts",
];
for (const dir of nodeModuleDirs) {
	if (!existsSync(dir)) {
		console.warn(`Übersprungen (nicht gefunden, 'npm install' ausgeführt?): ${dir}`);
		continue;
	}
	cpSync(dir, `${target}/${dir}`, { recursive: true });
}

console.log(`Kopiert nach ${target}`);
