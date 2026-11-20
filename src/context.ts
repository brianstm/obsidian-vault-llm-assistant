import { arrayBufferToBase64, normalizePath, TFile, type App } from "obsidian";
import type { ContextScope, ImageAttachment, VaultLLMAssistantSettings } from "./types";

export interface VaultContext {
	text: string;
	sources: TFile[];
	truncated: boolean;
	chars: number;
	images: ImageAttachment[];
}

const EMPTY: VaultContext = { text: "", sources: [], truncated: false, chars: 0, images: [] };

const STOP_WORDS = new Set(
	(
		"a an and are as at be but by can could did do does for from had has have how i if in into is it its " +
		"me my no not of on or our so than that the their them then there these they this to was we were " +
		"what when where which who why will with would you your about all any been also just more most some " +
		"such only other over very should tell give find show list note notes vault"
	).split(" "),
);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function tokenize(text: string): string[] {
	const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
	return Array.from(new Set(words.filter((w) => w.length > 1 && !STOP_WORDS.has(w))));
}

function folderPrefix(folder: string): string {
	const path = normalizePath(folder);
	return path === "/" ? "" : `${path}/`;
}

export function eligibleFiles(app: App, settings: VaultLLMAssistantSettings): TFile[] {
	const include = settings.includeFolders.map(folderPrefix).filter((p) => p !== "");
	const exclude = settings.excludeFolders.map(folderPrefix).filter((p) => p !== "");
	return app.vault.getMarkdownFiles().filter((file) => {
		if (include.length > 0 && !include.some((p) => file.path.startsWith(p))) return false;
		return !exclude.some((p) => file.path.startsWith(p));
	});
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count++;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

function linkedFiles(app: App, file: TFile): Set<string> {
	const linked = new Set<string>();
	const outgoing = app.metadataCache.resolvedLinks[file.path] ?? {};
	for (const path of Object.keys(outgoing)) linked.add(path);
	for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (targets[file.path]) linked.add(source);
	}
	linked.delete(file.path);
	return linked;
}

async function rankFiles(
	app: App,
	files: TFile[],
	query: string,
	boostPaths: Set<string>,
): Promise<{ file: TFile; content: string; score: number }[]> {
	const terms = tokenize(query);
	const docs: { file: TFile; content: string; tf: number[]; length: number; meta: string }[] = [];
	const df = new Array<number>(terms.length).fill(0);

	for (const file of files) {
		let content: string;
		try {
			content = await app.vault.cachedRead(file);
		} catch (err) {
			console.error(`Vault LLM Assistant: could not read ${file.path}`, err);
			continue;
		}
		const lower = content.toLowerCase();
		const tf = terms.map((t) => countOccurrences(lower, t));
		tf.forEach((count, i) => {
			if (count > 0) df[i]++;
		});
		const cache = app.metadataCache.getFileCache(file);
		const aliases: unknown = cache?.frontmatter?.aliases;
		const meta = [
			file.basename,
			...(cache?.headings ?? []).map((h) => h.heading),
			...(cache?.tags ?? []).map((t) => t.tag),
			...(Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === "string") : []),
		]
			.join(" ")
			.toLowerCase();
		docs.push({ file, content, tf, length: lower.length, meta });
	}

	const n = docs.length || 1;
	const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / n || 1;
	const k1 = 1.2;
	const b = 0.75;
	const idf = df.map((d) => Math.log(1 + (n - d + 0.5) / (d + 0.5)));

	return docs
		.map((doc) => {
			let score = 0;
			terms.forEach((term, i) => {
				const tf = doc.tf[i];
				if (tf > 0) score += (idf[i] * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * doc.length) / avgLength));
				if (doc.meta.includes(term)) score += idf[i] * 1.5;
			});
			if (score > 0 && boostPaths.has(doc.file.path)) score *= 1.3;
			return { file: doc.file, content: doc.content, score };
		})
		.sort((a, b2) => b2.score - a.score || b2.file.stat.mtime - a.file.stat.mtime);
}

function formatNote(file: TFile, content: string): string {
	return `<note path="${file.path.replace(/\.md$/, "")}">\n${content.trim()}\n</note>\n\n`;
}

async function readImages(app: App, files: TFile[]): Promise<ImageAttachment[]> {
	const images: ImageAttachment[] = [];
	for (const file of files) {
		const embeds = app.metadataCache.getFileCache(file)?.embeds ?? [];
		for (const embed of embeds) {
			if (images.length >= MAX_IMAGES) return images;
			const target = app.metadataCache.getFirstLinkpathDest(embed.link.split("|")[0], file.path);
			if (!(target instanceof TFile)) continue;
			const ext = target.extension.toLowerCase();
			if (!IMAGE_EXTENSIONS.has(ext) || target.stat.size > MAX_IMAGE_BYTES) continue;
			if (images.some((img) => img.name === target.path)) continue;
			try {
				const data = arrayBufferToBase64(await app.vault.readBinary(target));
				images.push({ mimeType: ext === "jpg" ? "image/jpeg" : `image/${ext}`, data, name: target.path });
			} catch (err) {
				console.error(`Vault LLM Assistant: could not read image ${target.path}`, err);
			}
		}
	}
	return images;
}

export async function buildContext(
	app: App,
	settings: VaultLLMAssistantSettings,
	query: string,
	activeFile: TFile | null,
	scope: ContextScope = settings.contextScope,
): Promise<VaultContext> {
	if (scope === "none") return EMPTY;
	const budget = Math.max(1000, settings.maxContextChars);

	const picked: { file: TFile; content: string }[] = [];
	let truncated = false;
	let used = 0;

	const add = (file: TFile, content: string): boolean => {
		if (picked.some((p) => p.file.path === file.path)) return true;
		const remaining = budget - used;
		if (remaining < 200) {
			truncated = true;
			return false;
		}
		let body = content;
		if (body.length > remaining) {
			body = `${body.slice(0, remaining)}\n[... note shortened to fit the context limit]`;
			truncated = true;
		}
		picked.push({ file, content: body });
		used += body.length;
		return true;
	};

	const linked = activeFile && settings.includeLinkedNotes ? linkedFiles(app, activeFile) : new Set<string>();

	if (scope === "current") {
		if (!activeFile) return EMPTY;
		add(activeFile, await app.vault.cachedRead(activeFile));
		for (const path of linked) {
			const file = app.vault.getFileByPath(path);
			if (file && file.extension === "md" && !add(file, await app.vault.cachedRead(file))) break;
		}
	} else {
		const files = eligibleFiles(app, settings);
		if (activeFile && files.some((f) => f.path === activeFile.path)) {
			add(activeFile, await app.vault.cachedRead(activeFile));
		}

		if (settings.contextStrategy === "all") {
			const recent = [...files].sort((a, b) => b.stat.mtime - a.stat.mtime);
			for (const file of recent) {
				if (!add(file, await app.vault.cachedRead(file))) break;
			}
		} else {
			const ranked = await rankFiles(app, files, query, linked);
			let matches = ranked.filter((r) => r.score > 0);
			if (matches.length === 0) matches = ranked.slice().sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
			for (const match of matches) {
				if (picked.length >= settings.maxNotes) {
					truncated = truncated || matches.length > picked.length;
					break;
				}
				if (!add(match.file, match.content)) break;
			}
		}
	}

	const text = picked.map((p) => formatNote(p.file, p.content)).join("");
	const sources = picked.map((p) => p.file);
	const images = settings.includeImages ? await readImages(app, sources) : [];
	return { text, sources, truncated, chars: used, images };
}
