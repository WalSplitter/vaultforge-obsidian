import type { App, TFile } from "obsidian";

export const MAX_SEARCH_RESULTS = 50;
const SNIPPET_RADIUS = 80;

export type PatchMode = "overwrite" | "append" | "prepend" | "create";

export interface SearchResult {
	path: string;
	snippet: string;
}

/** Reads a note's content by vault-relative path. Throws if the file doesn't exist. */
export async function readNote(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file || !("extension" in file)) {
		throw new Error(`Datei nicht gefunden: ${path}`);
	}
	return app.vault.cachedRead(file as TFile);
}

/** Creates or edits a note per `mode`. Returns a human-readable status message. */
export async function patchNote(app: App, path: string, content: string, mode: PatchMode): Promise<string> {
	const existing = app.vault.getAbstractFileByPath(path);
	const existingFile = existing && "extension" in existing ? (existing as TFile) : null;

	if (mode === "create") {
		if (existingFile) {
			throw new Error(`Datei existiert bereits: ${path}`);
		}
		await app.vault.create(path, content);
		return `Erstellt: ${path}`;
	}

	if (!existingFile) {
		await app.vault.create(path, content);
		return `Erstellt: ${path}`;
	}

	if (mode === "overwrite") {
		await app.vault.modify(existingFile, content);
	} else {
		const current = await app.vault.read(existingFile);
		const next = mode === "append" ? current + content : content + current;
		await app.vault.modify(existingFile, next);
	}
	return `Aktualisiert (${mode}): ${path}`;
}

/** Case-insensitive substring search across all Markdown notes. */
export async function searchVault(app: App, query: string, limit: number): Promise<SearchResult[]> {
	const needle = query.toLowerCase();
	const results: SearchResult[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		if (results.length >= limit) break;
		const text = await app.vault.cachedRead(file);
		const idx = text.toLowerCase().indexOf(needle);
		if (idx === -1) continue;
		const start = Math.max(0, idx - SNIPPET_RADIUS);
		const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
		results.push({ path: file.path, snippet: text.slice(start, end).trim() });
	}

	return results;
}
