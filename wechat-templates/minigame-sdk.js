/**
 * minigame-sdk.js — 跨平台小游戏能力适配层（微信 wx.* / 抖音 tt.*）
 *
 * 把微信与抖音都支持的能力抽象成一套统一接口，挂到 window.MiniGameSDK
 * （在小游戏里 window === GameGlobal，见 adapter.js），供两种方式调用：
 *
 *   1. Godot GDScript:  JavaScriptBridge.get_interface("MiniGameSDK")
 *   2. Godot C++     :  emscripten library (library_godot_minigame.js) 调用本对象
 *
 * 约定：
 *   • 异步方法接受一个回调 cb(resultJson)，resultJson 为 JSON 字符串
 *       { "ok": bool, "data": {...}, "err": "..." }
 *     这样 JavaScriptBridge / emscripten 都能安全地按字符串传递结果。
 *   • 同步方法直接返回 JSON 字符串。
 *   • 广告需要先 configure({ rewardedAdUnitId, interstitialAdUnitId })
 *     或在调用时显式传入 adUnitId。
 */
(function (global) {
  var _api = (typeof wx !== "undefined") ? wx : (typeof tt !== "undefined" ? tt : null);
  var PLATFORM = (_api && _api === (typeof wx !== "undefined" ? wx : null)) ? "wechat" : "douyin";

  function _ok(data) { return JSON.stringify({ ok: true, data: data || {}, err: "" }); }
  function _err(msg) { return JSON.stringify({ ok: false, data: {}, err: String(msg || "unknown") }); }
  function _call(cb, json) { if (typeof cb === "function") { try { cb(json); } catch (e) { console.error("[SDK] cb error", e); } } }

  var _cfg = { rewardedAdUnitId: "", interstitialAdUnitId: "" };
  var _rewardedAds = {};      // adUnitId -> ad instance
  var _interstitialAds = {};

  var SDK = {
    platform: PLATFORM,

    /** 配置广告位等参数。cfgJson: JSON 字符串或对象 */
    configure: function (cfg) {
      try {
        var o = (typeof cfg === "string") ? JSON.parse(cfg) : (cfg || {});
        if (o.rewardedAdUnitId) _cfg.rewardedAdUnitId = o.rewardedAdUnitId;
        if (o.interstitialAdUnitId) _cfg.interstitialAdUnitId = o.interstitialAdUnitId;
      } catch (e) { console.error("[SDK] configure parse fail", e); }
    },

    getPlatform: function () { return PLATFORM; },

    // ── 登录 + 用户信息 ─────────────────────────────────────────
    /** 登录，回调返回 { code }。业务后端用 code 换取 openid/session。 */
    login: function (cb) {
      if (!_api || !_api.login) { _call(cb, _err("login unsupported")); return; }
      _api.login({
        success: function (res) { _call(cb, _ok({ code: res.code, anonymousCode: res.anonymousCode || "" })); },
        fail: function (e) { _call(cb, _err(e && e.errMsg)); },
      });
    },

    /** 拉起用户信息授权，回调返回 { nickName, avatarUrl, ... }。 */
    getUserProfile: function (desc, cb) {
      // 抖音无 getUserProfile，回退到 getUserInfo
      var fn = _api && (_api.getUserProfile || _api.getUserInfo);
      if (!fn) { _call(cb, _err("getUserProfile unsupported")); return; }
      var opts = {
        desc: desc || "用于完善会员资料",
        lang: "zh_CN",
        success: function (res) { _call(cb, _ok({ userInfo: res.userInfo, rawData: res.rawData || "" })); },
        fail: function (e) { _call(cb, _err(e && e.errMsg)); },
      };
      fn.call(_api, opts);
    },

    // ── 激励视频广告 ────────────────────────────────────────────
    /** 展示激励视频。回调返回 { isEnded } —— 是否完整观看。 */
    showRewardedVideoAd: function (adUnitId, cb) {
      var id = adUnitId || _cfg.rewardedAdUnitId;
      if (!_api || !_api.createRewardedVideoAd) { _call(cb, _err("rewarded ad unsupported")); return; }
      if (!id) { _call(cb, _err("no rewardedAdUnitId configured")); return; }
      try {
        var ad = _rewardedAds[id];
        if (!ad) {
          ad = _api.createRewardedVideoAd({ adUnitId: id });
          _rewardedAds[id] = ad;
        }
        var onClose = function (res) {
          ad.offClose(onClose);
          var ended = (res && (res.isEnded !== undefined)) ? res.isEnded : true;
          _call(cb, _ok({ isEnded: !!ended }));
        };
        ad.onClose(onClose);
        ad.load().then(function () { return ad.show(); }).catch(function (e) {
          ad.offClose(onClose);
          _call(cb, _err(e && (e.errMsg || e.message)));
        });
      } catch (e) { _call(cb, _err(e && e.message)); }
    },

    // ── 插屏广告 ────────────────────────────────────────────────
    /** 展示插屏广告。回调返回 { shown }。 */
    showInterstitialAd: function (adUnitId, cb) {
      var id = adUnitId || _cfg.interstitialAdUnitId;
      if (!_api || !_api.createInterstitialAd) { _call(cb, _err("interstitial ad unsupported")); return; }
      if (!id) { _call(cb, _err("no interstitialAdUnitId configured")); return; }
      try {
        var ad = _interstitialAds[id];
        if (!ad) {
          ad = _api.createInterstitialAd({ adUnitId: id });
          _interstitialAds[id] = ad;
        }
        ad.load().then(function () { return ad.show(); })
          .then(function () { _call(cb, _ok({ shown: true })); })
          .catch(function (e) { _call(cb, _err(e && (e.errMsg || e.message))); });
      } catch (e) { _call(cb, _err(e && e.message)); }
    },

    // ── 分享转发 ────────────────────────────────────────────────
    /** 主动分享。opts: { title, imageUrl, query }。 */
    share: function (title, imageUrl, query, cb) {
      if (!_api || !_api.shareAppMessage) { _call(cb, _err("share unsupported")); return; }
      try {
        _api.shareAppMessage({
          title: title || "",
          imageUrl: imageUrl || "",
          query: query || "",
        });
        _call(cb, _ok({ shared: true }));
      } catch (e) { _call(cb, _err(e && e.message)); }
    },

    /** 显示右上角转发菜单（微信 showShareMenu / 抖音 showShareMenu）。 */
    showShareMenu: function () {
      try { if (_api && _api.showShareMenu) _api.showShareMenu({ withShareTicket: true }); } catch (e) {}
    },

    // ── 系统能力 ────────────────────────────────────────────────
    /** 震动。type: "short" | "long"。 */
    vibrate: function (type) {
      try {
        if (type === "long" && _api && _api.vibrateLong) _api.vibrateLong({});
        else if (_api && _api.vibrateShort) _api.vibrateShort({ type: "medium" });
      } catch (e) {}
    },

    /** 写剪贴板。 */
    setClipboard: function (text, cb) {
      if (!_api || !_api.setClipboardData) { _call(cb, _err("clipboard unsupported")); return; }
      _api.setClipboardData({
        data: String(text == null ? "" : text),
        success: function () { _call(cb, _ok({})); },
        fail: function (e) { _call(cb, _err(e && e.errMsg)); },
      });
    },

    /** 读剪贴板，回调返回 { text }。 */
    getClipboard: function (cb) {
      if (!_api || !_api.getClipboardData) { _call(cb, _err("clipboard unsupported")); return; }
      _api.getClipboardData({
        success: function (res) { _call(cb, _ok({ text: res.data || "" })); },
        fail: function (e) { _call(cb, _err(e && e.errMsg)); },
      });
    },

    // ── KV 存储（同步） ─────────────────────────────────────────
    /** 写入 KV。返回 JSON。 */
    storageSet: function (key, value) {
      try { _api.setStorageSync(key, String(value == null ? "" : value)); return _ok({}); }
      catch (e) { return _err(e && e.message); }
    },
    /** 读取 KV。返回 { value }。 */
    storageGet: function (key) {
      try { var v = _api.getStorageSync(key); return _ok({ value: v == null ? "" : v }); }
      catch (e) { return _err(e && e.message); }
    },
    /** 删除 KV。 */
    storageRemove: function (key) {
      try { _api.removeStorageSync(key); return _ok({}); }
      catch (e) { return _err(e && e.message); }
    },

    /** 系统信息（同步）。返回完整 systemInfo JSON。 */
    getSystemInfo: function () {
      try {
        var info = (_api.getSystemInfoSync ? _api.getSystemInfoSync() : {});
        return _ok(info);
      } catch (e) { return _err(e && e.message); }
    },
  };

  global.MiniGameSDK = SDK;
  // 兼容以 window 访问（adapter 中 window===GameGlobal，但保险起见双挂）
  if (typeof window !== "undefined" && window !== global) { try { window.MiniGameSDK = SDK; } catch (e) {} }
  console.log("[SDK] MiniGameSDK ready, platform:", PLATFORM);
})(GameGlobal);
