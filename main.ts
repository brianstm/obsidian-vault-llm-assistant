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

/**
 * Plugin Settings Interface
 * Defines all configurable options for the plugin
 */
interface VaultLLMAssistantSettings {
	apiKey: string; // API key for the selected LLM provider
	apiEndpoint: string; // API endpoint URL
	modelProvider: string; // 'gpt' or 'gemini'
	model: string; // Selected model name
	maxTokens: number; // Maximum token length for responses
	temperature: number; // Controls randomness in generation (0-2)
	includeCurrentFileOnly: boolean; // When true, only scans current file
	includeFolder: string; // Optional folder path to limit scanning to
	excludeFolder: string[]; // Folders to exclude from scanning
	newNoteFolder: string; // Default folder path for creating new notes from responses
	generateTitlesWithLLM: boolean; // Whether to use LLM to generate note titles
	useVaultContent: boolean; // Whether to include vault content in prompts
	mode: "query" | "create"; // Current mode: query or create notes
}

/**
 * Default settings configuration
 */
const DEFAULT_SETTINGS: VaultLLMAssistantSettings = {
	apiKey: "",
	apiEndpoint: "https://api.openai.com/v1/chat/completions",
	modelProvider: "gpt",
	model: "gpt-4o-mini", // Default to a modern model
	maxTokens: 2000,
	temperature: 0.7,
	includeCurrentFileOnly: false,
	includeFolder: "",
	excludeFolder: [],
	newNoteFolder: "", // Default to root of vault
	generateTitlesWithLLM: true, // Default to using LLM for titles
	useVaultContent: true, // Default to using vault content
	mode: "query", // Default to query mode
};

export default class VaultLLMAssistant extends Plugin {
	settings: VaultLLMAssistantSettings;
	statusBarItem: HTMLElement;

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
		this.app.workspace.detachLeavesOfType("vault-llm-assistant-view");
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

		await this.app.workspace.getRightLeaf(false)?.setViewState({
			type: "vault-llm-assistant-view",
			active: true,
		});

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
		// If vault content is disabled, return empty string
		if (!this.settings.useVaultContent) {
			return additionalContext ? additionalContext : "";
		}

		const vault = this.app.vault;
		const files: TFile[] = [];

		// Determine which files to scan based on settings
		if (this.settings.includeCurrentFileOnly && currentFile) {
			files.push(currentFile);
		} else {
			// Get all markdown files
			const allFiles = vault.getMarkdownFiles();

			// Filter based on include folder
			let filesToScan = allFiles;
			if (this.settings.includeFolder) {
				filesToScan = allFiles.filter((file) =>
					file.path.startsWith(this.settings.includeFolder)
				);
			}

			// Filter based on exclude folders
			if (this.settings.excludeFolder.length > 0) {
				filesToScan = filesToScan.filter((file) => {
					return !this.settings.excludeFolder.some((folder) =>
						file.path.startsWith(folder)
					);
				});
			}

			files.push(...filesToScan);
		}

		// Read the contents of each file
		let allContents = "";
		for (const file of files) {
			try {
				const content = await vault.read(file);
				allContents += `FILE: ${file.path}\n\n${content}\n\n`;
			} catch (error) {
				console.error(`Error reading file ${file.path}:`, error);
			}
		}

		// Add additional context if provided
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

			// Build different prompts based on mode and whether to use vault content
			if (this.settings.mode === "query") {
				if (this.settings.useVaultContent) {
					// Query mode with vault context
					prompt = `You are a helpful assistant for the user's Obsidian vault. 
You have access to the user's notes which are provided below. 
Please answer the user's question based on the information in these notes.
When referencing content from notes, cite the source file using the format [[file_path]].
Format your responses in Markdown. Format code blocks with the appropriate language annotation for syntax highlighting.
If you quote or reference content from the vault, make sure to include proper citations, you may include the specific part of the file that you are referencing using the format [[file_path#title_of_the_section_you_are_referencing]] (Do not change the title of the section you are referencing, use the same title as it is in the file with the same capitalization).
For any code examples, use proper markdown code blocks with language specification.

User's Notes:
${vaultContent}

${currentFilePath ? `Current file: ${currentFilePath}` : ""}

User's Question: ${query}`;
				} else {
					prompt = `You are a helpful assistant. Please answer the following question in a clear and concise manner.
Format your responses in Markdown. Format code blocks with the appropriate language annotation for syntax highlighting.

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

			if (this.settings.modelProvider === "gpt") {
				response = await this.queryGPT(prompt);
			} else if (this.settings.modelProvider === "gemini") {
				response = await this.queryGemini(prompt);
			} else {
				throw new Error("Unknown model provider");
			}

			// Strip markdown fences if they exist in create mode
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
			const response = await requestUrl({
				url: "https://api.openai.com/v1/chat/completions",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.settings.apiKey}`,
				},
				body: JSON.stringify({
					model: this.settings.model,
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
			console.error("Error querying OpenAI:", error);

			// Format error message in a more user-friendly way with specific handling for common HTTP status codes
			let errorMessage = "Error querying OpenAI: ";

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
						errorMessage += `Status ${error.status}: ${
							error.message || "Unknown error"
						}`;
				}
			} else if (error.message) {
				// For network errors or other exceptions
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
				url: `https://generativelanguage.googleapis.com/v1beta/models/${this.settings.model}:generateContent?key=${this.settings.apiKey}`,
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

			// Check for errors in the response
			if (jsonResponse.error) {
				return `Gemini API Error: ${
					jsonResponse.error.message || "Unknown error"
				}`;
			}

			return "No response generated.";
		} catch (error) {
			console.error("Error querying Gemini:", error);

			// Format error message in a more user-friendly way
			let errorMessage = "Error querying Gemini: ";

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
						errorMessage += `Status ${error.status}: ${
							error.message || "Unknown error"
						}`;
				}
			} else if (error.message) {
				// For network errors or other exceptions
				errorMessage += error.message;
			} else {
				errorMessage += "Unknown error occurred";
			}

			return errorMessage;
		}
	}

	formatGPTResponse(response: RequestUrlResponse): string {
		// This is no longer needed but kept for compatibility
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
		// This is no longer needed but kept for compatibility
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
			// Clean title for filename
			const cleanTitle = title
				.replace(/[\\/:*?"<>|]/g, "") // Remove invalid file characters
				.trim();

			const fileName =
				cleanTitle ||
				`LLM Response ${new Date().toISOString().slice(0, 10)}`;

			// Setup folder path
			let folderPath = this.settings.newNoteFolder.trim();
			if (folderPath && !folderPath.endsWith("/")) {
				folderPath += "/";
			}

			const fullPath = `${folderPath}${fileName}.md`;

			// Create folder if needed
			if (folderPath) {
				const folderExists = await this.app.vault.adapter.exists(
					folderPath
				);
				if (!folderExists) {
					await this.app.vault.createFolder(folderPath);
				}
			}

			// Create and open file
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

			if (this.settings.modelProvider === "gpt") {
				titleResponse = await this.queryGPT(prompt);
			} else if (this.settings.modelProvider === "gemini") {
				titleResponse = await this.queryGemini(prompt);
			} else {
				throw new Error("Unknown model provider");
			}

			// Clean up title
			const cleanTitle = titleResponse
				.replace(/^["']|["']$|[.:]$/g, "") // Remove quotes and trailing punctuation
				.trim();

			return (
				cleanTitle ||
				`LLM Response ${new Date().toISOString().slice(0, 10)}`
			);
		} catch (error) {
			console.error("Error generating title:", error);
			return `LLM Response ${new Date().toISOString().slice(0, 10)}`;
		}
	}

	/**
	 * Helper function to clean up markdown responses from LLMs
	 * Removes markdown fences and explanatory text that sometimes appears in responses
	 */
	cleanMarkdownResponse(text: string): string {
		// Remove ```md or ```markdown at the beginning
		text = text.replace(/^```m(?:d|arkdown)\s*\n/i, "");

		// Remove ``` at the end
		text = text.replace(/\n```\s*$/i, "");

		// Remove any explanatory text before the actual markdown content
		const mdFenceMatch = text.match(/```m(?:d|arkdown)/i);
		if (mdFenceMatch && mdFenceMatch.index) {
			text = text.substring(mdFenceMatch.index);
			// Then remove the fence itself
			text = text.replace(/```m(?:d|arkdown)\s*\n/i, "");
		}

		return text;
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

		// Create query input
		this.inputEl = contentEl.createEl("textarea", {
			attr: {
				placeholder:
					this.plugin.settings.mode === "query"
						? "What would you like to ask about your vault?"
						: "What topic would you like to create a note about?",
				rows: "4",
			},
		});
		this.inputEl.style.width = "100%";
		this.inputEl.focus();

		// Create button container
		const buttonContainer = contentEl.createDiv();
		buttonContainer.addClass("vault-llm-button-container");
		buttonContainer.style.marginTop = "10px";

		// Create cancel button
		const cancelButton = buttonContainer.createEl("button", {
			text: "Cancel",
		});
		cancelButton.addEventListener("click", () => {
			this.close();
		});

		// Create submit button
		const submitButton = buttonContainer.createEl("button", {
			text: this.plugin.settings.mode === "query" ? "Ask" : "Create",
		});
		submitButton.style.marginLeft = "10px";
		submitButton.classList.add("mod-cta");
		submitButton.addEventListener("click", () => {
			this.query = this.inputEl.value;
			this.close();
			this.processQuery();
		});

		// Handle Enter key (with Shift+Enter for new lines)
		this.inputEl.addEventListener("keydown", (event) => {
			if (
				event.key === "Enter" &&
				!event.shiftKey &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				this.query = this.inputEl.value;
				this.close();
				this.processQuery();
			}
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

		// For query mode, show the assistant view
		// For create mode, generate content and create a note directly
		if (this.plugin.settings.mode === "query") {
			// Show the assistant view
			await this.plugin.activateView();

			// Get access to the view
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
			// Create note mode - generate content and create a note directly without the UI
			try {
				// Skip vault scanning if useVaultContent is false
				const vaultContent = this.plugin.settings.useVaultContent
					? await this.plugin.scanVault("", this.currentFile || null)
					: "";

				// Show an info message if vault content is not being used
				if (!this.plugin.settings.useVaultContent) {
					new Notice("Creating note without using vault content");
				}

				// Generate content
				const content = await this.plugin.queryLLM(
					this.query,
					vaultContent,
					this.currentFile ? this.currentFile.path : null
				);

				// Check if the content is an error message
				if (
					content.startsWith("Error querying ") ||
					content.startsWith("Gemini API Error:")
				) {
					// Format error message nicely
					let errorMessage = "Failed to create note: ";

					// Extract the main error details
					if (content.includes(":")) {
						const [_, errorDetails] = content.split(":", 2);
						errorMessage += errorDetails.trim();
					} else {
						errorMessage += content;
					}

					// Show as a notice and return early
					new Notice(errorMessage, 10000); // Show for 10 seconds
					return;
				}

				// Generate title
				let title = this.query;
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
						// Continue with the query as the title
					}
				}

				// Create note
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

				// Create a more user-friendly error message
				let errorMessage = "Error creating note: ";

				if (error.message) {
					// Check for common error patterns
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

				new Notice(errorMessage, 7000); // Show for 7 seconds
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

		// Create the initial interface
		const introText = containerEl.createEl("p", {
			text: "Ask a question about your vault.",
			cls: "vault-llm-intro-text",
		});

		// Create query input and button
		const inputContainer = containerEl.createDiv({
			cls: "vault-llm-input-container",
		});

		const queryInput = inputContainer.createEl("textarea", {
			attr: {
				placeholder: "What would you like to ask?",
				rows: "3",
			},
		});

		// Options container (with scope toggles)
		const optionsContainer = inputContainer.createDiv({
			cls: "vault-llm-options-container",
		});

		// Mode toggle
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

			// Update UI based on mode
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

		// Current file only toggle
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

		// Use vault content toggle
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

		// Function to process the query
		const processQuery = () => {
			const query = queryInput.value.trim();
			if (query) {
				this.setQuery(query, this.app.workspace.getActiveFile());
				queryInput.value = "";
			} else {
				new Notice("Please enter a question");
			}
		};

		// Add click handler
		askButton.addEventListener("click", processQuery);

		// Add keyboard shortcut (Cmd/Ctrl+Enter)
		queryInput.addEventListener("keydown", (event) => {
			// Check for Cmd+Enter on Mac or Ctrl+Enter on Windows/others
			if (
				(event.metaKey && event.key === "Enter") ||
				(event.ctrlKey && event.key === "Enter")
			) {
				event.preventDefault();
				processQuery();
			}
		});

		// Create container for response
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

		// Update the response container
		const responseContainer = this.containerEl.querySelector(
			".vault-llm-response-container"
		);
		if (!responseContainer) return;
		responseContainer.empty();

		// Show that we're processing
		const loadingEl = responseContainer.createDiv({
			cls: "vault-llm-loading",
		});
		loadingEl.setText(
			this.plugin.settings.mode === "query"
				? "Scanning vault and generating response..."
				: "Generating note content..."
		);

		try {
			// Scan the vault only if useVaultContent is true
			const vaultContent = this.plugin.settings.useVaultContent
				? await this.plugin.scanVault("", currentFile || null)
				: "";

			// Create query display
			const queryEl = responseContainer.createEl("div", {
				cls: "vault-llm-query",
			});

			if (this.plugin.settings.mode === "query") {
				queryEl.innerHTML = "<strong>Your question:</strong> " + query;
			} else {
				queryEl.innerHTML = "<strong>Note topic:</strong> " + query;
			}

			// If using vault content, show the sources
			if (
				this.plugin.settings.useVaultContent &&
				vaultContent.trim() !== ""
			) {
				// Create container for workspace sources
				const sourceFiles = this.extractSourceFiles(vaultContent);
				const workspaceSourcesContainer = responseContainer.createDiv({
					cls: "vault-llm-workspace-sources",
				});

				// Create collapsible header
				const sourcesHeader = workspaceSourcesContainer.createDiv({
					cls: "vault-llm-sources-header",
				});
				sourcesHeader.innerHTML = `<div class="vault-llm-sources-title">
						<span class="vault-llm-sources-icon">▼</span> 
						Workspace sources (${sourceFiles.length} files)
					</div>`;

				// Create collapsible content
				const sourcesContent = workspaceSourcesContainer.createDiv({
					cls: "vault-llm-sources-content",
				});

				// Add files as simple text blocks instead of a list
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

				// Add toggle behavior
				sourcesHeader.addEventListener("click", () => {
					sourcesContent.toggleClass(
						"vault-llm-sources-collapsed",
						!sourcesContent.hasClass("vault-llm-sources-collapsed")
					);
					const icon = sourcesHeader.querySelector(
						".vault-llm-sources-icon"
					);
					if (icon) {
						icon.textContent = sourcesContent.hasClass(
							"vault-llm-sources-collapsed"
						)
							? "▶"
							: "▼";
					}
				});

				// Start collapsed by default
				sourcesContent.addClass("vault-llm-sources-collapsed");
				const icon = sourcesHeader.querySelector(
					".vault-llm-sources-icon"
				);
				if (icon) {
					icon.textContent = "▶";
				}
			} else if (!this.plugin.settings.useVaultContent) {
				// Add a message that vault content is not being used
				responseContainer.createEl("div", {
					cls: "vault-llm-info-message",
					text: "Note: Vault content is not being used for this query.",
				});
			}

			// Fetch the response
			let response = await this.plugin.queryLLM(
				query,
				vaultContent,
				currentFile ? currentFile.path : null
			);

			// Replace loading with the response
			loadingEl.remove();

			// Enhanced error handling that displays user-friendly error messages with troubleshooting tips
			// If the response starts with an error message, we display it in a nicely formatted container
			if (
				response.startsWith("Error querying ") ||
				response.startsWith("Gemini API Error:")
			) {
				// Create a nicely formatted error message
				const errorContainer = responseContainer.createEl("div", {
					cls: "vault-llm-error-message",
				});

				// Split the error message for better formatting
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

					// Add troubleshooting tips based on error
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

				// Add a retry button
				const retryButton = responseContainer.createEl("button", {
					text: "Try Again",
					cls: "vault-llm-action-button",
				});

				retryButton.addEventListener("click", () => {
					this.setQuery(query, currentFile);
				});

				return;
			}

			// Create container for the response with some styling
			const answerContainer = responseContainer.createEl("div", {
				cls: "vault-llm-answer",
			});

			// Set the inner HTML to properly render markdown
			MarkdownRenderer.renderMarkdown(
				response,
				answerContainer,
				currentFile ? currentFile.path : "/",
				new Component()
			);

			// Make content selectable
			answerContainer.addClass("vault-llm-selectable");

			// Add action buttons container
			const actionButtonsContainer = responseContainer.createEl("div", {
				cls: "vault-llm-action-buttons",
			});

			// Copy Text button
			const copyTextButton = actionButtonsContainer.createEl("button", {
				text: "Copy Text",
				cls: "vault-llm-action-button",
			});

			copyTextButton.addEventListener("click", () => {
				// Use DOM manipulation to extract plain text
				const tempDiv = document.createElement("div");
				tempDiv.innerHTML = answerContainer.innerHTML;

				// Remove all script tags for safety
				const scripts = tempDiv.getElementsByTagName("script");
				while (scripts[0]) {
					scripts[0].parentNode?.removeChild(scripts[0]);
				}

				const plainText = tempDiv.innerText;
				navigator.clipboard.writeText(plainText);
				new Notice("Text copied to clipboard");
			});

			// Copy Markdown button
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

			// Create Note button
			const createNoteButton = actionButtonsContainer.createEl("button", {
				text: "Create Note",
				cls: "vault-llm-action-button",
			});

			createNoteButton.addEventListener("click", async () => {
				// Default title
				let noteTitle = `LLM Response ${new Date()
					.toISOString()
					.slice(0, 10)}`;

				// Only show notice and change button state if we're going to generate a title
				if (this.plugin.settings.generateTitlesWithLLM) {
					// Show a loading notice
					new Notice("Generating title for note...");

					// Change button state to show it's working
					createNoteButton.disabled = true;
					createNoteButton.setText("Generating title...");
				}

				try {
					// Get a suitable title based on the setting
					if (this.plugin.settings.generateTitlesWithLLM) {
						noteTitle = await this.plugin.generateTitleForResponse(
							query,
							response
						);
					} else {
						// Use a simple title derived from the query
						noteTitle =
							query.length > 50
								? query.substring(0, 50).trim() + "..."
								: query.trim();
					}

					// Format the content based on the mode
					let formattedContent = "";

					if (this.plugin.settings.mode === "query") {
						formattedContent =
							`# ${noteTitle}\n\n` +
							`> [!info] Query\n> ${query}\n\n` +
							response;
					} else {
						// For create mode, just use the content with a title
						formattedContent = `# ${noteTitle}\n\n${response}`;
					}

					// Create the note
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
					// Reset button state if we changed it
					if (this.plugin.settings.generateTitlesWithLLM) {
						createNoteButton.disabled = false;
						createNoteButton.setText("Create Note");
					}
				}
			});

			// Make sure the user can see the action buttons by scrolling to the bottom
			setTimeout(() => {
				responseContainer.scrollTo({
					top: responseContainer.scrollHeight,
					behavior: "smooth",
				});
				// Then scroll back up slightly to show both the answer and buttons
				setTimeout(() => {
					responseContainer.scrollTo({
						top: responseContainer.scrollHeight - 150,
						behavior: "smooth",
					});
				}, 100);
			}, 200);

			// Process any internal links to make them clickable
			this.processLinks(answerContainer);

			// Scroll to the beginning of the response
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
		// First clean up any malformed link patterns in the text content
		const paragraphs = element.querySelectorAll("p");
		paragraphs.forEach((paragraph) => {
			const content = paragraph.innerHTML;

			// Fix common malformed link patterns
			let updatedContent = content;

			// Fix [[path]] format
			updatedContent = updatedContent.replace(
				/\[\[([^\]]+)\]\]/g,
				(match, path) => {
					return `<a class="internal-link vault-llm-link" href="${path.trim()}">${path.trim()}</a>`;
				}
			);

			// Fix links separated by commas
			updatedContent = updatedContent.replace(
				/\[([^\]]+)\](?:,\s*|\s*,\s*)/g,
				(match, path) => {
					return `<a class="internal-link vault-llm-link" href="${path.trim()}">${path.trim()}</a> `;
				}
			);

			// Update paragraph content if changes were made
			if (updatedContent !== content) {
				paragraph.innerHTML = updatedContent;
			}
		});

		// Now process all links to make them clickable
		element
			.querySelectorAll("a.internal-link, .cm-underline")
			.forEach((link: HTMLElement) => {
				const href =
					link.getAttribute("href") || link.textContent?.trim();
				if (href) {
					// Clean up the link text and properly handle fragment identifiers
					const cleanHref = href.replace(/[\[\],]/g, "").trim();
					let filePath = cleanHref;
					let fragment = "";

					// Handle Markdown-style header references
					if (cleanHref.includes(" > ")) {
						// Format: "file.md > Header" - convert to proper Obsidian format
						const parts = cleanHref.split(" > ", 2);
						filePath = parts[0].trim();
						if (parts.length > 1) {
							// Create a proper fragment ID from the header
							fragment =
								"#" +
								parts[1]
									.trim()
									.toLowerCase()
									.replace(/\s+/g, "-");
						}
					} else if (cleanHref.includes("#")) {
						// Already has a fragment
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

					// Ensure the link is properly styled and has the correct href
					link.classList.add("vault-llm-link");
					link.setAttribute("href", fullPath);
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
	apiKeyVisible: boolean = false;

	constructor(app: App, plugin: VaultLLMAssistant) {
		super(app, plugin);
		this.plugin = plugin;
		this.apiKeyVisible = false;
	}

	/**
	 * Creates the settings UI
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("vault-llm-settings");

		containerEl.createEl("h2", { text: "Vault LLM Assistant Settings" });

		// LLM provider selection - wider dropdown
		new Setting(containerEl)
			.setName("LLM Provider")
			.setDesc("Select which LLM provider to use")
			.addDropdown((dropdown) => {
				const dropdownEl = dropdown
					.addOption("gpt", "OpenAI GPT")
					.addOption("gemini", "Google Gemini")
					.setValue(this.plugin.settings.modelProvider)
					.onChange(async (value) => {
						this.plugin.settings.modelProvider = value;

						// Update the API endpoint based on the provider
						if (value === "gpt") {
							this.plugin.settings.apiEndpoint =
								"https://api.openai.com/v1/chat/completions";
							// Set a default model for GPT
							if (!this.plugin.settings.model.startsWith("gpt")) {
								this.plugin.settings.model = "gpt-4o-mini";
							}
						} else if (value === "gemini") {
							this.plugin.settings.apiEndpoint =
								"https://generativelanguage.googleapis.com/v1beta/models";
							// Set a default model for Gemini
							if (
								!this.plugin.settings.model.startsWith("gemini")
							) {
								this.plugin.settings.model = "gemini-2.0-flash";
							}
						}

						await this.plugin.saveSettings();
						this.display(); // Redraw the settings to update model options
					});
				// Make dropdown wider
				dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
				return dropdown;
			});

		// API Key with toggle visibility
		const apiKeySetting = new Setting(containerEl)
			.setName("API Key")
			.setDesc("Enter your API key for the selected LLM provider");

		// Create container for API key input and toggle button
		const apiKeyContainer = createDiv({
			cls: "vault-llm-apikey-container",
		});
		apiKeySetting.controlEl.appendChild(apiKeyContainer);

		// Add text input
		const apiKeyInput = new TextComponent(apiKeyContainer);
		apiKeyInput
			.setPlaceholder("Enter your API key")
			.setValue(
				this.apiKeyVisible
					? this.plugin.settings.apiKey
					: "••••••••••••••••••••••••••"
			)
			.onChange(async (value: string) => {
				this.plugin.settings.apiKey = value;
				await this.plugin.saveSettings();
			});
		apiKeyInput.inputEl.type = this.apiKeyVisible ? "text" : "password";
		apiKeyInput.inputEl.addClass("vault-llm-apikey-input");

		// Add visibility toggle button
		const toggleButton = apiKeyContainer.createEl("button", {
			cls: "vault-llm-visibility-toggle",
			text: this.apiKeyVisible ? "Hide" : "Show",
		});
		toggleButton.addEventListener("click", () => {
			this.apiKeyVisible = !this.apiKeyVisible;
			apiKeyInput.inputEl.type = this.apiKeyVisible ? "text" : "password";
			apiKeyInput.setValue(
				this.apiKeyVisible
					? this.plugin.settings.apiKey
					: "••••••••••••••••••••••••••"
			);
			toggleButton.textContent = this.apiKeyVisible ? "Hide" : "Show";
		});

		// Model selection
		if (this.plugin.settings.modelProvider === "gpt") {
			new Setting(containerEl)
				.setName("GPT Model")
				.setDesc("Select which GPT model to use")
				.addDropdown((dropdown) => {
					const dropdownEl = dropdown
						.addOption("gpt-3.5-turbo", "GPT-3.5 Turbo")
						.addOption("gpt-4", "GPT-4")
						.addOption("gpt-4-turbo", "GPT-4 Turbo")
						.addOption("gpt-4o-mini", "GPT-4o Mini")
						.addOption("gpt-4.1", "GPT-4.1")
						.addOption("gpt-4.1-mini", "GPT-4.1 Mini")
						.addOption("gpt-4.1-nano", "GPT-4.1 Nano")
						.setValue(this.plugin.settings.model)
						.onChange(async (value) => {
							this.plugin.settings.model = value;
							await this.plugin.saveSettings();
						});
					// Make dropdown wider
					dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
					return dropdown;
				});
		} else if (this.plugin.settings.modelProvider === "gemini") {
			new Setting(containerEl)
				.setName("Gemini Model")
				.setDesc("Select which Gemini model to use")
				.addDropdown((dropdown) => {
					const dropdownEl = dropdown
						.addOption("gemini-pro", "Gemini Pro")
						.addOption("gemini-1.5-pro", "Gemini 1.5 Pro")
						.addOption("gemini-2.0-flash", "Gemini 2.0 Flash")
						.addOption(
							"gemini-2.5-pro-preview-03-25",
							"Gemini 2.5 Pro Preview 03-25"
						)
						.setValue(this.plugin.settings.model)
						.onChange(async (value) => {
							this.plugin.settings.model = value;
							await this.plugin.saveSettings();
						});
					// Make dropdown wider
					dropdownEl.selectEl.addClass("vault-llm-wide-dropdown");
					return dropdown;
				});
		}

		// Max Tokens with improved display
		const maxTokensSetting = new Setting(containerEl)
			.setName("Max Tokens")
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
			.setName("Include Current File Only")
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
			.setName("Default Folder for New Notes")
			.setDesc(
				"Path where new notes will be created when using 'Create Note from Answer' (leave empty for vault root)"
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
			.setName("Generate Note Titles with LLM")
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
			.setName("Use Vault Content in Prompts")
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
					.addOption("create", "Create Notes")
					.setValue(this.plugin.settings.mode)
					.onChange(async (value) => {
						this.plugin.settings.mode = value as "query" | "create";
						await this.plugin.saveSettings();
					});
				// Make dropdown wider
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
			text: "Include Folders",
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
			text: "Exclude Folders",
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
