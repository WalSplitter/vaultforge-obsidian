import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { randomBytes } from "crypto";
import { VaultForgeMcpServer } from "./mcp/server";

interface VaultForgeSettings {
	mcpServerEnabled: boolean;
	mcpServerPort: number;
}

const DEFAULT_SETTINGS: VaultForgeSettings = {
	mcpServerEnabled: false,
	mcpServerPort: 27124,
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

		if (this.settings.mcpServerEnabled) {
			await this.startMcpServer();
		}
	}

	async onunload() {
		await this.mcpServer.stop();
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

	async startMcpServer(): Promise<void> {
		try {
			await this.mcpServer.start({
				app: this.app,
				port: this.settings.mcpServerPort,
				apiKey: this.getApiKey(),
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
	}
}
