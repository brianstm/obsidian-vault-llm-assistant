/**
 * Vault LLM Assistant for Obsidian
 */

import {
	App,
	Component,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	View,
	WorkspaceLeaf,
	requestUrl,
	RequestUrlResponse,
	TextComponent,
	SliderComponent,
} from "obsidian";
import { MarkdownRenderer } from "obsidian";

// Import models from external file
// eslint-disable-next-line @typescript-eslint/no-var-requires
const models = require("./models");
const OPENAI_MODELS = models.OPENAI_MODELS;
const GEMINI_MODELS = models.GEMINI_MODELS;

/**
 * Plugin Settings Interface
 * Defines all configurable options for the plugin
 */
interface VaultLLMAssistantSettings {
	encryptedOpenAIApiKey: string;
	encryptedGeminiApiKey: string;
	apiEndpoint: string;
	modelProvider: string;
	model: string;
	lmStudioApiUrl: string;
	lmStudioModel: string;
	useLocalLLM: boolean;
	maxTokens: number;
	temperature: number;
	includeCurrentFileOnly: boolean;
	includeFolder: string;
	excludeFolder: string[];
	newNoteFolder: string;
	generateTitlesWithLLM: boolean;
	useVaultContent: boolean;
	mode: "query" | "create";
}

/**
 * Default settings configuration
 */
const DEFAULT_SETTINGS: VaultLLMAssistantSettings = {
	encryptedOpenAIApiKey: "",
	encryptedGeminiApiKey: "",
	apiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
	modelProvider: "gemini",
	model: "gemini-3-pro-preview",
	lmStudioApiUrl: "http://localhost:1234/v1",
	lmStudioModel: "local-model",
	useLocalLLM: false,
	maxTokens: 2000,
	temperature: 0.7,
	includeCurrentFileOnly: false,
	includeFolder: "",
	excludeFolder: [],
	newNoteFolder: "",
	generateTitlesWithLLM: true,
	useVaultContent: true,
	mode: "query",
};

export default class VaultLLMAssistant extends Plugin {
	settings: VaultLLMAssistantSettings;
	statusBarItem: HTMLElement;
	openAIApiKey: string = "";
	geminiApiKey: string = "";

	async onload() {
		await this.loadSettings();

		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText("Vault LLM Assistant");

		const ribbonIconEl = this.addRibbonIcon(
			"bot",
			"Vault LLM Assistant",
			(evt: MouseEvent) => {
				new Notice("Opening Vault LLM Assistant...");
				this.activateView();
			}
		);
		ribbonIconEl.addClass("vault-llm-assistant-ribbon-class");

		this.addCommand({
			id: "scan-vault-ask-question",
			name: "Scan vault and ask a question",
			callback: () => {
				new QueryModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "scan-current-file-ask-question",
			name: "Scan current file and ask a question",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new QueryModal(this.app, this, view.file).open();
			},
		});

		this.registerView(
			"vault-llm-assistant-view",
			(leaf) => new VaultLLMAssistantView(leaf, this)
		);

		this.addSettingTab(new VaultLLMAssistantSettingTab(this.app, this));
	}

	/**
	 * Cleanup when plugin is disabled
	 */
	onunload() {
		// Obsidian will handle leaf cleanup
	}

	/**
	 * Load plugin settings from storage
	 */
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		// Load encrypted API keys
		if (this.settings.encryptedOpenAIApiKey) {
			this.openAIApiKey = this.decryptApiKey(
				this.settings.encryptedOpenAIApiKey
			);
		}

		if (this.settings.encryptedGeminiApiKey) {
			this.geminiApiKey = this.decryptApiKey(
				this.settings.encryptedGeminiApiKey
			);
		}

		// Handle legacy API key format
		if (
			this.settings.hasOwnProperty("encryptedApiKey") &&
			(this.settings as any).encryptedApiKey
		) {
			const oldKey = this.decryptApiKey(
				(this.settings as any).encryptedApiKey
			);
			if (oldKey) {
				if (this.settings.modelProvider === "gpt") {
					this.openAIApiKey = oldKey;
					this.settings.encryptedOpenAIApiKey =
						this.encryptApiKey(oldKey);
				} else if (this.settings.modelProvider === "gemini") {
					this.geminiApiKey = oldKey;
					this.settings.encryptedGeminiApiKey =
						this.encryptApiKey(oldKey);
				}

				delete (this.settings as any).encryptedApiKey;
				await this.saveSettings();
			}
		}

		// Remove any plaintext API key that might still be in the settings
		if ((this.settings as any).apiKey) {
			// Migrate plaintext key to encrypted format
			if (!this.openAIApiKey && !this.geminiApiKey) {
				const apiKey = (this.settings as any).apiKey;
				if (this.settings.modelProvider === "gpt") {
					this.openAIApiKey = apiKey;
					this.settings.encryptedOpenAIApiKey =
						this.encryptApiKey(apiKey);
				} else if (this.settings.modelProvider === "gemini") {
					this.geminiApiKey = apiKey;
					this.settings.encryptedGeminiApiKey =
						this.encryptApiKey(apiKey);
				}
			}

			delete (this.settings as any).apiKey;
			await this.saveSettings();
		}
	}

	/**
	 * Save plugin settings to storage
	 */
	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Opens the assistant view in the right sidebar
	 */
	async activateView() {
		this.app.workspace.detachLeavesOfType("vault-llm-assistant-view");

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: "vault-llm-assistant-view",
				active: true,
			});
		}

		const leaves = this.app.workspace.getLeavesOfType(
			"vault-llm-assistant-view"
		);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
		}
	}

	/**
	 * Scans vault files and builds a context string for the LLM
	 *
	 * @param additionalContext - Additional text to prepend to the vault content
	 * @param currentFile - Current file to use if includeCurrentFileOnly is true
	 * @returns A string containing all relevant vault content
	 */
	async scanVault(
		additionalContext: string = "",
		currentFile: TFile | null = null
	): Promise<string> {
		if (!this.settings.useVaultContent) {
			return additionalContext ? additionalContext : "";
		}

		const vault = this.app.vault;
		const files: TFile[] = [];

		if (this.settings.includeCurrentFileOnly && currentFile) {
			files.push(currentFile);
		} else {
			const allFiles = vault.getMarkdownFiles();

			let filesToScan = allFiles;
			if (this.settings.includeFolder) {
				filesToScan = allFiles.filter((file) =>
					file.path.startsWith(this.settings.includeFolder)
				);
			}

			if (this.settings.excludeFolder.length > 0) {
				filesToScan = filesToScan.filter((file) => {
					return !this.settings.excludeFolder.some((folder) =>
						file.path.startsWith(folder)
					);
				});
			}

			files.push(...filesToScan);
		}

		let allContents = "";
		for (const file of files) {
			try {
				const content = await vault.cachedRead(file);
				allContents += `FILE: ${file.path}\n\n${content}\n\n`;
			} catch (error) {
				console.error(`Error reading file ${file.path}:`, error);
			}
		}

		if (additionalContext) {
			allContents = additionalContext + "\n\n" + allContents;
		}

		return allContents;
	}

	/**
	 * Main method to query the configured LLM with vault content
	 * Builds different prompts based on the current mode (query or create) and whether vault content is used
	 *
	 * @param query - User's question or topic
	 * @param vaultContent - Vault content to use as context
	 * @param currentFilePath - Path of current file (optional)
	 * @returns The LLM's response as a string
	 */
	async queryLLM(
		query: string,
		vaultContent: string,
		currentFilePath: string | null = null
	): Promise<string> {
		try {
			let prompt = "";

			if (this.settings.mode === "query") {
				if (this.settings.useVaultContent) {
					prompt = `You are an expert assistant for the user's Obsidian vault.
1. Be concise and precise. Minimize filler text and get straight to the answer.
2. Answer STRICTLY based on the provided notes.
3. Cite sources using the format [[file_path]].
4. Use Markdown formatting.

User's Notes:
${vaultContent}

${currentFilePath ? `Current file: ${currentFilePath}` : ""}

User's Question: ${query}`;
				} else {
					prompt = `You are an expert assistant.
1. Answer clearly and concisely. Minimize filler text.
2. Use Markdown formatting.

User's Question: ${query}`;
				}
			} else if (this.settings.mode === "create") {
				if (this.settings.useVaultContent) {
					prompt = `You are a helpful assistant for creating new notes in the user's Obsidian vault.
You have access to the user's existing notes which are provided below.
Please create a comprehensive note about the requested topic, incorporating relevant information from the existing notes when applicable.
When referencing content from existing notes, cite the source file using the format [[file_path]].

IMPORTANT: Respond ONLY with the note content directly, without any additional text, introductions, or wrapper. DO NOT include \`\`\`md at the beginning or \`\`\` at the end.
Use proper Markdown formatting with headings, lists, and code blocks as needed.
If you quote or reference content from the vault, make sure to include proper citations, you may include the specific part of the file that you are referencing using the format [[file_path#title_of_the_section_you_are_referencing]] (Do not change the title of the section you are referencing, use the same title as it is in the file with the same capitalization).
For any code examples, use proper markdown code blocks with language specification.

User's Notes:
${vaultContent}

${currentFilePath ? `Current file: ${currentFilePath}` : ""}

Topic to create a note about: ${query}`;
				} else {
					prompt = `You are a helpful assistant for creating new notes.
Please create a comprehensive note about the requested topic.

IMPORTANT: Respond ONLY with the note content directly, without any additional text, introductions, or wrapper. DO NOT include \`\`\`md at the beginning or \`\`\` at the end.
Use proper Markdown formatting with headings, lists, and code blocks as needed.
For any code examples, use proper markdown code blocks with language specification.

Topic to create a note about: ${query}`;
				}
			}

			let response: string;

			if (this.settings.useLocalLLM) {
				response = await this.queryLMStudio(prompt);
			} else {
				if (this.settings.modelProvider === "gpt") {
					response = await this.queryGPT(prompt);
				} else if (this.settings.modelProvider === "gemini") {
					response = await this.queryGemini(prompt);
				} else {
					throw new Error("Unknown model provider");
				}
			}

			if (this.settings.mode === "create") {
				response = this.cleanMarkdownResponse(response);
			}

			return response;
		} catch (error) {
			console.error("Error querying LLM:", error);
			return `Error: ${error.message}`;
		}
	}

	/**
	 * Queries OpenAI's API with the prepared prompt
	 *
	 * @param prompt - Formatted prompt with system instructions and context
	 * @returns The model's response or a formatted error message
	 */
	async queryGPT(prompt: string): Promise<string> {
		try {
            // Find model config
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const modelConfig = OPENAI_MODELS.find((m: any) => m.id === this.settings.model);

            const body: any = {
                model: this.settings.model,
                temperature: this.settings.temperature,
            };

            const endpoint = (modelConfig && modelConfig.endpoint) ? modelConfig.endpoint : "/v1/chat/completions";

            if (endpoint === "/v1/responses") {
                 body.input = [
                    {
                        role: "system",
                        content:
                            "You are an expert assistant. Answer responsibly, concisely, and precisely. Always cite sources using [[Filename]].",
                    },
                    {
                        role: "user",
                        content: prompt,
                    },
                ];
            } else if (endpoint === "/v1/completions") {
                body.prompt = prompt;
                 // Add system prompt to context for completion models roughly
                body.prompt = "System: You are an expert assistant. Answer concisely.\nUser: " + prompt + "\nAssistant:";
            } else {
                 body.messages = [
                    {
                        role: "system",
                        content:
                            "You are an expert assistant. Answer responsibly, concisely, and precisely. Always cite sources using [[Filename]].",
                    },
                    {
                        role: "user",
                        content: prompt,
                    },
                ];
            }

            if (modelConfig && modelConfig.useMaxCompletionTokens) {
                body.max_completion_tokens = this.settings.maxTokens;
            } else if (endpoint !== "/v1/responses") {
                body.max_tokens = this.settings.maxTokens;
            }

            const url = `https://api.openai.com${endpoint}`;

			const response = await requestUrl({
				url: url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.getApiKey()}`,
				},
				body: JSON.stringify(body),
			});

			const jsonResponse = response.json;
			if (jsonResponse.choices && jsonResponse.choices.length > 0) {
				return jsonResponse.choices[0].message.content;
			}
			return "No response generated.";

		} catch (error) {
			console.error("Error querying OpenAI:", error);

			let errorMessage = "Error querying OpenAI: ";

			// Try to extract detailed error from response body if available
			if (error.text) {
				try {
					const errorBody = await error.text();
					const parsedBody = JSON.parse(errorBody);
					if (parsedBody.error && parsedBody.error.message) {
						errorMessage += `Server message: ${parsedBody.error.message}`;
						return errorMessage;
					}
				} catch (e) {
					// Failed to parse error body, continue with standard error handling
				}
			}

			if (error.status) {
				switch (error.status) {
					case 401:
						errorMessage +=
							"Authentication error. Please check your API key.";
						break;
					case 403:
						errorMessage +=
							"Permission denied. Your API key may not have access to this model.";
						break;
					case 404:
						errorMessage +=
							"The specified model was not found. It might be deprecated or unavailable.";
						break;
					case 429:
						errorMessage +=
							"Rate limit exceeded or quota exceeded. Please check your OpenAI plan and limits.";
						break;
					case 500:
					case 502:
					case 503:
					case 504:
						errorMessage +=
							"OpenAI server error. Please try again later.";
						break;
					default:
						errorMessage += `Status ${error.status}: ${error.message || "Unknown error"
							}`;
				}
			} else if (error.message) {
				errorMessage += error.message;
			} else {
				errorMessage += "Unknown error occurred";
			}

			return errorMessage;
		}
	}

	/**
	 * Queries Google's Gemini API with the prepared prompt
	 *
	 * @param prompt - Formatted prompt with context
	 * @returns The model's response
	 */
	async queryGemini(prompt: string): Promise<string> {
		try {
			const response = await requestUrl({
				url: `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.model
					}:generateContent?key=${this.getApiKey()}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					contents: [
						{
							parts: [{ text: prompt }],
						},
					],
					generationConfig: {
						maxOutputTokens: this.settings.maxTokens,
						temperature: this.settings.temperature,
					},
				}),
			});

			const jsonResponse = response.json;
			if (jsonResponse.candidates && jsonResponse.candidates.length > 0) {
				return jsonResponse.candidates[0].content.parts[0].text;
			}

			if (jsonResponse.error) {
				return `Gemini API Error: ${jsonResponse.error.message || "Unknown error"
					}`;
			}

			return "No response generated.";

		} catch (error) {
			console.error("Error querying Gemini:", error);

			let errorMessage = "Error querying Gemini: ";

			// Try to extract detailed error from response body if available
			if (error.text) {
				try {
					const errorBody = await error.text();
					const parsedBody = JSON.parse(errorBody);
					if (parsedBody.error && parsedBody.error.message) {
						errorMessage += `Server message: ${parsedBody.error.message}`;
						return errorMessage;
					}
				} catch (e) {
					// Failed to parse error body, continue with standard error handling
				}
			}

			if (error.status) {
				switch (error.status) {
					case 400:
						errorMessage +=
							"Bad request. Check your model name and request format.";
						break;
					case 401:
						errorMessage +=
							"Authentication error. Please check your API key.";
						break;
					case 403:
						errorMessage +=
							"Permission denied. Your API key may not have access to this model.";
						break;
					case 404:
						errorMessage +=
							"The specified model was not found. It might be deprecated or unavailable.";
						break;
					case 429:
						errorMessage +=
							"Rate limit exceeded or quota exceeded. Please check your Google AI Studio quota.";
						break;
					case 500:
					case 502:
					case 503:
					case 504:
						errorMessage +=
							"Gemini server error. Please try again later.";
						break;
					default:
						errorMessage += `Status ${error.status}: ${error.message || "Unknown error"
							}`;
				}
			} else if (error.message) {
				errorMessage += error.message;
			} else {
				errorMessage += "Unknown error occurred";
			}

			return errorMessage;
		}
	}

	/**
	 * Queries LM Studio (local LLM) with the prepared prompt
	 * Uses OpenAI-compatible API structure
	 *
	 * @param prompt - Formatted prompt with system instructions and context
	 * @returns The model's response or a formatted error message
	 */
	async queryLMStudio(prompt: string): Promise<string> {
		try {
			// Ensure URL ends with /chat/completions if not present, but respect user's base URL
			let url = this.settings.lmStudioApiUrl;
			if (!url.endsWith("/chat/completions")) {
				if (url.endsWith("/")) {
					url += "chat/completions";
				} else {
					url += "/chat/completions";
				}
			}

			const response = await requestUrl({
				url: url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.settings.lmStudioModel,
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant that answers questions about the user's Obsidian vault content.",
						},
						{
							role: "user",
							content: prompt,
						},
					],
					max_tokens: this.settings.maxTokens,
					temperature: this.settings.temperature,
				}),
			});

			const jsonResponse = response.json;
			if (jsonResponse.choices && jsonResponse.choices.length > 0) {
				return jsonResponse.choices[0].message.content;
			}
			return "No response generated.";
		} catch (error) {
			console.error("Error querying LM Studio:", error);

			let errorMessage = "Error querying LM Studio: ";

			if (error.status) {
				switch (error.status) {
					case 404:
						errorMessage +=
							"Endpoint not found. Check your LM Studio URL setting.";
						break;
					case 500:
						errorMessage +=
							"Server error. Check LM Studio logs.";
						break;
					case 0: // Connection refused often shows as status 0 in some contexts or needs specific handling
						errorMessage +=
							"Connection failed. Is LM Studio running and the server started?";
						break;
					default:
						errorMessage += `Status ${error.status}: ${error.message || "Unknown error"
							}`;
				}
			} else if (error.message) {
				if (error.message.includes("Connection refused") || error.message.includes("Failed to fetch")) {
					errorMessage += "Connection failed. Is LM Studio running and the server started?";
				} else {
					errorMessage += error.message;
				}
			} else {
				errorMessage += "Unknown error occurred";
			}

			return errorMessage;
		}
	}

	formatGPTResponse(response: RequestUrlResponse): string {
		try {
			const jsonResponse = response.json;
			if (jsonResponse.choices && jsonResponse.choices.length > 0) {
				return jsonResponse.choices[0].message.content;
			}
			return "No response generated.";
		} catch (error) {
			console.error("Error formatting GPT response:", error);
			return `Error formatting response: ${error.message}`;
		}
	}

	formatGeminiResponse(response: RequestUrlResponse): string {
		try {
			const jsonResponse = response.json;
			if (
				jsonResponse.candidates &&
				jsonResponse.candidates.length > 0 &&
				jsonResponse.candidates[0].content &&
				jsonResponse.candidates[0].content.parts &&
				jsonResponse.candidates[0].content.parts.length > 0
			) {
				return jsonResponse.candidates[0].content.parts[0].text;
			}
			return "No response generated.";
		} catch (error) {
			console.error("Error formatting Gemini response:", error);
			return `Error formatting response: ${error.message}`;
		}
	}

	/**
	 * Creates a new note from content
	 *
	 * @param title - The title for the new note
	 * @param content - The content to put in the note
	 * @returns The created file or null if failed
	 */
	async createNoteFromContent(
		title: string,
		content: string
	): Promise<TFile | null> {
		try {
			const cleanTitle = title.replace(/[\\/:*?"<>|]/g, "").trim();

			const fileName =
				cleanTitle ||
				`LLM response ${new Date().toISOString().slice(0, 10)}`;

			let folderPath = this.settings.newNoteFolder.trim();
			if (folderPath && !folderPath.endsWith("/")) {
				folderPath += "/";
			}

			const fullPath = `${folderPath}${fileName}.md`;

			if (folderPath) {
				const folderExists = await this.app.vault.adapter.exists(
					folderPath
				);
				if (!folderExists) {
					await this.app.vault.createFolder(folderPath);
				}
			}

			const file = await this.app.vault.create(fullPath, content);
			this.app.workspace.openLinkText(file.path, "", false);

			return file;
		} catch (error) {
			console.error("Error creating note:", error);
			new Notice(`Error creating note: ${error.message}`);
			return null;
		}
	}

	/**
	 * Generates a suitable title for the response using the LLM
	 *
	 * @param query - The user's question
	 * @param response - The LLM's response
	 * @returns A suitable title
	 */
	async generateTitleForResponse(
		query: string,
		response: string
	): Promise<string> {
		try {
			const prompt = `Based on the following question and answer, suggest a concise, descriptive title (5-7 words max) that summarizes the main topic. Return ONLY the title text, nothing else.

Question: ${query}

Answer: ${response.substring(0, 500)}... (truncated for brevity)`;

			let titleResponse: string;

			if (this.settings.useLocalLLM) {
				titleResponse = await this.queryLMStudio(prompt);
			} else {
				if (this.settings.modelProvider === "gpt") {
					titleResponse = await this.queryGPT(prompt);
				} else if (this.settings.modelProvider === "gemini") {
					titleResponse = await this.queryGemini(prompt);
				} else {
					throw new Error("Unknown model provider");
				}
			}

			// Clean up title
			const cleanTitle = titleResponse
				.replace(/^["']|["']$|[.:]$/g, "") // Remove quotes and trailing punctuation
				.trim();

			return (
				cleanTitle ||
				`LLM response ${new Date().toISOString().slice(0, 10)}`
			);
		} catch (error) {
			console.error("Error generating title:", error);
			return `LLM response ${new Date().toISOString().slice(0, 10)}`;
		}
	}

	/**
	 * Helper function to clean up markdown responses from LLMs
	 * Removes markdown fences and explanatory text that sometimes appears in responses
	 *
	 * @param text - The text to clean
	 * @returns The cleaned text
	 */
	cleanMarkdownResponse(text: string): string {
		text = text.replace(/^```m(?:d|arkdown)\s*\n/i, "");
		text = text.replace(/\n```\s*$/i, "");

		const mdFenceMatch = text.match(/```m(?:d|arkdown)/i);
		if (mdFenceMatch && mdFenceMatch.index) {
			text = text.substring(mdFenceMatch.index);
			text = text.replace(/```m(?:d|arkdown)\s*\n/i, "");
		}

		return text;
	}

	/**
	 * Encrypts the API key before storing in settings
	 * Uses a simple but better-than-plaintext approach
	 *
	 * @param apiKey - The API key to encrypt
	 * @returns The encrypted API key
	 */
	encryptApiKey(apiKey: string): string {
		if (!apiKey) return "";

		// Simple encryption using Base64 and character substitution
		const deviceId = this.getDeviceId();
		const mixed = apiKey
			.split("")
			.map((char, index) => {
				const deviceChar =
					deviceId[index % deviceId.length].charCodeAt(0);
				return String.fromCharCode(char.charCodeAt(0) ^ deviceChar);
			})
			.join("");

		return btoa(mixed);
	}

	/**
	 * Decrypts the API key from settings
	 *
	 * @param encryptedKey - The encrypted API key
	 * @returns The decrypted API key
	 */
	decryptApiKey(encryptedKey: string): string {
		if (!encryptedKey) return "";

		try {
			const deviceId = this.getDeviceId();
			const decoded = atob(encryptedKey);

			return decoded
				.split("")
				.map((char, index) => {
					const deviceChar =
						deviceId[index % deviceId.length].charCodeAt(0);
					return String.fromCharCode(char.charCodeAt(0) ^ deviceChar);
				})
				.join("");
		} catch (e) {
			console.error("Failed to decrypt API key:", e);
			return "";
		}
	}

	/**
	 * Gets a device-specific ID to use for encryption
	 * This helps make the encryption tied to the device
	 */
	getDeviceId(): string {
		// Using user agent and vault path to create a unique device identifier
		const userAgentInfo = navigator.userAgent || "unknown";
		const vaultPath = this.app.vault.getName() || "obsidian";
		const seed = `${userAgentInfo}-${vaultPath}`;

		// Create a simple hash of the seed
		let hash = 0;
		for (let i = 0; i < seed.length; i++) {
			const char = seed.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32bit integer
		}

		return Math.abs(hash).toString(16).padStart(16, "0");
	}

	/**
	 * Gets the API key for the current provider
	 */
	getApiKey(): string {
		if (this.settings.useLocalLLM) {
			return "";
		}
		if (this.settings.modelProvider === "gpt") {
			return this.openAIApiKey;
		} else if (this.settings.modelProvider === "gemini") {
			return this.geminiApiKey;
		}
		return "";
	}

	/**
	 * Sets the API key for a specific provider
	 */
	async setApiKey(apiKey: string, provider: string) {
		if (provider === "gpt") {
			this.openAIApiKey = apiKey;
			this.settings.encryptedOpenAIApiKey = this.encryptApiKey(apiKey);
		} else if (provider === "gemini") {
			this.geminiApiKey = apiKey;
			this.settings.encryptedGeminiApiKey = this.encryptApiKey(apiKey);
		}
		await this.saveSettings();
	}

	/**
	 * Gets the OpenAI API key
	 */
	getOpenAIApiKey(): string {
		return this.openAIApiKey;
	}

	/**
	 * Gets the Gemini API key
	 */
	getGeminiApiKey(): string {
		return this.geminiApiKey;
	}
}

/**
 * Modal dialog for entering a query
 * Provides a textarea and buttons for submitting or canceling
 */
class QueryModal extends Modal {
	plugin: VaultLLMAssistant;
	query: string;
	currentFile: TFile | null;
	inputEl: HTMLTextAreaElement;

	constructor(
		app: App,
		plugin: VaultLLMAssistant,
		currentFile: TFile | null = null
	) {
		super(app);
		this.plugin = plugin;
		this.query = "";
		this.currentFile = currentFile;
	}

	/**
	 * Creates the modal UI when opened
	 */
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("vault-llm-assistant-modal");

		const title =
			this.plugin.settings.mode === "query"
				? "Enter your question"
				: "Enter a topic to create a note about";
		contentEl.createEl("h2", { text: title });

		this.inputEl = contentEl.createEl("textarea", {
			attr: {
				placeholder:
					this.plugin.settings.mode === "query"
						? "What would you like to ask about your vault?"
						: "What topic would you like to create a note about?",
				rows: "4",
			},
		});
		this.inputEl.focus();

		const buttonContainer = contentEl.createDiv();
		buttonContainer.addClass("vault-llm-button-container");

		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		const submitButton = buttonContainer.createEl("button", {
			text: this.plugin.settings.mode === "query" ? "Ask" : "Create",
		});
		submitButton.classList.add("mod-cta");
		submitButton.addEventListener("click", () => {
			this.query = this.inputEl.value;
			this.close();
			this.processQuery();
		});


	}

	/**
	 * Processes the query when submitted
	 * Handles two different modes:
	 * 1. Query mode: Opens the assistant view and shows the response with actions
	 * 2. Create mode: Directly creates a new note without showing the assistant view
	 */
	async processQuery() {
		if (!this.query.trim()) {
			new Notice(
				this.plugin.settings.mode === "query"
					? "Please enter a question"
					: "Please enter a topic to create a note about"
			);
			return;
		}

		const noticeText =
			this.plugin.settings.mode === "query"
				? "Processing your question..."
				: "Generating note content...";

		new Notice(noticeText);

		if (this.plugin.settings.mode === "query") {
			await this.plugin.activateView();

			const leaves = this.app.workspace.getLeavesOfType(
				"vault-llm-assistant-view"
			);
			if (leaves.length === 0) {
				new Notice("Could not open the assistant view");
				return;
			}

			const view = leaves[0].view as VaultLLMAssistantView;
			if (view instanceof VaultLLMAssistantView) {
				view.setQuery(this.query, this.currentFile);
			}
		} else {
			try {
				const vaultContent = this.plugin.settings.useVaultContent
					? await this.plugin.scanVault("", this.currentFile || null)
					: "";

				if (!this.plugin.settings.useVaultContent) {
					new Notice("Creating note without using vault content");
				}

				const content = await this.plugin.queryLLM(
					this.query,
					vaultContent,
					this.currentFile ? this.currentFile.path : null
				);

				if (
					content.startsWith("Error querying ") ||
					content.startsWith("Gemini API Error:")
				) {
					let errorMessage = "Failed to create note: ";

					if (content.includes(":")) {
						const [_, errorDetails] = content.split(":", 2);
						errorMessage += errorDetails.trim();
					} else {
						errorMessage += content;
					}

					new Notice(errorMessage, 10000);
					return;
				}

				let title = `LLM response ${new Date()
					.toISOString()
					.slice(0, 10)}`;

				if (this.plugin.settings.generateTitlesWithLLM) {
					try {
						title = await this.plugin.generateTitleForResponse(
							this.query,
							content
						);
					} catch (titleError) {
						console.error("Error generating title:", titleError);
						new Notice(
							"Could not generate a title, using your topic text instead."
						);
					}
				}

				const noteContent = `# ${title}\n\n${content}`;
				const file = await this.plugin.createNoteFromContent(
					title,
					noteContent
				);

				if (file) {
					new Notice(`Note created: ${file.name}`);
				}
			} catch (error) {
				console.error("Error creating note:", error);

				let errorMessage = "Error creating note: ";

				if (error.message) {
					if (error.message.includes("already exists")) {
						errorMessage +=
							"A note with this title already exists.";
					} else if (error.message.includes("permission")) {
						errorMessage +=
							"Permission denied. Check your folder permissions.";
					} else {
						errorMessage += error.message;
					}
				} else {
					errorMessage += "An unknown error occurred.";
				}

				new Notice(errorMessage, 7000);
			}
		}
	}

	/**
	 * Cleanup when modal is closed
	 */
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Main view component for the assistant
 * Displays in the Obsidian workspace as a panel
 */
class VaultLLMAssistantView extends View {
	plugin: VaultLLMAssistant;
	contentEl: HTMLElement;
	currentFile: TFile | null = null;
	isProcessing: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: VaultLLMAssistant) {
		super(leaf);
		this.plugin = plugin;
		this.contentEl = createDiv({ cls: "vault-llm-assistant-view" });
	}

	/**
	 * Returns the view type for Obsidian
	 */
	getViewType(): string {
		return "vault-llm-assistant-view";
	}

	/**
	 * Returns the display title for the view
	 */
	getDisplayText(): string {
		return "Vault LLM Assistant";
	}

	/**
	 * Returns the icon name for the view
	 */
	getIcon(): string {
		return "bot";
	}

	/**
	 * Creates the view UI when opened
	 */
	async onOpen() {
		const containerEl = this.containerEl;
		containerEl.empty();
		containerEl.addClass("vault-llm-assistant-view");
		containerEl.createEl("h2", { text: "Vault LLM Assistant" });

		const introText = containerEl.createEl("p", {
			text: "Ask a question about your vault.",
			cls: "vault-llm-intro-text",
		});

		const inputContainer = containerEl.createDiv({
			cls: "vault-llm-input-container",
		});

		const queryInput = inputContainer.createEl("textarea", {
			attr: {
				placeholder: "What would you like to ask?",
				rows: "3",
			},
		});



		const optionsContainer = inputContainer.createDiv({
			cls: "vault-llm-options-container",
		});

		const modeToggle = optionsContainer.createDiv({
			cls: "vault-llm-option-toggle",
		});

		const modeSelect = modeToggle.createEl("select", {
			attr: {
				id: "mode-select",
			},
		});

		modeSelect.createEl("option", {
			value: "query",
			text: "Query Mode",
			attr: {
				selected:
					this.plugin.settings.mode === "query" ? "selected" : null,
			},
		});

		modeSelect.createEl("option", {
			value: "create",
			text: "Create Mode",
			attr: {
				selected:
					this.plugin.settings.mode === "create" ? "selected" : null,
			},
		});

		modeSelect.addEventListener("change", async (e) => {
			const target = e.target as HTMLSelectElement;
			this.plugin.settings.mode = target.value as "query" | "create";
			await this.plugin.saveSettings();

			const queryInput = inputContainer.querySelector("textarea");
			if (queryInput) {
				queryInput.placeholder =
					this.plugin.settings.mode === "query"
						? "What would you like to ask?"
						: "What topic would you like to create a note about?";
			}

			const askButton = buttonContainer.querySelector("button.mod-cta");
			if (askButton) {
				askButton.textContent =
					this.plugin.settings.mode === "query" ? "Ask" : "Create";
			}
		});

		const currentFileToggle = optionsContainer.createDiv({
			cls: "vault-llm-option-toggle",
		});

		const currentFileCheckbox = currentFileToggle.createEl("input", {
			attr: {
				type: "checkbox",
				id: "current-file-only",
			},
		});
		currentFileCheckbox.checked =
			this.plugin.settings.includeCurrentFileOnly;

		currentFileToggle.createEl("label", {
			text: "Current file only",
			attr: { for: "current-file-only" },
		});

		currentFileCheckbox.addEventListener("change", async (e) => {
			this.plugin.settings.includeCurrentFileOnly =
				currentFileCheckbox.checked;
			await this.plugin.saveSettings();
		});

		const useVaultContentToggle = optionsContainer.createDiv({
			cls: "vault-llm-option-toggle",
		});

		const useVaultContentCheckbox = useVaultContentToggle.createEl(
			"input",
			{
				attr: {
					type: "checkbox",
					id: "use-vault-content",
				},
			}
		);
		useVaultContentCheckbox.checked = this.plugin.settings.useVaultContent;

		useVaultContentToggle.createEl("label", {
			text: "Use vault content",
			attr: { for: "use-vault-content" },
		});

		useVaultContentCheckbox.addEventListener("change", async (e) => {
			this.plugin.settings.useVaultContent =
				useVaultContentCheckbox.checked;
			await this.plugin.saveSettings();
		});

		const buttonContainer = inputContainer.createDiv({
			cls: "vault-llm-button-container",
		});

		const askButton = buttonContainer.createEl("button", { text: "Ask" });
		askButton.classList.add("mod-cta");

		const processQuery = () => {
			const query = queryInput.value.trim();
			if (query) {
				this.setQuery(query, this.app.workspace.getActiveFile());
				queryInput.value = "";
			} else {
				new Notice("Please enter a question");
			}
		};

		askButton.addEventListener("click", processQuery);



		containerEl.createDiv({ cls: "vault-llm-response-container" });
	}

	/**
	 * Processes a new query and updates the view
	 * This is the core function that handles scanning the vault, querying the LLM, and displaying results
	 *
	 * @param query - User's question or topic
	 * @param currentFile - Current file for context (optional)
	 */
	async setQuery(query: string, currentFile: TFile | null = null) {
		if (this.isProcessing) {
			new Notice("Already processing a query. Please wait.");
			return;
		}

		this.isProcessing = true;
		this.currentFile = currentFile;

		const responseContainer = this.containerEl.querySelector(
			".vault-llm-response-container"
		);
		if (!responseContainer) return;
		responseContainer.empty();

		const loadingEl = responseContainer.createDiv({
			cls: "vault-llm-loading",
		});
		loadingEl.setText(
			this.plugin.settings.mode === "query"
				? "Scanning vault and generating response..."
				: "Generating note content..."
		);

		try {
			const vaultContent = this.plugin.settings.useVaultContent
				? await this.plugin.scanVault("", currentFile || null)
				: "";

			const queryEl = responseContainer.createEl("div", {
				cls: "vault-llm-query",
			});

			if (this.plugin.settings.mode === "query") {
				const strongEl = queryEl.createEl("strong");
				strongEl.setText("Your question: ");
				queryEl.createSpan({ text: query });
			} else {
				const strongEl = queryEl.createEl("strong");
				strongEl.setText("Note topic: ");
				queryEl.createSpan({ text: query });
			}

			// Add model indicator
			queryEl.createSpan({
				cls: "vault-llm-model-badge",
				text: this.plugin.settings.model,
			});

			if (
				this.plugin.settings.useVaultContent &&
				vaultContent.trim() !== ""
			) {
				const sourceFiles = this.extractSourceFiles(vaultContent);
				const workspaceSourcesContainer = responseContainer.createDiv({
					cls: "vault-llm-workspace-sources",
				});

				const sourcesHeader = workspaceSourcesContainer.createDiv({
					cls: "vault-llm-sources-header",
				});

				const sourcesTitle = sourcesHeader.createDiv({
					cls: "vault-llm-sources-title",
				});

				const iconSpan = sourcesTitle.createSpan({
					cls: "vault-llm-sources-icon",
					text: "▼",
				});

				sourcesTitle.createSpan({
					text: ` Workspace sources (${sourceFiles.length} files)`,
				});

				const sourcesContent = workspaceSourcesContainer.createDiv({
					cls: "vault-llm-sources-content",
				});

				if (sourceFiles.length > 0) {
					sourceFiles.forEach((file) => {
						sourcesContent.createEl("div", {
							text: file,
							cls: "vault-llm-source-item",
						});
					});
				} else {
					sourcesContent.createEl("div", {
						text: "No source files were included.",
						cls: "vault-llm-empty-list",
					});
				}

				sourcesHeader.addEventListener("click", () => {
					sourcesContent.toggleClass(
						"vault-llm-sources-collapsed",
						!sourcesContent.hasClass("vault-llm-sources-collapsed")
					);
					if (iconSpan) {
						iconSpan.textContent = sourcesContent.hasClass(
							"vault-llm-sources-collapsed"
						)
							? "▶"
							: "▼";
					}
				});

				sourcesContent.addClass("vault-llm-sources-collapsed");
				if (iconSpan) {
					iconSpan.textContent = "▶";
				}
			} else if (!this.plugin.settings.useVaultContent) {
				responseContainer.createEl("div", {
					cls: "vault-llm-info-message",
					text: "Note: Vault content is not being used for this query.",
				});
			}

			let response = await this.plugin.queryLLM(
				query,
				vaultContent,
				currentFile ? currentFile.path : null
			);

			loadingEl.remove();

			if (
				response.startsWith("Error querying ") ||
				response.startsWith("Gemini API Error:")
			) {
				const errorContainer = responseContainer.createEl("div", {
					cls: "vault-llm-error-message",
				});

				if (response.includes(":")) {
					const [errorTitle, errorDetails] = response.split(":", 2);

					errorContainer.createEl("div", {
						cls: "vault-llm-error-title",
						text: errorTitle + ":",
					});

					errorContainer.createEl("div", {
						cls: "vault-llm-error-details",
						text: errorDetails.trim(),
					});

					if (response.includes("API key")) {
						errorContainer.createEl("div", {
							text: "→ Check your API key in settings and verify it's correct.",
							cls: "vault-llm-error-help",
						});
					} else if (
						response.includes("Rate limit") ||
						response.includes("quota")
					) {
						errorContainer.createEl("div", {
							text: "→ You may need to wait or upgrade your plan.",
							cls: "vault-llm-error-help",
						});
					} else if (response.includes("server error")) {
						errorContainer.createEl("div", {
							text: "→ The service might be temporarily unavailable. Try again later.",
							cls: "vault-llm-error-help",
						});
					}
				} else {
					errorContainer.setText(response);
				}

				const retryButton = responseContainer.createEl("button", {
					text: "Try again",
					cls: "vault-llm-action-button",
				});

				retryButton.addEventListener("click", () => {
					this.setQuery(query, currentFile);
				});

				return;
			}

			const answerContainer = responseContainer.createEl("div", {
				cls: "vault-llm-answer",
			});

			await MarkdownRenderer.render(
				this.app,
				response,
				answerContainer,
				currentFile ? currentFile.path : "/",
				new Component()
			);

			answerContainer.addClass("vault-llm-selectable");

			const actionButtonsContainer = responseContainer.createEl("div", {
				cls: "vault-llm-action-buttons",
			});

			const copyTextButton = actionButtonsContainer.createEl("button", {
				text: "Copy text",
				cls: "vault-llm-action-button",
			});

			copyTextButton.addEventListener("click", () => {
				const plainText = answerContainer.textContent || "";
				navigator.clipboard.writeText(plainText);
				new Notice("Text copied to clipboard");
			});

			const copyMarkdownButton = actionButtonsContainer.createEl(
				"button",
				{
					text: "Copy Markdown",
					cls: "vault-llm-action-button",
				}
			);

			copyMarkdownButton.addEventListener("click", () => {
				navigator.clipboard.writeText(response);
				new Notice("Markdown copied to clipboard");
			});

			const createNoteButton = actionButtonsContainer.createEl("button", {
				text: "Create note",
				cls: "vault-llm-action-button",
			});

			createNoteButton.addEventListener("click", async () => {
				let noteTitle = `LLM response ${new Date()
					.toISOString()
					.slice(0, 10)}`;

				if (this.plugin.settings.generateTitlesWithLLM) {
					new Notice("Generating title for note...");

					createNoteButton.disabled = true;
					createNoteButton.setText("Generating title...");
				}

				try {
					if (this.plugin.settings.generateTitlesWithLLM) {
						noteTitle = await this.plugin.generateTitleForResponse(
							query,
							response
						);
					} else {
						noteTitle =
							query.length > 50
								? query.substring(0, 50).trim() + "..."
								: query.trim();
					}

					let formattedContent = "";

					if (this.plugin.settings.mode === "query") {
						formattedContent =
							`# ${noteTitle}\n\n` +
							`> [!info] Query\n> ${query}\n\n` +
							response;
					} else {
						formattedContent = `# ${noteTitle}\n\n${response}`;
					}

					const file = await this.plugin.createNoteFromContent(
						noteTitle,
						formattedContent
					);

					if (file) {
						new Notice(`Note created: ${file.name}`);
					}
				} catch (error) {
					console.error("Error creating note:", error);
					new Notice(`Error creating note: ${error.message}`);
				} finally {
					if (this.plugin.settings.generateTitlesWithLLM) {
						createNoteButton.disabled = false;
						createNoteButton.setText("Create Note");
					}
				}
			});

			setTimeout(() => {
				responseContainer.scrollTo({
					top: responseContainer.scrollHeight,
					behavior: "smooth",
				});
				setTimeout(() => {
					responseContainer.scrollTo({
						top: responseContainer.scrollHeight - 150,
						behavior: "smooth",
					});
				}, 100);
			}, 200);

			this.processLinks(answerContainer);
			responseContainer.scrollTop = 0;
		} catch (error) {
			loadingEl.remove();
			if (responseContainer) {
				responseContainer.createEl("div", {
					cls: "vault-llm-error",
					text: `Error: ${error.message}`,
				});
			}
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Extracts source file paths from the vault content string
	 *
	 * @param vaultContent - The vault content string
	 * @returns Array of file paths used as sources
	 */
	extractSourceFiles(vaultContent: string): string[] {
		const sourceFiles: string[] = [];
		const fileRegex = /FILE: ([^\n]+)/g;
		let match;

		while ((match = fileRegex.exec(vaultContent)) !== null) {
			sourceFiles.push(match[1]);
		}

		return sourceFiles;
	}

	/**
	 * Returns view data for Obsidian serialization
	 */
	getViewData(): string {
		// Not needed for this implementation
		return "";
	}

	/**
	 * Sets view data from Obsidian serialization
	 */
	setViewData(data: string, clear: boolean): void {
		// Not needed for this implementation
	}

	/**
	 * Processes links in the response to make them clickable
	 * Fixes common formatting issues with links in the LLM response
	 *
	 * @param element - HTML element containing the response
	 */
	processLinks(element: HTMLElement) {
		// First process paragraphs to find and convert wiki-style links
		this.processWikiStyleLinks(element);

		// Process all links to make them clickable
		element
			.querySelectorAll("a.internal-link, .cm-underline")
			.forEach((link: HTMLElement) => {
				const href =
					link.getAttribute("href") || link.textContent?.trim();
				if (href) {
					// Handle different link formats and fragments
					const cleanHref = href.replace(/[\[\],]/g, "").trim();
					let filePath = cleanHref;
					let fragment = "";

					if (cleanHref.includes(" > ")) {
						// Format: "file.md > Header" - convert to proper Obsidian format
						const parts = cleanHref.split(" > ", 2);
						filePath = parts[0].trim();
						if (parts.length > 1) {
							fragment =
								"#" +
								parts[1]
									.trim()
									.toLowerCase()
									.replace(/\s+/g, "-");
						}
					} else if (cleanHref.includes("#")) {
						const parts = cleanHref.split("#", 2);
						filePath = parts[0].trim();
						fragment =
							parts.length > 1 ? "#" + parts[1].trim() : "";
					}

					// The full path to use when opening the link
					const fullPath = fragment ? filePath + fragment : filePath;

					link.addEventListener("click", (e) => {
						e.preventDefault();
						const file =
							this.app.metadataCache.getFirstLinkpathDest(
								filePath,
								""
							);
						if (file instanceof TFile) {
							this.app.workspace.openLinkText(
								fullPath,
								"",
								false
							);
						} else {
							new Notice(`File not found: ${filePath}`);
						}
					});

					link.classList.add("vault-llm-link");
					link.setAttribute("href", fullPath);

					// Make sure the link text is visible and matches the path
					if (
						!link.textContent ||
						link.textContent === "-" ||
						link.textContent.trim() === "" ||
						link.textContent.trim() === "-"
					) {
						link.textContent = filePath;
						link.classList.add("vault-llm-visible-link");
					}
				}
			});
	}

	/**
	 * Processes paragraphs to find and convert wiki-style links
	 *
	 * @param element - HTML element containing the response
	 */
	processWikiStyleLinks(element: HTMLElement) {
		const paragraphs = element.querySelectorAll("p");
		paragraphs.forEach((paragraph) => {
			const text = paragraph.textContent || "";
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;

			// Find wiki-style links [[...]]
			const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
			let match;

			while ((match = wikiLinkRegex.exec(text)) !== null) {
				// Add text before the match
				if (match.index > lastIndex) {
					fragment.appendChild(
						document.createTextNode(
							text.substring(lastIndex, match.index)
						)
					);
				}

				const path = match[1].trim();

				// Create link element
				const linkEl = document.createElement("a");
				linkEl.classList.add("internal-link", "vault-llm-link");
				linkEl.setAttribute("href", path);
				linkEl.textContent = path;

				// Add event listener to open link
				linkEl.addEventListener("click", (e) => {
					e.preventDefault();
					const file = this.app.metadataCache.getFirstLinkpathDest(
						path,
						""
					);
					if (file instanceof TFile) {
						this.app.workspace.openLinkText(path, "", false);
					} else {
						new Notice(`File not found: ${path}`);
					}
				});

				fragment.appendChild(linkEl);
				lastIndex = match.index + match[0].length;
			}

			// Add remaining text
			if (lastIndex < text.length) {
				fragment.appendChild(
					document.createTextNode(text.substring(lastIndex))
				);
			}

			// Only replace content if we found wiki links
			if (lastIndex > 0) {
				// Clear paragraph content using proper DOM API
				while (paragraph.firstChild) {
					paragraph.removeChild(paragraph.firstChild);
				}

				paragraph.appendChild(fragment);
			}
		});
	}
}

/**
 * Settings tab for configuring the plugin
 * Provides UI for all plugin settings
 */
class VaultLLMAssistantSettingTab extends PluginSettingTab {
	plugin: VaultLLMAssistant;
	openAIApiKeyVisible: boolean = false;
	geminiApiKeyVisible: boolean = false;

	constructor(app: App, plugin: VaultLLMAssistant) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Creates the settings UI
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("vault-llm-settings");

		// LLM Provider setting

		// 1. Use Local LLM Checkbox
		new Setting(containerEl)
			.setName("Use Local LLM (LM Studio)")
			.setDesc("Toggle to use a local LLM server instead of online providers")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useLocalLLM)
					.onChange(async (value: boolean) => {
						this.plugin.settings.useLocalLLM = value;
						await this.plugin.saveSettings();
						this.display(); // Redraw settings
					})
			);

		// 2. Online Provider Selection (Only if NOT using local LLM)
		if (!this.plugin.settings.useLocalLLM) {
			new Setting(containerEl)
				.setName("Online Provider")
				.setDesc("Select which online LLM provider to use")
				.addDropdown((dropdown) => {
					const dropdownEl = dropdown
						.addOption("gpt", "OpenAI GPT")
						.addOption("gemini", "Google Gemini")
						.setValue(this.plugin.settings.modelProvider)
						.onChange(async (value) => {
							this.plugin.settings.modelProvider = value;

							// Update endpoints and default model based on provider
							if (value === "gpt") {
								this.plugin.settings.apiEndpoint =
									"https://api.openai.com/v1/chat/completions";
								if (!this.plugin.settings.model.startsWith("gpt")) {
									this.plugin.settings.model = "gpt-4o-mini";
								}
							} else if (value === "gemini") {
								this.plugin.settings.apiEndpoint =
									"https://generativelanguage.googleapis.com/v1beta/models";
								if (
									!this.plugin.settings.model.startsWith("gemini")
								) {
									this.plugin.settings.model = "gemini-3-pro-preview";
								}
							}

							await this.plugin.saveSettings();
							this.display(); // Redraw the settings
						});
					dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
					return dropdown;
				});
		}

		// 3. LM Studio Settings (Only if using local LLM)
		if (this.plugin.settings.useLocalLLM) {
			new Setting(containerEl)
				.setName("LM Studio API URL")
				.setDesc("The base URL for your local LM Studio server (e.g., http://localhost:1234/v1)")
				.addText((text: TextComponent) =>
					text
						.setPlaceholder("http://localhost:1234/v1")
						.setValue(this.plugin.settings.lmStudioApiUrl)
						.onChange(async (value: string) => {
							this.plugin.settings.lmStudioApiUrl = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("LM Studio Model Name")
				.setDesc("The model identifier to use (check LM Studio server logs for the loaded model ID)")
				.addText((text: TextComponent) =>
					text
						.setPlaceholder("local-model")
						.setValue(this.plugin.settings.lmStudioModel)
						.onChange(async (value: string) => {
							this.plugin.settings.lmStudioModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// OpenAI API Key (Only if Online AND Provider is GPT)
		if (!this.plugin.settings.useLocalLLM && this.plugin.settings.modelProvider === "gpt") {
			const openAIApiKeySetting = new Setting(containerEl)
				.setName("OpenAI API key")
				.setDesc("Enter your OpenAI API key (Required)");

			// Create container for OpenAI API key input and toggle button
			const openAIApiKeyContainer = createDiv({
				cls: "vault-llm-apikey-container",
			});
			openAIApiKeySetting.controlEl.appendChild(openAIApiKeyContainer);

			// Add text input for OpenAI
			const openAIApiKeyInput = new TextComponent(openAIApiKeyContainer);
			openAIApiKeyInput
				.setPlaceholder("Enter your OpenAI API key")
				.setValue(
					this.openAIApiKeyVisible
						? this.plugin.getOpenAIApiKey()
						: "••••••••••••••••••••••••••"
				)
				.onChange(async (value: string) => {
					await this.plugin.setApiKey(value, "gpt");
				});
			openAIApiKeyInput.inputEl.type = this.openAIApiKeyVisible
				? "text"
				: "password";
			openAIApiKeyInput.inputEl.addClass("vault-llm-apikey-input");

			// Add visibility toggle button for OpenAI
			const openAIToggleButton = openAIApiKeyContainer.createEl("button", {
				cls: "vault-llm-visibility-toggle",
				text: this.openAIApiKeyVisible ? "Hide" : "Show",
			});
			openAIToggleButton.addEventListener("click", () => {
				this.openAIApiKeyVisible = !this.openAIApiKeyVisible;
				openAIApiKeyInput.inputEl.type = this.openAIApiKeyVisible
					? "text"
					: "password";
				openAIApiKeyInput.setValue(
					this.openAIApiKeyVisible
						? this.plugin.getOpenAIApiKey()
						: "••••••••••••••••••••••••••"
				);
				openAIToggleButton.textContent = this.openAIApiKeyVisible
					? "Hide"
					: "Show";
			});
		}

		// Gemini API Key (Only if Online AND Provider is Gemini)
		if (!this.plugin.settings.useLocalLLM && this.plugin.settings.modelProvider === "gemini") {
			const geminiApiKeySetting = new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc("Enter your Google Gemini API key (Required)");

			// Create container for Gemini API key input and toggle button
			const geminiApiKeyContainer = createDiv({
				cls: "vault-llm-apikey-container",
			});
			geminiApiKeySetting.controlEl.appendChild(geminiApiKeyContainer);

			// Add text input for Gemini
			const geminiApiKeyInput = new TextComponent(geminiApiKeyContainer);
			geminiApiKeyInput
				.setPlaceholder("Enter your Gemini API key")
				.setValue(
					this.geminiApiKeyVisible
						? this.plugin.getGeminiApiKey()
						: "••••••••••••••••••••••••••"
				)
				.onChange(async (value: string) => {
					await this.plugin.setApiKey(value, "gemini");
				});
			geminiApiKeyInput.inputEl.type = this.geminiApiKeyVisible
				? "text"
				: "password";
			geminiApiKeyInput.inputEl.addClass("vault-llm-apikey-input");

			// Add visibility toggle button for Gemini
			const geminiToggleButton = geminiApiKeyContainer.createEl("button", {
				cls: "vault-llm-visibility-toggle",
				text: this.geminiApiKeyVisible ? "Hide" : "Show",
			});
			geminiToggleButton.addEventListener("click", () => {
				this.geminiApiKeyVisible = !this.geminiApiKeyVisible;
				geminiApiKeyInput.inputEl.type = this.geminiApiKeyVisible
					? "text"
					: "password";
				geminiApiKeyInput.setValue(
					this.geminiApiKeyVisible
						? this.plugin.getGeminiApiKey()
						: "••••••••••••••••••••••••••"
				);
				geminiToggleButton.textContent = this.geminiApiKeyVisible
					? "Hide"
					: "Show";
			});
		}

		// Test Connection Button
		const testConnectionSetting = new Setting(containerEl)
			.setName("Test Connection")
			.setDesc("Verify that your API key and selected model are working correctly")
			.addButton((button) => {
				button.setButtonText("Test Connection").onClick(async () => {
					button.setButtonText("Testing...");
					button.setDisabled(true);

					try {
						let result = "";
						// Use strict 1 token generation to test connection
						if (this.plugin.settings.modelProvider === "gpt") {
							// Find model config
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const modelConfig = OPENAI_MODELS.find((m: any) => m.id === this.plugin.settings.model);

                            const endpoint = (modelConfig && modelConfig.endpoint) ? modelConfig.endpoint : "/v1/chat/completions";
                            const body: any = {
                                model: this.plugin.settings.model,
                            };

                            const messages = [
                                {
                                    role: "user",
                                    content: "Hi",
                                },
                            ];

                            if (endpoint === "/v1/responses") {
                                body.input = messages;
                            } else if (endpoint === "/v1/completions") {
                                body.prompt = "Hi";
                            } else {
                                body.messages = messages;
                            }

                            const maxTokens = 50; // Use 50 to avoid max_tokens errors on reasoning models

                            if (modelConfig && modelConfig.useMaxCompletionTokens) {
                                body.max_completion_tokens = maxTokens;
                            } else if (endpoint !== "/v1/responses") {
                                body.max_tokens = maxTokens;
                            }

                            const url = `https://api.openai.com${endpoint}`;

							// For GPT, manual simple request
							const response = await requestUrl({
								url: url,
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									Authorization: `Bearer ${this.plugin.getApiKey()}`,
								},
								body: JSON.stringify(body),
							});
							if (response.status === 200) {
								result = "Success";
							}
						} else {
							// For Gemini, manual simple request
							const response = await requestUrl({
								url: `https://generativelanguage.googleapis.com/v1beta/models/${
									this.plugin.settings.model
								}:generateContent?key=${this.plugin.getApiKey()}`,
								method: "POST",
								headers: {
									"Content-Type": "application/json",
								},
								body: JSON.stringify({
									contents: [
										{
											parts: [{ text: "Hi" }],
										},
									],
									generationConfig: {
										maxOutputTokens: 1,
									},
								}),
							});
							// Check for error in JSON response even if status is 200 (common in some APIs, though Gemini usually errors)
							if (response.status === 200 && !response.json.error) {
								result = "Success";
							} else if (response.json.error) {
								throw new Error(
									response.json.error.message ||
										"Unknown Gemini error"
								);
							}
						}

						new Notice(
							`Connection successful! Connected to ${this.plugin.settings.model}`
						);
					} catch (error) {
						console.error("Connection test failed:", error);
						let msg = error.message;
						if (error.text) {
							// Try to parse detailed error from body if available
							try {
								const body = await error.text();
								const parsed = JSON.parse(body);
								if (parsed.error && parsed.error.message) {
									msg = parsed.error.message;
								}
							} catch (e) {
								// ignore
							}
						}
						new Notice(`Connection failed: ${msg}`, 10000);
					} finally {
						button.setButtonText("Test Connection");
						button.setDisabled(false);
					}
				});
			});

		// Model selection
		if (!this.plugin.settings.useLocalLLM && this.plugin.settings.modelProvider === "gpt") {
			new Setting(containerEl)
				.setName("GPT model")
				.setDesc("Select which GPT model to use")
				.addDropdown((dropdown) => {
					const dropdownEl = dropdown;
					OPENAI_MODELS.forEach((model: { id: string; name: string }) => {
						dropdownEl.addOption(model.id, model.name);
					});

					dropdownEl
						.setValue(this.plugin.settings.model)
						.onChange(async (value) => {
							this.plugin.settings.model = value;
							await this.plugin.saveSettings();
						});
					dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
					return dropdown;
				});
		} else if (!this.plugin.settings.useLocalLLM && this.plugin.settings.modelProvider === "gemini") {
			new Setting(containerEl)
				.setName("Gemini model")
				.setDesc("Select which Gemini model to use")
				.addDropdown((dropdown) => {
					const dropdownEl = dropdown;
					GEMINI_MODELS.forEach((model: { id: string; name: string }) => {
						dropdownEl.addOption(model.id, model.name);
					});

					dropdownEl
						.setValue(this.plugin.settings.model)
						.onChange(async (value) => {
							this.plugin.settings.model = value;
							await this.plugin.saveSettings();
						});
					dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
					return dropdown;
				});
		}

		// Max Tokens with improved display
		const maxTokensSetting = new Setting(containerEl)
			.setName("Max tokens")
			.setDesc("Maximum number of tokens in the response");

		// Container for slider and value display
		const maxTokensContainer = createDiv({
			cls: "vault-llm-slider-container",
		});
		maxTokensSetting.controlEl.appendChild(maxTokensContainer);

		// Value display
		const maxTokensValueDisplay = maxTokensContainer.createDiv({
			cls: "vault-llm-slider-value",
			text: this.plugin.settings.maxTokens.toString(),
		});

		// Add slider
		const maxTokensSlider = new SliderComponent(maxTokensContainer)
			.setLimits(100, 4000, 100)
			.setValue(this.plugin.settings.maxTokens)
			.onChange(async (value: number) => {
				this.plugin.settings.maxTokens = value;
				maxTokensValueDisplay.textContent = value.toString();
				await this.plugin.saveSettings();
			});
		maxTokensSlider.sliderEl.addClass("vault-llm-slider");

		// Temperature with improved display
		const temperatureSetting = new Setting(containerEl)
			.setName("Temperature")
			.setDesc(
				"Controls randomness in responses (0-2, lower is more focused)"
			);

		// Container for slider and value display
		const tempContainer = createDiv({ cls: "vault-llm-slider-container" });
		temperatureSetting.controlEl.appendChild(tempContainer);

		// Value display
		const tempValueDisplay = tempContainer.createDiv({
			cls: "vault-llm-slider-value",
			text: this.plugin.settings.temperature.toString(),
		});

		// Add slider
		const tempSlider = new SliderComponent(tempContainer)
			.setLimits(0, 2, 0.1)
			.setValue(this.plugin.settings.temperature)
			.onChange(async (value: number) => {
				this.plugin.settings.temperature = value;
				tempValueDisplay.textContent = value.toFixed(1);
				await this.plugin.saveSettings();
			});
		tempSlider.sliderEl.addClass("vault-llm-slider");

		// Include current file only
		new Setting(containerEl)
			.setName("Include current file only")
			.setDesc(
				"When enabled, only scans the current file instead of the entire vault"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeCurrentFileOnly)
					.onChange(async (value) => {
						this.plugin.settings.includeCurrentFileOnly = value;
						await this.plugin.saveSettings();
					})
			);

		// Default folder for new notes
		new Setting(containerEl)
			.setName("Default folder for new notes")
			.setDesc(
				"Path where new notes will be created when using 'Create note from answer' (leave empty for vault root)"
			)
			.addText((text) =>
				text
					.setPlaceholder("folder/path")
					.setValue(this.plugin.settings.newNoteFolder || "")
					.onChange(async (value) => {
						this.plugin.settings.newNoteFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Use LLM for note titles
		new Setting(containerEl)
			.setName("Generate note titles with LLM")
			.setDesc(
				"When enabled, uses the LLM to generate descriptive titles for new notes (uses additional API calls)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.generateTitlesWithLLM)
					.onChange(async (value) => {
						this.plugin.settings.generateTitlesWithLLM = value;
						await this.plugin.saveSettings();
					})
			);

		// Use vault content in prompts
		new Setting(containerEl)
			.setName("Use vault content in prompts")
			.setDesc("When enabled, includes the vault content in prompts")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useVaultContent)
					.onChange(async (value) => {
						this.plugin.settings.useVaultContent = value;
						await this.plugin.saveSettings();
					})
			);

		// Mode selection
		new Setting(containerEl)
			.setName("Mode")
			.setDesc("Select the current mode: query or create notes")
			.addDropdown((dropdown) => {
				const dropdownEl = dropdown
					.addOption("query", "Query")
					.addOption("create", "Create notes")
					.setValue(this.plugin.settings.mode)
					.onChange(async (value) => {
						this.plugin.settings.mode = value as "query" | "create";
						await this.plugin.saveSettings();
					});
				dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
				return dropdown;
			});

		// Create folder management section
		const folderSection = containerEl.createDiv({
			cls: "vault-llm-folder-section",
		});

		// Include Folders
		const includeFolderSection = folderSection.createDiv({
			cls: "vault-llm-folder-subsection",
		});
		includeFolderSection.createEl("h3", {
			text: "Include folders",
			cls: "vault-llm-section-header",
		});

		// Description
		includeFolderSection.createEl("p", {
			text: "Only include files from these folders (leave empty to include all)",
			cls: "vault-llm-section-desc",
		});

		// Input for new include folder
		const includeFolderContainer = includeFolderSection.createDiv({
			cls: "vault-llm-folder-input-container",
		});
		const includeFolderInput = new TextComponent(includeFolderContainer);
		includeFolderInput
			.setPlaceholder("folder/path (comma-separated paths)")
			.setValue(this.plugin.settings.includeFolder || "");

		// Add additional styling to the input element
		includeFolderInput.inputEl.addClass("vault-llm-folder-textbox");
		includeFolderInput.inputEl.setAttribute("rows", "2");

		// Add button for include folder
		const includeAddButton = includeFolderContainer.createEl("button", {
			text: "Save",
			cls: "vault-llm-folder-add-button",
		});
		includeAddButton.addEventListener("click", async () => {
			this.plugin.settings.includeFolder = includeFolderInput.getValue();
			await this.plugin.saveSettings();
			new Notice("Include folder paths saved (case sensitive)");
			this.display(); // Refresh view
		});

		// Exclude Folders section
		const excludeFolderSection = folderSection.createDiv({
			cls: "vault-llm-folder-subsection",
		});
		excludeFolderSection.createEl("h3", {
			text: "Exclude folders",
			cls: "vault-llm-section-header",
		});

		// Description
		excludeFolderSection.createEl("p", {
			text: "Folders to exclude from scanning (case sensitive)",
			cls: "vault-llm-section-desc",
		});

		// Display current excluded folders
		const excludedFoldersDisplay = excludeFolderSection.createDiv({
			cls: "vault-llm-excluded-list",
		});
		if (this.plugin.settings.excludeFolder.length > 0) {
			this.plugin.settings.excludeFolder.forEach((folder, index) => {
				const folderItem = excludedFoldersDisplay.createDiv({
					cls: "vault-llm-folder-item",
				});
				folderItem.createSpan({
					text: folder,
					cls: "vault-llm-folder-path",
				});

				const removeBtn = folderItem.createEl("button", {
					text: "Remove",
					cls: "vault-llm-folder-remove-button",
				});
				removeBtn.addEventListener("click", async () => {
					this.plugin.settings.excludeFolder.splice(index, 1);
					await this.plugin.saveSettings();
					this.display(); // Refresh view
				});
			});
		} else {
			excludedFoldersDisplay.createEl("p", {
				text: "No folders excluded",
				cls: "vault-llm-empty-list",
			});
		}

		// Input for new exclude folder
		const excludeFolderContainer = excludeFolderSection.createDiv({
			cls: "vault-llm-folder-input-container",
		});
		const excludeFolderInput = new TextComponent(excludeFolderContainer);
		excludeFolderInput.setPlaceholder(
			"folder/to/exclude (comma-separated paths)"
		);

		// Add additional styling to the input element
		excludeFolderInput.inputEl.addClass("vault-llm-folder-textbox");
		excludeFolderInput.inputEl.setAttribute("rows", "2");

		// Add button for exclude folder
		const excludeAddButton = excludeFolderContainer.createEl("button", {
			text: "Add",
			cls: "vault-llm-folder-add-button",
		});
		excludeAddButton.addEventListener("click", async () => {
			const input = excludeFolderInput.getValue();
			if (input) {
				// Split by comma and trim each entry
				const folders = input
					.split(",")
					.map((f: string) => f.trim())
					.filter((f: string) => f);

				// Add each folder that's not already in the list
				folders.forEach((folder) => {
					if (!this.plugin.settings.excludeFolder.includes(folder)) {
						this.plugin.settings.excludeFolder.push(folder);
					}
				});

				await this.plugin.saveSettings();
				excludeFolderInput.setValue("");
				this.display(); // Refresh view
			}
		});
	}
}
