import { Node, JavaScriptBridge, OS } from "godot";

/**
 * MiniGameSDK — GodotJS (quickjs-ng / v8) 版跨平台小游戏能力封装（无需改引擎）。
 *
 * 原理：
 *   GodotJS 脚本运行在引擎内嵌的 JS 运行时（quickjs-ng），与宿主小游戏的 JS 环境
 *   （微信/抖音，即 emscripten 那层）是**两个隔离的 JS 引擎**，无法直接互访。
 *   但 `JavaScriptBridge` 是 Godot 的 C++ 单例，在两种脚本语言下都可用；
 *   `JavaScriptBridge.get_interface("MiniGameSDK")` 会返回宿主环境里的
 *   `window.MiniGameSDK`（由 minigame-sdk.js 注入），从而打通：
 *
 *     GodotJS(quickjs) ──▶ JavaScriptBridge(C++) ──▶ 宿主 window.MiniGameSDK
 *
 *   全程不使用 `eval`（走 godot_js_wrapper_* 导入函数），在禁用 eval 的小游戏可用。
 *
 * 用法（作为 Autoload / 单例节点）：
 *   1. 把本文件加入 GodotJS 项目并注册为 Autoload，名字建议 "MiniGameSDK"。
 *      （若同时用了 C++ module 或 GDScript autoload，三者同名——只启用其一。）
 *   2. 异步接口返回 Promise，结果为已解析对象 { ok, data, err }：
 *        const r = await MiniGameSDK.instance!.login();
 *        if (r.ok) console.log("code =", r.data.code);
 *      同步接口直接返回值。
 *
 * 备注（不同 GodotJS 版本可能需微调，仅两处）：
 *   • 动态方法调用统一用 JavaScriptObject 的 `call("<jsMethod>", ...args)`，
 *     避免依赖代理对未知成员名的转发。
 *   • `create_callback` 直接传入普通 JS 函数（GodotJS 会自动包装为 Callable）。
 */

export interface SDKResult {
	ok: boolean;
	data: any;
	err: string;
}

const UNAVAILABLE: SDKResult = { ok: false, data: {}, err: "unavailable" };

export default class MiniGameSDK extends Node {
	private static _instance: MiniGameSDK | null = null;
	/** 全局访问入口（Autoload 就绪后可用）。 */
	static get instance(): MiniGameSDK | null {
		return MiniGameSDK._instance;
	}

	// JavaScriptObject | null —— 宿主 window.MiniGameSDK 的桥接句柄
	private _sdk: any = null;
	// 保活：create_callback 生成的 Callable 在被调用前不能被 GC
	private _pending: Set<any> = new Set();

	_ready(): void {
		MiniGameSDK._instance = this;
		if (OS.has_feature("web")) {
			this._sdk = JavaScriptBridge.get_interface("MiniGameSDK");
		}
		if (this._sdk == null) {
			console.warn("[MiniGameSDK] JS 接口不可用（非小游戏环境或 minigame-sdk.js 未加载）");
		}
	}

	get available(): boolean {
		return this._sdk != null;
	}

	private _parse(v: any): SDKResult {
		const s = v == null ? "" : String(v);
		if (s.length === 0) {
			return { ok: false, data: {}, err: "empty" };
		}
		try {
			const o = JSON.parse(s);
			return o && typeof o === "object" ? (o as SDKResult) : { ok: false, data: {}, err: "parse" };
		} catch (e) {
			return { ok: false, data: {}, err: "parse failed" };
		}
	}

	// 宿主异步方法：cb(resultJson) → 解析后 resolve
	private _callAsync(method: string, ...args: any[]): Promise<SDKResult> {
		return new Promise<SDKResult>((resolve) => {
			if (this._sdk == null) {
				resolve(UNAVAILABLE);
				return;
			}
			let cb: any;
			const handler = (cbArgs: any) => {
				this._pending.delete(cb);
				// create_callback 回调统一收到一个「参数数组」
				const json = Array.isArray(cbArgs) ? cbArgs[0] : cbArgs;
				resolve(this._parse(json));
			};
			cb = JavaScriptBridge.create_callback(handler);
			this._pending.add(cb);
			this._sdk.call(method, ...args, cb);
		});
	}

	// 宿主同步方法：返回 JSON 字符串 → 解析
	private _callSync(method: string, ...args: any[]): SDKResult {
		if (this._sdk == null) {
			return UNAVAILABLE;
		}
		return this._parse(this._sdk.call(method, ...args));
	}

	// ── configuration ──────────────────────────────────────────────
	configure(config: object): void {
		if (this._sdk != null) {
			this._sdk.call("configure", JSON.stringify(config));
		}
	}

	get_platform(): string {
		return this._sdk != null ? String(this._sdk.call("getPlatform")) : "unknown";
	}

	// ── login + user info ──────────────────────────────────────────
	login(): Promise<SDKResult> {
		return this._callAsync("login");
	}

	get_user_profile(desc = "用于完善会员资料"): Promise<SDKResult> {
		return this._callAsync("getUserProfile", desc);
	}

	// ── ads ────────────────────────────────────────────────────────
	show_rewarded_video(adUnitId = ""): Promise<SDKResult> {
		return this._callAsync("showRewardedVideoAd", adUnitId);
	}

	show_interstitial(adUnitId = ""): Promise<SDKResult> {
		return this._callAsync("showInterstitialAd", adUnitId);
	}

	// ── share ──────────────────────────────────────────────────────
	share(title = "", imageUrl = "", query = ""): Promise<SDKResult> {
		return this._callAsync("share", title, imageUrl, query);
	}

	show_share_menu(): void {
		if (this._sdk != null) {
			this._sdk.call("showShareMenu");
		}
	}

	// ── system ─────────────────────────────────────────────────────
	vibrate(type = "short"): void {
		if (this._sdk != null) {
			this._sdk.call("vibrate", type);
		}
	}

	set_clipboard(text: string): Promise<SDKResult> {
		return this._callAsync("setClipboard", text);
	}

	get_clipboard(): Promise<SDKResult> {
		return this._callAsync("getClipboard");
	}

	// ── KV storage (sync) ──────────────────────────────────────────
	storage_set(key: string, value: string): SDKResult {
		return this._callSync("storageSet", key, value);
	}

	storage_get(key: string): SDKResult {
		return this._callSync("storageGet", key);
	}

	storage_remove(key: string): SDKResult {
		return this._callSync("storageRemove", key);
	}

	get_system_info(): SDKResult {
		return this._callSync("getSystemInfo");
	}
}
