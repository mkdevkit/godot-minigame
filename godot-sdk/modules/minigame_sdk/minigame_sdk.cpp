/**************************************************************************/
/*  minigame_sdk.cpp                                                      */
/**************************************************************************/

#include "minigame_sdk.h"

#include "core/object/class_db.h"

#ifdef WEB_ENABLED
#include <stdlib.h> // free()

// Imports implemented by js/library_godot_minigame.js.
extern "C" {
extern char *godot_js_mg_get_platform();
extern void godot_js_mg_configure(const char *p_json);
extern char *godot_js_mg_get_system_info();
extern char *godot_js_mg_storage_set(const char *p_key, const char *p_value);
extern char *godot_js_mg_storage_get(const char *p_key);
extern char *godot_js_mg_storage_remove(const char *p_key);
extern void godot_js_mg_vibrate(const char *p_type);
extern void godot_js_mg_show_share_menu();
extern void godot_js_mg_login(void (*p_cb)(const char *));
extern void godot_js_mg_get_user_profile(const char *p_desc, void (*p_cb)(const char *));
extern void godot_js_mg_show_rewarded(const char *p_ad_unit_id, void (*p_cb)(const char *));
extern void godot_js_mg_show_interstitial(const char *p_ad_unit_id, void (*p_cb)(const char *));
extern void godot_js_mg_share(const char *p_title, const char *p_image_url, const char *p_query, void (*p_cb)(const char *));
extern void godot_js_mg_set_clipboard(const char *p_text, void (*p_cb)(const char *));
extern void godot_js_mg_get_clipboard(void (*p_cb)(const char *));
}

// A malloc'd char* string returned by the JS library → Godot String, then free().
static String _take_string(char *p_ptr) {
	if (p_ptr == nullptr) {
		return String();
	}
	String s = String::utf8(p_ptr);
	free(p_ptr);
	return s;
}

// Static trampolines: JS callbacks fire asynchronously on the browser event
// loop; defer signal emission onto Godot's main thread for safety.
static void _emit_deferred(const char *p_json, const char *p_signal) {
	MiniGameSDK *s = MiniGameSDK::get_singleton();
	if (s) {
		s->call_deferred(SNAME("_deferred_emit"), String(p_signal), String::utf8(p_json ? p_json : "{}"));
	}
}
static void _cb_login(const char *j) { _emit_deferred(j, "login_completed"); }
static void _cb_user_profile(const char *j) { _emit_deferred(j, "user_profile_completed"); }
static void _cb_rewarded(const char *j) { _emit_deferred(j, "rewarded_video_closed"); }
static void _cb_interstitial(const char *j) { _emit_deferred(j, "interstitial_closed"); }
static void _cb_share(const char *j) { _emit_deferred(j, "share_completed"); }
static void _cb_clipboard_write(const char *j) { _emit_deferred(j, "clipboard_written"); }
static void _cb_clipboard_read(const char *j) { _emit_deferred(j, "clipboard_read"); }
#endif // WEB_ENABLED

MiniGameSDK *MiniGameSDK::singleton = nullptr;

MiniGameSDK *MiniGameSDK::get_singleton() {
	return singleton;
}

void MiniGameSDK::configure(const String &p_config_json) {
#ifdef WEB_ENABLED
	godot_js_mg_configure(p_config_json.utf8().get_data());
#endif
}

String MiniGameSDK::get_platform() const {
#ifdef WEB_ENABLED
	return _take_string(godot_js_mg_get_platform());
#else
	return String("unknown");
#endif
}

void MiniGameSDK::login() {
#ifdef WEB_ENABLED
	godot_js_mg_login(&_cb_login);
#else
	call_deferred(SNAME("_deferred_emit"), String("login_completed"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::get_user_profile(const String &p_desc) {
#ifdef WEB_ENABLED
	godot_js_mg_get_user_profile(p_desc.utf8().get_data(), &_cb_user_profile);
#else
	call_deferred(SNAME("_deferred_emit"), String("user_profile_completed"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::show_rewarded_video(const String &p_ad_unit_id) {
#ifdef WEB_ENABLED
	godot_js_mg_show_rewarded(p_ad_unit_id.utf8().get_data(), &_cb_rewarded);
#else
	call_deferred(SNAME("_deferred_emit"), String("rewarded_video_closed"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::show_interstitial(const String &p_ad_unit_id) {
#ifdef WEB_ENABLED
	godot_js_mg_show_interstitial(p_ad_unit_id.utf8().get_data(), &_cb_interstitial);
#else
	call_deferred(SNAME("_deferred_emit"), String("interstitial_closed"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::share(const String &p_title, const String &p_image_url, const String &p_query) {
#ifdef WEB_ENABLED
	godot_js_mg_share(p_title.utf8().get_data(), p_image_url.utf8().get_data(), p_query.utf8().get_data(), &_cb_share);
#else
	call_deferred(SNAME("_deferred_emit"), String("share_completed"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::set_clipboard(const String &p_text) {
#ifdef WEB_ENABLED
	godot_js_mg_set_clipboard(p_text.utf8().get_data(), &_cb_clipboard_write);
#endif
}

void MiniGameSDK::get_clipboard() {
#ifdef WEB_ENABLED
	godot_js_mg_get_clipboard(&_cb_clipboard_read);
#else
	call_deferred(SNAME("_deferred_emit"), String("clipboard_read"), String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}"));
#endif
}

void MiniGameSDK::show_share_menu() {
#ifdef WEB_ENABLED
	godot_js_mg_show_share_menu();
#endif
}

void MiniGameSDK::vibrate(const String &p_type) {
#ifdef WEB_ENABLED
	godot_js_mg_vibrate(p_type.utf8().get_data());
#endif
}

String MiniGameSDK::storage_set(const String &p_key, const String &p_value) {
#ifdef WEB_ENABLED
	return _take_string(godot_js_mg_storage_set(p_key.utf8().get_data(), p_value.utf8().get_data()));
#else
	return String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}");
#endif
}

String MiniGameSDK::storage_get(const String &p_key) {
#ifdef WEB_ENABLED
	return _take_string(godot_js_mg_storage_get(p_key.utf8().get_data()));
#else
	return String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}");
#endif
}

String MiniGameSDK::storage_remove(const String &p_key) {
#ifdef WEB_ENABLED
	return _take_string(godot_js_mg_storage_remove(p_key.utf8().get_data()));
#else
	return String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}");
#endif
}

String MiniGameSDK::get_system_info() const {
#ifdef WEB_ENABLED
	return _take_string(godot_js_mg_get_system_info());
#else
	return String("{\"ok\":false,\"data\":{},\"err\":\"not a mini-game platform\"}");
#endif
}

void MiniGameSDK::_deferred_emit(const String &p_signal, const String &p_json) {
	emit_signal(p_signal, p_json);
}

void MiniGameSDK::_bind_methods() {
	ClassDB::bind_method(D_METHOD("configure", "config_json"), &MiniGameSDK::configure);
	ClassDB::bind_method(D_METHOD("get_platform"), &MiniGameSDK::get_platform);

	ClassDB::bind_method(D_METHOD("login"), &MiniGameSDK::login);
	ClassDB::bind_method(D_METHOD("get_user_profile", "desc"), &MiniGameSDK::get_user_profile, DEFVAL(""));
	ClassDB::bind_method(D_METHOD("show_rewarded_video", "ad_unit_id"), &MiniGameSDK::show_rewarded_video, DEFVAL(""));
	ClassDB::bind_method(D_METHOD("show_interstitial", "ad_unit_id"), &MiniGameSDK::show_interstitial, DEFVAL(""));
	ClassDB::bind_method(D_METHOD("share", "title", "image_url", "query"), &MiniGameSDK::share, DEFVAL(""), DEFVAL(""), DEFVAL(""));
	ClassDB::bind_method(D_METHOD("show_share_menu"), &MiniGameSDK::show_share_menu);
	ClassDB::bind_method(D_METHOD("vibrate", "type"), &MiniGameSDK::vibrate, DEFVAL("short"));
	ClassDB::bind_method(D_METHOD("set_clipboard", "text"), &MiniGameSDK::set_clipboard);
	ClassDB::bind_method(D_METHOD("get_clipboard"), &MiniGameSDK::get_clipboard);

	ClassDB::bind_method(D_METHOD("storage_set", "key", "value"), &MiniGameSDK::storage_set);
	ClassDB::bind_method(D_METHOD("storage_get", "key"), &MiniGameSDK::storage_get);
	ClassDB::bind_method(D_METHOD("storage_remove", "key"), &MiniGameSDK::storage_remove);
	ClassDB::bind_method(D_METHOD("get_system_info"), &MiniGameSDK::get_system_info);

	ClassDB::bind_method(D_METHOD("_deferred_emit", "signal", "json"), &MiniGameSDK::_deferred_emit);

	ADD_SIGNAL(MethodInfo("login_completed", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("user_profile_completed", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("rewarded_video_closed", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("interstitial_closed", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("share_completed", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("clipboard_written", PropertyInfo(Variant::STRING, "result_json")));
	ADD_SIGNAL(MethodInfo("clipboard_read", PropertyInfo(Variant::STRING, "result_json")));
}

MiniGameSDK::MiniGameSDK() {
	ERR_FAIL_COND_MSG(singleton != nullptr, "MiniGameSDK singleton already exists.");
	singleton = this;
}

MiniGameSDK::~MiniGameSDK() {
	if (singleton == this) {
		singleton = nullptr;
	}
}
