import { Platform, type Modifier } from "obsidian";
import type { SendShortcut } from "./types";

export function shortcutLabel(shortcut: SendShortcut): string {
	switch (shortcut) {
		case "mod-enter":
			return Platform.isMacOS ? "Cmd+Enter" : "Ctrl+Enter";
		case "ctrl-enter":
			return "Ctrl+Enter";
		case "alt-enter":
			return Platform.isMacOS ? "Option+Enter" : "Alt+Enter";
		case "shift-enter":
			return "Shift+Enter";
		default:
			return "Enter";
	}
}

export function shortcutOptions(): Record<SendShortcut, string> {
	const options: Partial<Record<SendShortcut, string>> = { "mod-enter": shortcutLabel("mod-enter") };
	if (Platform.isMacOS) options["ctrl-enter"] = "Ctrl+Enter";
	options["enter"] = "Enter (Shift+Enter for a new line)";
	options["shift-enter"] = "Shift+Enter";
	options["alt-enter"] = shortcutLabel("alt-enter");
	return options as Record<SendShortcut, string>;
}

export function shortcutModifiers(shortcut: SendShortcut): Modifier[] {
	switch (shortcut) {
		case "mod-enter":
			return ["Mod"];
		case "ctrl-enter":
			return ["Ctrl"];
		case "alt-enter":
			return ["Alt"];
		case "shift-enter":
			return ["Shift"];
		default:
			return [];
	}
}

export function matchesShortcut(evt: KeyboardEvent, shortcut: SendShortcut): boolean {
	if (evt.key !== "Enter" || evt.isComposing) return false;
	const mod = Platform.isMacOS ? evt.metaKey : evt.ctrlKey;
	const exact = (meta: boolean, ctrl: boolean, alt: boolean, shift: boolean) =>
		evt.metaKey === meta && evt.ctrlKey === ctrl && evt.altKey === alt && evt.shiftKey === shift;
	switch (shortcut) {
		case "mod-enter":
			return mod && !evt.altKey && !evt.shiftKey;
		case "ctrl-enter":
			return exact(false, true, false, false);
		case "alt-enter":
			return exact(false, false, true, false);
		case "shift-enter":
			return exact(false, false, false, true);
		default:
			return exact(false, false, false, false);
	}
}
