import type { App } from "obsidian";
import { MAX_SEARCH_RESULTS, patchNote, readNote, searchVault, type PatchMode } from "../tools";
import { listSkills } from "../skills";
import {
	ClaudeApiError,
	sendMessage,
	type ClaudeMessage,
	type ContentBlock,
	type ToolDefinition,
} from "./client";

const MAX_TOOL_ITERATIONS = 8;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "vault_read",
		description: "Liest den Inhalt einer Notiz aus dem Vault anhand ihres Pfads (z.B. 'Ordner/Notiz.md').",
		input_schema: {
			type: "object",
			properties: { path: { type: "string", description: "Vault-relativer Pfad zur Notiz" } },
			required: ["path"],
		},
	},
	{
		name: "vault_patch",
		description:
			"Erstellt oder ändert eine Notiz. mode='overwrite' ersetzt den gesamten Inhalt, 'append' hängt an, " +
			"'prepend' stellt voran, 'create' legt nur an falls die Datei noch nicht existiert.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relativer Pfad zur Notiz" },
				content: { type: "string", description: "Zu schreibender Text" },
				mode: {
					type: "string",
					enum: ["overwrite", "append", "prepend", "create"],
					description: "Standard: overwrite",
				},
			},
			required: ["path", "content"],
		},
	},
	{
		name: "search_query",
		description: "Durchsucht alle Markdown-Notizen im Vault nach einem Textfragment (case-insensitive).",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Suchbegriff" },
				limit: { type: "number", description: `1-${MAX_SEARCH_RESULTS}, Standard 20` },
			},
			required: ["query"],
		},
	},
	{
		name: "skills_list",
		description: "Listet die im Vault gefundenen Claude Skills (Name + Beschreibung) auf.",
		input_schema: { type: "object", properties: {} },
	},
];

/** Executes a single tool call against the vault and returns its text result. */
export async function runTool(app: App, skillsFolder: string, name: string, input: Record<string, unknown>): Promise<string> {
	switch (name) {
		case "vault_read":
			return readNote(app, input.path as string);
		case "vault_patch":
			return patchNote(app, input.path as string, input.content as string, (input.mode as PatchMode) ?? "overwrite");
		case "search_query": {
			const results = await searchVault(app, input.query as string, (input.limit as number) ?? 20);
			if (results.length === 0) return `Keine Treffer für '${input.query as string}'`;
			return results.map((r) => `## ${r.path}\n${r.snippet}`).join("\n\n");
		}
		case "skills_list": {
			const skills = await listSkills(app, skillsFolder);
			if (skills.length === 0) return `Keine Skills in '${skillsFolder}' gefunden.`;
			return skills.map((s) => `## ${s.name}\n${s.description}\nPfad: ${s.path}`).join("\n\n");
		}
		default:
			throw new Error(`Unbekanntes Tool: ${name}`);
	}
}

async function buildSystemPrompt(app: App, skillsFolder: string): Promise<string> {
	const skills = await listSkills(app, skillsFolder);
	const base =
		"Du bist der VaultForge-Assistent: ein Claude-Modell mit direktem Lese-/Schreib-/Suchzugriff auf ein " +
		"Obsidian-Vault über die Tools vault_read, vault_patch und search_query. Antworte präzise und nutze die " +
		"Tools proaktiv, wenn eine Frage Vault-Inhalte betrifft.";

	if (skills.length === 0) return base;

	const skillList = skills.map((s) => `- ${s.name}: ${s.description} (${s.path})`).join("\n");
	return (
		base +
		"\n\nVerfügbare Claude Skills in diesem Vault (Kurzbeschreibung — lade die volle Anleitung bei Bedarf " +
		`per vault_read auf den angegebenen Pfad):\n${skillList}`
	);
}

export interface ChatTurnResult {
	messages: ClaudeMessage[];
	replyText: string;
	toolCalls: { name: string; input: Record<string, unknown> }[];
}

/**
 * Sends `userText` plus prior `history`, running the tool-use loop (capped at
 * MAX_TOOL_ITERATIONS) until Claude produces a final text reply.
 */
export async function runChatTurn(
	app: App,
	opts: { apiKey: string; model: string; skillsFolder: string },
	userText: string,
	history: ClaudeMessage[]
): Promise<ChatTurnResult> {
	const system = await buildSystemPrompt(app, opts.skillsFolder);
	const messages: ClaudeMessage[] = [...history, { role: "user", content: [{ type: "text", text: userText }] }];
	const toolCalls: { name: string; input: Record<string, unknown> }[] = [];

	for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
		const response = await sendMessage({
			apiKey: opts.apiKey,
			model: opts.model,
			system,
			messages,
			tools: TOOL_DEFINITIONS,
		});

		messages.push({ role: "assistant", content: response.content });

		if (response.stop_reason !== "tool_use") {
			const replyText = response.content
				.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
				.map((b) => b.text)
				.join("\n");
			return { messages, replyText, toolCalls };
		}

		const toolResults: ContentBlock[] = [];
		for (const block of response.content) {
			if (block.type !== "tool_use") continue;
			toolCalls.push({ name: block.name, input: block.input });
			try {
				const result = await runTool(app, opts.skillsFolder, block.name, block.input);
				toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
			} catch (err) {
				toolResults.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: (err as Error).message,
					is_error: true,
				});
			}
		}
		messages.push({ role: "user", content: toolResults });
	}

	throw new ClaudeApiError(`Abgebrochen: Tool-Loop-Limit (${MAX_TOOL_ITERATIONS}) erreicht.`);
}
