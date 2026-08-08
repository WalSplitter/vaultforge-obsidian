import { requestUrl } from "obsidian";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
export const MAX_TOKENS = 4096;

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: ContentBlock[];
}

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface ClaudeResponse {
	content: ContentBlock[];
	stop_reason: string | null;
}

export class ClaudeApiError extends Error {}

export async function sendMessage(opts: {
	apiKey: string;
	model: string;
	system: string;
	messages: ClaudeMessage[];
	tools: ToolDefinition[];
}): Promise<ClaudeResponse> {
	const res = await requestUrl({
		url: API_URL,
		method: "POST",
		throw: false,
		headers: {
			"x-api-key": opts.apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: opts.model,
			max_tokens: MAX_TOKENS,
			system: opts.system,
			messages: opts.messages,
			tools: opts.tools,
		}),
	});

	if (res.status >= 400) {
		const message =
			(res.json as { error?: { message?: string } } | undefined)?.error?.message ??
			`HTTP ${res.status}`;
		throw new ClaudeApiError(`Claude-API-Fehler: ${message}`);
	}

	return res.json as ClaudeResponse;
}
