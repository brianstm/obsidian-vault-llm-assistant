import type {
	ContextScope,
	PromptTemplate,
	ProviderId,
	VaultLLMAssistantSettings,
} from "./types";
import { PROVIDERS, isProviderId } from "./providers";

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
	{
		id: "summarize",
		name: "Summarize",
		output: "insert",
		prompt: "Summarize the following text as concise bullet points. Keep the key facts, decisions and numbers.\n\n{{selection}}",
	},
	{
		id: "improve-writing",
		name: "Improve writing",
		output: "replace",
		prompt: "Rewrite the following text so it is clearer and more concise. Keep the meaning, tone, language and Markdown formatting, including links.\n\n{{selection}}",
	},
	{
		id: "fix-grammar",
		name: "Fix spelling and grammar",
		output: "replace",
		prompt: "Fix spelling, grammar and punctuation in the following text. Change nothing else. Keep the original language and Markdown formatting.\n\n{{selection}}",
	},
	{
		id: "continue-writing",
		name: "Continue writing",
		output: "insert",
		prompt: "Continue writing from the end of the text below. Match its style, tone and language. Return only the new text.\n\n{{before}}",
	},
	{
		id: "action-items",
		name: "Extract action items",
		output: "insert",
		prompt: "List the action items in the following text as a Markdown task list (- [ ] ...). Include owners and due dates when they are mentioned.\n\n{{selection}}",
	},
	{
		id: "suggest-tags",
		name: "Suggest tags",
		output: "insert",
		prompt: "Suggest 3 to 7 tags for the note below. Return them on one line as #tags separated by spaces, in lowercase with hyphens instead of spaces.\n\n{{note}}",
	},
	{
		id: "explain",
		name: "Explain",
		output: "chat",
		prompt: "Explain the following text in simple terms:\n\n{{selection}}",
	},
	{
		id: "translate-english",
		name: "Translate to English",
		output: "replace",
		prompt: "Translate the following text into English. Keep the Markdown formatting and links.\n\n{{selection}}",
	},
];

export const DEFAULT_SETTINGS: VaultLLMAssistantSettings = {
	provider: "gemini",
	models: {},
	baseUrls: {},
	secretIds: {},
	fetchedModels: {},
	modelsFetchedAt: {},
	maxTokens: 8192,
	temperature: 0.7,
	reasoningEffort: "default",
	customInstructions: "",
	contextScope: "vault",
	contextStrategy: "relevant",
	maxContextChars: 80000,
	maxNotes: 20,
	includeLinkedNotes: true,
	includeImages: false,
	includeFolders: [],
	excludeFolders: [],
	newNoteFolder: "",
	generateTitlesWithLLM: true,
	mode: "query",
	sendShortcut: "mod-enter",
	templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
};

export type LegacyKeys = Partial<Record<ProviderId, { value: string; encrypted: boolean }>>;

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function splitFolders(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v !== "");
	}
	return [];
}

export function migrateSettings(raw: unknown): {
	settings: VaultLLMAssistantSettings;
	legacyKeys: LegacyKeys;
	changed: boolean;
} {
	const data: Record<string, unknown> =
		raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
	const legacyKeys: LegacyKeys = {};
	let changed = false;

	const settings: VaultLLMAssistantSettings = {
		...DEFAULT_SETTINGS,
		models: {},
		baseUrls: {},
		secretIds: {},
		fetchedModels: {},
		modelsFetchedAt: {},
		templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
	};

	const sameShape = [
		"maxTokens",
		"temperature",
		"reasoningEffort",
		"customInstructions",
		"contextScope",
		"contextStrategy",
		"maxContextChars",
		"maxNotes",
		"includeLinkedNotes",
		"includeImages",
		"newNoteFolder",
		"generateTitlesWithLLM",
		"mode",
		"sendShortcut",
	] as const;
	for (const key of sameShape) {
		const value = data[key];
		if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
	}

	for (const key of ["models", "baseUrls", "secretIds", "fetchedModels", "modelsFetchedAt"] as const) {
		const value = data[key];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			(settings as unknown as Record<string, unknown>)[key] = { ...value };
		}
	}

	if (Array.isArray(data.templates)) {
		settings.templates = (data.templates as unknown[])
			.filter(
				(t): t is PromptTemplate =>
					!!t &&
					typeof t === "object" &&
					typeof (t as PromptTemplate).id === "string" &&
					typeof (t as PromptTemplate).name === "string" &&
					typeof (t as PromptTemplate).prompt === "string",
			)
			.map((t) => ({ ...t, output: t.output ?? "insert" }));
	}

	if (data.includeFolders !== undefined) settings.includeFolders = splitFolders(data.includeFolders);
	if (data.excludeFolders !== undefined) settings.excludeFolders = splitFolders(data.excludeFolders);

	const provider = str(data.provider);
	if (provider && isProviderId(provider)) {
		settings.provider = provider;
	} else if ("modelProvider" in data || "useLocalLLM" in data || "useOllama" in data) {
		changed = true;
		if (data.useLocalLLM === true) settings.provider = "lmstudio";
		else if (data.useOllama === true) settings.provider = "ollama";
		else {
			const old = str(data.modelProvider);
			settings.provider = old && isProviderId(old) ? old : DEFAULT_SETTINGS.provider;
		}

		const oldProvider = str(data.modelProvider);
		const oldModel = str(data.model);
		if (oldProvider && isProviderId(oldProvider) && oldModel) {
			settings.models[oldProvider] = oldModel;
		}
		const lmStudioModel = str(data.lmStudioModel);
		if (lmStudioModel && lmStudioModel !== "local-model") settings.models.lmstudio = lmStudioModel;
		const ollamaModel = str(data.ollamaModel);
		if (ollamaModel) settings.models.ollama = ollamaModel;

		const lmStudioUrl = str(data.lmStudioApiUrl);
		if (lmStudioUrl && lmStudioUrl !== PROVIDERS.lmstudio.defaultBaseUrl) settings.baseUrls.lmstudio = lmStudioUrl;
		const ollamaUrl = str(data.ollamaUrl);
		if (ollamaUrl && ollamaUrl !== PROVIDERS.ollama.defaultBaseUrl) settings.baseUrls.ollama = ollamaUrl;
	}

	if (data.contextScope === undefined && ("useVaultContent" in data || "includeCurrentFileOnly" in data)) {
		changed = true;
		let scope: ContextScope = "vault";
		if (data.useVaultContent === false) scope = "none";
		else if (data.includeCurrentFileOnly === true) scope = "current";
		settings.contextScope = scope;
	}
	if (data.includeFolders === undefined && data.includeFolder !== undefined) {
		changed = true;
		settings.includeFolders = splitFolders(data.includeFolder);
	}
	if (data.excludeFolders === undefined && data.excludeFolder !== undefined) {
		changed = true;
		settings.excludeFolders = splitFolders(data.excludeFolder);
	}

	const encrypted: [string, ProviderId][] = [
		["encryptedOpenAIApiKey", "gpt"],
		["encryptedGeminiApiKey", "gemini"],
		["encryptedClaudeApiKey", "claude"],
	];
	for (const [field, id] of encrypted) {
		const value = str(data[field]);
		if (value) legacyKeys[id] = { value, encrypted: true };
		if (field in data) changed = true;
	}
	const oldProvider = str(data.modelProvider);
	if (oldProvider && isProviderId(oldProvider) && !legacyKeys[oldProvider]) {
		const oldEncrypted = str(data.encryptedApiKey);
		const oldPlain = str(data.apiKey);
		if (oldEncrypted) legacyKeys[oldProvider] = { value: oldEncrypted, encrypted: true };
		else if (oldPlain) legacyKeys[oldProvider] = { value: oldPlain, encrypted: false };
	}
	if ("encryptedApiKey" in data || "apiKey" in data) changed = true;

	if (!["vault", "current", "none"].includes(settings.contextScope)) settings.contextScope = DEFAULT_SETTINGS.contextScope;
	if (!["relevant", "all"].includes(settings.contextStrategy)) settings.contextStrategy = DEFAULT_SETTINGS.contextStrategy;
	if (!["default", "low", "medium", "high"].includes(settings.reasoningEffort)) settings.reasoningEffort = "default";
	if (!["mod-enter", "ctrl-enter", "enter", "shift-enter", "alt-enter"].includes(settings.sendShortcut)) settings.sendShortcut = "mod-enter";
	if (settings.mode !== "query" && settings.mode !== "create") settings.mode = "query";

	return { settings, legacyKeys, changed };
}
