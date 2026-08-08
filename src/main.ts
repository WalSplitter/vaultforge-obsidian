import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { randomBytes } from "crypto";
import { VaultForgeMcpServer } from "./mcp/server";
import { createSkillScaffold, listSkills } from "./skills";
import { VIEW_TYPE_CHAT, VaultForgeChatView } from "./chat/ChatView";

interface VaultForgeSettings {
	mcpServerEnabled: boolean;
	mcpServerPort: number;
	chatModel: string;
	skillsFolder: string;
}

const DEFAULT_SETTINGS: VaultForgeSettings = {
	mcpServerEnabled: false,
	mcpServerPort: 27124,
	chatModel: "claude-sonnet-5",
	skillsFolder: "Skills",
};

// Device-local storage (app.loadLocalStorage), NOT part of the vault's files:
// survives outside data.json so it never travels with a synced/shared vault.
const API_KEY_STORAGE_KEY = "vaultforge-mcp-api-key";
const ANTHROPIC_KEY_STORAGE_KEY = "vaultforge-anthropic-api-key";

export default class VaultForgePlugin extends Plugin {
	settings!: VaultForgeSettings;
	mcpServer = new VaultForgeMcpServer();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new VaultForgeSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new VaultForgeChatView(leaf, this));
		this.addRibbonIcon("message-circle", "VaultForge Chat", () => void this.activateChatView());
		this.addCommand({
			id: "open-chat",
			name: "Chat öffnen",
			callback: () => void this.activateChatView(),
		});

		if (this.settings.mcpServerEnabled) {
			await this.startMcpServer();
		}
	}

	async onunload() {
		await this.mcpServer.stop();
	}

	async activateChatView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	getApiKey(): string {
		const existing = this.app.loadLocalStorage(API_KEY_STORAGE_KEY);
		if (typeof existing === "string" && existing.length > 0) {
			return existing;
		}
		const generated = randomBytes(24).toString("hex");
		this.app.saveLocalStorage(API_KEY_STORAGE_KEY, generated);
		return generated;
	}

	async regenerateApiKey(): Promise<string> {
		const generated = randomBytes(24).toString("hex");
		this.app.saveLocalStorage(API_KEY_STORAGE_KEY, generated);
		if (this.mcpServer.isRunning) {
			await this.startMcpServer();
		}
		return generated;
	}

	getAnthropicApiKey(): string {
		const existing = this.app.loadLocalStorage(ANTHROPIC_KEY_STORAGE_KEY);
		return typeof existing === "string" ? existing : "";
	}

	setAnthropicApiKey(key: string): void {
		this.app.saveLocalStorage(ANTHROPIC_KEY_STORAGE_KEY, key.trim().length > 0 ? key.trim() : null);
	}

	async startMcpServer(): Promise<void> {
		try {
			await this.mcpServer.start({
				app: this.app,
				port: this.settings.mcpServerPort,
				apiKey: this.getApiKey(),
				skillsFolder: this.settings.skillsFolder,
			});
			new Notice(`VaultForge MCP-Server läuft auf 127.0.0.1:${this.settings.mcpServerPort}`);
		} catch (err) {
			new Notice(`VaultForge: MCP-Server konnte nicht gestartet werden: ${(err as Error).message}`);
			throw err;
		}
	}

	async stopMcpServer(): Promise<void> {
		await this.mcpServer.stop();
	}

	async loadSettings() {
		const loaded: Record<string, unknown> = (await this.loadData()) ?? {};
		// Migration: earlier versions stored the API key in data.json (vault-synced,
		// plaintext). Strip it on load so it stops shipping with the vault.
		const hadLegacyKey = "mcpApiKey" in loaded;
		delete loaded.mcpApiKey;

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (hadLegacyKey) {
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VaultForgeSettingTab extends PluginSettingTab {
	plugin: VaultForgePlugin;

	constructor(app: App, plugin: VaultForgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("MCP-Server aktivieren")
			.setDesc(
				"Startet einen lokalen MCP-Server (nur 127.0.0.1) für Claude Code / Claude Desktop mit Vault- und Skills-Zugriff."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.mcpServerEnabled).onChange(async (value) => {
					this.plugin.settings.mcpServerEnabled = value;
					await this.plugin.saveSettings();
					try {
						if (value) {
							await this.plugin.startMcpServer();
						} else {
							await this.plugin.stopMcpServer();
						}
					} finally {
						this.display();
					}
				})
			);

		new Setting(containerEl)
			.setName("MCP-Server-Port")
			.setDesc("Lokaler Port für den MCP-Server. Änderung erfordert Neustart des Servers.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.mcpServerPort)).onChange(async (value) => {
					const port = Number(value);
					if (!Number.isNaN(port)) {
						this.plugin.settings.mcpServerPort = port;
						await this.plugin.saveSettings();
					}
				})
			);

		let apiKeyText: HTMLInputElement;
		const apiKeySetting = new Setting(containerEl)
			.setName("API-Key")
			.setDesc(
				"Als Bearer-Token im Authorization-Header an den MCP-Server senden. Geräte-lokal gespeichert " +
					"(nicht in der Vault-Datei) - reist nicht mit, falls die Vault synchronisiert oder geteilt wird."
			)
			.addText((text) => {
				apiKeyText = text.inputEl;
				text.setValue(this.plugin.getApiKey());
				text.inputEl.readOnly = true;
				text.inputEl.type = "password";
				text.inputEl.addClass("vaultforge-api-key");
			});

		apiKeySetting.addExtraButton((btn) =>
			btn
				.setIcon("eye")
				.setTooltip("Anzeigen/Verbergen")
				.onClick(() => {
					const showing = apiKeyText.type === "text";
					apiKeyText.type = showing ? "password" : "text";
					btn.setIcon(showing ? "eye" : "eye-off");
				})
		);

		apiKeySetting.addExtraButton((btn) =>
			btn
				.setIcon("refresh-cw")
				.setTooltip("Neu generieren")
				.onClick(async () => {
					const confirmed = window.confirm(
						"API-Key neu generieren? Bereits konfigurierte MCP-Clients (Claude Code/Desktop) verlieren den Zugriff, bis der neue Key dort eingetragen ist."
					);
					if (!confirmed) return;
					await this.plugin.regenerateApiKey();
					new Notice("VaultForge: API-Key neu generiert.");
					this.display();
				})
		);

		new Setting(containerEl).setName("Chat").setHeading();

		let anthropicKeyText: HTMLInputElement;
		const anthropicKeySetting = new Setting(containerEl)
			.setName("Anthropic-API-Key")
			.setDesc(
				"Wird für den eingebauten Chat/Coding-Assistenten verwendet (direkte Anfragen an die Anthropic-API). " +
					"Geräte-lokal gespeichert, nicht in der Vault-Datei."
			)
			.addText((text) => {
				anthropicKeyText = text.inputEl;
				text.setValue(this.plugin.getAnthropicApiKey());
				text.inputEl.type = "password";
				text.inputEl.addClass("vaultforge-api-key");
				text.onChange((value) => this.plugin.setAnthropicApiKey(value));
			});

		anthropicKeySetting.addExtraButton((btn) =>
			btn
				.setIcon("eye")
				.setTooltip("Anzeigen/Verbergen")
				.onClick(() => {
					const showing = anthropicKeyText.type === "text";
					anthropicKeyText.type = showing ? "password" : "text";
					btn.setIcon(showing ? "eye" : "eye-off");
				})
		);

		new Setting(containerEl)
			.setName("Chat-Modell")
			.setDesc("Anthropic-Modell-ID für den Chat-Assistenten.")
			.addText((text) =>
				text.setValue(this.plugin.settings.chatModel).onChange(async (value) => {
					if (value.trim().length === 0) return;
					this.plugin.settings.chatModel = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Claude Skills").setHeading();

		new Setting(containerEl)
			.setName("Skills-Ordner")
			.setDesc(
				"Vault-relativer Ordner, dessen Unterordner mit einer SKILL.md als Claude Skills erkannt werden."
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.skillsFolder).onChange(async (value) => {
					if (value.trim().length === 0) return;
					this.plugin.settings.skillsFolder = value.trim();
					await this.plugin.saveSettings();
					this.renderSkillsList();
				})
			);

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText("Neuen Skill anlegen").onClick(() => {
					new NewSkillModal(this.app, async (name) => {
						try {
							await createSkillScaffold(this.app, this.plugin.settings.skillsFolder, name);
							new Notice(`VaultForge: Skill '${name}' angelegt.`);
							await this.renderSkillsList();
						} catch (err) {
							new Notice(`VaultForge: ${(err as Error).message}`);
						}
					}).open();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Aktualisieren").onClick(() => void this.renderSkillsList())
			);

		this.skillsListEl = containerEl.createDiv({ cls: "vaultforge-skills-list" });
		void this.renderSkillsList();
	}

	private skillsListEl!: HTMLElement;

	async renderSkillsList(): Promise<void> {
		if (!this.skillsListEl) return;
		this.skillsListEl.empty();

		const skills = await listSkills(this.app, this.plugin.settings.skillsFolder);
		if (skills.length === 0) {
			this.skillsListEl.createEl("p", {
				cls: "setting-item-description",
				text: `Keine Skills in '${this.plugin.settings.skillsFolder}' gefunden.`,
			});
			return;
		}

		for (const skill of skills) {
			const row = new Setting(this.skillsListEl).setName(skill.name).setDesc(skill.description || skill.path);
			row.addExtraButton((btn) =>
				btn
					.setIcon("file-text")
					.setTooltip("Öffnen")
					.onClick(async () => {
						const file = this.app.vault.getAbstractFileByPath(skill.path);
						if (file instanceof TFile) {
							await this.app.workspace.getLeaf(false).openFile(file);
						}
					})
			);
			row.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Löschen")
					.onClick(async () => {
						const confirmed = window.confirm(`Skill '${skill.name}' (${skill.folder}) unwiderruflich löschen?`);
						if (!confirmed) return;
						const folder = this.app.vault.getAbstractFileByPath(skill.folder);
						if (folder) await this.app.vault.delete(folder, true);
						new Notice(`VaultForge: Skill '${skill.name}' gelöscht.`);
						await this.renderSkillsList();
					})
			);
		}
	}
}

class NewSkillModal extends Modal {
	private onSubmit: (name: string) => void;

	constructor(app: App, onSubmit: (name: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Neuen Skill anlegen" });

		let value = "";
		new Setting(contentEl).setName("Name").addText((text) =>
			text.onChange((v) => (value = v))
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Anlegen")
				.setCta()
				.onClick(() => {
					if (value.trim().length === 0) return;
					this.onSubmit(value.trim());
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
