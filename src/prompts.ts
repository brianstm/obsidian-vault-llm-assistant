import type { AssistantMode } from "./types";

const CITATION_RULES = `Cite the notes you use with wikilinks to their path, for example [[Folder/Note name]]. To point at a section, use [[Folder/Note name#Heading]] with the heading text exactly as written in the note. Only cite notes that appear in the provided notes.`;

export function systemPrompt(mode: AssistantMode, hasNotes: boolean, customInstructions: string): string {
	let prompt: string;
	if (mode === "query") {
		prompt = hasNotes
			? `You are an assistant for the user's Obsidian vault. The user's notes are provided inside <note> tags.
- Answer from the notes. Be concise and precise, and get straight to the answer.
- ${CITATION_RULES}
- If the notes do not contain the answer, say so clearly. You may then add general knowledge, labelled as such.
- Use Markdown formatting.`
			: `You are a helpful, knowledgeable assistant inside Obsidian.
- Answer clearly and concisely, without filler.
- Use Markdown formatting.`;
	} else {
		prompt = `You write new notes for the user's Obsidian vault.
- Write a complete, well-structured note about the topic the user gives you.
- Respond with the note content only: no introduction, no closing remarks, and no \`\`\`markdown fence around the note.
- Use Markdown headings, lists, tables and code blocks with a language tag where they help. Do not start with a top-level # title; the title is added separately.${
			hasNotes
				? `
- The user's existing notes are provided inside <note> tags. Use relevant information from them and link to them. ${CITATION_RULES}`
				: ""
		}`;
	}
	const extra = customInstructions.trim();
	return extra ? `${prompt}\n\nAdditional instructions from the user:\n${extra}` : prompt;
}

export function userTurn(mode: AssistantMode, query: string, notes: string, currentPath: string | null): string {
	const parts: string[] = [];
	if (notes) parts.push(`<notes>\n${notes}</notes>`);
	if (currentPath) parts.push(`The note the user has open is [[${currentPath.replace(/\.md$/, "")}]].`);
	parts.push(mode === "query" ? query : `Topic for the new note: ${query}`);
	return parts.join("\n\n");
}

export const TITLE_SYSTEM_PROMPT =
	"You write short, descriptive note titles. Reply with the title only: at most 8 words, no quotes, no trailing punctuation, no Markdown.";

export function titlePrompt(query: string, response: string): string {
	return `Suggest a title for a note created from this request and answer.\n\nRequest: ${query}\n\nAnswer (start):\n${response.slice(0, 1500)}`;
}

export const TEMPLATE_SYSTEM_PROMPT =
	"You are a writing assistant inside Obsidian. Reply with only the requested text in Markdown: no introduction, no explanation, and no code fence around the whole reply.";

export function unwrapMarkdownFence(text: string): string {
	const match = text.trim().match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i);
	return match ? match[1] : text.trim();
}

export function cleanTitle(raw: string, fallback: string): string {
	const title = raw
		.split("\n")[0]
		.replace(/^#+\s*/, "")
		.replace(/[*_`]/g, "")
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/[.\s]+$/, "")
		.trim()
		.slice(0, 100)
		.trim();
	return title || fallback;
}
