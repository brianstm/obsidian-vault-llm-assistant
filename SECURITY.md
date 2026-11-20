# Security policy

## Supported versions

Only the latest release gets security fixes, so keep the plugin updated from Obsidian's Community plugins settings.

## Reporting a problem

Please report security issues privately on GitHub. Go to the repo's **Security** tab and pick **Report a vulnerability**. Don't open a public issue for it.

Let me know the plugin version, your Obsidian version and platform, and how to reproduce it. I'll try to reply within a week. If it's a real issue, I'll ship a fix as soon as I can and credit you in the changelog, unless you'd rather not be named.

## How your data is handled

- **API keys** are kept in Obsidian's secret storage, not in the plugin's `data.json`.
- **Your notes** only go to the provider you picked, and only when you ask a question, write a note or run a template. The "Vault context" settings decide which notes get sent. You can skip folders or turn notes off completely.
- The plugin doesn't track you and doesn't talk to any other servers.
