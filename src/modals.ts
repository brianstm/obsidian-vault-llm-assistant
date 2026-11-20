import {
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	type App,
	type Editor,
	type MarkdownFileInfo,
	type MarkdownView,
	type TFile,
} from "obsidian";
import type VaultLLMAssistant from "./main";
import { buildContext } from "./context";
import { systemPrompt, unwrapMarkdownFence, userTurn } from "./prompts";
import { TEMPLATE_OUTPUT_LABELS, errorText, runTemplate } from "./templates";
import type { AssistantMode, ContextScope, PromptTemplate } from "./types";

export class QueryModal extends Modal {
	private inputEl!: HTMLTextAreaElement;

	constructor(
		app: App,
		private plugin: VaultLLMAssistant,
		private file: TFile | null,
		private mode: AssistantMode,
		private contextScope?: ContextScope,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("vault-llm-modal");
		const isQuery = this.mode === "query";
		this.setTitle(isQuery ? "Ask a question" : "Create a note about a topic");

		if (this.contextScope === "current" && this.file) {
			contentEl.createDiv({ cls: "vault-llm-modal-hint", text: `Using ${this.file.basename} as context.` });
		}

		this.inputEl = contentEl.createEl("textarea", {
			cls: "vault-llm-modal-input",
			attr: {
				rows: "4",
				placeholder: isQuery ? "What would you like to know?" : "What should the note be about?",
			},
		});
		this.inputEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
				evt.preventDefault();
				this.submit();
			}
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(isQuery ? "Ask" : "Create note")
					.setCta()
					.onClick(() => this.submit()),
			);

		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	private submit() {
		const query = this.inputEl.value.trim();
		if (!query) {
			new Notice(this.mode === "query" ? "Type a question first." : "Type a topic first.");
			return;
		}
		this.close();
		if (this.mode === "query") {
			void this.plugin.activateView().then((view) => view?.ask(query, this.file, { scope: this.contextScope, mode: "query" }));
		} else {
			void createNoteFromTopic(this.plugin, query, this.file, this.contextScope);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

export async function createNoteFromTopic(
	plugin: VaultLLMAssistant,
	topic: string,
	file: TFile | null,
	scope?: ContextScope,
): Promise<void> {
	const notice = new Notice("Writing your note...", 0);
	try {
		const context = await buildContext(plugin.app, plugin.settings, topic, file, scope);
		const content = unwrapMarkdownFence(
			await plugin.complete({
				system: systemPrompt("create", context.text !== "", plugin.settings.customInstructions),
				messages: [
					{
						role: "user",
						content: userTurn("create", topic, context.text, file?.path ?? null),
						images: context.images,
					},
				],
			}),
		);
		const title = await plugin.generateTitle(topic, content);
		const created = await plugin.createNote(title, `# ${title}\n\n${content}\n`);
		new Notice(`Created ${created.basename}`);
	} catch (err) {
		console.error("Vault LLM Assistant: could not create note", err);
		new Notice(`Couldn't create the note: ${errorText(err)}`, 10000);
	} finally {
		notice.hide();
	}
}

export class TemplatePickerModal extends FuzzySuggestModal<PromptTemplate> {
	constructor(
		app: App,
		private plugin: VaultLLMAssistant,
		private editor: Editor,
		private ctx: MarkdownView | MarkdownFileInfo,
	) {
		super(app);
		this.setPlaceholder("Choose a prompt template...");
	}

	getItems(): PromptTemplate[] {
		return this.plugin.settings.templates;
	}

	getItemText(template: PromptTemplate): string {
		return `${template.name} (${TEMPLATE_OUTPUT_LABELS[template.output].toLowerCase()})`;
	}

	onChooseItem(template: PromptTemplate): void {
		void runTemplate(this.plugin, template, this.editor, this.ctx);
	}
}
