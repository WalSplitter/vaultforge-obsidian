import type { App, TFile, TFolder } from "obsidian";

export interface SkillMeta {
	name: string;
	description: string;
	/** Vault-relative folder containing SKILL.md */
	folder: string;
	/** Vault-relative path to SKILL.md */
	path: string;
}

/**
 * Parses a flat YAML frontmatter block (--- ... ---) at the top of a string.
 * Only handles simple `key: value` pairs (no nesting/lists), which is all
 * SKILL.md's `name`/`description` fields need.
 */
export function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const fields: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const fieldMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!fieldMatch) continue;
		const [, key, rawValue] = fieldMatch;
		const value = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
		fields[key] = value;
	}
	return fields;
}

/**
 * Scans immediate subfolders of `folderPath` for a SKILL.md and parses its
 * frontmatter. Folders without a SKILL.md are skipped. Missing root folder
 * yields an empty list rather than an error (nothing configured yet).
 */
export async function listSkills(app: App, folderPath: string): Promise<SkillMeta[]> {
	const root = app.vault.getAbstractFileByPath(folderPath);
	if (!root || !("children" in root)) return [];

	const skills: SkillMeta[] = [];
	for (const child of (root as TFolder).children) {
		if (!("children" in child)) continue; // not a folder
		const skillFile = (child as TFolder).children.find(
			(f): f is TFile => "extension" in f && f.name === "SKILL.md"
		);
		if (!skillFile) continue;

		const content = await app.vault.cachedRead(skillFile);
		const fields = parseFrontmatter(content);
		skills.push({
			name: fields.name ?? child.name,
			description: fields.description ?? "",
			folder: child.path,
			path: skillFile.path,
		});
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates `folderPath/skillName/SKILL.md` with a starter template. Throws if it already exists. */
export async function createSkillScaffold(app: App, folderPath: string, skillName: string): Promise<SkillMeta> {
	const slug = skillName.trim();
	if (!slug) throw new Error("Skill-Name darf nicht leer sein");

	const folder = `${folderPath}/${slug}`;
	const path = `${folder}/SKILL.md`;
	if (app.vault.getAbstractFileByPath(path)) {
		throw new Error(`Skill existiert bereits: ${path}`);
	}

	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}
	await app.vault.createFolder(folder);

	const template = `---\nname: ${slug}\ndescription: TODO - kurz beschreiben, wann dieser Skill greifen soll\n---\n\nTODO: Anleitung für diesen Skill hier ausformulieren.\n`;
	await app.vault.create(path, template);

	return { name: slug, description: "TODO - kurz beschreiben, wann dieser Skill greifen soll", folder, path };
}
