import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type VaultForgePlugin from "../main";
import { AgentCliError, runChatTurn, type ChatEvent } from "../claude/agent";

export const VIEW_TYPE_CHAT = "vaultforge-chat";

interface RenderedTurn {
	role: "user" | "assistant";
	events: ChatEvent[];
}

export class VaultForgeChatView extends ItemView {
	private plugin: VaultForgePlugin;
	private turns: RenderedTurn[] = [];
	private sessionId: string | undefined;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private busy = false;

	constructor(leaf: WorkspaceLeaf, plugin: VaultForgePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "VaultForge Chat";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.containerEl.empty();
	}

	private render(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass("vaultforge-chat-container");

		container.createDiv({ cls: "vaultforge-chat-hint" }, (el) => {
			el.createEl("p", {
				text:
					"Nutzt die lokal installierte Claude-Code-CLI (Pro/Max-Anmeldung oder deren eigener API-Key) — " +
					"kein separater Anthropic-API-Key in diesem Plugin. Falls 'claude' nicht gefunden wird oder " +
					"nicht angemeldet ist, siehe Einstellungen → VaultForge → Chat.",
			});
		});

		this.messagesEl = container.createDiv({ cls: "vaultforge-chat-messages" });
		this.renderHistory();

		const inputRow = container.createDiv({ cls: "vaultforge-chat-input-row" });
		this.inputEl = inputRow.createEl("textarea", {
			cls: "vaultforge-chat-input",
			attr: { placeholder: "Nachricht an VaultForge... (Enter = senden, Shift+Enter = neue Zeile)" },
		});
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				void this.handleSend();
			}
		});

		this.sendBtn = inputRow.createEl("button", { cls: "vaultforge-chat-send", text: "Senden" });
		this.sendBtn.addEventListener("click", () => void this.handleSend());
	}

	private renderHistory(): void {
		this.messagesEl.empty();
		for (const turn of this.turns) {
			for (const event of turn.events) {
				this.appendEvent(turn.role, event);
			}
		}
		this.scrollToBottom();
	}

	private appendEvent(role: "user" | "assistant", event: ChatEvent): void {
		if (event.type === "text" && event.text && event.text.trim().length > 0) {
			const bubble = this.messagesEl.createDiv({ cls: `vaultforge-chat-bubble vaultforge-chat-${role}` });
			bubble.createEl("p", { text: event.text });
		} else if (event.type === "tool_call") {
			this.messagesEl.createDiv({
				cls: "vaultforge-chat-tool-call",
				text: `🔧 ${event.toolName}(${JSON.stringify(event.toolInput ?? {})})`,
			});
		}
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.inputEl.disabled = busy;
		this.sendBtn.disabled = busy;
		this.sendBtn.setText(busy ? "..." : "Senden");
	}

	private async handleSend(): Promise<void> {
		if (this.busy) return;
		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";
		this.turns.push({ role: "user", events: [{ type: "text", text }] });
		this.messagesEl.createDiv({ cls: "vaultforge-chat-bubble vaultforge-chat-user" }).createEl("p", { text });
		this.scrollToBottom();
		this.setBusy(true);

		try {
			const result = await runChatTurn(
				this.app,
				{
					model: this.plugin.settings.chatModel,
					skillsFolder: this.plugin.settings.skillsFolder,
					sessionId: this.sessionId,
					cliPath: this.plugin.settings.claudeCliPath || undefined,
				},
				text
			);
			this.sessionId = result.sessionId;
			this.turns.push({ role: "assistant", events: result.events });
			for (const event of result.events) {
				this.appendEvent("assistant", event);
			}
			this.scrollToBottom();
		} catch (err) {
			const message = err instanceof AgentCliError ? err.message : `Fehler: ${(err as Error).message}`;
			new Notice(`VaultForge Chat: ${message}`);
			this.messagesEl.createDiv({ cls: "vaultforge-chat-error", text: message });
			this.scrollToBottom();
		} finally {
			this.setBusy(false);
		}
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}
}
