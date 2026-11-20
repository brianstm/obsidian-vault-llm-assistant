import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores([
		"node_modules",
		"main.js",
		"esbuild.config.mjs",
		"version-bump.mjs",
	]),
	...obsidianmd.configs.recommended,
	{
		files: ["src/legacy-keys.ts"],
		rules: {
			// Old keys were encrypted with the user agent, so this file has to read it.
			"obsidianmd/platform": "off",
		},
	},
	{
		rules: {
			// The declarative settings API needs Obsidian 1.13, and we support 1.11.4.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
]);
