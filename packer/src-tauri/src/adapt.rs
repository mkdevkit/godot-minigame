//! adapt.rs — Rust port of tools/adapt-minigame.js.
//!
//! Converts a Godot 4.x Web export into a WeChat / Douyin mini-game project.
//! Runtime templates are embedded at compile time via rust-embed, so the built
//! executable is fully self-contained (no Node, no external template files).

use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

// Runtime templates embedded from tools/<platform>-templates at compile time.
// Relative folder paths are resolved by rust-embed against CARGO_MANIFEST_DIR
// (this crate = tools/packer/src-tauri, so ../../ = tools/).
#[derive(RustEmbed)]
#[folder = "../../wechat-templates"]
struct WechatTpl;

#[derive(RustEmbed)]
#[folder = "../../tiktok-templates"]
struct TiktokTpl;

#[derive(Debug, Deserialize)]
pub struct AdaptOptions {
    pub platform: String,    // "wechat" | "tiktok"
    pub src: String,         // dir holding <exe>.js/.wasm/.pck
    pub engine: String,      // optional engine dir (godot.js + godot.wasm.br); "" = none
    pub exe: String,         // export base name, e.g. "build"
    pub out: String,         // output project dir
    pub orientation: String, // "portrait" | "landscape"
}

#[derive(Debug, Serialize)]
pub struct AdaptReport {
    pub ok: bool,
    pub logs: Vec<String>,
    pub error: Option<String>,
}

struct Ctx {
    platform: String,
    src: PathBuf,
    engine: Option<PathBuf>,
    exe: String,
    out: PathBuf,
    orientation: String,
    base: String,       // engine file base name ("godot" or exe)
    logs: Vec<String>,
}

impl Ctx {
    fn log<S: Into<String>>(&mut self, m: S) {
        self.logs.push(m.into());
    }
    fn wasm_br(&self) -> String { format!("engine/{}.wasm.br", self.base) }
    fn wasm_raw(&self) -> String { format!("engine/{}.wasm", self.base) }
    fn main_pack(&self) -> String { format!("engine/{}.zip", self.exe) }
    fn executable(&self) -> String { format!("engine/{}", self.base) }
}

fn tpl(platform: &str, name: &str) -> Result<String, String> {
    let file = match platform {
        "tiktok" => TiktokTpl::get(name),
        _ => WechatTpl::get(name),
    }
    .ok_or_else(|| format!("embedded template missing: {}", name))?;
    String::from_utf8(file.data.into_owned()).map_err(|e| e.to_string())
}

fn ensure_dir(p: &Path) -> Result<(), String> {
    std::fs::create_dir_all(p).map_err(|e| format!("mkdir {}: {}", p.display(), e))
}
fn write_file(p: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = p.parent() {
        ensure_dir(parent)?;
    }
    std::fs::write(p, content).map_err(|e| format!("write {}: {}", p.display(), e))
}
fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        ensure_dir(parent)?;
    }
    std::fs::copy(from, to).map_err(|e| format!("copy {} -> {}: {}", from.display(), to.display(), e))?;
    Ok(())
}

fn brotli_compress(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        // (writer, buffer_size, quality=11, lgwin=22)
        let mut w = brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
        let _ = w.write_all(data);
        let _ = w.flush();
    }
    out
}

// ── 1. patch <engine>.js → js/libs/godot.js ─────────────────────────────────
fn patch_godot_js(ctx: &mut Ctx) -> Result<(), String> {
    let src_js = match &ctx.engine {
        Some(dir) => dir.join("godot.js"),
        None => ctx.src.join(format!("{}.js", ctx.exe)),
    };
    if !src_js.exists() {
        return Err(format!("missing engine js: {}", src_js.display()));
    }
    let mut c = std::fs::read_to_string(&src_js).map_err(|e| e.to_string())?;

    // preamble
    if !c.starts_with("if(typeof GameGlobal") {
        let preamble = "if(typeof GameGlobal!==\"undefined\"&&GameGlobal.__adapter){var document=GameGlobal.__adapter.document;var window=GameGlobal.__adapter.window||GameGlobal;var navigator=GameGlobal.__adapter.navigator;}\n";
        c = format!("{}{}", preamble, c);
        ctx.log("  ✓ preamble (document/window/navigator)");
    } else {
        ctx.log("  = preamble (already patched)");
    }

    // postamble
    if !c.contains("GameGlobal.Engine=Engine") {
        c.push_str("\nif(typeof Engine!==\"undefined\")GameGlobal.Engine=Engine;if(typeof Godot!==\"undefined\")GameGlobal.Godot=Godot;\n");
        ctx.log("  ✓ postamble (expose Engine/Godot)");
    } else {
        ctx.log("  = postamble (already patched)");
    }

    let replace_once = |c: &mut String, find: &str, repl: &str, label: &str, logs: &mut Vec<String>| {
        if c.contains(find) {
            *c = c.replacen(find, repl, 1);
            logs.push(format!("  ✓ {}", label));
        } else if c.contains(repl) {
            logs.push(format!("  = {} (already patched)", label));
        } else {
            logs.push(format!("  ! {} (target NOT found — skipped)", label));
        }
    };

    replace_once(&mut c,
        "GodotConfig.canvas.parentElement.appendChild(",
        "(GodotConfig.canvas.parentElement||document.body).appendChild(",
        "canvas.parentElement guard", &mut ctx.logs);

    replace_once(&mut c,
        r#"createContext:(canvas,webGLContextAttributes)=>{if(webGLContextAttributes.renderViaOffscreenBackBuffer)webGLContextAttributes["preserveDrawingBuffer"]=true;var ctx=webGLContextAttributes.majorVersion>1?canvas.getContext("webgl2",webGLContextAttributes):canvas.getContext("webgl",webGLContextAttributes);if(!ctx)return 0;var handle=GL.registerContext(ctx,webGLContextAttributes);return handle}"#,
        r#"createContext:(canvas,webGLContextAttributes)=>{if(!canvas&&typeof GameGlobal!=="undefined")canvas=GameGlobal.canvas;if(!canvas){console.error("[GL] no canvas");return 0}var type=webGLContextAttributes.majorVersion>1?"webgl2":"webgl";var ctx=canvas.getContext(type,webGLContextAttributes);if(!ctx)ctx=canvas.getContext(type);if(!ctx&&canvas.__glctx)ctx=canvas.__glctx;if(!ctx&&typeof GameGlobal!=="undefined"&&GameGlobal.canvas&&GameGlobal.canvas!==canvas){ctx=GameGlobal.canvas.getContext(type,webGLContextAttributes)||GameGlobal.canvas.getContext(type);canvas=GameGlobal.canvas}if(!ctx){console.error("[GL] getContext failed");return 0}canvas.__glctx=ctx;var handle=GL.registerContext(ctx,webGLContextAttributes);return handle}"#,
        "GL.createContext fallback", &mut ctx.logs);

    replace_once(&mut c,
        "async connectPositionWorklet(start){await GodotAudio.audioPositionWorkletPromise;if(this.isCanceled){return}this._source.connect(this.getPositionWorklet());if(start){this.start()}}",
        "async connectPositionWorklet(start){if(start){this.start()}}",
        "connectPositionWorklet neutralise", &mut ctx.logs);

    replace_once(&mut c,
        "return !!document.createElement('canvas').getContext(['webgl', 'webgl2'][majorVersion - 1]);",
        "try{var _c=document.createElement('canvas');var _r=_c.getContext(['webgl','webgl2'][majorVersion-1]);return !!_r}catch(e){return true;}",
        "isWebGLAvailable guard", &mut ctx.logs);

    replace_once(&mut c,
        r#"GodotFS._mount_points.forEach(function(path){createRecursive(path);FS.mount(IDBFS,{},path)});return new Promise(function(resolve,reject){FS.syncfs(true,function(err){if(err){GodotFS._mount_points=[];GodotFS._idbfs=false;GodotRuntime.print(`IndexedDB not available: ${err.message}`)}else{GodotFS._idbfs=true}resolve(err)})})"#,
        r#"GodotFS._mount_points.forEach(function(path){createRecursive(path)});try{if(typeof GameGlobal!=="undefined"&&GameGlobal.__wxfs){GodotFS._mount_points.forEach(function(p){GameGlobal.__wxfs.restore(p,FS)});GodotFS._idbfs=true}}catch(wxe){GodotRuntime.print("[wxfs] restore failed: "+wxe.message)}return Promise.resolve(null)"#,
        "wxFS restore (GodotFS.init)", &mut ctx.logs);

    replace_once(&mut c,
        r#"GodotFS._syncing=true;return new Promise(function(resolve,reject){FS.syncfs(false,function(error){if(error){GodotRuntime.error(`Failed to save IDB file system: ${error.message}`)}GodotFS._syncing=false;resolve(error)})})"#,
        r#"GodotFS._syncing=true;try{if(typeof GameGlobal!=="undefined"&&GameGlobal.__wxfs){GodotFS._mount_points.forEach(function(p){GameGlobal.__wxfs.flush(p,FS)})}}catch(wxe){GodotRuntime.error("[wxfs] flush failed: "+wxe.message)}GodotFS._syncing=false;return Promise.resolve(null)"#,
        "wxFS flush (GodotFS.sync)", &mut ctx.logs);

    replace_once(&mut c,
        "resolve();\n\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t});\n\t\t\t\t\t\t});\n\t\t\t\t\t});",
        "resolve();\n\t\t\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t\t}).catch(reject);\n\t\t\t\t\t});",
        "doInit error propagation (.catch(reject))", &mut ctx.logs);

    let dst = ctx.out.join("js/libs/godot.js");
    write_file(&dst, c.as_bytes())?;
    ctx.log(format!("[1] Patched js/libs/godot.js  (source: {})", src_js.display()));
    Ok(())
}

// ── 2. engine wasm → engine/<base>.wasm.br ───────────────────────────────────
fn provide_wasm(ctx: &mut Ctx) -> Result<(), String> {
    let dst = ctx.out.join(ctx.wasm_br());
    if let Some(parent) = dst.parent() {
        ensure_dir(parent)?;
    }
    if let Some(dir) = &ctx.engine {
        let from = dir.join("godot.wasm.br");
        copy_file(&from, &dst)?;
        let sz = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
        ctx.log(format!("[2] Copied compatible engine → {} ({:.1}MB, EH-free)", ctx.wasm_br(), sz as f64 / 1_048_576.0));
        return Ok(());
    }
    let src_wasm = ctx.src.join(format!("{}.wasm", ctx.exe));
    if !src_wasm.exists() {
        return Err(format!("missing {}", src_wasm.display()));
    }
    let data = std::fs::read(&src_wasm).map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    let out = brotli_compress(&data);
    write_file(&dst, &out)?;
    ctx.log(format!("[2] Brotli {}.wasm → {} ({:.1}MB, {:.1}s)", ctx.exe, ctx.wasm_br(), out.len() as f64 / 1_048_576.0, start.elapsed().as_secs_f64()));
    Ok(())
}

// ── 3. copy pck (renamed) + audio worklets + splash into engine/ ─────────────
fn copy_assets(ctx: &mut Ctx) -> Result<(), String> {
    let pck = ctx.src.join(format!("{}.pck", ctx.exe));
    let main_pack = ctx.out.join(ctx.main_pack());
    copy_file(&pck, &main_pack)?;
    ctx.log(format!("[3] Copied {}.pck → {} (renamed: mini-game FS denies .pck)", ctx.exe, ctx.main_pack()));

    let worklets = [
        (format!("{}.audio.worklet.js", ctx.exe), format!("{}.audio.worklet.js", ctx.base)),
        (format!("{}.audio.position.worklet.js", ctx.exe), format!("{}.audio.position.worklet.js", ctx.base)),
    ];
    for (from, to) in worklets.iter() {
        let f = ctx.src.join(from);
        if f.exists() {
            copy_file(&f, &ctx.out.join("engine").join(to))?;
            ctx.log(format!("    Copied {} → engine/{}", from, to));
        }
    }
    let png = ctx.src.join(format!("{}.png", ctx.exe));
    if png.exists() {
        copy_file(&png, &ctx.out.join("images/logo.png"))?;
        ctx.log("    Copied splash → images/logo.png");
    }
    Ok(())
}

// ── prune stale files from engine/ ───────────────────────────────────────────
fn prune_engine(ctx: &mut Ctx) -> Result<(), String> {
    let dir = ctx.out.join("engine");
    if !dir.exists() {
        return Ok(());
    }
    let keep: Vec<String> = vec![
        format!("{}.wasm.br", ctx.base),
        format!("{}.zip", ctx.exe),
        format!("{}.audio.worklet.js", ctx.base),
        format!("{}.audio.position.worklet.js", ctx.base),
        "game.js".to_string(),
    ];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !keep.contains(&name) {
                let _ = std::fs::remove_file(entry.path());
                ctx.log(format!("    Pruned stale engine/{}", name));
            }
        }
    }
    Ok(())
}

// ── 4. runtime layer ─────────────────────────────────────────────────────────
fn emit_runtime(ctx: &mut Ctx) -> Result<(), String> {
    ctx.log("[4] Runtime layer");
    let plat = ctx.platform.clone();

    let candidates = if ctx.engine.is_some() {
        format!("[\"{}\"]", ctx.wasm_br())
    } else {
        format!("[\"{}\", \"{}\"]", ctx.wasm_br(), ctx.wasm_raw())
    };
    let adapter = tpl(&plat, "adapter.js")?.replacen(
        "const _wasmCandidates = [\"engine/godot.wasm.br\", \"engine/godot.wasm\"];",
        &format!("const _wasmCandidates = {};", candidates),
        1,
    );
    write_file(&ctx.out.join("adapter.js"), adapter.as_bytes())?;
    ctx.log("    adapter.js");

    for name in ["audio-compat.js", "fetch.js", "wxfs-adapter.js", "minigame-sdk.js", "game.js"] {
        write_file(&ctx.out.join(name), tpl(&plat, name)?.as_bytes())?;
        ctx.log(format!("    {}", name));
    }

    let loader = tpl(&plat, "loader.js")?
        .replacen("{{{EXECUTABLE}}}", &ctx.executable(), 1)
        .replacen("{{{MAIN_PACK}}}", &ctx.main_pack(), 1);
    write_file(&ctx.out.join("js/loader.js"), loader.as_bytes())?;
    ctx.log("    js/loader.js");

    write_file(&ctx.out.join("js/image_loader.js"), tpl(&plat, "image_loader.js")?.as_bytes())?;
    ctx.log("    js/image_loader.js");
    write_file(&ctx.out.join("js/worker/position_reporting.js"), tpl(&plat, "worker/position_reporting.js")?.as_bytes())?;
    ctx.log("    js/worker/position_reporting.js");

    write_file(&ctx.out.join("engine/game.js"), b"// engine subpackage placeholder\n")?;
    write_file(&ctx.out.join("subpacks/game.js"), b"// reserved subpackage placeholder\n")?;
    ctx.log("    engine/game.js, subpacks/game.js");
    Ok(())
}

// ── 5. game.json (+ minimal project.config.json) ─────────────────────────────
fn write_game_json(ctx: &mut Ctx) -> Result<(), String> {
    let plat = ctx.platform.clone();
    let gj = tpl(&plat, "game.json")?.replacen("{{{ORIENTATION}}}", &ctx.orientation, 1);
    write_file(&ctx.out.join("game.json"), gj.as_bytes())?;
    ctx.log(format!("[5] Wrote game.json (platform={}, orientation={})", ctx.platform, ctx.orientation));

    let pcfg = ctx.out.join("project.config.json");
    if !pcfg.exists() {
        let label = if ctx.platform == "tiktok" { "Douyin" } else { "WeChat" };
        let cfg = serde_json::json!({
            "description": format!("Godot mini-game ({})", label),
            "setting": { "es6": true },
            "packOptions": { "ignore": [
                { "type": "folder", "value": "game" },
                { "type": "folder", "value": "tools" }
            ]}
        });
        write_file(&pcfg, serde_json::to_string_pretty(&cfg).unwrap().as_bytes())?;
        ctx.log("    project.config.json (minimal)");
    }
    Ok(())
}

pub fn adapt(opts: AdaptOptions) -> AdaptReport {
    let platform = if opts.platform == "tiktok" { "tiktok" } else { "wechat" }.to_string();
    let engine = {
        let e = opts.engine.trim();
        if e.is_empty() { None } else { Some(PathBuf::from(e)) }
    };
    let base = if engine.is_some() { "godot".to_string() } else { opts.exe.clone() };

    let mut ctx = Ctx {
        platform,
        src: PathBuf::from(&opts.src),
        engine,
        exe: opts.exe.clone(),
        out: PathBuf::from(&opts.out),
        orientation: if opts.orientation.is_empty() { "portrait".to_string() } else { opts.orientation.clone() },
        base,
        logs: Vec::new(),
    };

    ctx.log(format!(
        "=== adapt platform={} engine={} exe={} out={} orientation={} ===",
        ctx.platform,
        ctx.engine.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "(project self)".into()),
        ctx.exe, ctx.out.display(), ctx.orientation
    ));

    let result = (|| -> Result<(), String> {
        if ctx.src.as_os_str().is_empty() || !ctx.src.exists() {
            return Err(format!("source dir not found: {}", ctx.src.display()));
        }
        if ctx.out.as_os_str().is_empty() {
            return Err("output dir is empty".to_string());
        }
        patch_godot_js(&mut ctx)?;
        provide_wasm(&mut ctx)?;
        copy_assets(&mut ctx)?;
        prune_engine(&mut ctx)?;
        emit_runtime(&mut ctx)?;
        write_game_json(&mut ctx)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            let label = if ctx.platform == "tiktok" { "Douyin" } else { "WeChat" };
            ctx.log(format!("=== Done. Import the output dir into {} DevTools (MiniGame). ===", label));
            if ctx.engine.is_none() {
                ctx.log("WARNING: using the project's own WASM (likely has wasm-eh → CompileError on device).");
                ctx.log("Provide an EH-free engine dir (godot.js + godot.wasm.br) for real-device builds.");
            }
            AdaptReport { ok: true, logs: ctx.logs, error: None }
        }
        Err(e) => {
            ctx.log(format!("ERROR: {}", e));
            AdaptReport { ok: false, logs: ctx.logs, error: Some(e) }
        }
    }
}
