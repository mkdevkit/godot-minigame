/**************************************************************************/
/*  minigame_sdk.h                                                        */
/*  Cross-platform (WeChat / Douyin) mini-game capability singleton.      */
/*  Bridges Godot C++/GDScript to window.MiniGameSDK via an emscripten    */
/*  JS library (see js/library_godot_minigame.js). Web-only effect;       */
/*  on other platforms calls are safe no-ops so GDScript still compiles.  */
/**************************************************************************/

#ifndef MINIGAME_SDK_H
#define MINIGAME_SDK_H

#include "core/object/object.h"

class MiniGameSDK : public Object {
	GDCLASS(MiniGameSDK, Object);

	static MiniGameSDK *singleton;

protected:
	static void _bind_methods();

public:
	static MiniGameSDK *get_singleton();

	// ── configuration ────────────────────────────────────────────────
	// config_json e.g. {"rewardedAdUnitId":"...","interstitialAdUnitId":"..."}
	void configure(const String &p_config_json);
	String get_platform() const; // "wechat" | "douyin" | "unknown"

	// ── async: results delivered via signals (JSON string {ok,data,err}) ─
	void login();                                    // → login_completed
	void get_user_profile(const String &p_desc);     // → user_profile_completed
	void show_rewarded_video(const String &p_ad_unit_id); // → rewarded_video_closed
	void show_interstitial(const String &p_ad_unit_id);   // → interstitial_closed
	void share(const String &p_title, const String &p_image_url, const String &p_query); // → share_completed
	void set_clipboard(const String &p_text);        // → clipboard_written
	void get_clipboard();                            // → clipboard_read

	// ── sync ─────────────────────────────────────────────────────────
	void show_share_menu();
	void vibrate(const String &p_type); // "short" | "long"
	String storage_set(const String &p_key, const String &p_value);
	String storage_get(const String &p_key);
	String storage_remove(const String &p_key);
	String get_system_info() const;

	// Internal: invoked (deferred) by static JS trampolines.
	void _deferred_emit(const String &p_signal, const String &p_json);

	MiniGameSDK();
	~MiniGameSDK();
};

#endif // MINIGAME_SDK_H
