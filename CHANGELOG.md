# Changelog

All notable changes to the Vault LLM Assistant plugin for Obsidian will be documented in this file.

## 1.0.4 - 2024-06-16

### Security

-   Added encrypted API key storage for both OpenAI and Gemini providers
-   Removed plaintext API key storage from settings
-   Implemented automatic migration of existing API keys to encrypted format

### User Interface

-   Refactored settings UI to accommodate separate API key fields for each provider
-   Added required/optional labels to API key fields based on selected provider
-   Improved input field styling for consistency

### Bug Fixes

-   Updated deprecated `navigator.platform` with modern alternative
-   Improved DOM manipulation code for better security

## 1.0.3 - 2024-06-05

### Bug Fixes

-   Fixed issue where links displayed as "-" instead of their actual titles
-   Added proper styling for link elements to ensure visibility

## 1.0.2 - 2024-05-21

### Bug Fixes

-   Various bug fixes and stability improvements

## 1.0.1 - 2024-05-10

### New Features

-   Added create mode to generate comprehensive notes
-   Added option to exclude vault content from queries

### Changed

-   Switched to direct API endpoint calls instead of package dependencies
-   Improved response handling and error messaging

## 1.0.0 - 2024-04-29

### Initial Release

-   Ask questions about vault content with AI-generated answers
-   Results include citations and links back to original notes
-   Copy results as text or markdown with one click
-   Create new notes from responses with AI-generated titles
-   Support for OpenAI GPT and Google Gemini models
-   Configure which files and folders to include or exclude from scanning
-   Highlight and copy results easily
