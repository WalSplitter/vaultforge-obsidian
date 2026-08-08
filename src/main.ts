import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { randomBytes } from "crypto";
import { VaultForgeMcpServer } from "./mcp/server";

interface VaultForgeSettings {
	mcpServerEnabled: boolean;
	mcpServerPort: number;
	mcpApiKey: string;
}

const DEFAULT_SETTINGS: VaultForgeSettings = {
	mcpServerEnabled: false,
	mcpServerPort: 27124,
	mcpApiKey: "",
};

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

	async startMcpServer(): Promise<void> {
		if (!this.settings.mcpApiKey) {
			this.settings.mcpApiKey = randomBytes(24).toString("hex");
			await this.saveSettings();
		}
		try {
			await this.mcpServer.start({
				app: this.app,
				port: this.settings.mcpServerPort,
				apiKey: this.settings.mcpApiKey,
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

		if (this.plugin.settings.mcpApiKey) {
			new Setting(containerEl)
				.setName("API-Key")
				.setDesc("Als Bearer-Token im Authorization-Header an den MCP-Server senden.")
				.addText((text) => {
					text.setValue(this.plugin.settings.mcpApiKey);
					text.inputEl.readOnly = true;
					text.inputEl.addClass("vaultforge-api-key");
				});
		}
	}
}
