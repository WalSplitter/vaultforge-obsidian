import { cpSync, existsSync, mkdirSync } from "fs";

const target = "vaultforge/.obsidian/plugins/vaultforge";

mkdirSync(target, { recursive: true });
cpSync("manifest.json", `${target}/manifest.json`);
cpSync("main.js", `${target}/main.js`);
if (existsSync("styles.css")) {
	cpSync("styles.css", `${target}/styles.css`);
}

console.log(`Kopiert nach ${target}`);
