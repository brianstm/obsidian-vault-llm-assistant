import { MarkdownView, Notice, Plugin, TFile, moment, normalizePath, type Editor, type MarkdownFileInfo, type WorkspaceLeaf } from "obsidian";
import { AssistantView, VIEW_TYPE } from "./view";
import { QueryModal, TemplatePickerModal } from "./modals";
import { VaultLLMAssistantSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings";
import { decryptLegacyKey } from "./legacy-keys";
import { PROVIDERS, complete, normalizeBaseUrl, type ProviderConfig } from "./providers";
import { TITLE_SYSTEM_PROMPT, cleanTitle, titlePrompt } from "./prompts";
import { runTemplate } from "./templates";
import type { CompletionRequest, ProviderId, VaultLLMAssistantSettings } from "./types";

export default class VaultLLMAssistant extends Plugin {
	settings: VaultLLMAssistantSettings = { ...DEFAULT_SETTINGS };
	private statusBarEl: HTMLElement | null = null;
	private templateCommandIds: string[] = [];

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new AssistantView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE, { display: "Vault LLM Assistant", defaultMod: true });

		this.addRibbonIcon("bot", "Open Vault LLM Assistant", () => {
			void this.activateView();
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("mod-clickable", "vault-llm-status");
		this.registerDomEvent(this.statusBarEl, "click", () => {
			void this.activateView();
		});
		this.updateStatusBar();

		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "Start a new chat",
			callback: () => {
				void this.activateView().then((view) => view?.clearChat());
			},
		});

		this.addCommand({
			id: "scan-vault-ask-question",
			name: "Ask a question about your vault",
			callback: () => {
				new QueryModal(this.app, this, null, "query").open();
			},
		});

		this.addCommand({
			id: "scan-current-file-ask-question",
			name: "Ask a question about the current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) new QueryModal(this.app, this, file, "query", "current").open();
				return true;
			},
		});

		this.addCommand({
			id: "create-note-on-topic",
			name: "Create a note about a topic",
			callback: () => {
				new QueryModal(this.app, this, this.app.workspace.getActiveFile(), "create").open();
			},
		});

		this.addCommand({
			id: "run-prompt-template",
			name: "Run a prompt template on the selection or note",
			editorCallback: (editor, ctx) => {
				new TemplatePickerModal(this.app, this, editor, ctx).open();
			},
		});

		this.registerTemplateCommands();

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				menu.addItem((item) =>
					item
						.setTitle("Run AI prompt template...")
						.setIcon("bot")
						.onClick(() => new TemplatePickerModal(this.app, this, editor, info).open()),
				);
			}),
		);

		this.addSettingTab(new VaultLLMAssistantSettingTab(this.app, this));
	}

	async loadSettings() {
		const { settings, legacyKeys, changed } = migrateSettings(await this.loadData());
		this.settings = settings;

		let moved = 0;
		for (const [id, legacy] of Object.entries(legacyKeys) as [ProviderId, { value: string; encrypted: boolean }][]) {
			const key = legacy.encrypted ? decryptLegacyKey(this.app, legacy.value) : legacy.value;
			if (!key) continue;
			const preferred = PROVIDERS[id].defaultSecretId ?? `${id}-api-key`;
			const existing = this.app.secretStorage.getSecret(preferred);
			const secretId = existing && existing !== key ? `vault-llm-${id}-api-key` : preferred;
			this.app.secretStorage.setSecret(secretId, key);
			this.settings.secretIds[id] = secretId;
			moved++;
		}
		if (changed) {
			await this.saveSettings();
			if (moved > 0) {
				new Notice(
					`Vault LLM Assistant: your API key${moved === 1 ? " is" : "s are"} now kept in Obsidian's secret storage.`,
				);
			} else if (Object.keys(legacyKeys).length > 0) {
				new Notice("Vault LLM Assistant: please add your API key again in the plugin settings.", 10000);
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStatusBar();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof AssistantView) leaf.view.refreshHeader();
		}
	}

	getModel(id: ProviderId = this.settings.provider): string {
		return this.settings.models[id] || PROVIDERS[id].defaultModel;
	}

	getSecretId(id: ProviderId): string {
		return this.settings.secretIds[id] ?? PROVIDERS[id].defaultSecretId ?? "";
	}

	getProviderConfig(id: ProviderId = this.settings.provider): ProviderConfig {
		const provider = PROVIDERS[id];
		const secretId = this.getSecretId(id);
		const apiKey = provider.apiKey !== "none" && secretId ? (this.app.secretStorage.getSecret(secretId) ?? "") : "";
		return {
			provider,
			model: this.getModel(id),
			baseUrl: normalizeBaseUrl(this.settings.baseUrls[id] || provider.defaultBaseUrl, provider.kind),
			apiKey: apiKey.trim(),
			maxTokens: this.settings.maxTokens,
			temperature: this.settings.temperature,
			reasoningEffort: this.settings.reasoningEffort,
		};
	}

	async complete(request: CompletionRequest): Promise<string> {
		return complete(this.getProviderConfig(), request);
	}

	modelLabel(): string {
		const id = this.settings.provider;
		const model = this.getModel(id);
		const known = this.settings.fetchedModels[id]?.find((m) => m.id === model);
		return known?.name ?? (model || PROVIDERS[id].name);
	}

	private updateStatusBar() {
		this.statusBarEl?.setText(`AI: ${this.modelLabel()}`);
	}

	fallbackTitle(): string {
		return `AI note ${moment().format("YYYY-MM-DD HHmm")}`;
	}

	async generateTitle(query: string, response: string): Promise<string> {
		if (!this.settings.generateTitlesWithLLM) {
			return cleanTitle(query, this.fallbackTitle());
		}
		try {
			const title = await this.complete({
				system: TITLE_SYSTEM_PROMPT,
				messages: [{ role: "user", content: titlePrompt(query, response) }],
			});
			return cleanTitle(title, cleanTitle(query, this.fallbackTitle()));
		} catch (err) {
			console.error("Vault LLM Assistant: could not generate a title", err);
			return cleanTitle(query, this.fallbackTitle());
		}
	}

	async createNote(title: string, content: string): Promise<TFile> {
		const folder = normalizePath(this.settings.newNoteFolder.trim() || "/");
		const prefix = folder === "/" ? "" : `${folder}/`;
		if (prefix && !this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		let path = normalizePath(`${prefix}${title}.md`);
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
			path = normalizePath(`${prefix}${title} ${i}.md`);
		}
		const file = await this.app.vault.create(path, content);
		await this.app.workspace.getLeaf(false).openFile(file);
		return file;
	}

	async activateView(): Promise<AssistantView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof AssistantView ? leaf.view : null;
	}

	getLastEditor(): MarkdownView | null {
		const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
		return leaf?.view instanceof MarkdownView ? leaf.view : null;
	}

	registerTemplateCommands() {
		for (const id of this.templateCommandIds) this.removeCommand(id);
		this.templateCommandIds = [];
		for (const template of this.settings.templates) {
			const id = `template-${template.id}`;
			this.addCommand({
				id,
				name: `Prompt: ${template.name}`,
				editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
					void runTemplate(this, template, editor, ctx);
				},
			});
			this.templateCommandIds.push(id);
		}
	}
}
