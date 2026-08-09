import { App, FileSystemAdapter } from "obsidian";
import { patchNote, readNote, searchVault, MAX_SEARCH_RESULTS, type PatchMode } from "../tools";
import { listSkills } from "../skills";

/**
 * Chat backend based on the Claude Agent SDK instead of a raw Anthropic API
 * key: it shells out to a locally installed & logged-in `claude` CLI, so
 * usage is billed through that CLI's own auth (Claude Pro/Max subscription
 * OR whatever ANTHROPIC_API_KEY the CLI itself is configured with) — never
 * a separate API key this plugin manages.
 *
 * The SDK is ESM-only and resolves its native CLI binary via its own
 * node_modules at runtime, so it's imported dynamically here rather than
 * bundled (see esbuild.config.mjs).
 */

export class AgentCliError extends Error {}

export interface ChatEvent {
	type: "text" | "tool_call" | "tool_result_error";
	text?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
}

export interface ChatTurnResult {
	sessionId: string;
	events: ChatEvent[];
	replyText: string;
}

async function loadSdk() {
	try {
		return await import("@anthropic-ai/claude-agent-sdk");
	} catch (err) {
		throw new AgentCliError(
			"Claude Agent SDK konnte nicht geladen werden. Ist die Vault-Plugin-Installation vollständig " +
				`(node_modules/@anthropic-ai neben main.js)? Ursache: ${(err as Error).message}`
		);
	}
}

async function buildToolServer(app: App, skillsFolder: string, sdk: Awaited<ReturnType<typeof loadSdk>>) {
	const { tool, createSdkMcpServer } = sdk;
	// Requires a Zod v4 raw shape; the project's bundled zod (v4) is passed as
	// plain z.object(...) descriptors, which the SDK reads structurally.
	const { z } = await import("zod");

	const vaultRead = tool(
		"vault_read",
		"Liest den Inhalt einer Notiz aus dem Vault anhand ihres Pfads (z.B. 'Ordner/Notiz.md').",
		{ path: z.string().describe("Vault-relativer Pfad zur Notiz") },
		async ({ path }) => {
			try {
				return { content: [{ type: "text", text: await readNote(app, path) }] };
			} catch (err) {
				return { content: [{ type: "text", text: (err as Error).message }], isError: true };
			}
		},
		{ annotations: { readOnlyHint: true } }
	);

	const vaultPatch = tool(
		"vault_patch",
		"Erstellt oder ändert eine Notiz. mode='overwrite' ersetzt den gesamten Inhalt, 'append' hängt an, " +
			"'prepend' stellt voran, 'create' legt nur an falls die Datei noch nicht existiert.",
		{
			path: z.string().describe("Vault-relativer Pfad zur Notiz"),
			content: z.string().describe("Zu schreibender Text"),
			mode: z.enum(["overwrite", "append", "prepend", "create"]).default("overwrite"),
		},
		async ({ path, content, mode }) => {
			try {
				const status = await patchNote(app, path, content, mode as PatchMode);
				return { content: [{ type: "text", text: status }] };
			} catch (err) {
				return { content: [{ type: "text", text: (err as Error).message }], isError: true };
			}
		}
	);

	const searchQuery = tool(
		"search_query",
		"Durchsucht alle Markdown-Notizen im Vault nach einem Textfragment (case-insensitive).",
		{
			query: z.string().min(1).describe("Suchbegriff"),
			limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
		},
		async ({ query, limit }) => {
			const results = await searchVault(app, query, limit);
			if (results.length === 0) {
				return { content: [{ type: "text", text: `Keine Treffer für '${query}'` }] };
			}
			const text = results.map((r) => `## ${r.path}\n${r.snippet}`).join("\n\n");
			return { content: [{ type: "text", text }] };
		},
		{ annotations: { readOnlyHint: true } }
	);

	const skillsList = tool(
		"skills_list",
		"Listet die im Vault gefundenen Claude Skills (Name + Beschreibung) auf.",
		{},
		async () => {
			const skills = await listSkills(app, skillsFolder);
			if (skills.length === 0) {
				return { content: [{ type: "text", text: `Keine Skills in '${skillsFolder}' gefunden.` }] };
			}
			const text = skills.map((s) => `## ${s.name}\n${s.description}\nPfad: ${s.path}`).join("\n\n");
			return { content: [{ type: "text", text }] };
		},
		{ annotations: { readOnlyHint: true } }
	);

	return createSdkMcpServer({
		name: "vaultforge",
		tools: [vaultRead, vaultPatch, searchQuery, skillsList],
	});
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

function vaultCwd(app: App): string | undefined {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
}

export interface RunChatTurnOptions {
	model: string;
	skillsFolder: string;
	/** Resume the CLI session from a previous turn; omit to start a new one. */
	sessionId?: string;
	/** Overrides auto-detection (PATH) of the `claude` executable. */
	cliPath?: string;
}

/**
 * Sends one user turn to the Claude Agent SDK (== the locally installed,
 * logged-in `claude` CLI) and waits for the finished reply. Tool calls the
 * model makes against vault_read/vault_patch/search_query/skills_list are
 * run in-process and looped by the SDK itself — no manual tool-use loop here.
 */
export async function runChatTurn(app: App, opts: RunChatTurnOptions, userText: string): Promise<ChatTurnResult> {
	const sdk = await loadSdk();
	const server = await buildToolServer(app, opts.skillsFolder, sdk);
	const system = await buildSystemPrompt(app, opts.skillsFolder);

	const events: ChatEvent[] = [];
	let sessionId = opts.sessionId ?? "";
	let stderr = "";

	const stream = sdk.query({
		prompt: userText,
		options: {
			model: opts.model,
			systemPrompt: system,
			tools: [],
			mcpServers: { vaultforge: server },
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			settingSources: [],
			resume: opts.sessionId || undefined,
			cwd: vaultCwd(app),
			pathToClaudeCodeExecutable: opts.cliPath || undefined,
			stderr: (data: string) => {
				stderr += data;
			},
		},
	});

	try {
		for await (const message of stream) {
			if (message.type === "system" && message.subtype === "init") {
				sessionId = message.session_id;
			} else if (message.type === "assistant") {
				sessionId = message.session_id;
				for (const block of message.message.content) {
					if (block.type === "text" && block.text.trim().length > 0) {
						events.push({ type: "text", text: block.text });
					} else if (block.type === "tool_use") {
						events.push({
							type: "tool_call",
							toolName: block.name,
							toolInput: block.input as Record<string, unknown>,
						});
					}
				}
			} else if (message.type === "result") {
				sessionId = message.session_id;
				if (message.subtype !== "success") {
					throw new AgentCliError(
						`Claude-CLI-Fehler (${message.subtype}): ${message.errors?.join("; ") || stderr || "unbekannt"}`
					);
				}
				const replyText = message.result;
				return { sessionId, events, replyText };
			}
		}
	} catch (err) {
		if (err instanceof AgentCliError) throw err;
		const msg = (err as Error).message ?? String(err);
		if (/not found|ENOENT/i.test(msg)) {
			throw new AgentCliError(
				"Claude-Code-CLI (`claude`) wurde nicht gefunden. Bitte installieren (npm i -g @anthropic-ai/claude-code " +
					"oder offizielles Installationsprogramm) und in den VaultForge-Einstellungen den Pfad hinterlegen, " +
					`falls sie nicht im PATH liegt. Details: ${msg}`
			);
		}
		if (/not authenticated|authentication_failed|login/i.test(msg) || /login/i.test(stderr)) {
			throw new AgentCliError("Nicht bei Claude Code angemeldet. Bitte in einem Terminal `claude login` ausführen.");
		}
		throw new AgentCliError(`${msg}${stderr ? `\n${stderr}` : ""}`);
	}

	throw new AgentCliError("Claude-CLI hat keine Antwort geliefert." + (stderr ? `\n${stderr}` : ""));
}
