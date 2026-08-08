import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type VaultForgePlugin from "../main";
import { ClaudeApiError, type ClaudeMessage, type ContentBlock } from "../claude/client";
import { runChatTurn } from "../claude/tools";

export const VIEW_TYPE_CHAT = "vaultforge-chat";

export class VaultForgeChatView extends ItemView {
	private plugin: VaultForgePlugin;
	private history: ClaudeMessage[] = [];
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

		const apiKey = this.plugin.getAnthropicApiKey();
		if (!apiKey) {
			container.createDiv({ cls: "vaultforge-chat-empty" }, (el) => {
				el.createEl("p", {
					text: "Kein Anthropic-API-Key hinterlegt. Bitte in den VaultForge-Einstellungen unter 'Chat' eintragen.",
				});
			});
			return;
		}

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
		for (const message of this.history) {
			for (const block of message.content) {
				this.appendBlock(message.role, block);
			}
		}
		this.scrollToBottom();
	}

	private appendBlock(role: "user" | "assistant", block: ContentBlock): void {
		if (block.type === "text" && block.text.trim().length > 0) {
			const bubble = this.messagesEl.createDiv({ cls: `vaultforge-chat-bubble vaultforge-chat-${role}` });
			bubble.createEl("p", { text: block.text });
		} else if (block.type === "tool_use") {
			this.messagesEl.createDiv({
				cls: "vaultforge-chat-tool-call",
				text: `🔧 ${block.name}(${JSON.stringify(block.input)})`,
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
		this.messagesEl.createDiv({ cls: "vaultforge-chat-bubble vaultforge-chat-user" }).createEl("p", { text });
		this.scrollToBottom();
		this.setBusy(true);

		try {
			const result = await runChatTurn(
				this.app,
				{
					apiKey: this.plugin.getAnthropicApiKey(),
					model: this.plugin.settings.chatModel,
					skillsFolder: this.plugin.settings.skillsFolder,
				},
				text,
				this.history
			);
			this.history = result.messages;
			this.renderHistory();
		} catch (err) {
			const message = err instanceof ClaudeApiError ? err.message : `Fehler: ${(err as Error).message}`;
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
