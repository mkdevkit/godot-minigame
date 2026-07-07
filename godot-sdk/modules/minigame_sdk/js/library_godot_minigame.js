/**
 * library_godot_minigame.js — Emscripten JS library bridging Godot C++ to the
 * cross-platform mini-game SDK (window.MiniGameSDK, provided by minigame-sdk.js).
 *
 * Build integration (custom engine, WEB platform only):
 *   Added via modules/minigame_sdk/SCsub → env.AddJSLibraries([...]).
 *   The C++ side (minigame_sdk.cpp) declares these as `extern "C"` imports.
 *
 * Conventions:
 *   • Async results are delivered to a C function pointer callback that receives
 *     a malloc'd UTF-8 JSON string ({ok,data,err}); C++ copies then free()s it.
 *   • Sync string getters return a malloc'd UTF-8 string; C++ copies then free()s.
 *   • If window.MiniGameSDK is missing (e.g. plain web build), calls degrade to
 *     an error result so the game keeps running.
 */
const GodotMinigame = {
	$GodotMinigame__deps: ["$GodotRuntime"],
	$GodotMinigame: {
		getSDK: function () {
			if (typeof window !== "undefined" && window["MiniGameSDK"]) return window["MiniGameSDK"];
			if (typeof GameGlobal !== "undefined" && GameGlobal["MiniGameSDK"]) return GameGlobal["MiniGameSDK"];
			return null;
		},
		// Invoke a wasm function pointer with a freshly-allocated JSON string.
		emit: function (callback, json) {
			if (!callback) return;
			const cb = GodotRuntime.get_func(callback);
			const p = GodotRuntime.allocString(String(json == null ? "{}" : json));
			try { cb(p); } finally { GodotRuntime.free(p); }
		},
		errJson: function (msg) { return JSON.stringify({ ok: false, data: {}, err: String(msg || "MiniGameSDK unavailable") }); },
	},

	// ── sync ────────────────────────────────────────────────────────────────
	godot_js_mg_get_platform__proxy: "sync",
	godot_js_mg_get_platform__sig: "i",
	godot_js_mg_get_platform: function () {
		const sdk = GodotMinigame.getSDK();
		return GodotRuntime.allocString(sdk ? String(sdk.getPlatform()) : "unknown");
	},

	godot_js_mg_configure__proxy: "sync",
	godot_js_mg_configure__sig: "vi",
	godot_js_mg_configure: function (json) {
		const sdk = GodotMinigame.getSDK();
		if (sdk) sdk.configure(GodotRuntime.parseString(json));
	},

	godot_js_mg_get_system_info__proxy: "sync",
	godot_js_mg_get_system_info__sig: "i",
	godot_js_mg_get_system_info: function () {
		const sdk = GodotMinigame.getSDK();
		return GodotRuntime.allocString(sdk ? String(sdk.getSystemInfo()) : GodotMinigame.errJson());
	},

	godot_js_mg_storage_set__proxy: "sync",
	godot_js_mg_storage_set__sig: "iii",
	godot_js_mg_storage_set: function (key, value) {
		const sdk = GodotMinigame.getSDK();
		const r = sdk ? sdk.storageSet(GodotRuntime.parseString(key), GodotRuntime.parseString(value)) : GodotMinigame.errJson();
		return GodotRuntime.allocString(String(r));
	},

	godot_js_mg_storage_get__proxy: "sync",
	godot_js_mg_storage_get__sig: "ii",
	godot_js_mg_storage_get: function (key) {
		const sdk = GodotMinigame.getSDK();
		const r = sdk ? sdk.storageGet(GodotRuntime.parseString(key)) : GodotMinigame.errJson();
		return GodotRuntime.allocString(String(r));
	},

	godot_js_mg_storage_remove__proxy: "sync",
	godot_js_mg_storage_remove__sig: "ii",
	godot_js_mg_storage_remove: function (key) {
		const sdk = GodotMinigame.getSDK();
		const r = sdk ? sdk.storageRemove(GodotRuntime.parseString(key)) : GodotMinigame.errJson();
		return GodotRuntime.allocString(String(r));
	},

	godot_js_mg_vibrate__proxy: "sync",
	godot_js_mg_vibrate__sig: "vi",
	godot_js_mg_vibrate: function (type) {
		const sdk = GodotMinigame.getSDK();
		if (sdk) sdk.vibrate(GodotRuntime.parseString(type));
	},

	godot_js_mg_show_share_menu__proxy: "sync",
	godot_js_mg_show_share_menu__sig: "v",
	godot_js_mg_show_share_menu: function () {
		const sdk = GodotMinigame.getSDK();
		if (sdk) sdk.showShareMenu();
	},

	// ── async (callback = wasm func ptr taking char*) ─────────────────────────
	godot_js_mg_login__proxy: "sync",
	godot_js_mg_login__sig: "vi",
	godot_js_mg_login: function (callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.login(function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_get_user_profile__proxy: "sync",
	godot_js_mg_get_user_profile__sig: "vii",
	godot_js_mg_get_user_profile: function (desc, callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.getUserProfile(GodotRuntime.parseString(desc), function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_show_rewarded__proxy: "sync",
	godot_js_mg_show_rewarded__sig: "vii",
	godot_js_mg_show_rewarded: function (adUnitId, callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.showRewardedVideoAd(GodotRuntime.parseString(adUnitId), function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_show_interstitial__proxy: "sync",
	godot_js_mg_show_interstitial__sig: "vii",
	godot_js_mg_show_interstitial: function (adUnitId, callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.showInterstitialAd(GodotRuntime.parseString(adUnitId), function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_share__proxy: "sync",
	godot_js_mg_share__sig: "viiii",
	godot_js_mg_share: function (title, imageUrl, query, callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.share(GodotRuntime.parseString(title), GodotRuntime.parseString(imageUrl), GodotRuntime.parseString(query),
			function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_set_clipboard__proxy: "sync",
	godot_js_mg_set_clipboard__sig: "vii",
	godot_js_mg_set_clipboard: function (text, callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.setClipboard(GodotRuntime.parseString(text), function (json) { GodotMinigame.emit(callback, json); });
	},

	godot_js_mg_get_clipboard__proxy: "sync",
	godot_js_mg_get_clipboard__sig: "vi",
	godot_js_mg_get_clipboard: function (callback) {
		const sdk = GodotMinigame.getSDK();
		if (!sdk) { GodotMinigame.emit(callback, GodotMinigame.errJson()); return; }
		sdk.getClipboard(function (json) { GodotMinigame.emit(callback, json); });
	},
};

autoAddDeps(GodotMinigame, "$GodotMinigame");
mergeInto(LibraryManager.library, GodotMinigame);
