/**
 * audio-compat.js  —  微信小游戏音频兼容补丁
 *
 * 必须在 adapter.js 之前 import：adapter.js 在导入时就调用并缓存了
 * wx.createWebAudioContext()（见 adapter.js 中 _nativeWebAudio 赋值），
 * 所以要在那之前包装该工厂，注入的 estimatePlaybackPosition 才会生效。
 * 因此放在入口首个 import，而不是胶水层内部（那时机太晚）。
 *
 * 做三件事（保留 Worklet 高性能，只补进度估算）：
 *   1. 包装 wx.createWebAudioContext，给 createBufferSource() 注入
 *      estimatePlaybackPosition()（基于 ctx.currentTime 估算）。
 *   2. iOS 切回前台时恢复被挂起的 AudioContext（wx.onShow）。
 *   3. 暴露 __installSoundPosBridge(Module)，由 loader 在 startGame 后
 *      用 engine.rtenv 调用，等价于 Module._JS_Sound_GetPlaybackPos = ...
 *      （Unity 风格桥接；Godot 不会调用它，作为无害兼容项保留，
 *        供自定义引擎使用）。
 */
(function (global) {
  const _api = (typeof wx !== "undefined") ? wx : (typeof tt !== "undefined" ? tt : null);
  if (!_api) return;

  // 记录所有创建出来的音频上下文，供 onShow 恢复
  const _ctxs = [];

  // ── 1. 包装 createWebAudioContext，注入进度估算 ──────────────────
  if (typeof _api.createWebAudioContext === "function") {
    const originalCreateWebAudioCtx = _api.createWebAudioContext.bind(_api);
    _api.createWebAudioContext = function () {
      const ctx = originalCreateWebAudioCtx();
      _ctxs.push(ctx);

      const origCreateBufferSource = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = function () {
        const src = origCreateBufferSource();
        let playStartAt = 0;
        let pausedAt = 0;
        let isPlaying = false;

        const origStart = src.start.bind(src);
        src.start = function (when, offset, dur) {
          playStartAt = ctx.currentTime - (offset || 0);
          pausedAt = 0;
          isPlaying = true;
          origStart(when, offset, dur);
        };

        const origStop = src.stop.bind(src);
        src.stop = function () {
          if (isPlaying) pausedAt = ctx.currentTime - playStartAt;
          isPlaying = false;
          origStop();
        };

        // 关键：给 source 挂载微信兼容的进度估算函数
        src.estimatePlaybackPosition = function () {
          if (!isPlaying) return pausedAt;
          return ctx.currentTime - playStartAt;
        };
        return src;
      };
      return ctx;
    };
  }

  // ── 2. iOS 后台恢复补丁 ────────────────────────────────────────
  if (typeof _api.onShow === "function") {
    _api.onShow(function () {
      _ctxs.forEach(function (ctx) {
        try {
          if (ctx && ctx.state !== "running" && typeof ctx.resume === "function") ctx.resume();
        } catch (_e) { /* ignore */ }
      });
    });
  }

  // ── 3. 覆盖引擎获取音频位置的 JS 桥接函数（由 loader 用 rtenv 调用）──
  global.__installSoundPosBridge = function (Module) {
    if (!Module) return;
    Module._JS_Sound_GetPlaybackPos = function (channel) {
      const ch = Module.audioChannels && Module.audioChannels[channel];
      if (!ch || !ch.source) return 0;
      return ch.source.estimatePlaybackPosition ? ch.source.estimatePlaybackPosition() : 0;
    };
  };
})(GameGlobal);
