import { Notice, PluginSettingTab, SecretComponent, Setting, debounce, type App } from "obsidian";
import type VaultLLMAssistant from "./main";
import { PROVIDERS, PROVIDER_ORDER, complete, listModels } from "./providers";
import { DEFAULT_TEMPLATES } from "./settings";
import { shortcutOptions } from "./shortcuts";
import { TEMPLATE_OUTPUT_LABELS, errorText } from "./templates";
import type {
	AssistantMode,
	ContextScope,
	ContextStrategy,
	ProviderId,
	ReasoningEffort,
	SendShortcut,
	TemplateOutput,
} from "./types";

const CUSTOM_MODEL = "__custom__";
const MODEL_LIST_MAX_AGE = 24 * 60 * 60 * 1000;

function splitList(value: string): string[] {
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v !== "");
}

export class VaultLLMAssistantSettingTab extends PluginSettingTab {
	private typingCustomModel = false;
	private loadingModels = new Set<ProviderId>();
	private modelErrors: Partial<Record<ProviderId, string>> = {};
	private expandedTemplate: string | null = null;
	private readonly saveTemplates = debounce(
		() => {
			void this.plugin.saveSettings().then(() => this.plugin.registerTemplateCommands());
		},
		800,
		true,
	);

	constructor(
		app: App,
		private plugin: VaultLLMAssistant,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderProvider(containerEl);
		this.renderResponse(containerEl);
		this.renderContext(containerEl);
		this.renderNotes(containerEl);
		this.renderTemplates(containerEl);
	}

	private async save() {
		await this.plugin.saveSettings();
	}

	private renderProvider(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		const id = settings.provider;
		const provider = PROVIDERS[id];

		new Setting(containerEl).setName("Model provider").setHeading();

		new Setting(containerEl)
			.setName("Provider")
			.setDesc(provider.description)
			.addDropdown((dropdown) => {
				for (const pid of PROVIDER_ORDER) {
					const p = PROVIDERS[pid];
					dropdown.addOption(pid, p.local ? `${p.name} (local)` : p.name);
				}
				dropdown.setValue(id).onChange(async (value) => {
					settings.provider = value as ProviderId;
					this.typingCustomModel = false;
					await this.save();
					this.display();
				});
			});

		if (provider.apiKey !== "none") {
			new Setting(containerEl)
				.setName("API key")
				.setDesc(
					createFragment((frag) => {
						frag.appendText(
							provider.apiKey === "optional"
								? "Optional. Your key is kept in Obsidian's secret storage, not in the plugin's data file. "
								: "Your key is kept in Obsidian's secret storage, not in the plugin's data file. ",
						);
						if (provider.keyUrl) frag.createEl("a", { text: "Get a key", href: provider.keyUrl });
					}),
				)
				.addComponent((el) =>
					new SecretComponent(this.app, el).setValue(this.plugin.getSecretId(id)).onChange(async (value) => {
						settings.secretIds[id] = value ?? "";
						delete this.modelErrors[id];
						await this.save();
						this.display();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc(
				provider.defaultBaseUrl
					? `Leave this empty to use ${provider.defaultBaseUrl}. Change it if you use a proxy or your own server.`
					: "The address of your server, for example http://localhost:8000/v1.",
			)
			.addText((text) =>
				text
					.setPlaceholder(provider.defaultBaseUrl || "https://example.com/v1")
					.setValue(settings.baseUrls[id] ?? "")
					.onChange(async (value) => {
						settings.baseUrls[id] = value.trim();
						delete this.modelErrors[id];
						await this.save();
					}),
			);

		this.renderModel(containerEl, id);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Sends a quick message to check that the key, URL and model all work.")
			.addButton((button) =>
				button.setButtonText("Test").onClick(async () => {
					button.setDisabled(true).setButtonText("Testing...");
					try {
						const config = this.plugin.getProviderConfig();
						config.maxTokens = Math.min(config.maxTokens, 2048);
						await complete(config, {
							system: "",
							messages: [{ role: "user", content: "Reply with the single word OK." }],
						});
						new Notice(`It works! Connected to ${provider.name} using ${config.model}.`);
					} catch (err) {
						new Notice(`That didn't work: ${errorText(err)}`, 10000);
					} finally {
						button.setDisabled(false).setButtonText("Test");
					}
				}),
			);
	}

	private canLoadModels(id: ProviderId): boolean {
		const config = this.plugin.getProviderConfig(id);
		return config.baseUrl !== "" && (config.provider.apiKey !== "required" || config.apiKey !== "");
	}

	private async loadModels(id: ProviderId, quiet: boolean) {
		if (this.loadingModels.has(id)) return;
		const settings = this.plugin.settings;
		this.loadingModels.add(id);
		delete this.modelErrors[id];
		this.display();
		try {
			const models = await listModels(this.plugin.getProviderConfig(id));
			settings.fetchedModels[id] = models;
			settings.modelsFetchedAt[id] = Date.now();
			if (!settings.models[id] && models.length > 0) {
				const preferred = models.find((m) => m.id === PROVIDERS[id].defaultModel);
				settings.models[id] = (preferred ?? models[0]).id;
			}
			await this.save();
			if (!quiet) new Notice(`Found ${models.length} model${models.length === 1 ? "" : "s"}.`);
		} catch (err) {
			this.modelErrors[id] = errorText(err);
			if (!quiet) new Notice(`Couldn't load models: ${errorText(err)}`, 10000);
		} finally {
			this.loadingModels.delete(id);
			this.display();
		}
	}

	private renderModel(containerEl: HTMLElement, id: ProviderId) {
		const settings = this.plugin.settings;
		const provider = PROVIDERS[id];
		const current = this.plugin.getModel(id);
		const models = settings.fetchedModels[id] ?? [];
		const loading = this.loadingModels.has(id);
		const error = this.modelErrors[id];
		const canLoad = this.canLoadModels(id);

		const stale = Date.now() - (settings.modelsFetchedAt[id] ?? 0) > MODEL_LIST_MAX_AGE;
		if (canLoad && !loading && !error && (models.length === 0 || stale)) {
			void this.loadModels(id, true);
		}

		const options = new Map<string, string>(models.map((m) => [m.id, m.name]));
		const typing = this.typingCustomModel || options.size === 0 || (current !== "" && !options.has(current));

		let desc: string;
		if (loading) desc = "Loading models...";
		else if (error) desc = `Couldn't load models: ${error} You can still type a model ID.`;
		else if (!canLoad) desc = provider.defaultBaseUrl ? "Add your API key to see the models you can use." : "Set the base URL to see the models on your server.";
		else desc = `${models.length} model${models.length === 1 ? "" : "s"} available. Hit refresh if a new one is missing.`;

		const setting = new Setting(containerEl).setName("Model").setDesc(desc);

		if (options.size > 0) {
			setting.addDropdown((dropdown) => {
				for (const [value, name] of options) dropdown.addOption(value, name);
				dropdown.addOption(CUSTOM_MODEL, "Other (type a model ID)");
				dropdown.setValue(typing ? CUSTOM_MODEL : current).onChange(async (value) => {
					if (value === CUSTOM_MODEL) {
						this.typingCustomModel = true;
					} else {
						this.typingCustomModel = false;
						settings.models[id] = value;
						await this.save();
					}
					this.display();
				});
			});
		}

		setting.addExtraButton((button) =>
			button
				.setIcon("refresh-cw")
				.setTooltip("Reload the model list")
				.setDisabled(loading)
				.onClick(() => {
					void this.loadModels(id, false);
				}),
		);

		if (typing) {
			new Setting(containerEl)
				.setName("Model ID")
				.setDesc("The exact model name the provider uses.")
				.addText((text) =>
					text
						.setPlaceholder(provider.defaultModel || "model-name")
						.setValue(settings.models[id] ?? "")
						.onChange(async (value) => {
							settings.models[id] = value.trim();
							await this.save();
						}),
				);
		}
	}

	private renderResponse(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Responses").setHeading();

		new Setting(containerEl)
			.setName("Max tokens")
			.setDesc("How long an answer can be. Thinking models use some of these tokens to think first.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "64";
				text
					.setValue(String(settings.maxTokens))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						if (Number.isFinite(n) && n >= 64) {
							settings.maxTokens = Math.min(n, 200000);
							await this.save();
						}
					});
			});

		new Setting(containerEl)
			.setName("Temperature")
			.setDesc("Higher gives more creative answers, lower gives more focused ones. Thinking models and Claude 4.7 or newer ignore this.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(settings.temperature)
					.onChange(async (value) => {
						settings.temperature = value;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Reasoning effort")
			.setDesc("How hard the model thinks before it answers. Works with Claude and OpenAI's reasoning models.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ default: "Model default", low: "Low (faster)", medium: "Medium", high: "High (more thorough)" })
					.setValue(settings.reasoningEffort)
					.onChange(async (value) => {
						settings.reasoningEffort = value as ReasoningEffort;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Custom instructions")
			.setDesc("Added to every request. Handy for things like your language, tone or how you like answers laid out.")
			.setClass("vault-llm-setting-textarea")
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text
					.setPlaceholder("Answer in British English. Prefer short bullet lists.")
					.setValue(settings.customInstructions)
					.onChange(async (value) => {
						settings.customInstructions = value;
						await this.save();
					});
			});
	}

	private renderContext(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Vault context").setHeading();

		new Setting(containerEl)
			.setName("Default notes to read")
			.setDesc("Which notes get sent with your questions. You can also switch this in the chat.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ vault: "Vault notes", current: "Current note", none: "No notes" })
					.setValue(settings.contextScope)
					.onChange(async (value) => {
						settings.contextScope = value as ContextScope;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Note selection")
			.setDesc(
				"Most relevant sends the notes that best match your question, which works well for big vaults. All sends every note, newest first, until it hits the size limit.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ relevant: "Most relevant notes", all: "All notes" })
					.setValue(settings.contextStrategy)
					.onChange(async (value) => {
						settings.contextStrategy = value as ContextStrategy;
						await this.save();
					}),
			);

		const sizeDesc = (chars: number) =>
			`Up to ${Math.round(chars / 1000)}k characters of notes per request (about ${Math.round(chars / 4000)}k tokens). Bigger limits cost more.`;
		const sizeSetting = new Setting(containerEl).setName("Maximum context size").setDesc(sizeDesc(settings.maxContextChars));
		sizeSetting.addSlider((slider) =>
			slider
				.setLimits(10000, 400000, 10000)
				.setValue(settings.maxContextChars)
				.onChange(async (value) => {
					settings.maxContextChars = value;
					sizeSetting.setDesc(sizeDesc(value));
					await this.save();
				}),
		);

		new Setting(containerEl)
			.setName("Maximum notes")
			.setDesc("How many of the best matching notes to send.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 100, 1)
					.setValue(settings.maxNotes)
					.onChange(async (value) => {
						settings.maxNotes = value;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Prefer linked notes")
			.setDesc("Gives a boost to notes linked to or from the note you have open, and adds them when you use the current note.")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeLinkedNotes).onChange(async (value) => {
					settings.includeLinkedNotes = value;
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Include images")
			.setDesc("Sends up to 5 images from the notes it uses. Your model needs to support images.")
			.addToggle((toggle) =>
				toggle.setValue(settings.includeImages).onChange(async (value) => {
					settings.includeImages = value;
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Only read these folders")
			.setDesc("Folder paths separated by commas. Leave empty to use the whole vault. Paths are case sensitive.")
			.addText((text) =>
				text
					.setPlaceholder("Projects, Areas/Work")
					.setValue(settings.includeFolders.join(", "))
					.onChange(async (value) => {
						settings.includeFolders = splitList(value);
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Never read these folders")
			.setDesc("Folders to skip, separated by commas. Good for a private journal or your templates folder.")
			.addText((text) =>
				text
					.setPlaceholder("Private, Templates")
					.setValue(settings.excludeFolders.join(", "))
					.onChange(async (value) => {
						settings.excludeFolders = splitList(value);
						await this.save();
					}),
			);
	}

	private renderNotes(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Chat and new notes").setHeading();

		new Setting(containerEl)
			.setName("Folder for new notes")
			.setDesc("Where new notes go. Leave empty to put them in the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("AI notes")
					.setValue(settings.newNoteFolder)
					.onChange(async (value) => {
						settings.newNoteFolder = value.trim();
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Generate titles")
			.setDesc("Asks the model to name each new note. This uses one extra request.")
			.addToggle((toggle) =>
				toggle.setValue(settings.generateTitlesWithLLM).onChange(async (value) => {
					settings.generateTitlesWithLLM = value;
					await this.save();
				}),
			);

		new Setting(containerEl)
			.setName("Send message with")
			.setDesc("The keyboard shortcut that sends your message in the chat and in the question popup.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(shortcutOptions())
					.setValue(settings.sendShortcut)
					.onChange(async (value) => {
						settings.sendShortcut = value as SendShortcut;
						await this.save();
					}),
			);

		new Setting(containerEl)
			.setName("Default chat mode")
			.setDesc("Ask answers questions. Write note drafts a new note on a topic.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ query: "Ask", create: "Write note" })
					.setValue(settings.mode)
					.onChange(async (value) => {
						settings.mode = value as AssistantMode;
						await this.save();
					}),
			);
	}

	private renderTemplates(containerEl: HTMLElement) {
		const settings = this.plugin.settings;
		new Setting(containerEl).setName("Prompt templates").setHeading();

		containerEl.createDiv({
			cls: "setting-item-description vault-llm-templates-help",
			text: "Run these from the command palette, the right-click menu in a note, or a hotkey. You can use {{selection}} (the selected text, or the whole note if nothing is selected), {{note}}, {{before}} (everything before the cursor) and {{title}}.",
		});

		settings.templates.forEach((template, index) => {
			const expanded = this.expandedTemplate === template.id;
			new Setting(containerEl)
				.setName(template.name || "Untitled template")
				.setDesc(TEMPLATE_OUTPUT_LABELS[template.output])
				.addExtraButton((button) =>
					button
						.setIcon(expanded ? "chevron-up" : "pencil")
						.setTooltip(expanded ? "Close" : "Edit")
						.onClick(() => {
							this.expandedTemplate = expanded ? null : template.id;
							this.display();
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash-2")
						.setTooltip("Delete")
						.onClick(async () => {
							settings.templates.splice(index, 1);
							await this.save();
							this.plugin.registerTemplateCommands();
							this.display();
						}),
				);

			if (!expanded) return;

			const editor = containerEl.createDiv({ cls: "vault-llm-template-editor" });
			new Setting(editor).setName("Name").addText((text) =>
				text.setValue(template.name).onChange((value) => {
					template.name = value;
					this.saveTemplates();
				}),
			);
			new Setting(editor).setName("Output").addDropdown((dropdown) =>
				dropdown
					.addOptions(TEMPLATE_OUTPUT_LABELS)
					.setValue(template.output)
					.onChange((value) => {
						template.output = value as TemplateOutput;
						this.saveTemplates();
					}),
			);
			new Setting(editor)
				.setName("Prompt")
				.setClass("vault-llm-setting-textarea")
				.addTextArea((text) => {
					text.inputEl.rows = 6;
					text.setValue(template.prompt).onChange((value) => {
						template.prompt = value;
						this.saveTemplates();
					});
				});
		});

		new Setting(containerEl)
			.addButton((button) =>
				button
					.setButtonText("Add template")
					.setCta()
					.onClick(async () => {
						const id = `custom-${Date.now().toString(36)}`;
						settings.templates.push({ id, name: "New template", output: "insert", prompt: "{{selection}}" });
						this.expandedTemplate = id;
						await this.save();
						this.plugin.registerTemplateCommands();
						this.display();
					}),
			)
			.addButton((button) =>
				button.setButtonText("Restore missing defaults").onClick(async () => {
					const missing = DEFAULT_TEMPLATES.filter((d) => !settings.templates.some((t) => t.id === d.id));
					settings.templates.push(...missing.map((t) => ({ ...t })));
					await this.save();
					this.plugin.registerTemplateCommands();
					new Notice(missing.length ? `Restored ${missing.length} template${missing.length === 1 ? "" : "s"}.` : "You already have all the default templates.");
					this.display();
				}),
			);
	}
}
