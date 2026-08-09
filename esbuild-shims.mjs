import { pathToFileURL } from "url";
import { EventEmitter } from "events";

// esbuild substitutes bare `import.meta` with `{}` when bundling to CJS
// output, since CJS has no such concept - that breaks the Agent SDK's
// `createRequire(import.meta.url)` calls (createRequire(undefined) throws).
// esbuild.config.mjs redirects `import.meta.url` to this instead. It doesn't
// need to be the *real* original source file location (the SDK only uses it
// to anchor an internal require() for optional native-binary lookups we
// deliberately don't ship - see esbuild.config.mjs) - it just needs to be a
// well-formed, platform-correct absolute file:// URL so createRequire()
// doesn't throw. process.execPath (the running Electron/Node binary) is
// always a real, valid path on every OS, unlike a hardcoded placeholder
// string (e.g. a Unix-style path is invalid on Windows, and vice versa).
export const __vaultforgeModuleUrl = pathToFileURL(process.execPath).href;

// Obsidian's plugin sandbox runs code in a context where the ambient global
// `AbortController` isn't recognized as an `EventEmitter`/`EventTarget` by
// Node's own internals (observed via `events.setMaxListeners(n, signal)`
// throwing "must be an instance of EventEmitter or EventTarget" for a
// signal from `new AbortController()` - almost certainly a cross-realm
// identity mismatch, not a missing feature: the global `AbortController`
// visible to plugin code isn't the same class Node's own internals check
// against). `events.setMaxListeners` itself can't be monkey-patched (its
// property descriptor is non-configurable), and `events.EventTarget`/`Event`
// aren't actually module exports in current Node (verified: undefined) -
// only globals, which would just be the same mismatched class again. But
// `events.EventEmitter` - the *other* class Node's check accepts, per the
// error text - genuinely is a real export, obtained via the exact same
// `require("events")` Node's own internal `setMaxListeners` is a method of.
// So every bare `AbortController` reference in the bundle (see the `define`
// entry in esbuild.config.mjs) is redirected to a minimal AbortController
// look-alike built on EventEmitter instead, implementing the small part of
// the DOM AbortSignal surface anything here actually calls
// (addEventListener/removeEventListener/dispatchEvent/onabort/aborted/reason/
// throwIfAborted).
class VaultForgeAbortSignal extends EventEmitter {
	aborted = false;
	reason;
	onabort = null;
	addEventListener(type, listener) {
		this.on(type, listener);
	}
	removeEventListener(type, listener) {
		this.off(type, listener);
	}
	dispatchEvent(event) {
		this.emit(event.type, event);
		return true;
	}
	throwIfAborted() {
		if (this.aborted) throw this.reason;
	}
	_signalAbort(reason) {
		if (this.aborted) return;
		this.aborted = true;
		this.reason = reason;
		const event = { type: "abort", target: this };
		this.dispatchEvent(event);
		if (typeof this.onabort === "function") this.onabort(event);
	}
}

export class __vaultforgeAbortController {
	signal = new VaultForgeAbortSignal();
	abort(reason) {
		this.signal._signalAbort(reason ?? new Error("This operation was aborted"));
	}
}
