import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { randomBytes } from "crypto";
import { VaultForgeMcpServer } from "./mcp/server";
import { createSkillScaffold, listSkills } from "./skills";
import { VIEW_TYPE_CHAT, VaultForgeChatView } from "./chat/ChatView";
import { AgentCliError, runChatTurn } from "./claude/agent";
import { t } from "./i18n";

interface VaultForgeSettings {
	mcpServerEnabled: boolean;
	mcpServerPort: number;
	chatModel: string;
	skillsFolder: string;
	/** Override for locating the `claude` CLI when it isn't on PATH (e.g. Obsidian launched outside a shell). */
	claudeCliPath: string;
}

const DEFAULT_SETTINGS: VaultForgeSettings = {
	mcpServerEnabled: false,
	mcpServerPort: 27124,
	chatModel: "claude-sonnet-5",
	skillsFolder: "Skills",
	claudeCliPath: "",
};

// Device-local storage (app.loadLocalStorage), NOT part of the vault's files:
// survives outside data.json so it never travels with a synced/shared vault.
const API_KEY_STORAGE_KEY = "vaultforge-mcp-api-key";

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
			name: t("commandOpenChat"),
			callback: () => void this.activateChatView(),
		});

		if (this.settings.mcpServerEnabled) {
			await this.startMcpServer();
		}
	}

	onunload(): void {
		// Plugin.onunload() must return void - Obsidian doesn't await it, so
		// the server close is intentionally fire-and-forget here.
		void this.mcpServer.stop();
	}

	async activateChatView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	getApiKey(): string {
		const existing = this.app.loadLocalStorage(API_KEY_STORAGE_KEY) as string | null;
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

	async startMcpServer(): Promise<void> {
		try {
			await this.mcpServer.start({
				app: this.app,
				port: this.settings.mcpServerPort,
				apiKey: this.getApiKey(),
				skillsFolder: this.settings.skillsFolder,
			});
			new Notice(t("noticeMcpServerRunning", { port: this.settings.mcpServerPort }));
		} catch (err) {
			new Notice(t("noticeMcpServerStartFailed", { message: (err as Error).message }));
			throw err;
		}
	}

	async stopMcpServer(): Promise<void> {
		await this.mcpServer.stop();
	}

	async loadSettings() {
		const loaded = ((await this.loadData()) ?? {}) as Record<string, unknown>;
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
			.setName(t("settingMcpEnableName"))
			.setDesc(t("settingMcpEnableDesc"))
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
			.setName(t("settingMcpPortName"))
			.setDesc(t("settingMcpPortDesc"))
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
			.setName(t("settingApiKeyName"))
			.setDesc(t("settingApiKeyDesc"))
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
				.setTooltip(t("tooltipShowHideKey"))
				.onClick(() => {
					const showing = apiKeyText.type === "text";
					apiKeyText.type = showing ? "password" : "text";
					btn.setIcon(showing ? "eye" : "eye-off");
				})
		);

		apiKeySetting.addExtraButton((btn) =>
			btn
				.setIcon("refresh-cw")
				.setTooltip(t("tooltipRegenerateKey"))
				.onClick(async () => {
					const confirmed = await confirmDialog(this.app, t("confirmRegenerateKey"));
					if (!confirmed) return;
					await this.plugin.regenerateApiKey();
					new Notice(t("noticeApiKeyRegenerated"));
					this.display();
				})
		);

		new Setting(containerEl).setName("Chat").setHeading();

		new Setting(containerEl).setName(t("settingLoginName")).setDesc(t("settingLoginDesc"));

		let cliPathText: HTMLInputElement;
		new Setting(containerEl)
			.setName(t("settingCliPathName"))
			.setDesc(t("settingCliPathDesc"))
			.addText((text) => {
				cliPathText = text.inputEl;
				text.setValue(this.plugin.settings.claudeCliPath);
				text.setPlaceholder(t("cliPathPlaceholder"));
				text.onChange(async (value) => {
					this.plugin.settings.claudeCliPath = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t("settingChatModelName"))
			.setDesc(t("settingChatModelDesc"))
			.addText((text) =>
				text.setValue(this.plugin.settings.chatModel).onChange(async (value) => {
					if (value.trim().length === 0) return;
					this.plugin.settings.chatModel = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("settingTestConnectionName"))
			.setDesc(t("settingTestConnectionDesc"))
			.addButton((btn) =>
				btn.setButtonText(t("buttonTest")).onClick(async () => {
					btn.setDisabled(true).setButtonText(t("buttonTesting"));
					try {
						await runChatTurn(
							this.app,
							{
								model: this.plugin.settings.chatModel,
								skillsFolder: this.plugin.settings.skillsFolder,
								cliPath: cliPathText.value.trim() || undefined,
							},
							t("testPingPrompt")
						);
						new Notice(t("noticeConnectionSuccess"));
					} catch (err) {
						const message = err instanceof AgentCliError ? err.message : (err as Error).message;
						new Notice(`VaultForge: ${message}`, 10000);
					} finally {
						btn.setDisabled(false).setButtonText(t("buttonTest"));
					}
				})
			);

		new Setting(containerEl).setName("Claude Skills").setHeading();

		new Setting(containerEl)
			.setName(t("settingSkillsFolderName"))
			.setDesc(t("settingSkillsFolderDesc"))
			.addText((text) =>
				text.setValue(this.plugin.settings.skillsFolder).onChange(async (value) => {
					if (value.trim().length === 0) return;
					this.plugin.settings.skillsFolder = value.trim();
					await this.plugin.saveSettings();
					await this.renderSkillsList();
				})
			);

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText(t("buttonNewSkill")).onClick(() => {
					new NewSkillModal(this.app, async (name) => {
						try {
							await createSkillScaffold(this.app, this.plugin.settings.skillsFolder, name);
							new Notice(t("noticeSkillCreated", { name }));
							await this.renderSkillsList();
						} catch (err) {
							new Notice(`VaultForge: ${(err as Error).message}`);
						}
					}).open();
				})
			)
			.addButton((btn) =>
				btn.setButtonText(t("buttonRefreshSkills")).onClick(() => void this.renderSkillsList())
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
				text: t("noSkillsFound", { folder: this.plugin.settings.skillsFolder }),
			});
			return;
		}

		for (const skill of skills) {
			const row = new Setting(this.skillsListEl).setName(skill.name).setDesc(skill.description || skill.path);
			row.addExtraButton((btn) =>
				btn
					.setIcon("file-text")
					.setTooltip(t("tooltipOpenSkill"))
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
					.setTooltip(t("tooltipDeleteSkill"))
					.onClick(async () => {
						const confirmed = await confirmDialog(
							this.app,
							t("confirmDeleteSkill", { name: skill.name, folder: skill.folder })
						);
						if (!confirmed) return;
						const folder = this.app.vault.getAbstractFileByPath(skill.folder);
						if (folder) await this.app.fileManager.trashFile(folder);
						new Notice(t("noticeSkillDeleted", { name: skill.name }));
						await this.renderSkillsList();
					})
			);
		}
	}
}

class NewSkillModal extends Modal {
	private onSubmit: (name: string) => void | Promise<void>;

	constructor(app: App, onSubmit: (name: string) => void | Promise<void>) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: t("buttonNewSkill") });

		let value = "";
		new Setting(contentEl).setName("Name").addText((text) =>
			text.onChange((v) => (value = v))
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(t("buttonCreateSkill"))
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

/** Obsidian-native replacement for `window.confirm()`, which the review guidelines flag. */
class ConfirmModal extends Modal {
	private message: string;
	private onChoice: (confirmed: boolean) => void;

	constructor(app: App, message: string, onChoice: (confirmed: boolean) => void) {
		super(app);
		this.message = message;
		this.onChoice = onChoice;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t("buttonCancel")).onClick(() => {
					this.onChoice(false);
					this.close();
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText(t("buttonConfirm"))
					.setWarning()
					.onClick(() => {
						this.onChoice(true);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function confirmDialog(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, message, resolve).open();
	});
}
