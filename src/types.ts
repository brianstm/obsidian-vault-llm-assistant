export type ProviderId =
	| "gpt"
	| "claude"
	| "gemini"
	| "groq"
	| "nvidia"
	| "openrouter"
	| "mistral"
	| "deepseek"
	| "xai"
	| "lmstudio"
	| "ollama"
	| "custom";

export type AssistantMode = "query" | "create";

export type ContextScope = "vault" | "current" | "none";

export type ContextStrategy = "relevant" | "all";

export type SendShortcut = "mod-enter" | "ctrl-enter" | "enter" | "shift-enter" | "alt-enter";

export type ReasoningEffort = "default" | "low" | "medium" | "high";

export type TemplateOutput = "replace" | "insert" | "chat" | "note";

export interface PromptTemplate {
	id: string;
	name: string;
	prompt: string;
	output: TemplateOutput;
}

export interface ModelOption {
	id: string;
	name: string;
}

export interface VaultLLMAssistantSettings {
	provider: ProviderId;
	models: Partial<Record<ProviderId, string>>;
	baseUrls: Partial<Record<ProviderId, string>>;
	secretIds: Partial<Record<ProviderId, string>>;
	fetchedModels: Partial<Record<ProviderId, ModelOption[]>>;
	modelsFetchedAt: Partial<Record<ProviderId, number>>;
	maxTokens: number;
	temperature: number;
	reasoningEffort: ReasoningEffort;
	customInstructions: string;
	contextScope: ContextScope;
	contextStrategy: ContextStrategy;
	maxContextChars: number;
	maxNotes: number;
	includeLinkedNotes: boolean;
	includeImages: boolean;
	includeFolders: string[];
	excludeFolders: string[];
	newNoteFolder: string;
	generateTitlesWithLLM: boolean;
	mode: AssistantMode;
	sendShortcut: SendShortcut;
	templates: PromptTemplate[];
}

export interface ImageAttachment {
	mimeType: string;
	data: string;
	name: string;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	images?: ImageAttachment[];
}

export interface CompletionRequest {
	system: string;
	messages: ChatMessage[];
}
