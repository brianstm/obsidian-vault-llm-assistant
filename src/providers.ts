import { requestUrl, type RequestUrlResponse } from "obsidian";
import type {
	ChatMessage,
	CompletionRequest,
	ModelOption,
	ProviderId,
	ReasoningEffort,
} from "./types";

export type ProviderKind = "openai" | "openai-compatible" | "anthropic" | "gemini" | "ollama";

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	kind: ProviderKind;
	description: string;
	defaultBaseUrl: string;
	apiKey: "required" | "optional" | "none";
	defaultSecretId?: string;
	keyUrl?: string;
	defaultModel: string;
	local?: boolean;
	extraHeaders?: Record<string, string>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
	gpt: {
		id: "gpt",
		name: "OpenAI",
		kind: "openai",
		description: "GPT and o-series models from OpenAI.",
		defaultBaseUrl: "https://api.openai.com/v1",
		apiKey: "required",
		defaultSecretId: "openai-api-key",
		keyUrl: "https://platform.openai.com/api-keys",
		defaultModel: "gpt-5.4-mini",
	},
	claude: {
		id: "claude",
		name: "Anthropic Claude",
		kind: "anthropic",
		description: "Claude models from Anthropic.",
		defaultBaseUrl: "https://api.anthropic.com/v1",
		apiKey: "required",
		defaultSecretId: "anthropic-api-key",
		keyUrl: "https://platform.claude.com/settings/keys",
		defaultModel: "claude-opus-5-5",
	},
	gemini: {
		id: "gemini",
		name: "Google Gemini",
		kind: "gemini",
		description: "Gemini models from Google AI Studio.",
		defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
		apiKey: "required",
		defaultSecretId: "gemini-api-key",
		keyUrl: "https://aistudio.google.com/apikey",
		defaultModel: "gemini-2.5-flash",
	},
	groq: {
		id: "groq",
		name: "Groq",
		kind: "openai-compatible",
		description: "Open models that run really fast on Groq.",
		defaultBaseUrl: "https://api.groq.com/openai/v1",
		apiKey: "required",
		defaultSecretId: "groq-api-key",
		keyUrl: "https://console.groq.com/keys",
		defaultModel: "llama-3.3-70b-versatile",
	},
	nvidia: {
		id: "nvidia",
		name: "NVIDIA NIM",
		kind: "openai-compatible",
		description: "Models from build.nvidia.com. You can also point the base URL at your own NIM.",
		defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
		apiKey: "optional",
		defaultSecretId: "nvidia-api-key",
		keyUrl: "https://build.nvidia.com/settings/api-keys",
		defaultModel: "meta/llama-3.3-70b-instruct",
	},
	openrouter: {
		id: "openrouter",
		name: "OpenRouter",
		kind: "openai-compatible",
		description: "One key for hundreds of models from lots of providers.",
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		apiKey: "required",
		defaultSecretId: "openrouter-api-key",
		keyUrl: "https://openrouter.ai/settings/keys",
		defaultModel: "openrouter/auto",
		extraHeaders: { "HTTP-Referer": "https://obsidian.md", "X-Title": "Vault LLM Assistant" },
	},
	mistral: {
		id: "mistral",
		name: "Mistral AI",
		kind: "openai-compatible",
		description: "Models from Mistral AI.",
		defaultBaseUrl: "https://api.mistral.ai/v1",
		apiKey: "required",
		defaultSecretId: "mistral-api-key",
		keyUrl: "https://console.mistral.ai/api-keys",
		defaultModel: "mistral-medium-latest",
	},
	deepseek: {
		id: "deepseek",
		name: "DeepSeek",
		kind: "openai-compatible",
		description: "Models from DeepSeek.",
		defaultBaseUrl: "https://api.deepseek.com/v1",
		apiKey: "required",
		defaultSecretId: "deepseek-api-key",
		keyUrl: "https://platform.deepseek.com/api_keys",
		defaultModel: "deepseek-chat",
	},
	xai: {
		id: "xai",
		name: "xAI Grok",
		kind: "openai-compatible",
		description: "Grok models from xAI.",
		defaultBaseUrl: "https://api.x.ai/v1",
		apiKey: "required",
		defaultSecretId: "xai-api-key",
		keyUrl: "https://console.x.ai",
		defaultModel: "grok-4",
	},
	lmstudio: {
		id: "lmstudio",
		name: "LM Studio",
		kind: "openai-compatible",
		description: "Models running on your computer in LM Studio. Turn on its local server first.",
		defaultBaseUrl: "http://localhost:1234/v1",
		apiKey: "none",
		defaultModel: "",
		local: true,
	},
	ollama: {
		id: "ollama",
		name: "Ollama",
		kind: "ollama",
		description: "Models running on your computer with Ollama.",
		defaultBaseUrl: "http://localhost:11434",
		apiKey: "none",
		defaultModel: "llama3.2",
		local: true,
	},
	custom: {
		id: "custom",
		name: "Custom (OpenAI-compatible)",
		kind: "openai-compatible",
		description: "Any server that works with the OpenAI chat API, like vLLM, LiteLLM, Together or Fireworks.",
		defaultBaseUrl: "",
		apiKey: "optional",
		defaultSecretId: "custom-llm-api-key",
		defaultModel: "",
	},
};

export const PROVIDER_ORDER: ProviderId[] = [
	"gpt",
	"claude",
	"gemini",
	"groq",
	"nvidia",
	"openrouter",
	"mistral",
	"deepseek",
	"xai",
	"lmstudio",
	"ollama",
	"custom",
];

export function isProviderId(value: string): value is ProviderId {
	return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export interface ProviderConfig {
	provider: ProviderInfo;
	model: string;
	baseUrl: string;
	apiKey: string;
	maxTokens: number;
	temperature: number;
	reasoningEffort: ReasoningEffort;
}

export class LLMError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly hint?: string,
	) {
		super(message);
		this.name = "LLMError";
	}
}

export function normalizeBaseUrl(url: string, kind: ProviderKind): string {
	let base = url.trim().replace(/\/+$/, "");
	if (kind === "ollama") {
		base = base.replace(/\/api(\/(generate|chat))?$/, "");
	} else {
		base = base.replace(/\/(chat\/completions|completions|responses|messages)$/, "");
	}
	return base;
}

function hintFor(status: number, config: ProviderConfig): string | undefined {
	if (status === 401 || status === 403) return "Check the API key for this provider in the plugin settings.";
	if (status === 404) return "Check the model name, or reload the model list in the plugin settings.";
	if (status === 413) return "That request was too big. Try a lower maximum context size in the plugin settings.";
	if (status === 429) return "You hit a rate limit or ran out of quota. Wait a bit, or check your plan with the provider.";
	if (status >= 500) return `${config.provider.name} is having trouble right now. Try again in a bit.`;
	return undefined;
}

function readJson(res: RequestUrlResponse): unknown {
	try {
		return res.json as unknown;
	} catch {
		return undefined;
	}
}

function errorMessageFrom(data: unknown): string | undefined {
	if (!data || typeof data !== "object") return undefined;
	const d = data as { error?: unknown; message?: unknown; detail?: unknown };
	if (typeof d.error === "string") return d.error;
	if (d.error && typeof d.error === "object") {
		const message = (d.error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	if (typeof d.message === "string") return d.message;
	if (typeof d.detail === "string") return d.detail;
	return undefined;
}

async function requestJson(
	config: ProviderConfig,
	method: "GET" | "POST",
	url: string,
	headers: Record<string, string>,
	body?: unknown,
): Promise<unknown> {
	let res: RequestUrlResponse;
	try {
		res = await requestUrl({
			url,
			method,
			headers: { "Content-Type": "application/json", ...config.provider.extraHeaders, ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
			throw: false,
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new LLMError(
			`Couldn't reach ${config.provider.name} (${reason}).`,
			0,
			config.provider.local
				? `Make sure ${config.provider.name} is running and the base URL is right.`
				: "Check your internet connection and the base URL.",
		);
	}

	const data = readJson(res);
	if (res.status >= 400) {
		const message = errorMessageFrom(data) ?? `Request failed with status ${res.status}.`;
		throw new LLMError(message, res.status, hintFor(res.status, config));
	}
	if (data === undefined) {
		throw new LLMError(`${config.provider.name} sent back something that isn't JSON.`);
	}
	return data;
}

function bearer(config: ProviderConfig): Record<string, string> {
	return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

export function stripThinking(text: string): string {
	return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").replace(/^[\s\S]*?<\/think>\s*/, "");
}

function requireText(text: string, config: ProviderConfig, truncated: boolean): string {
	const clean = stripThinking(text).trim();
	if (clean) {
		return truncated ? `${clean}\n\n*(The answer got cut off. Raise "Max tokens" in the settings for longer answers.)*` : clean;
	}
	if (truncated) {
		throw new LLMError(
			"The model ran out of tokens before it could answer.",
			undefined,
			'Raise "Max tokens" in the plugin settings, or lower the reasoning effort.',
		);
	}
	throw new LLMError(`${config.provider.name} sent back an empty answer.`);
}

function isOpenAIReasoningModel(model: string): boolean {
	return /^(o\d|gpt-5)/.test(model) && !model.includes("chat");
}

function usesResponsesApi(model: string): boolean {
	return /^(o\d|gpt-5).*-pro(-|$)/.test(model);
}

function openAIContent(message: ChatMessage): unknown {
	if (!message.images?.length || message.role !== "user") return message.content;
	return [
		{ type: "text", text: message.content },
		...message.images.map((img) => ({
			type: "image_url",
			image_url: { url: `data:${img.mimeType};base64,${img.data}` },
		})),
	];
}

interface ChatCompletionResponse {
	choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

async function completeChatCompletions(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	const messages: unknown[] = [];
	if (req.system) messages.push({ role: "system", content: req.system });
	for (const m of req.messages) messages.push({ role: m.role, content: openAIContent(m) });

	const body: Record<string, unknown> = { model: config.model, messages, stream: false };
	if (config.provider.kind === "openai" && isOpenAIReasoningModel(config.model)) {
		body.max_completion_tokens = config.maxTokens;
		if (config.reasoningEffort !== "default") body.reasoning_effort = config.reasoningEffort;
	} else {
		body.max_tokens = config.maxTokens;
		body.temperature = config.temperature;
	}

	const data = (await requestJson(
		config,
		"POST",
		`${config.baseUrl}/chat/completions`,
		bearer(config),
		body,
	)) as ChatCompletionResponse;
	const choice = data.choices?.[0];
	return requireText(choice?.message?.content ?? "", config, choice?.finish_reason === "length");
}

interface ResponsesApiResponse {
	status?: string;
	incomplete_details?: { reason?: string } | null;
	output?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

async function completeResponses(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	const input = req.messages.map((m) => {
		if (m.role === "assistant" || !m.images?.length) return { role: m.role, content: m.content };
		return {
			role: m.role,
			content: [
				{ type: "input_text", text: m.content },
				...m.images.map((img) => ({ type: "input_image", image_url: `data:${img.mimeType};base64,${img.data}` })),
			],
		};
	});
	const body: Record<string, unknown> = {
		model: config.model,
		input,
		max_output_tokens: config.maxTokens,
	};
	if (req.system) body.instructions = req.system;
	if (config.reasoningEffort !== "default") body.reasoning = { effort: config.reasoningEffort };

	const data = (await requestJson(
		config,
		"POST",
		`${config.baseUrl}/responses`,
		bearer(config),
		body,
	)) as ResponsesApiResponse;
	const text = (data.output ?? [])
		.filter((item) => item.type === "message")
		.flatMap((item) => item.content ?? [])
		.filter((part) => part.type === "output_text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
	return requireText(text, config, data.incomplete_details?.reason === "max_output_tokens");
}

// Claude 4.7 and newer reject temperature.
const CLAUDE_ACCEPTS_TEMPERATURE = /^claude-(3|opus-4-[0-6]|opus-4-2\d{7}|sonnet-4-[0-6]|sonnet-4-2\d{7}|haiku-4-5)/;
const CLAUDE_NO_EFFORT = /^claude-(3|haiku-4|sonnet-4-5|sonnet-4-2\d{7}|sonnet-4-0|opus-4-[01]|opus-4-2\d{7})/;
const CLAUDE_FALLBACKS = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/;

interface AnthropicResponse {
	content?: { type?: string; text?: string }[];
	stop_reason?: string;
}

async function completeAnthropic(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	const messages = req.messages.map((m) => {
		if (!m.images?.length || m.role !== "user") return { role: m.role, content: m.content };
		return {
			role: m.role,
			content: [
				...m.images.map((img) => ({
					type: "image",
					source: { type: "base64", media_type: img.mimeType, data: img.data },
				})),
				{ type: "text", text: m.content },
			],
		};
	});

	const body: Record<string, unknown> = {
		model: config.model,
		max_tokens: config.maxTokens,
		messages,
	};
	if (req.system) body.system = req.system;
	if (CLAUDE_ACCEPTS_TEMPERATURE.test(config.model)) body.temperature = Math.min(config.temperature, 1);
	if (config.reasoningEffort !== "default" && !CLAUDE_NO_EFFORT.test(config.model)) {
		body.output_config = { effort: config.reasoningEffort };
	}

	const headers: Record<string, string> = {
		"x-api-key": config.apiKey,
		"anthropic-version": "2023-06-01",
	};
	if (CLAUDE_FALLBACKS.test(config.model)) {
		// If Claude declines, the API retries on another model.
		headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
		body.fallbacks = "default";
	}

	const data = (await requestJson(config, "POST", `${config.baseUrl}/messages`, headers, body)) as AnthropicResponse;
	if (data.stop_reason === "refusal") {
		throw new LLMError("Claude didn't want to answer this one.", undefined, "Try asking it a different way.");
	}
	const text = (data.content ?? [])
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("");
	return requireText(text, config, data.stop_reason === "max_tokens");
}

interface GeminiResponse {
	candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
	promptFeedback?: { blockReason?: string };
}

async function completeGemini(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	const body: Record<string, unknown> = {
		contents: req.messages.map((m) => ({
			role: m.role === "assistant" ? "model" : "user",
			parts: [
				{ text: m.content },
				...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
			],
		})),
		generationConfig: { maxOutputTokens: config.maxTokens, temperature: config.temperature },
	};
	if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

	const model = config.model.replace(/^models\//, "");
	const data = (await requestJson(
		config,
		"POST",
		`${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
		{ "x-goog-api-key": config.apiKey },
		body,
	)) as GeminiResponse;

	if (data.promptFeedback?.blockReason) {
		throw new LLMError(`Gemini blocked this request (${data.promptFeedback.blockReason}).`);
	}
	const candidate = data.candidates?.[0];
	if (candidate?.finishReason === "SAFETY") {
		throw new LLMError("Gemini stopped the answer for safety reasons.");
	}
	const text = (candidate?.content?.parts ?? [])
		.filter((p) => !p.thought && typeof p.text === "string")
		.map((p) => p.text)
		.join("");
	return requireText(text, config, candidate?.finishReason === "MAX_TOKENS");
}

interface OllamaChatResponse {
	message?: { content?: string };
	done_reason?: string;
}

async function completeOllama(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	const messages: unknown[] = [];
	if (req.system) messages.push({ role: "system", content: req.system });
	for (const m of req.messages) {
		messages.push({
			role: m.role,
			content: m.content,
			...(m.images?.length ? { images: m.images.map((img) => img.data) } : {}),
		});
	}
	try {
		const data = (await requestJson(config, "POST", `${config.baseUrl}/api/chat`, bearer(config), {
			model: config.model,
			messages,
			stream: false,
			options: { temperature: config.temperature, num_predict: config.maxTokens },
		})) as OllamaChatResponse;
		return requireText(data.message?.content ?? "", config, data.done_reason === "length");
	} catch (err) {
		if (err instanceof LLMError && err.status === 404) {
			throw new LLMError(
				`Ollama doesn't have the model "${config.model}".`,
				404,
				`Run "ollama pull ${config.model}" in a terminal, or pick a different model.`,
			);
		}
		throw err;
	}
}

function checkConfig(config: ProviderConfig): void {
	if (!config.baseUrl) {
		throw new LLMError(`There's no base URL for ${config.provider.name} yet.`, undefined, "Add it in the plugin settings.");
	}
	if (!config.model) {
		throw new LLMError(`No model is picked for ${config.provider.name} yet.`, undefined, "Pick one in the plugin settings.");
	}
	if (config.provider.apiKey === "required" && !config.apiKey) {
		throw new LLMError(
			`There's no API key for ${config.provider.name} yet.`,
			401,
			"Add your API key in the plugin settings.",
		);
	}
}

export async function complete(config: ProviderConfig, req: CompletionRequest): Promise<string> {
	checkConfig(config);
	switch (config.provider.kind) {
		case "anthropic":
			return completeAnthropic(config, req);
		case "gemini":
			return completeGemini(config, req);
		case "ollama":
			return completeOllama(config, req);
		case "openai":
			if (usesResponsesApi(config.model)) return completeResponses(config, req);
			return completeChatCompletions(config, req);
		default:
			return completeChatCompletions(config, req);
	}
}

const NON_CHAT_MODEL =
	/(embed|whisper|tts|audio|realtime|transcri|moderation|dall-e|image|rerank|guard|davinci|babbage|search|computer-use|sora|deep-research|codex|aqa)/i;

export async function listModels(config: ProviderConfig): Promise<ModelOption[]> {
	if (!config.baseUrl) throw new LLMError(`There's no base URL for ${config.provider.name} yet.`);
	const sortByName = (a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name);

	switch (config.provider.kind) {
		case "anthropic": {
			const data = (await requestJson(config, "GET", `${config.baseUrl}/models?limit=1000`, {
				"x-api-key": config.apiKey,
				"anthropic-version": "2023-06-01",
			})) as { data?: { id: string; display_name?: string }[] };
			return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
		}
		case "gemini": {
			const data = (await requestJson(config, "GET", `${config.baseUrl}/models?pageSize=1000`, {
				"x-goog-api-key": config.apiKey,
			})) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
			return (data.models ?? [])
				.filter((m) => m.supportedGenerationMethods?.includes("generateContent") && !NON_CHAT_MODEL.test(m.name))
				.map((m) => {
					const id = m.name.replace(/^models\//, "");
					return { id, name: m.displayName ?? id };
				})
				.sort(sortByName);
		}
		case "ollama": {
			const data = (await requestJson(config, "GET", `${config.baseUrl}/api/tags`, bearer(config))) as {
				models?: { name: string }[];
			};
			return (data.models ?? []).map((m) => ({ id: m.name, name: m.name })).sort(sortByName);
		}
		case "openai": {
			const data = (await requestJson(config, "GET", `${config.baseUrl}/models`, bearer(config))) as {
				data?: { id: string; created?: number }[];
			};
			return (data.data ?? [])
				.filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !NON_CHAT_MODEL.test(m.id))
				.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
				.map((m) => ({ id: m.id, name: m.id }));
		}
		default: {
			const data = (await requestJson(config, "GET", `${config.baseUrl}/models`, bearer(config))) as {
				data?: { id: string; name?: string }[];
			};
			return (data.data ?? [])
				.filter((m) => !NON_CHAT_MODEL.test(m.id))
				.map((m) => ({ id: m.id, name: m.name ?? m.id }))
				.sort(sortByName);
		}
	}
}
