import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from "http";
import type { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { MAX_SEARCH_RESULTS, patchNote, readNote, searchVault } from "../tools";
import { listSkills } from "../skills";

const MCP_PATH = "/mcp";

interface StartOptions {
	app: App;
	port: number;
	apiKey: string;
	skillsFolder: string;
}

export class VaultForgeMcpServer {
	private httpServer: HttpServer | null = null;
	private mcpServer: McpServer | null = null;

	get isRunning(): boolean {
		return this.httpServer !== null;
	}

	async start({ app, port, apiKey, skillsFolder }: StartOptions): Promise<void> {
		if (this.isRunning) {
			await this.stop();
		}

		this.mcpServer = this.buildMcpServer(app, skillsFolder);

		this.httpServer = createServer((req, res) => {
			void this.handleRequest(req, res, apiKey);
		});

		await new Promise<void>((resolve, reject) => {
			const server = this.httpServer;
			if (!server) return reject(new Error("MCP-Server nicht initialisiert"));
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		const server = this.httpServer;
		this.httpServer = null;
		this.mcpServer = null;
		if (!server) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse, apiKey: string): Promise<void> {
		if (req.url !== MCP_PATH || req.method !== "POST") {
			res.writeHead(404).end();
			return;
		}

		const authHeader = req.headers["authorization"] ?? "";
		if (authHeader !== `Bearer ${apiKey}`) {
			res.writeHead(401, { "Content-Type": "application/json" }).end(
				JSON.stringify({ error: "Unauthorized: gültigen Bearer-Token im Authorization-Header senden" })
			);
			return;
		}

		let body: unknown;
		try {
			body = await readJsonBody(req);
		} catch (err) {
			res.writeHead(400, { "Content-Type": "application/json" }).end(
				JSON.stringify({ error: `Ungültiger JSON-Body: ${(err as Error).message}` })
			);
			return;
		}

		const mcpServer = this.mcpServer;
		if (!mcpServer) {
			res.writeHead(503).end();
			return;
		}

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		res.on("close", () => void transport.close());

		try {
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, body);
		} catch (err) {
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" }).end(
					JSON.stringify({ error: `Interner Fehler: ${(err as Error).message}` })
				);
			}
		}
	}

	private buildMcpServer(app: App, skillsFolder: string): McpServer {
		const server = new McpServer({ name: "vaultforge", version: "0.0.1" });

		server.registerTool(
			"vault_read",
			{
				title: "Notiz lesen",
				description: "Liest den Inhalt einer Notiz aus dem Vault anhand ihres Pfads (z.B. 'Ordner/Notiz.md').",
				inputSchema: {
					path: z.string().describe("Vault-relativer Pfad zur Notiz"),
				},
			},
			async ({ path }) => {
				try {
					const content = await readNote(app, path);
					return { content: [{ type: "text", text: content }] };
				} catch (err) {
					return { content: [{ type: "text", text: (err as Error).message }], isError: true };
				}
			}
		);

		server.registerTool(
			"vault_patch",
			{
				title: "Notiz schreiben/ändern",
				description:
					"Erstellt oder ändert eine Notiz. mode='overwrite' ersetzt den gesamten Inhalt, 'append' hängt an, " +
					"'prepend' stellt voran, 'create' legt nur an falls die Datei noch nicht existiert.",
				inputSchema: {
					path: z.string().describe("Vault-relativer Pfad zur Notiz"),
					content: z.string().describe("Zu schreibender Text"),
					mode: z.enum(["overwrite", "append", "prepend", "create"]).default("overwrite"),
				},
			},
			async ({ path, content, mode }) => {
				try {
					const status = await patchNote(app, path, content, mode);
					return { content: [{ type: "text", text: status }] };
				} catch (err) {
					return { content: [{ type: "text", text: (err as Error).message }], isError: true };
				}
			}
		);

		server.registerTool(
			"search_query",
			{
				title: "Vault durchsuchen",
				description: "Durchsucht alle Markdown-Notizen im Vault nach einem Textfragment (case-insensitive).",
				inputSchema: {
					query: z.string().min(1).describe("Suchbegriff"),
					limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
				},
			},
			async ({ query, limit }) => {
				const results = await searchVault(app, query, limit);

				if (results.length === 0) {
					return { content: [{ type: "text", text: `Keine Treffer für '${query}'` }] };
				}

				const text = results.map((r) => `## ${r.path}\n${r.snippet}`).join("\n\n");
				return { content: [{ type: "text", text }] };
			}
		);

		server.registerTool(
			"skills_list",
			{
				title: "Claude Skills auflisten",
				description:
					`Listet alle im Vault-Ordner '${skillsFolder}' gefundenen Claude Skills (Unterordner mit SKILL.md) ` +
					"mit Name und Beschreibung auf. Volle Anleitung eines Skills danach per vault_read auf dessen Pfad laden.",
				inputSchema: {},
			},
			async () => {
				const skills = await listSkills(app, skillsFolder);
				if (skills.length === 0) {
					return { content: [{ type: "text", text: `Keine Skills in '${skillsFolder}' gefunden.` }] };
				}
				const text = skills.map((s) => `## ${s.name}\n${s.description}\nPfad: ${s.path}`).join("\n\n");
				return { content: [{ type: "text", text }] };
			}
		);

		return server;
	}
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			if (!raw) return resolve(undefined);
			try {
				resolve(JSON.parse(raw));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}
