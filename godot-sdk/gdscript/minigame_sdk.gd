extends Node
## MiniGameSDK — 纯 GDScript 版跨平台小游戏能力封装（无需重编引擎）。
##
## 通过 JavaScriptBridge.get_interface("MiniGameSDK") 调用运行时适配层
## （minigame-sdk.js 注入的 window.MiniGameSDK）。仅在 Web 导出（小游戏）下生效，
## 桌面/编辑器下自动降级为无操作，方便本地调试。
##
## 用法：
##   1. 作为 Autoload 注册，名字建议 "MiniGameSDK"
##      （若同时集成了 C++ module，二者会重名——二选一即可）。
##   2. 连接信号获取异步结果：
##        MiniGameSDK.login_completed.connect(_on_login)
##        MiniGameSDK.login()
##      异步结果为已解析的 Dictionary：{ ok: bool, data: Dictionary, err: String }

signal login_completed(result: Dictionary)
signal user_profile_completed(result: Dictionary)
signal rewarded_video_closed(result: Dictionary)
signal interstitial_closed(result: Dictionary)
signal share_completed(result: Dictionary)
signal clipboard_written(result: Dictionary)
signal clipboard_read(result: Dictionary)

var _js: JavaScriptObject = null
# 保活：JavaScriptBridge 回调会被 GC，必须持有引用直到用完。
var _cb_refs: Array = []


func _ready() -> void:
	if OS.has_feature("web"):
		_js = JavaScriptBridge.get_interface("MiniGameSDK")
	if _js == null:
		push_warning("[MiniGameSDK] JS 接口不可用（非小游戏环境或 minigame-sdk.js 未加载）")


func _available() -> bool:
	return _js != null


func _parse(v) -> Dictionary:
	var s := str(v)
	if s.is_empty():
		return {"ok": false, "data": {}, "err": "empty"}
	var out = JSON.parse_string(s)
	if typeof(out) == TYPE_DICTIONARY:
		return out
	return {"ok": false, "data": {}, "err": "parse failed"}


func _make_cb(handler: Callable) -> JavaScriptObject:
	var cb := JavaScriptBridge.create_callback(handler)
	_cb_refs.append(cb)
	return cb


# ── configuration ──────────────────────────────────────────────────
func configure(config: Dictionary) -> void:
	if not _available():
		return
	_js.configure(JSON.stringify(config))


func get_platform() -> String:
	if not _available():
		return "unknown"
	return str(_js.getPlatform())


# ── login + user info ──────────────────────────────────────────────
func login() -> void:
	if not _available():
		login_completed.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.login(_make_cb(_on_login))

func _on_login(args) -> void:
	login_completed.emit(_parse(args[0] if args.size() > 0 else ""))


func get_user_profile(desc: String = "用于完善会员资料") -> void:
	if not _available():
		user_profile_completed.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.getUserProfile(desc, _make_cb(_on_user_profile))

func _on_user_profile(args) -> void:
	user_profile_completed.emit(_parse(args[0] if args.size() > 0 else ""))


# ── ads ────────────────────────────────────────────────────────────
func show_rewarded_video(ad_unit_id: String = "") -> void:
	if not _available():
		rewarded_video_closed.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.showRewardedVideoAd(ad_unit_id, _make_cb(_on_rewarded))

func _on_rewarded(args) -> void:
	rewarded_video_closed.emit(_parse(args[0] if args.size() > 0 else ""))


func show_interstitial(ad_unit_id: String = "") -> void:
	if not _available():
		interstitial_closed.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.showInterstitialAd(ad_unit_id, _make_cb(_on_interstitial))

func _on_interstitial(args) -> void:
	interstitial_closed.emit(_parse(args[0] if args.size() > 0 else ""))


# ── share ──────────────────────────────────────────────────────────
func share(title: String = "", image_url: String = "", query: String = "") -> void:
	if not _available():
		share_completed.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.share(title, image_url, query, _make_cb(_on_share))

func _on_share(args) -> void:
	share_completed.emit(_parse(args[0] if args.size() > 0 else ""))

func show_share_menu() -> void:
	if _available():
		_js.showShareMenu()


# ── system ─────────────────────────────────────────────────────────
func vibrate(type: String = "short") -> void:
	if _available():
		_js.vibrate(type)

func set_clipboard(text: String) -> void:
	if not _available():
		return
	_js.setClipboard(text, _make_cb(_on_clipboard_written))

func _on_clipboard_written(args) -> void:
	clipboard_written.emit(_parse(args[0] if args.size() > 0 else ""))

func get_clipboard() -> void:
	if not _available():
		clipboard_read.emit({"ok": false, "data": {}, "err": "unavailable"})
		return
	_js.getClipboard(_make_cb(_on_clipboard_read))

func _on_clipboard_read(args) -> void:
	clipboard_read.emit(_parse(args[0] if args.size() > 0 else ""))


# ── KV storage (sync) ──────────────────────────────────────────────
func storage_set(key: String, value: String) -> Dictionary:
	if not _available():
		return {"ok": false, "data": {}, "err": "unavailable"}
	return _parse(_js.storageSet(key, value))

func storage_get(key: String) -> Dictionary:
	if not _available():
		return {"ok": false, "data": {}, "err": "unavailable"}
	return _parse(_js.storageGet(key))

func storage_remove(key: String) -> Dictionary:
	if not _available():
		return {"ok": false, "data": {}, "err": "unavailable"}
	return _parse(_js.storageRemove(key))

func get_system_info() -> Dictionary:
	if not _available():
		return {"ok": false, "data": {}, "err": "unavailable"}
	return _parse(_js.getSystemInfo())
