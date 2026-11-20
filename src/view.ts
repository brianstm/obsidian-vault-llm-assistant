import {
	ButtonComponent,
	Component,
	DropdownComponent,
	ExtraButtonComponent,
	ItemView,
	Keymap,
	MarkdownRenderer,
	Notice,
	Scope,
	setIcon,
	type KeymapEventHandler,
	type TFile,
	type WorkspaceLeaf,
} from "obsidian";
import type VaultLLMAssistant from "./main";
import { buildContext } from "./context";
import { LLMError } from "./providers";
import { systemPrompt, unwrapMarkdownFence, userTurn } from "./prompts";
import { matchesShortcut, shortcutLabel, shortcutModifiers } from "./shortcuts";
import type { AssistantMode, ChatMessage, ContextScope, SendShortcut } from "./types";

export const VIEW_TYPE = "vault-llm-assistant-view";

const HISTORY_TURNS = 8;

const SCOPE_LABELS: Record<ContextScope, string> = {
	vault: "Vault notes",
	current: "Current note",
	none: "No notes",
};

interface Turn {
	mode: AssistantMode;
	scope: ContextScope;
	query: string;
	label?: string;
	file: TFile | null;
	model: string;
	stage: "context" | "waiting" | "done";
	response?: string;
	error?: unknown;
	sources: TFile[];
	truncated: boolean;
	imageCount: number;
	el?: HTMLElement;
	component?: Component;
}

export interface AskOptions {
	mode?: AssistantMode;
	scope?: ContextScope;
	label?: string;
}

export class AssistantView extends ItemView {
	private turns: Turn[] = [];
	private busy = false;
	private modelBadgeEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButton!: ButtonComponent;
	private modeDropdown!: DropdownComponent;
	private scopeDropdown!: DropdownComponent;

	private sendKey: KeymapEventHandler | null = null;
	private sendKeyShortcut: SendShortcut | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: VaultLLMAssistant,
	) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Vault LLM Assistant";
	}

	getIcon(): string {
		return "bot";
	}

	onOpen(): Promise<void> {
		this.render();
		return Promise.resolve();
	}

	private render() {
		const root = this.contentEl;
		root.empty();
		root.addClass("vault-llm-view");

		const header = root.createDiv({ cls: "vault-llm-header" });
		this.modelBadgeEl = header.createDiv({ cls: "vault-llm-model-badge" });
		const headerActions = header.createDiv({ cls: "vault-llm-header-actions" });
		new ExtraButtonComponent(headerActions)
			.setIcon("save")
			.setTooltip("Save chat as note")
			.onClick(() => {
				void this.saveChat();
			});
		new ExtraButtonComponent(headerActions)
			.setIcon("square-pen")
			.setTooltip("New chat")
			.onClick(() => this.clearChat());

		this.messagesEl = root.createDiv({ cls: "vault-llm-messages" });
		this.registerDomEvent(this.messagesEl, "click", (evt) => this.onLinkClick(evt));
		this.registerDomEvent(this.messagesEl, "mouseover", (evt) => this.onLinkHover(evt));
		this.renderEmptyState();

		const composer = root.createDiv({ cls: "vault-llm-composer" });
		this.inputEl = composer.createEl("textarea", {
			cls: "vault-llm-input",
			attr: { rows: "3" },
		});
		this.registerDomEvent(this.inputEl, "keydown", (evt) => {
			if (!evt.defaultPrevented && matchesShortcut(evt, this.plugin.settings.sendShortcut)) {
				evt.preventDefault();
				this.submit();
			}
		});

		const controls = composer.createDiv({ cls: "vault-llm-controls" });
		this.modeDropdown = new DropdownComponent(controls)
			.addOptions({ query: "Ask", create: "Write note" })
			.onChange(async (value) => {
				this.plugin.settings.mode = value as AssistantMode;
				await this.plugin.saveSettings();
			});
		this.modeDropdown.selectEl.setAttr("aria-label", "Mode");

		this.scopeDropdown = new DropdownComponent(controls).addOptions(SCOPE_LABELS).onChange(async (value) => {
			this.plugin.settings.contextScope = value as ContextScope;
			await this.plugin.saveSettings();
		});
		this.scopeDropdown.selectEl.setAttr("aria-label", "Notes the assistant can read");

		controls.createDiv({ cls: "vault-llm-spacer" });
		this.sendButton = new ButtonComponent(controls)
			.setIcon("send-horizontal")
			.setTooltip("Send")
			.setCta()
			.onClick(() => this.submit());

		this.refreshHeader();
	}

	refreshHeader() {
		if (!this.modelBadgeEl) return;
		this.modelBadgeEl.setText(this.plugin.modelLabel());
		this.modeDropdown.setValue(this.plugin.settings.mode);
		this.scopeDropdown.setValue(this.plugin.settings.contextScope);
		this.registerSendKey();
		const shortcut = shortcutLabel(this.plugin.settings.sendShortcut);
		this.inputEl.placeholder =
			this.plugin.settings.mode === "query"
				? `Ask about your notes (${shortcut} to send)`
				: `What should the new note be about? (${shortcut} to send)`;
	}

	private registerSendKey() {
		const shortcut = this.plugin.settings.sendShortcut;
		if (!this.scope || this.sendKeyShortcut === shortcut) return;
		if (this.sendKey) this.scope.unregister(this.sendKey);
		this.sendKeyShortcut = shortcut;
		this.sendKey = this.scope.register(shortcutModifiers(shortcut), "Enter", (evt) => {
			if (activeDocument.activeElement !== this.inputEl || !matchesShortcut(evt, shortcut)) return true;
			this.submit();
			return false;
		});
	}

	private renderEmptyState() {
		const empty = this.messagesEl.createDiv({ cls: "vault-llm-empty" });
		setIcon(empty.createDiv({ cls: "vault-llm-empty-icon" }), "bot");
		empty.createDiv({ cls: "vault-llm-empty-title", text: "Ask anything about your notes" });
		const tips = empty.createEl("ul");
		tips.createEl("li", { text: "Answers link to the notes they come from." });
		tips.createEl("li", { text: "You can ask follow-up questions. The chat remembers what you talked about." });
		tips.createEl("li", { text: "Switch to \"Write note\" to draft a new note on any topic." });
		tips.createEl("li", { text: "Right-click in a note to run a prompt template on the selected text." });
	}

	private submit() {
		const query = this.inputEl.value.trim();
		if (!query) return;
		this.inputEl.value = "";
		void this.ask(query, this.app.workspace.getActiveFile());
	}

	async ask(query: string, file: TFile | null = this.app.workspace.getActiveFile(), options: AskOptions = {}) {
		if (this.busy) {
			new Notice("Hang on, still working on the last answer.");
			return;
		}
		const turn: Turn = {
			mode: options.mode ?? this.plugin.settings.mode,
			scope: options.scope ?? this.plugin.settings.contextScope,
			query,
			label: options.label,
			file,
			model: this.plugin.modelLabel(),
			stage: "context",
			sources: [],
			truncated: false,
			imageCount: 0,
		};
		this.turns.push(turn);
		await this.runTurn(turn);
	}

	private history(before: Turn): ChatMessage[] {
		const done = this.turns.slice(0, this.turns.indexOf(before)).filter((t) => t.response && !t.error);
		return done.slice(-HISTORY_TURNS).flatMap((t): ChatMessage[] => [
			{ role: "user", content: t.mode === "query" ? t.query : `Topic for the new note: ${t.query}` },
			{ role: "assistant", content: t.response ?? "" },
		]);
	}

	private async runTurn(turn: Turn) {
		this.setBusy(true);
		turn.error = undefined;
		turn.response = undefined;
		turn.stage = "context";
		await this.renderTurn(turn);
		this.scrollToBottom();

		try {
			const settings = this.plugin.settings;
			const context = await buildContext(this.app, settings, turn.query, turn.file, turn.scope);
			turn.sources = context.sources;
			turn.truncated = context.truncated;
			turn.imageCount = context.images.length;
			turn.stage = "waiting";
			await this.renderTurn(turn);

			const response = await this.plugin.complete({
				system: systemPrompt(turn.mode, context.text !== "", settings.customInstructions),
				messages: [
					...this.history(turn),
					{
						role: "user",
						content: userTurn(turn.mode, turn.query, context.text, turn.file?.path ?? null),
						images: context.images,
					},
				],
			});
			turn.response = turn.mode === "create" ? unwrapMarkdownFence(response) : response;
		} catch (err) {
			console.error("Vault LLM Assistant: request failed", err);
			turn.error = err;
		} finally {
			turn.stage = "done";
			this.setBusy(false);
		}
		await this.renderTurn(turn);
		this.scrollToAnswer(turn);
	}

	private setBusy(busy: boolean) {
		this.busy = busy;
		this.sendButton.setDisabled(busy);
		this.sendButton.buttonEl.toggleClass("is-loading", busy);
	}

	private async renderTurn(turn: Turn) {
		this.messagesEl.querySelector(".vault-llm-empty")?.remove();
		if (!turn.el) turn.el = this.messagesEl.createDiv({ cls: "vault-llm-turn" });
		if (turn.component) {
			this.removeChild(turn.component);
			turn.component = undefined;
		}
		const el = turn.el;
		el.empty();

		const userEl = el.createDiv({ cls: "vault-llm-message mod-user" });
		userEl.createDiv({ cls: "vault-llm-message-text", text: turn.label ?? turn.query });
		const userMeta = userEl.createDiv({ cls: "vault-llm-message-meta" });
		userMeta.setText(
			[turn.mode === "create" ? "Write note" : null, SCOPE_LABELS[turn.scope]].filter(Boolean).join(" · "),
		);

		const botEl = el.createDiv({ cls: "vault-llm-message mod-assistant" });
		botEl.createDiv({ cls: "vault-llm-message-meta", text: turn.model });

		if (turn.stage !== "done") {
			const loading = botEl.createDiv({ cls: "vault-llm-loading" });
			loading.createSpan({
				text:
					turn.stage === "context"
						? "Finding relevant notes"
						: turn.sources.length > 0
							? `Reading ${turn.sources.length} note${turn.sources.length === 1 ? "" : "s"} and thinking`
							: "Thinking",
			});
			loading.createSpan({ cls: "vault-llm-dots" });
			return;
		}

		if (turn.sources.length > 0) this.renderSources(botEl, turn);

		if (turn.error !== undefined) {
			this.renderError(botEl, turn);
			return;
		}

		const answerEl = botEl.createDiv({ cls: "vault-llm-answer markdown-rendered" });
		const component = new Component();
		this.addChild(component);
		turn.component = component;
		await MarkdownRenderer.render(this.app, turn.response ?? "", answerEl, turn.file?.path ?? "", component);

		this.renderActions(botEl, turn);
	}

	private renderSources(parent: HTMLElement, turn: Turn) {
		const details = parent.createEl("details", { cls: "vault-llm-sources" });
		const parts = [`${turn.sources.length} note${turn.sources.length === 1 ? "" : "s"} used`];
		if (turn.imageCount > 0) parts.push(`${turn.imageCount} image${turn.imageCount === 1 ? "" : "s"}`);
		if (turn.truncated) parts.push("some notes left out to fit the context limit");
		details.createEl("summary", { text: parts.join(" · ") });
		const list = details.createEl("ul");
		for (const file of turn.sources) {
			list.createEl("li").createEl("a", {
				cls: "internal-link",
				text: file.path.replace(/\.md$/, ""),
				attr: { "data-href": file.path, href: file.path },
			});
		}
	}

	private renderError(parent: HTMLElement, turn: Turn) {
		const box = parent.createDiv({ cls: "vault-llm-error" });
		const err = turn.error;
		box.createDiv({ cls: "vault-llm-error-title", text: "Something went wrong" });
		box.createDiv({
			cls: "vault-llm-error-details",
			text: err instanceof Error ? err.message : String(err),
		});
		if (err instanceof LLMError && err.hint) {
			box.createDiv({ cls: "vault-llm-error-hint", text: err.hint });
		}
		new ButtonComponent(box).setButtonText("Try again").onClick(() => {
			if (!this.busy) void this.runTurn(turn);
		});
	}

	private renderActions(parent: HTMLElement, turn: Turn) {
		const response = turn.response ?? "";
		const actions = parent.createDiv({ cls: "vault-llm-actions" });

		new ExtraButtonComponent(actions)
			.setIcon("copy")
			.setTooltip("Copy Markdown")
			.onClick(() => {
				void navigator.clipboard.writeText(response).then(() => new Notice("Copied to clipboard"));
			});

		new ExtraButtonComponent(actions)
			.setIcon("text-cursor-input")
			.setTooltip("Insert at cursor in the last note you edited")
			.onClick(() => {
				const view = this.plugin.getLastEditor();
				if (!view) {
					new Notice("Open a note first.");
					return;
				}
				view.editor.replaceSelection(response);
				new Notice(`Inserted into ${view.file?.basename ?? "the note"}`);
			});

		new ExtraButtonComponent(actions)
			.setIcon("file-plus")
			.setTooltip("Create note from this answer")
			.onClick(() => {
				void this.createNoteFromTurn(turn);
			});

		if (turn === this.turns[this.turns.length - 1]) {
			new ExtraButtonComponent(actions)
				.setIcon("refresh-cw")
				.setTooltip("Regenerate")
				.onClick(() => {
					if (!this.busy) void this.runTurn(turn);
				});
		}
	}

	private async createNoteFromTurn(turn: Turn) {
		const response = turn.response ?? "";
		const notice = new Notice("Creating note...", 0);
		try {
			const title = await this.plugin.generateTitle(turn.label ?? turn.query, response);
			const body =
				turn.mode === "query"
					? `# ${title}\n\n> [!question] ${(turn.label ?? turn.query).replace(/\n/g, "\n> ")}\n\n${response}\n`
					: `# ${title}\n\n${response}\n`;
			const file = await this.plugin.createNote(title, body);
			new Notice(`Created ${file.basename}`);
		} catch (err) {
			console.error("Vault LLM Assistant: could not create note", err);
			new Notice(`Couldn't create the note: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			notice.hide();
		}
	}

	private async saveChat() {
		const done = this.turns.filter((t) => t.response && !t.error);
		if (done.length === 0) {
			new Notice("Nothing to save yet.");
			return;
		}
		const notice = new Notice("Saving chat...", 0);
		try {
			const title = await this.plugin.generateTitle(done[0].label ?? done[0].query, done[0].response ?? "");
			const body = done
				.map((t) => `## ${(t.label ?? t.query).split("\n")[0]}\n\n${t.response ?? ""}`)
				.join("\n\n---\n\n");
			const file = await this.plugin.createNote(title, `# ${title}\n\n${body}\n`);
			new Notice(`Saved chat as ${file.basename}`);
		} catch (err) {
			console.error("Vault LLM Assistant: could not save chat", err);
			new Notice(`Couldn't save the chat: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			notice.hide();
		}
	}

	clearChat() {
		if (this.busy) {
			new Notice("Hang on, still working on the last answer.");
			return;
		}
		for (const turn of this.turns) {
			if (turn.component) this.removeChild(turn.component);
		}
		this.turns = [];
		this.messagesEl.empty();
		this.renderEmptyState();
		this.inputEl.focus();
	}

	private linkTarget(evt: MouseEvent): { el: HTMLElement; href: string } | null {
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return null;
		const el = target.closest<HTMLElement>("a.internal-link");
		const href = el?.getAttr("data-href") ?? el?.getAttr("href");
		return el && href ? { el, href } : null;
	}

	private onLinkClick(evt: MouseEvent) {
		const link = this.linkTarget(evt);
		if (!link) return;
		evt.preventDefault();
		void this.app.workspace.openLinkText(link.href, "", Keymap.isModEvent(evt));
	}

	private onLinkHover(evt: MouseEvent) {
		const link = this.linkTarget(evt);
		if (!link) return;
		this.app.workspace.trigger("hover-link", {
			event: evt,
			source: VIEW_TYPE,
			hoverParent: this,
			targetEl: link.el,
			linktext: link.href,
			sourcePath: "",
		});
	}

	private scrollToBottom() {
		this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
	}

	private scrollToAnswer(turn: Turn) {
		const answer = turn.el?.querySelector<HTMLElement>(".mod-assistant");
		if (answer) this.messagesEl.scrollTo({ top: answer.offsetTop - this.messagesEl.offsetTop - 8, behavior: "smooth" });
	}
}
