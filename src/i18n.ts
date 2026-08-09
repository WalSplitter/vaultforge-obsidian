/**
 * Minimal DE/EN string table for VaultForge's Obsidian-facing UI (settings tab,
 * modals, notices, chat view, and errors surfaced to the user). Locale is
 * detected once from Obsidian's own configured display language, so it
 * follows whatever the user picked in Obsidian's General settings rather
 * than the system locale.
 *
 * Out of scope on purpose: MCP tool descriptions/titles and the chat system
 * prompt (src/claude/agent.ts, src/mcp/server.ts) are consumed by the model,
 * not read by a human in the UI, so they stay as authored and aren't part of
 * this dictionary.
 */

import { getLanguage } from "obsidian";

export type Locale = "en" | "de";

function detectLocale(): Locale {
	return getLanguage().toLowerCase().startsWith("de") ? "de" : "en";
}

export const locale: Locale = detectLocale();

const en = {
	commandOpenChat: "Open chat",

	noticeMcpServerRunning: "VaultForge MCP server running on 127.0.0.1:{port}",
	noticeMcpServerStartFailed: "VaultForge: could not start MCP server: {message}",

	settingMcpEnableName: "Enable MCP server",
	settingMcpEnableDesc:
		"Starts a local MCP server (127.0.0.1 only) that gives Claude Code / Claude Desktop access to your vault and skills.",
	settingMcpPortName: "MCP server port",
	settingMcpPortDesc: "Local port for the MCP server. Changing it requires restarting the server.",

	settingApiKeyName: "API key",
	settingApiKeyDesc:
		"Sent as a bearer token in the Authorization header to the MCP server. Stored device-locally " +
		"(not in the vault file) - it does not travel with the vault if it's synced or shared.",
	tooltipShowHideKey: "Show/hide",
	tooltipRegenerateKey: "Regenerate",
	buttonConfirm: "Confirm",
	buttonCancel: "Cancel",
	confirmRegenerateKey:
		"Regenerate the API key? Already-configured MCP clients (Claude Code/Desktop) will lose access until the new key is entered there.",
	noticeApiKeyRegenerated: "VaultForge: API key regenerated.",

	settingLoginName: "Login",
	settingLoginDesc:
		"Chat runs on the Claude Agent SDK, i.e. through a locally installed Claude Code CLI - no separate " +
		"Anthropic API key in this plugin. Usage is billed through that CLI's own login (a Claude Pro/Max " +
		"subscription, or its own API key). Run once in a terminal: `claude login` (opens the browser login).",

	settingCliPathName: "Path to claude CLI (optional)",
	settingCliPathDesc:
		"Only needed if 'claude' isn't found automatically (e.g. because Obsidian wasn't launched from a shell " +
		"with a full PATH). Leave empty for auto-detection.",
	cliPathPlaceholder: "e.g. C:\\Users\\<you>\\AppData\\Roaming\\npm\\claude.cmd",

	settingChatModelName: "Chat model",
	settingChatModelDesc: "Claude model ID for the chat assistant.",

	settingTestConnectionName: "Test connection",
	settingTestConnectionDesc: "Checks whether the claude CLI can be found and is logged in (sends a minimal test request).",
	buttonTest: "Test",
	buttonTesting: "Checking...",
	testPingPrompt: "Reply with 'OK' only.",
	noticeConnectionSuccess: "VaultForge: connection to the claude CLI succeeded.",

	settingSkillsFolderName: "Skills folder",
	settingSkillsFolderDesc: "Vault-relative folder whose subfolders containing a SKILL.md are recognized as Claude Skills.",
	buttonNewSkill: "Create new skill",
	buttonRefreshSkills: "Refresh",
	noticeSkillCreated: "VaultForge: skill '{name}' created.",
	noSkillsFound: "No skills found in '{folder}'.",
	tooltipOpenSkill: "Open",
	tooltipDeleteSkill: "Delete",
	confirmDeleteSkill: "Permanently delete skill '{name}' ({folder})?",
	noticeSkillDeleted: "VaultForge: skill '{name}' deleted.",
	buttonCreateSkill: "Create",

	chatHintText:
		"Uses the locally installed Claude Code CLI (Pro/Max login or its own API key) - no separate Anthropic " +
		"API key in this plugin. If 'claude' isn't found or isn't logged in, see Settings \u2192 VaultForge \u2192 Chat.",
	chatInputPlaceholder: "Message VaultForge... (Enter = send, Shift+Enter = new line)",
	buttonSend: "Send",
	chatErrorPrefix: "Error: {message}",
	noticeChatError: "VaultForge Chat: {message}",

	errCliResultError: "Claude CLI error ({subtype}): {errors}",
	errUnknown: "unknown",
	errCliNotFound:
		"The Claude Code CLI (`claude`) was not found. Please install it (npm i -g @anthropic-ai/claude-code, or " +
		"the official installer) and set the path in VaultForge's settings if it isn't on PATH. Details: {message}",
	errNotAuthenticated: "Not logged in to Claude Code. Please run `claude login` in a terminal.",
	errNoResponse: "The claude CLI returned no response.",

	errSkillNameEmpty: "Skill name must not be empty",
	errSkillExists: "Skill already exists: {path}",
	templateDescriptionTodo: "TODO - briefly describe when this skill should apply",
	templateBodyTodo: "TODO: write out the instructions for this skill here.",
} as const;

type StringKey = keyof typeof en;

const de: Record<StringKey, string> = {
	commandOpenChat: "Chat öffnen",

	noticeMcpServerRunning: "VaultForge MCP-Server läuft auf 127.0.0.1:{port}",
	noticeMcpServerStartFailed: "VaultForge: MCP-Server konnte nicht gestartet werden: {message}",

	settingMcpEnableName: "MCP-Server aktivieren",
	settingMcpEnableDesc:
		"Startet einen lokalen MCP-Server (nur 127.0.0.1) für Claude Code / Claude Desktop mit Vault- und Skills-Zugriff.",
	settingMcpPortName: "MCP-Server-Port",
	settingMcpPortDesc: "Lokaler Port für den MCP-Server. Änderung erfordert Neustart des Servers.",

	settingApiKeyName: "API-Key",
	settingApiKeyDesc:
		"Als Bearer-Token im Authorization-Header an den MCP-Server senden. Geräte-lokal gespeichert " +
		"(nicht in der Vault-Datei) - reist nicht mit, falls die Vault synchronisiert oder geteilt wird.",
	tooltipShowHideKey: "Anzeigen/Verbergen",
	tooltipRegenerateKey: "Neu generieren",
	buttonConfirm: "Bestätigen",
	buttonCancel: "Abbrechen",
	confirmRegenerateKey:
		"API-Key neu generieren? Bereits konfigurierte MCP-Clients (Claude Code/Desktop) verlieren den Zugriff, bis der neue Key dort eingetragen ist.",
	noticeApiKeyRegenerated: "VaultForge: API-Key neu generiert.",

	settingLoginName: "Anmeldung",
	settingLoginDesc:
		"Der Chat läuft über das Claude Agent SDK, d.h. über eine lokal installierte Claude-Code-CLI — " +
		"kein eigener Anthropic-API-Key in diesem Plugin. Nutzung wird über die Anmeldung dieser CLI " +
		"abgerechnet (Claude Pro/Max-Abo oder deren eigener API-Key). Einmalig in einem Terminal " +
		"ausführen: `claude login` (öffnet den Browser-Login).",

	settingCliPathName: "Pfad zur claude-CLI (optional)",
	settingCliPathDesc:
		"Nur nötig, falls 'claude' nicht automatisch gefunden wird (z.B. weil Obsidian nicht aus einer " +
		"Shell mit vollem PATH gestartet wurde). Leer lassen für Auto-Erkennung.",
	cliPathPlaceholder: "z.B. C:\\Users\\<du>\\AppData\\Roaming\\npm\\claude.cmd",

	settingChatModelName: "Chat-Modell",
	settingChatModelDesc: "Claude-Modell-ID für den Chat-Assistenten.",

	settingTestConnectionName: "Verbindung testen",
	settingTestConnectionDesc: "Prüft, ob die claude-CLI gefunden und angemeldet ist (sendet eine minimale Testanfrage).",
	buttonTest: "Testen",
	buttonTesting: "Prüfe...",
	testPingPrompt: "Antworte ausschließlich mit 'OK'.",
	noticeConnectionSuccess: "VaultForge: Verbindung zur claude-CLI erfolgreich.",

	settingSkillsFolderName: "Skills-Ordner",
	settingSkillsFolderDesc: "Vault-relativer Ordner, dessen Unterordner mit einer SKILL.md als Claude Skills erkannt werden.",
	buttonNewSkill: "Neuen Skill anlegen",
	buttonRefreshSkills: "Aktualisieren",
	noticeSkillCreated: "VaultForge: Skill '{name}' angelegt.",
	noSkillsFound: "Keine Skills in '{folder}' gefunden.",
	tooltipOpenSkill: "Öffnen",
	tooltipDeleteSkill: "Löschen",
	confirmDeleteSkill: "Skill '{name}' ({folder}) unwiderruflich löschen?",
	noticeSkillDeleted: "VaultForge: Skill '{name}' gelöscht.",
	buttonCreateSkill: "Anlegen",

	chatHintText:
		"Nutzt die lokal installierte Claude-Code-CLI (Pro/Max-Anmeldung oder deren eigener API-Key) — " +
		"kein separater Anthropic-API-Key in diesem Plugin. Falls 'claude' nicht gefunden wird oder " +
		"nicht angemeldet ist, siehe Einstellungen → VaultForge → Chat.",
	chatInputPlaceholder: "Nachricht an VaultForge... (Enter = senden, Shift+Enter = neue Zeile)",
	buttonSend: "Senden",
	chatErrorPrefix: "Fehler: {message}",
	noticeChatError: "VaultForge Chat: {message}",

	errCliResultError: "Claude-CLI-Fehler ({subtype}): {errors}",
	errUnknown: "unbekannt",
	errCliNotFound:
		"Claude-Code-CLI (`claude`) wurde nicht gefunden. Bitte installieren (npm i -g @anthropic-ai/claude-code " +
		"oder offizielles Installationsprogramm) und in den VaultForge-Einstellungen den Pfad hinterlegen, " +
		"falls sie nicht im PATH liegt. Details: {message}",
	errNotAuthenticated: "Nicht bei Claude Code angemeldet. Bitte in einem Terminal `claude login` ausführen.",
	errNoResponse: "Claude-CLI hat keine Antwort geliefert.",

	errSkillNameEmpty: "Skill-Name darf nicht leer sein",
	errSkillExists: "Skill existiert bereits: {path}",
	templateDescriptionTodo: "TODO - kurz beschreiben, wann dieser Skill greifen soll",
	templateBodyTodo: "TODO: Anleitung für diesen Skill hier ausformulieren.",
};

const dictionaries: Record<Locale, Record<StringKey, string>> = { en, de };

export function t(key: StringKey, vars?: Record<string, string | number>): string {
	let str = dictionaries[locale][key] ?? en[key];
	if (vars) {
		for (const [name, value] of Object.entries(vars)) {
			str = str.split(`{${name}}`).join(String(value));
		}
	}
	return str;
}
