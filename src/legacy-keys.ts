import { base64ToArrayBuffer, type App } from "obsidian";

// Reads API keys saved by 1.0.x so they can move to secret storage. Delete this once most people have updated.
export function decryptLegacyKey(app: App, encrypted: string): string {
	try {
		const seed = `${navigator.userAgent || "unknown"}-${app.vault.getName() || "obsidian"}`;
		let hash = 0;
		for (let i = 0; i < seed.length; i++) {
			hash = (hash << 5) - hash + seed.charCodeAt(i);
			hash = hash & hash;
		}
		const deviceId = Math.abs(hash).toString(16).padStart(16, "0");

		const bytes = new Uint8Array(base64ToArrayBuffer(encrypted));
		let key = "";
		for (let i = 0; i < bytes.length; i++) {
			key += String.fromCharCode(bytes[i] ^ deviceId.charCodeAt(i % deviceId.length));
		}
		return /^[\x21-\x7e]+$/.test(key) ? key : "";
	} catch (err) {
		console.error("Vault LLM Assistant: could not read a saved API key", err);
		return "";
	}
}
