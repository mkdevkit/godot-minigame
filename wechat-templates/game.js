// Mini-Game entry point for Godot Engine (WeChat / Douyin)
// Phase 0: audio compat — MUST run before adapter.js (it caches createWebAudioContext)
import "./audio-compat.js";
// Phase 1: browser env adapters (window/document/canvas/WebGL/Audio/fetch/WebAssembly)
import "./adapter.js";
import "./fetch.js";
import "./wxfs-adapter.js";
// Phase 1.5: cross-platform mini-game SDK (login/ad/share/system) → window.MiniGameSDK
import "./minigame-sdk.js";

// Phase 2: loading screen + engine boot
import Loader from "./js/loader.js";

const _api = (typeof wx !== "undefined") ? wx : tt;

function checkUpdate() {
  try {
    const updater = _api.getUpdateManager();
    updater.onCheckForUpdate(() => {});
    updater.onUpdateReady(() => {
      _api.showModal({
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
