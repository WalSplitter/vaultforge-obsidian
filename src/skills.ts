import { TFile, TFolder, type App } from "obsidian";
import { t } from "./i18n";

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
	if (!(root instanceof TFolder)) return [];

	const skills: SkillMeta[] = [];
	for (const child of root.children) {
		if (!(child instanceof TFolder)) continue;
		const skillFile = child.children.find(
			(f): f is TFile => f instanceof TFile && f.name === "SKILL.md"
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
	if (!slug) throw new Error(t("errSkillNameEmpty"));

	const folder = `${folderPath}/${slug}`;
	const path = `${folder}/SKILL.md`;
	if (app.vault.getAbstractFileByPath(path)) {
		throw new Error(t("errSkillExists", { path }));
	}

	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}
	await app.vault.createFolder(folder);

	const description = t("templateDescriptionTodo");
	const template = `---\nname: ${slug}\ndescription: ${description}\n---\n\n${t("templateBodyTodo")}\n`;
	await app.vault.create(path, template);

	return { name: slug, description, folder, path };
}
