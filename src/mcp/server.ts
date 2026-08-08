import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from "http";
import type { App, TFile } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const MCP_PATH = "/mcp";
const MAX_SEARCH_RESULTS = 50;
const SNIPPET_RADIUS = 80;

interface StartOptions {
	app: App;
	port: number;
	apiKey: string;
}

export class VaultForgeMcpServer {
	private httpServer: HttpServer | null = null;
	private mcpServer: McpServer | null = null;

	get isRunning(): boolean {
		return this.httpServer !== null;
	}

	async start({ app, port, apiKey }: StartOptions): Promise<void> {
		if (this.isRunning) {
			await this.stop();
		}

		this.mcpServer = this.buildMcpServer(app);

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

	private buildMcpServer(app: App): McpServer {
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
				const file = app.vault.getAbstractFileByPath(path);
				if (!file || !("extension" in file)) {
					return { content: [{ type: "text", text: `Datei nicht gefunden: ${path}` }], isError: true };
				}
				const content = await app.vault.cachedRead(file as TFile);
				return { content: [{ type: "text", text: content }] };
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
				const existing = app.vault.getAbstractFileByPath(path);
				const existingFile = existing && "extension" in existing ? (existing as TFile) : null;

				if (mode === "create") {
					if (existingFile) {
						return { content: [{ type: "text", text: `Datei existiert bereits: ${path}` }], isError: true };
					}
					await app.vault.create(path, content);
					return { content: [{ type: "text", text: `Erstellt: ${path}` }] };
				}

				if (!existingFile) {
					await app.vault.create(path, content);
					return { content: [{ type: "text", text: `Erstellt: ${path}` }] };
				}

				if (mode === "overwrite") {
					await app.vault.modify(existingFile, content);
				} else {
					const current = await app.vault.read(existingFile);
					const next = mode === "append" ? current + content : content + current;
					await app.vault.modify(existingFile, next);
				}
				return { content: [{ type: "text", text: `Aktualisiert (${mode}): ${path}` }] };
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
				const needle = query.toLowerCase();
				const results: { path: string; snippet: string }[] = [];

				for (const file of app.vault.getMarkdownFiles()) {
					if (results.length >= limit) break;
					const text = await app.vault.cachedRead(file);
					const idx = text.toLowerCase().indexOf(needle);
					if (idx === -1) continue;
					const start = Math.max(0, idx - SNIPPET_RADIUS);
					const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
					results.push({ path: file.path, snippet: text.slice(start, end).trim() });
				}

				if (results.length === 0) {
					return { content: [{ type: "text", text: `Keine Treffer für '${query}'` }] };
				}

				const text = results.map((r) => `## ${r.path}\n${r.snippet}`).join("\n\n");
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
