/**
 * Godot engine loader for WeChat mini games.
 *
 * 流程: loading screen → engine subpackage → boot Godot → wxFS restore → auto-sync.
 */
import "./libs/godot.js";
import { waitForImage } from "./image_loader.js";

const _api = (typeof wx !== "undefined") ? wx : tt;

const LoaderConfig = {
  logo: "images/logo.png",
  background: "images/logo.png",
  iconWidth: 128,
  iconHeight: 128,
  backgroundColor: "#282c34",
  loadingBarHeight: 20,
  loadingBarColor: "#478CBF",
  loadingBarBgColor: "#444",
};

// Use __adapter.canvas which has properly wrapped addEventListener/getContext
const _canvas = (GameGlobal.__adapter && GameGlobal.__adapter.canvas) || GameGlobal.canvas || _api.createCanvas();

class Loader {
  constructor(config) {
    this.config = { ...LoaderConfig, ...config };
    const info = (_api.getWindowInfo || _api.getSystemInfoSync).call(_api);
    const dpr = info.pixelRatio;
    this.progress = 0;
    this.screenCtx = _canvas.getContext("webgl2");
    this.loadingCanvas = _api.createCanvas();
    this.loadingCtx = this.loadingCanvas.getContext("2d");
    this.loadingCanvas.width = window.innerWidth * dpr;
    this.loadingCanvas.height = window.innerHeight * dpr;
    _canvas.width = window.innerWidth * dpr;
    _canvas.height = window.innerHeight * dpr;
    this.loadingCtx.scale(dpr, dpr);
    this.bgImage = _api.createImage();
    this.bgImage.src = this.config.background;
    this.logoImage = _api.createImage();
    this.logoImage.src = this.config.logo;
    const [tex, clean] = this._initWebgl();
    this.screenTexture = tex;
    this.cleanWebgl = clean;
  }

  async loadSubpackages() {
    console.log("[Loader] await loadSubpackage('engine') ...");
    await new Promise((resolve, reject) => {
      _api.loadSubpackage({ name: "engine", success: resolve, fail: reject });
    });
    console.log("[Loader] engine subpackage loaded");
    this._step();
  }

  _step() {
    this.progress = Math.min(this.progress + 1, 3);
    this._drawLoading();
  }

  _drawLoading() {
    const ctx = this.loadingCtx;
    const w = window.innerWidth, h = window.innerHeight;
    ctx.fillStyle = this.config.backgroundColor;
    ctx.fillRect(0, 0, w, h);
    if (this.bgImage.complete) ctx.drawImage(this.bgImage, 0, 0, w, h);
    if (this.logoImage.complete) {
      const iw = this.config.iconWidth, ih = this.config.iconHeight;
      ctx.drawImage(this.logoImage, (w - iw) / 2, h / 3 - ih / 3, iw, ih);
    }
    const barW = w - 48, barX = (w - barW) / 2, barY = h - this.config.loadingBarHeight / 2 - 100;
    const pct = this.progress / 3;
    ctx.fillStyle = this.config.loadingBarBgColor;
    ctx.fillRect(barX, barY, barW, this.config.loadingBarHeight);
    ctx.fillStyle = this.config.loadingBarColor;
    ctx.fillRect(barX, barY, pct * barW, this.config.loadingBarHeight);
    ctx.font = "16px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText(`${(pct * 100).toFixed(1)}%`, w / 2, barY + this.config.loadingBarHeight - 4);
    this._blit();
  }

  _initWebgl() {
    const gl = this.screenCtx;
    const vsSrc = `attribute vec4 a_position; attribute vec2 a_texCoord; varying vec2 v_texCoord;
      void main() { gl_Position = a_position; v_texCoord = a_texCoord; }`;
    const fsSrc = `precision mediump float; varying vec2 v_texCoord; uniform sampler2D u_texture;
      void main() { gl_FragColor = texture2D(u_texture, v_texCoord); }`;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
    const verts = new Float32Array([-1,1,0,0, -1,-1,0,1, 1,-1,1,1, -1,1,0,0, 1,-1,1,1, 1,1,1,0]);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const posL = gl.getAttribLocation(prog, "a_position"); gl.vertexAttribPointer(posL, 2, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(posL);
    const texL = gl.getAttribLocation(prog, "a_texCoord"); gl.vertexAttribPointer(texL, 2, gl.FLOAT, false, 16, 8); gl.enableVertexAttribArray(texL);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.viewport(0, 0, this.loadingCanvas.width, this.loadingCanvas.height);
    const clean = () => {
      for (let i = 0; i < gl.getParameter(gl.MAX_VERTEX_ATTRIBS); i++) gl.disableVertexAttribArray(i);
      gl.deleteTexture(tex); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    };
    return [tex, clean];
  }

  _blit() {
    const gl = this.screenCtx;
    gl.bindTexture(gl.TEXTURE_2D, this.screenTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.loadingCanvas);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  async load() {
    try {
      console.log("[Loader] ▶ 开始加载流程");
      // Step 1/4: Load images
      console.log("[Loader] 1/4 加载图片资源...");
      await Promise.all([waitForImage(this.bgImage), waitForImage(this.logoImage)]);
      this._step();

      // Step 2/4: Load engine subpackage (wasm.br, pck, worklets)
      console.log("[Loader] 2/4 加载引擎子包...");
      await this.loadSubpackages();

      // Step 3/4: Boot Godot engine
      console.log("[Loader] 3/4 启动 Godot 引擎...");
      this._step();
      const _Engine = GameGlobal.Engine || (typeof Engine !== "undefined" ? Engine : null);
      if (!_Engine) throw new Error("Engine not found – godot.js may not have loaded correctly");
      const engine = new _Engine();
      GameGlobal.engine = engine;

      await engine.startGame({
        canvas: _canvas,
        executable: "{{{EXECUTABLE}}}",
        mainPack: "{{{MAIN_PACK}}}",
        args: [],
      });

      console.log("[Loader] engine.startGame() done");

      // Audio: install Unity-style playback-position bridge onto the module (rtenv).
      // Harmless no-op for stock Godot; useful for engines exposing that bridge.
      if (GameGlobal.__installSoundPosBridge && engine.rtenv) {
        try { GameGlobal.__installSoundPosBridge(engine.rtenv); }
        catch (e) { console.warn("[audio] sound-pos bridge failed", e); }
      }

      // Step 4/4: wxFS persistence (restore + auto-sync)
      console.log("[Loader] 4/4 设置文件持久化...");
      const __safeFS = (function () {
        try {
          if (!engine.rtenv) return null;
          const mod = engine.rtenv;
          // Object.defineProperty getter for "FS" calls abort() on access.
          // Use getOwnPropertyDescriptor to check before touching it.
          const desc = Object.getOwnPropertyDescriptor(mod, "FS");
          if (desc && typeof desc.get === "function") {
            // It's an abort-triggering getter – FS is truly not exported.
            console.warn("[wxfs] FS not exported (getter detected), wxfs disabled");
            return null;
          }
          const fs = mod["FS"];
          if (fs && typeof fs === "object") return fs;
        } catch (e) {
          console.warn("[wxfs] FS probe failed", e.message);
        }
        return null;
      })();

      if (__safeFS) {
        const persistPaths = engine.config.persistentPaths || ["/userfs"];
        for (const p of persistPaths) {
          try {
            GameGlobal.__wxfs.restore(p, __safeFS);
          } catch (e) {
            console.warn("[wxfs] restore failed for", p, e);
          }
        }
      }

      let _flushFS = __safeFS;
      setInterval(() => {
        if (!_flushFS) return;
        try {
          const persistPaths = engine.config.persistentPaths || ["/userfs"];
          for (const p of persistPaths) {
            GameGlobal.__wxfs.flush(p, _flushFS);
          }
        } catch (e) {
          console.warn("[wxfs] flush failed", e);
        }
      }, 5000);

      // Flush on hide (user leaves minigame)
      wx.onHide(() => {
        if (!_flushFS) return;
        try {
          const persistPaths = engine.config.persistentPaths || ["/userfs"];
          for (const p of persistPaths) {
            GameGlobal.__wxfs.flush(p, _flushFS);
          }
        } catch (e) { /* ignore */ }
      });

      // Clean up loading screen
      this.logoImage = null;
      this.loadingCtx.clearRect(0, 0, this.loadingCanvas.width, this.loadingCanvas.height);
      this.cleanWebgl();
      console.log("[Loader] ✓ 加载完成，游戏已启动");
    } catch (err) {
      console.error("[Loader] ✗ 加载失败:", err);
      if (err && err.stack) console.error("[Loader] Stack:", err.stack);
    }
  }
}

export default Loader;
