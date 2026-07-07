#!/usr/bin/env node
/**
 * adapt-minigame.js
 * -----------------------------------------------------------------------------
 * Converts a Godot 4.x **Web export** into a WeChat / Douyin Mini-Game project.
 *
 * Two engine modes:
 *   • default        — use the project's own <exe>.js / <exe>.wasm (only runs in
 *                      the DevTools simulator IF it has no wasm-eh, which standard
 *                      Godot Web exports DO have → CompileError). Kept for exports
 *                      already built mini-game compatible.
 *   • --engine <dir> — swap in a mini-game compatible engine (godot.js +
 *                      godot.wasm.br, built WITHOUT wasm-eh/SIMD) and load the
 *                      project's .pck with it. This is what works on real devices.
 *                      The engine's major.minor must match the .pck.
 *
 * Pipeline:
 *   1. Patch <engine>.js → js/libs/godot.js  (adapter globals + WebGL fallback +
 *      audio-worklet neutralise + expose Engine/Godot + wxFS persistence)
 *   2. Provide engine/<base>.wasm.br  (copy compatible .br, or Brotli the raw .wasm)
 *   3. Copy .pck → engine/<exe>.zip  (mini-game file reader denies the .pck ext)
 *   4. Emit runtime layer (adapter.js / fetch.js / wxfs-adapter.js / minigame-sdk.js /
 *      game.js / js/loader.js / js/image_loader.js / js/worker/position_reporting.js)
 *   5. Write game.json (subpackages + workers) + subpackage placeholders
 *
 * Usage:
 *   node tools/adapt-minigame.js --platform wechat --engine tools/engine --src game
 *   node tools/adapt-minigame.js --platform tiktok --out dist/tiktok --engine tools/engine --src game --orientation landscape
 *
 * Flags:
 *   --platform  wechat | tiktok   target mini-game platform            (default wechat)
 *   --out       <dir>             output project dir (relative to root) (default: project root)
 *   --engine    <dir>            mini-game compatible engine dir (godot.js + godot.wasm.br)
 *   --src       <dir>            dir holding <exe>.js/.wasm/.pck        (default game)
 *   --exe       <name>           project export base name              (default build)
 *   --orientation portrait|landscape                                   (default portrait)
 *
 * Re-runnable / idempotent.
 * -----------------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const ROOT = path.resolve(__dirname, "..");

// ── platform ──────────────────────────────────────────────────────────────────
const PLATFORM = (arg("platform", "wechat") || "wechat").toLowerCase();
const PLATFORMS = {
  wechat: { label: "WeChat", tpl: "wechat-templates" },
  tiktok: { label: "Douyin", tpl: "tiktok-templates" },
};
if (!PLATFORMS[PLATFORM]) {
  throw new Error(`unknown --platform "${PLATFORM}" (expected: ${Object.keys(PLATFORMS).join(" | ")})`);
}
const PLAT = PLATFORMS[PLATFORM];
const TPL = path.join(__dirname, PLAT.tpl);

// ── paths ─────────────────────────────────────────────────────────────────────
const OUT = path.resolve(ROOT, arg("out", "."));       // output project dir
const EXE = arg("exe", "build");                       // project export base name
const SRC = path.join(ROOT, arg("src", "game"));       // dir holding <exe>.js/.wasm/.pck
const ENGINE = arg("engine", "");                      // compatible engine dir (godot.js + godot.wasm.br)
const ENGINE_DIR = ENGINE ? path.resolve(ROOT, ENGINE) : "";
const ORIENTATION = arg("orientation", "portrait");
const PCK_EXT = "zip";                                 // mini-game FS refuses to read .pck

const BASE = ENGINE_DIR ? "godot" : EXE;               // engine file base name
const EXECUTABLE = `engine/${BASE}`;
const WASM_BR = `engine/${BASE}.wasm.br`;
const WASM_RAW = `engine/${BASE}.wasm`;
const MAIN_PACK = `engine/${EXE}.${PCK_EXT}`;

const KEEP_IN_ENGINE = new Set([
  `${BASE}.wasm.br`,
  `${EXE}.${PCK_EXT}`,
  `${BASE}.audio.worklet.js`,
  `${BASE}.audio.position.worklet.js`,
  "game.js",
]);

function log(m) { console.log(m); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function copy(from, to) { ensureDir(path.dirname(to)); fs.copyFileSync(from, to); }

// ── 1. patch <engine>.js → js/libs/godot.js ──────────────────────────────────
function patchGodotJs() {
  const srcJs = ENGINE_DIR ? path.join(ENGINE_DIR, "godot.js") : path.join(SRC, `${EXE}.js`);
  if (!fs.existsSync(srcJs)) throw new Error("missing engine js: " + srcJs);
  let c = fs.readFileSync(srcJs, "utf8");
  const report = [];

  function replaceOnce(find, repl, label) {
    if (!c.includes(find)) {
      report.push(c.includes(repl) ? `  = ${label} (already patched)` : `  ! ${label} (target NOT found — skipped)`);
      return;
    }
    c = c.replace(find, repl);
    report.push(`  ✓ ${label}`);
  }

  const preamble = 'if(typeof GameGlobal!=="undefined"&&GameGlobal.__adapter){var document=GameGlobal.__adapter.document;var window=GameGlobal.__adapter.window||GameGlobal;var navigator=GameGlobal.__adapter.navigator;}\n';
  if (!c.startsWith('if(typeof GameGlobal')) { c = preamble + c; report.push("  ✓ preamble (document/window/navigator)"); }
  else report.push("  = preamble (already patched)");

  if (c.indexOf("GameGlobal.Engine=Engine") === -1) {
    c = c + '\nif(typeof Engine!=="undefined")GameGlobal.Engine=Engine;if(typeof Godot!=="undefined")GameGlobal.Godot=Godot;\n';
    report.push("  ✓ postamble (expose Engine/Godot)");
  } else report.push("  = postamble (already patched)");

  replaceOnce(
    "GodotConfig.canvas.parentElement.appendChild(",
    "(GodotConfig.canvas.parentElement||document.body).appendChild(",
    "canvas.parentElement guard");

  const glOld = 'createContext:(canvas,webGLContextAttributes)=>{if(webGLContextAttributes.renderViaOffscreenBackBuffer)webGLContextAttributes["preserveDrawingBuffer"]=true;var ctx=webGLContextAttributes.majorVersion>1?canvas.getContext("webgl2",webGLContextAttributes):canvas.getContext("webgl",webGLContextAttributes);if(!ctx)return 0;var handle=GL.registerContext(ctx,webGLContextAttributes);return handle}';
  const glNew = 'createContext:(canvas,webGLContextAttributes)=>{if(!canvas&&typeof GameGlobal!=="undefined")canvas=GameGlobal.canvas;if(!canvas){console.error("[GL] no canvas");return 0}var type=webGLContextAttributes.majorVersion>1?"webgl2":"webgl";var ctx=canvas.getContext(type,webGLContextAttributes);if(!ctx)ctx=canvas.getContext(type);if(!ctx&&canvas.__glctx)ctx=canvas.__glctx;if(!ctx&&typeof GameGlobal!=="undefined"&&GameGlobal.canvas&&GameGlobal.canvas!==canvas){ctx=GameGlobal.canvas.getContext(type,webGLContextAttributes)||GameGlobal.canvas.getContext(type);canvas=GameGlobal.canvas}if(!ctx){console.error("[GL] getContext failed");return 0}canvas.__glctx=ctx;var handle=GL.registerContext(ctx,webGLContextAttributes);return handle}';
  replaceOnce(glOld, glNew, "GL.createContext fallback");

  replaceOnce(
    "async connectPositionWorklet(start){await GodotAudio.audioPositionWorkletPromise;if(this.isCanceled){return}this._source.connect(this.getPositionWorklet());if(start){this.start()}}",
    "async connectPositionWorklet(start){if(start){this.start()}}",
    "connectPositionWorklet neutralise");

  replaceOnce(
    "return !!document.createElement('canvas').getContext(['webgl', 'webgl2'][majorVersion - 1]);",
    "try{var _c=document.createElement('canvas');var _r=_c.getContext(['webgl','webgl2'][majorVersion-1]);return !!_r}catch(e){return true;}",
    "isWebGLAvailable guard");

  replaceOnce(
    "GodotFS._mount_points.forEach(function(path){createRecursive(path);FS.mount(IDBFS,{},path)});return new Promise(function(resolve,reject){FS.syncfs(true,function(err){if(err){GodotFS._mount_points=[];GodotFS._idbfs=false;GodotRuntime.print(`IndexedDB not available: ${err.message}`)}else{GodotFS._idbfs=true}resolve(err)})})",
    'GodotFS._mount_points.forEach(function(path){createRecursive(path)});try{if(typeof GameGlobal!=="undefined"&&GameGlobal.__wxfs){GodotFS._mount_points.forEach(function(p){GameGlobal.__wxfs.restore(p,FS)});GodotFS._idbfs=true}}catch(wxe){GodotRuntime.print("[wxfs] restore failed: "+wxe.message)}return Promise.resolve(null)',
    "wxFS restore (GodotFS.init)");

  replaceOnce(
    "GodotFS._syncing=true;return new Promise(function(resolve,reject){FS.syncfs(false,function(error){if(error){GodotRuntime.error(`Failed to save IDB file system: ${error.message}`)}GodotFS._syncing=false;resolve(error)})})",
    'GodotFS._syncing=true;try{if(typeof GameGlobal!=="undefined"&&GameGlobal.__wxfs){GodotFS._mount_points.forEach(function(p){GameGlobal.__wxfs.flush(p,FS)})}}catch(wxe){GodotRuntime.error("[wxfs] flush failed: "+wxe.message)}GodotFS._syncing=false;return Promise.resolve(null)',
    "wxFS flush (GodotFS.sync)");

  // Fix doInit: add .catch(reject) so Godot/initFS failures propagate
  replaceOnce(
    'resolve();\n\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t});\n\t\t\t\t\t\t});\n\t\t\t\t\t});',
    'resolve();\n\t\t\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t});',
    "doInit error propagation (.catch(reject))");

  const dst = path.join(OUT, "js/libs/godot.js");
  ensureDir(path.dirname(dst));
  fs.writeFileSync(dst, c);
  log(`[1] Patched js/libs/godot.js  (source: ${path.relative(ROOT, srcJs)})`);
  report.forEach(log);
}

// ── 2. engine wasm → engine/<base>.wasm.br ────────────────────────────────────
function provideWasm() {
  const dst = path.join(OUT, WASM_BR);
  ensureDir(path.dirname(dst));
  if (ENGINE_DIR) {
    copy(path.join(ENGINE_DIR, "godot.wasm.br"), dst);
    log(`[2] Copied compatible engine → ${WASM_BR} (${(fs.statSync(dst).size/1048576).toFixed(1)}MB, EH-free)`);
    return;
  }
  const srcWasm = path.join(SRC, `${EXE}.wasm`);
  if (!fs.existsSync(srcWasm)) throw new Error("missing " + srcWasm);
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(srcWasm).mtimeMs) {
    log(`[2] ${WASM_BR} up-to-date, skip`);
    return;
  }
  const src = fs.readFileSync(srcWasm);
  const t = Date.now();
  const out = zlib.brotliCompressSync(src, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: src.length,
  }});
  fs.writeFileSync(dst, out);
  log(`[2] Brotli ${EXE}.wasm → ${WASM_BR} (${(out.length/1048576).toFixed(1)}MB, ${((Date.now()-t)/1000).toFixed(1)}s)`);
}

// ── 3. copy pck (renamed) + audio worklets + splash into engine/ ──────────────
function copyAssets() {
  copy(path.join(SRC, `${EXE}.pck`), path.join(OUT, MAIN_PACK));
  log(`[3] Copied ${EXE}.pck → ${MAIN_PACK} (renamed: mini-game FS denies .pck)`);
  const worklets = [
    [`${EXE}.audio.worklet.js`, `${BASE}.audio.worklet.js`],
    [`${EXE}.audio.position.worklet.js`, `${BASE}.audio.position.worklet.js`],
  ];
  for (const [from, to] of worklets) {
    const f = path.join(SRC, from);
    if (fs.existsSync(f)) { copy(f, path.join(OUT, "engine", to)); log(`    Copied ${from} → engine/${to}`); }
  }
  const png = path.join(SRC, `${EXE}.png`);
  if (fs.existsSync(png)) { copy(png, path.join(OUT, "images/logo.png")); log("    Copied splash → images/logo.png"); }
}

// ── prune stale files from engine/ ────────────────────────────────────────────
function pruneEngine() {
  const dir = path.join(OUT, "engine");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!KEEP_IN_ENGINE.has(f)) {
      fs.rmSync(path.join(dir, f), { force: true });
      log(`    Pruned stale engine/${f}`);
    }
  }
}

// ── 4. runtime layer ──────────────────────────────────────────────────────────
function tpl(name) { return fs.readFileSync(path.join(TPL, name), "utf8"); }
function writeOut(rel, content) { const p = path.join(OUT, rel); ensureDir(path.dirname(p)); fs.writeFileSync(p, content); log("    " + rel); }

function emitRuntime() {
  log("[4] Runtime layer");
  const candidates = ENGINE_DIR ? `["${WASM_BR}"]` : `["${WASM_BR}", "${WASM_RAW}"]`;
  const adapter = tpl("adapter.js").replace(
    'const _wasmCandidates = ["engine/godot.wasm.br", "engine/godot.wasm"];',
    `const _wasmCandidates = ${candidates};`);
  writeOut("adapter.js", adapter);

  writeOut("audio-compat.js", tpl("audio-compat.js"));
  writeOut("fetch.js", tpl("fetch.js"));
  writeOut("wxfs-adapter.js", tpl("wxfs-adapter.js"));
  writeOut("minigame-sdk.js", tpl("minigame-sdk.js"));
  writeOut("game.js", tpl("game.js"));

  const loader = tpl("loader.js")
    .replace("{{{EXECUTABLE}}}", EXECUTABLE)
    .replace("{{{MAIN_PACK}}}", MAIN_PACK);
  writeOut("js/loader.js", loader);

  writeOut("js/image_loader.js", tpl("image_loader.js"));
  writeOut("js/worker/position_reporting.js", tpl(path.join("worker", "position_reporting.js")));

  writeOut("engine/game.js", "// engine subpackage placeholder\n");
  writeOut("subpacks/game.js", "// reserved subpackage placeholder\n");
}

// ── 5. game.json (+ minimal project.config.json when writing a fresh --out) ────
function writeGameJson() {
  fs.writeFileSync(path.join(OUT, "game.json"), tpl("game.json").replace("{{{ORIENTATION}}}", ORIENTATION));
  log("[5] Wrote game.json (platform=" + PLATFORM + ", orientation=" + ORIENTATION + ")");

  // Emit a minimal project.config.json for dedicated output dirs that lack one,
  // so the folder can be imported into DevTools directly.
  const pcfg = path.join(OUT, "project.config.json");
  if (path.resolve(OUT) !== path.resolve(ROOT) && !fs.existsSync(pcfg)) {
    const cfg = {
      description: `Godot mini-game (${PLAT.label})`,
      setting: { es6: true },
      packOptions: { ignore: [{ type: "folder", value: "game" }, { type: "folder", value: "tools" }] },
    };
    fs.writeFileSync(pcfg, JSON.stringify(cfg, null, 2));
    log("    project.config.json (minimal)");
  }
}

(function main() {
  log(`\n=== adapt-minigame  platform=${PLATFORM}(${PLAT.label})  engine=${ENGINE_DIR ? path.relative(ROOT, ENGINE_DIR) : "(project self)"}  exe=${EXE}  out=${path.relative(ROOT, OUT) || "."}  orientation=${ORIENTATION} ===\n`);
  patchGodotJs();
  provideWasm();
  copyAssets();
  pruneEngine();
  emitRuntime();
  writeGameJson();
  log("\n=== Done. Import the output dir into " + PLAT.label + " DevTools (MiniGame). ===");
  if (!ENGINE_DIR) {
    log("WARNING: using the project's own WASM. Standard Godot Web exports use wasm-eh,");
    log("which WXWebAssembly/TTWebAssembly rejects (CompileError). Re-run with --engine <dir>");
    log("pointing at a mini-game compatible engine (godot.js + godot.wasm.br).\n");
  } else {
    log(`Engine: mini-game compatible build from ${path.relative(ROOT, ENGINE_DIR)} (EH-free).`);
    log("The engine major.minor must match the .pck; patch differences are fine.\n");
  }
})();
