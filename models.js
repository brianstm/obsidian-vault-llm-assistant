const OPENAI_MODELS = [
    // GPT-5 Series (Hypothetical)
    { id: "gpt-5.2-pro", name: "GPT-5.2 Pro", endpoint: "/v1/responses" },
    { id: "gpt-5.2", name: "GPT-5.2", useMaxCompletionTokens: true },
    { id: "gpt-5.1", name: "GPT-5.1", useMaxCompletionTokens: true },
    { id: "gpt-5-pro", name: "GPT-5 Pro", endpoint: "/v1/responses" },
    { id: "gpt-5", name: "GPT-5", useMaxCompletionTokens: true },
    { id: "gpt-5-mini", name: "GPT-5 Mini", useMaxCompletionTokens: true },
    { id: "gpt-5-nano", name: "GPT-5 Nano", useMaxCompletionTokens: true },

    // Reasoning Series (o-series)
    { id: "o1-pro", name: "o1 Pro", endpoint: "/v1/responses" },
    { id: "o1", name: "o1", useMaxCompletionTokens: true },
    { id: "o3", name: "o3", useMaxCompletionTokens: true },
    { id: "o3-mini", name: "o3 Mini", useMaxCompletionTokens: true },
    { id: "o4-mini", name: "o4 Mini", useMaxCompletionTokens: true },

    // GPT-4.1 Series
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },

    // GPT-4o Series
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },

    // GPT-4 Legacy
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4", name: "GPT-4" },

    // GPT-3.5 Legacy
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    { id: "gpt-3.5-turbo-16k", name: "GPT-3.5 Turbo 16k" }
];

const GEMINI_MODELS = [
    // Gemini 3.0 Series (Preview)
    { id: "gemini-3-pro-preview", name: "Gemini 3.0 Pro (Preview)" },
    { id: "gemini-3-flash-preview", name: "Gemini 3.0 Flash (Preview)" },

    // Gemini 2.5 Series
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },

    // Gemini 2.0 Series
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },

    // "Latest" Aliases
    { id: "gemini-pro-latest", name: "Gemini Pro (Latest)" },
    { id: "gemini-flash-latest", name: "Gemini Flash (Latest)" },
    { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite (Latest)" }
];

module.exports = {
    OPENAI_MODELS,
    GEMINI_MODELS
};
