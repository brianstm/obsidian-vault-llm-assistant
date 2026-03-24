const OPENAI_MODELS = [
	{ id: "gpt-5.2-pro", name: "GPT-5.2 Pro", endpoint: "/v1/responses" },
	{ id: "gpt-5.2", name: "GPT-5.2", useMaxCompletionTokens: true },
	{ id: "gpt-5.1", name: "GPT-5.1", useMaxCompletionTokens: true },
	{ id: "gpt-5-pro", name: "GPT-5 Pro", endpoint: "/v1/responses" },
	{ id: "gpt-5", name: "GPT-5", useMaxCompletionTokens: true },
	{ id: "gpt-5-mini", name: "GPT-5 Mini", useMaxCompletionTokens: true },
	{ id: "gpt-5-nano", name: "GPT-5 Nano", useMaxCompletionTokens: true },
	{ id: "o1-pro", name: "o1 Pro", endpoint: "/v1/responses" },
	{ id: "o1", name: "o1", useMaxCompletionTokens: true },
	{ id: "o3", name: "o3", useMaxCompletionTokens: true },
	{ id: "o3-mini", name: "o3 Mini", useMaxCompletionTokens: true },
	{ id: "o4-mini", name: "o4 Mini", useMaxCompletionTokens: true },
	{ id: "gpt-4.1", name: "GPT-4.1" },
	{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
	{ id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
	{ id: "gpt-4o", name: "GPT-4o" },
	{ id: "gpt-4o-mini", name: "GPT-4o Mini" },
	{ id: "gpt-4-turbo", name: "GPT-4 Turbo" },
	{ id: "gpt-4", name: "GPT-4" },
	{ id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
	{ id: "gpt-3.5-turbo-16k", name: "GPT-3.5 Turbo 16k" },
];

const GEMINI_MODELS = [
	{ id: "gemini-3-pro-preview", name: "Gemini 3.0 Pro (Preview)" },
	{ id: "gemini-3-flash-preview", name: "Gemini 3.0 Flash (Preview)" },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
	{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
	{ id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
	{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
	{ id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
	{ id: "gemini-pro-latest", name: "Gemini Pro (Latest)" },
	{ id: "gemini-flash-latest", name: "Gemini Flash (Latest)" },
	{ id: "gemini-flash-lite-latest", name: "Gemini Flash Lite (Latest)" },
];

const CLAUDE_MODELS = [
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
	{ id: "claude-opus-4-5", name: "Claude Opus 4.5" },
	{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
	{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (Latest)" },
	{ id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet (20240620)" },
	{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
	{ id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
	{ id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet" },
	{ id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
];

module.exports = {
	OPENAI_MODELS,
	GEMINI_MODELS,
	CLAUDE_MODELS,
};
