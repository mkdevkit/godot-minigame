// WeChat Mini-Game entry point for Godot Engine
// Phase 0: audio compat — MUST run before adapter.js (it caches wx.createWebAudioContext)
import "./audio-compat.js";
// Phase 1: browser env adapters (window/document/canvas/WebGL/Audio/fetch/WebAssembly)
import "./adapter.js";
import "./fetch.js";
import "./wxfs-adapter.js";

// Phase 2: loading screen + engine boot
import Loader from "./js/loader.js";

function checkUpdate() {
  try {
    const updater = wx.getUpdateManager();
    updater.onCheckForUpdate(() => {});
    updater.onUpdateReady(() => {
      wx.showModal({
        title: "更新提示",
        content: "新版本已准备好，是否重启应用？",
        success(res) { if (res.confirm) updater.applyUpdate(); },
      });
    });
    updater.onUpdateFailed(() => {});
  } catch {}
}

checkUpdate();
const loader = new Loader();
loader.load();
