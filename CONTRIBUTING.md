# Contributing

Thanks for wanting to help out! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue and include:

- your Obsidian version and whether you're on desktop or mobile,
- the provider and model you're using,
- what you expected and what happened, plus any error from the chat or the developer console (Cmd+Option+I on macOS, Ctrl+Shift+I elsewhere).

Please never paste your API key in an issue.

## Getting set up

You'll need Node.js 22 or newer.

```bash
git clone https://github.com/brianstm/obsidian-vault-llm-assistant.git
cd obsidian-vault-llm-assistant
npm install
npm run dev
```

`npm run dev` rebuilds `main.js` every time you save. To try it out, put the repo folder (or a symlink to it) in a test vault at `.obsidian/plugins/vault-llm-assistant` and turn the plugin on. The [Hot Reload](https://github.com/pjeby/hot-reload) plugin will reload it for you after each build.

## Where things are

| File | What's in it |
| --- | --- |
| `src/main.ts` | The plugin itself: commands, loading settings, making notes |
| `src/providers.ts` | Every provider and the code that talks to it |
| `src/context.ts` | Picks which notes get sent with a question |
| `src/view.ts` | The chat sidebar |
| `src/settings-tab.ts` | The settings screen |
| `src/templates.ts` | Prompt templates that edit the current note |

## Before you open a pull request

```bash
npm run lint
npm run build
```

Both need to pass. CI runs the same thing. Lint uses [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin), which has the same rules as Obsidian's plugin review.

A few more things:

- write UI text in sentence case and keep it short and friendly,
- stick to Obsidian's APIs (`requestUrl`, `createEl`, `Setting`, CSS variables) instead of raw DOM or `fetch`,
- add a line to `CHANGELOG.md` under an "Unreleased" heading.

## Releasing

1. Run `npm version patch` (or `minor`). This updates `manifest.json` and `versions.json`.
2. Push the commit and the tag. The release workflow builds the plugin, attests `main.js`, `manifest.json` and `styles.css`, and makes a draft release on GitHub.
3. Look over the draft and publish it.
