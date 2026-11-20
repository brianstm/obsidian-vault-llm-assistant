# Changelog

All notable changes to the Vault LLM Assistant plugin for Obsidian will be documented in this file.

## 1.1.0 - 2026-11-20

### New features

- New providers: Groq, NVIDIA NIM (hosted or your own), OpenRouter, Mistral AI, DeepSeek, xAI Grok, and any server that works with the OpenAI API (vLLM, LiteLLM, Together, Fireworks and others). Every provider has a base URL you can change.
- Model lists now come straight from your provider, so new models show up on their own. The list refreshes once a day, there's a refresh button, and you can still type any model name.
- The chat remembers the conversation, so you can ask follow-up questions. You can start a new chat or save the whole thing as a note.
- Press Cmd+Enter (Ctrl+Enter on Windows and Linux) to send. Enter now adds a new line.
- Smarter note picking. Instead of sending your whole vault, it finds the notes that best match your question (file names, headings, tags and links count extra) and sends those, up to a size limit you choose.
- Prompt templates for the selected text or the whole note: summarize, improve writing, fix spelling and grammar, keep writing, pull out action items, suggest tags, explain and translate. You can add your own and run them from the command palette, the right-click menu or a hotkey.
- Put an answer into your note at the cursor.
- Custom instructions that get added to every request.
- A reasoning effort setting for Claude and OpenAI's reasoning models.
- Hover previews and clickable links for the notes an answer used.

### Improvements

- API keys now live in Obsidian's secret storage instead of the plugin's data file. Your old keys move over on their own the first time you load the new version.
- The Gemini key goes in a request header now, not in the URL.
- Error messages are clearer and tell you how to fix the problem, and there's a "Try again" button.
- "Only read these folders" takes more than one folder now, and a folder no longer matches other folders that just start with the same name.
- New notes never overwrite a note with the same name.
- The status bar shows the model you're using. Click it to open the chat.
- Opening the chat doesn't wipe your last conversation anymore.

### Bug fixes

- Note titles now work with Claude, LM Studio and Ollama.
- GPT-5 and o-series models no longer fail because of the temperature setting.
- OpenAI "Pro" models now return their answer.
- Claude 4.7 and newer no longer fail because of temperature, and answers aren't empty when the model thinks first.
- If a Gemini thinking model runs out of tokens, you get a clear message instead of a blank answer.
- `<think>` blocks from models like DeepSeek R1 and Qwen3 no longer show up in answers.

### Maintenance

- Split the code into smaller files and fixed every warning from Obsidian's plugin review checks.
- Rewrote the stylesheet with Obsidian's CSS variables. No duplicate selectors or `!important` anymore.
- Updated the build tools (TypeScript 5, ESLint 9, esbuild 0.25) and got rid of the vulnerable dev packages.
- Release files now come with GitHub build attestations, and every pull request runs lint and build.
- Needs Obsidian 1.11.4 or newer.

## 1.0.11 - 2026-03-26

### New Features

- Added new models and removing deprecated models.
- Added a model validation

## 1.0.10 - 2026-03-24

### New Features

- Added support for Anthropic Claude models via direct API integration
- Added visual option to include markdown images (Vault images) in requests to OpenAI, Gemini, and Claude vision-capable models

### Improvements

- Updated predefined model list to include Claude 3 and Claude 3.5 series

## 1.0.9 - 2026-02-21

### New Features

- Added support for local LLM via Ollama

### Bug Fixes

- Fixed an issue where the test connection ignored the local LLM setting and tested OpenAI/Gemini instead
- Resolved a visual bug where the chat interface displayed "Gemini" instead of the active LM Studio or Ollama model name

## 1.0.8 - 2026-01-10

### Improvements

- Refactored model definitions and added new models
- Introduced model validation script
- Refined prompts for dynamic API requests

## 1.0.7 - 2025-12-12

### New Features

- Added support for local LLM (LM Studio)

### User Interface

- Added badges to see which model is being used

### Improvements

- Added GPT-5 and Gemini 3 models

## 1.0.6 - 2025-05-29

### User Interface

- Fixed Text Case UI

## 1.0.5 - 2025-05-16

### Improvements

- Updated UI text to follow Obsidian sentence case guidelines
- Added proper support for ensureSideLeaf API
- Fixed multiple code standards to comply with Obsidian plugin guidelines

### Security

- Further improved encrypted API key handling

## 1.0.4 - 2025-05-16

### Security

- Added encrypted API key storage for both OpenAI and Gemini providers
- Removed plaintext API key storage from settings
- Implemented automatic migration of existing API keys to encrypted format

### User Interface

- Refactored settings UI to accommodate separate API key fields for each provider
- Added required/optional labels to API key fields based on selected provider
- Improved input field styling for consistency

### Bug Fixes

- Updated deprecated `navigator.platform` with modern alternative
- Improved DOM manipulation code for better security

## 1.0.3 - 2025-05-05

### Bug Fixes

- Fixed issue where links displayed as "-" instead of their actual titles
- Added proper styling for link elements to ensure visibility

## 1.0.2 - 2025-04-21

### Bug Fixes

- Various bug fixes and stability improvements

## 1.0.1 - 2025-04-10

### New Features

- Added create mode to generate comprehensive notes
- Added option to exclude vault content from queries

### Changed

- Switched to direct API endpoint calls instead of package dependencies
- Improved response handling and error messaging

## 1.0.0 - 2025-03-29

### Initial Release

- Ask questions about vault content with AI-generated answers
- Results include citations and links back to original notes
- Copy results as text or markdown with one click
- Create new notes from responses with AI-generated titles
- Support for OpenAI GPT and Google Gemini models
- Configure which files and folders to include or exclude from scanning
- Highlight and copy results easily
