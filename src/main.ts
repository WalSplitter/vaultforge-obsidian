import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

interface VaultForgeSettings {
	mcpServerEnabled: boolean;
	mcpServerPort: number;
}

const DEFAULT_SETTINGS: VaultForgeSettings = {
	mcpServerEnabled: false,
	mcpServerPort: 27124,
};

export default class VaultForgePlugin extends Plugin {
	settings!: VaultForgeSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new VaultForgeSettingTab(this.app, this));
	}

	onunload() {}

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
			.setDesc("Startet einen lokalen MCP-Server für Claude Code / Claude Desktop mit Vault- und Skills-Zugriff.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.mcpServerEnabled).onChange(async (value) => {
					this.plugin.settings.mcpServerEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("MCP-Server-Port")
			.setDesc("Lokaler Port für den MCP-Server.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.mcpServerPort)).onChange(async (value) => {
					const port = Number(value);
					if (!Number.isNaN(port)) {
						this.plugin.settings.mcpServerPort = port;
						await this.plugin.saveSettings();
					}
				})
			);
	}
}
