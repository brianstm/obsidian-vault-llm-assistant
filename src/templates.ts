import { Notice, type Editor, type MarkdownFileInfo, type MarkdownView } from "obsidian";
import type VaultLLMAssistant from "./main";
import { LLMError } from "./providers";
import { TEMPLATE_SYSTEM_PROMPT, cleanTitle, unwrapMarkdownFence } from "./prompts";
import type { PromptTemplate } from "./types";

export const TEMPLATE_OUTPUT_LABELS: Record<PromptTemplate["output"], string> = {
	replace: "Replace selection",
	insert: "Insert below selection",
	chat: "Show in chat",
	note: "Create new note",
};

export function fillTemplate(
	template: string,
	values: { selection: string; note: string; before: string; title: string },
): string {
	return template.replace(/\{\{\s*(selection|note|before|title)\s*\}\}/g, (_match, name: keyof typeof values) => values[name]);
}

export function errorText(err: unknown): string {
	if (err instanceof LLMError) return err.hint ? `${err.message} ${err.hint}` : err.message;
	return err instanceof Error ? err.message : String(err);
}

export async function runTemplate(
	plugin: VaultLLMAssistant,
	template: PromptTemplate,
	editor: Editor,
	ctx: MarkdownView | MarkdownFileInfo,
): Promise<void> {
	const selection = editor.getSelection();
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	const note = editor.getValue();
	const before = editor.getRange({ line: 0, ch: 0 }, to);
	const usesSelection = /\{\{\s*selection\s*\}\}/.test(template.prompt);

	if (template.output === "replace" && usesSelection && !selection) {
		new Notice(`Select the text for "${template.name}" first.`);
		return;
	}

	const prompt = fillTemplate(template.prompt, {
		selection: selection || note,
		note,
		before,
		title: ctx.file?.basename ?? "",
	});

	if (template.output === "chat") {
		const view = await plugin.activateView();
		await view?.ask(prompt, ctx.file ?? null, { scope: "none", mode: "query", label: template.name });
		return;
	}

	const notice = new Notice(`Running "${template.name}"...`, 0);
	try {
		const result = unwrapMarkdownFence(
			await plugin.complete({ system: TEMPLATE_SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
		);

		if (template.output === "replace") {
			editor.replaceRange(result, from, to);
		} else if (template.output === "insert") {
			if (selection) {
				editor.replaceRange(`\n\n${result}\n`, to);
			} else {
				const lineText = editor.getLine(to.line);
				const separator = lineText.trim() === "" || to.ch < lineText.length ? "" : "\n\n";
				editor.replaceRange(`${separator}${result}`, to);
			}
		} else {
			const title = cleanTitle(`${template.name} - ${ctx.file?.basename ?? ""}`, plugin.fallbackTitle());
			const file = await plugin.createNote(title, result);
			new Notice(`Created ${file.basename}`);
		}
	} catch (err) {
		console.error("Vault LLM Assistant: prompt template failed", err);
		new Notice(`"${template.name}" failed: ${errorText(err)}`, 10000);
	} finally {
		notice.hide();
	}
}
