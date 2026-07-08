# godot-minigame-packer — 图形化打包工具（Tauri v2）

把 [`adapt-minigame.js`](../adapt-minigame.js) 的适配流程做成桌面 GUI：选目录、选平台、
一键生成微信 / 抖音小游戏工程。**适配逻辑用 Rust 原生重写**，运行时模板用 `rust-embed`
在编译期嵌入可执行文件，因此产物是**自包含单文件 exe**，运行时不依赖 Node，也不需要
外部模板文件。

## 技术栈

- 后端：Rust + Tauri v2（`src-tauri/`）
  - `src/adapt.rs` — adapt-minigame.js 的 Rust 移植（补丁 / Brotli / 拷贝 / game.json）
  - `rust-embed` 嵌入 `../wechat-templates` 与 `../tiktok-templates`
  - `brotli` crate 做 wasm 压缩（quality 11）
- 前端：Vue 3 + Vite（`src/`），`@tauri-apps/plugin-dialog` 选目录

## 目录

```
tools/packer/
├── package.json / vite.config.js / index.html
├── src/                     # Vue 前端
│   ├── main.js  App.vue  styles.css
└── src-tauri/               # Rust 后端
    ├── Cargo.toml  build.rs  tauri.conf.json
    ├── capabilities/default.json
    ├── icons/               # 需自行生成（见下）
    └── src/  main.rs  lib.rs  adapt.rs
```

## 前置依赖

- [Node.js](https://nodejs.org/)（仅**开发/构建**本工具时需要；打出的 exe 不需要）
- [Rust](https://rustup.rs/) 工具链
- Windows：**WebView2 运行时**（Win10/11 通常已自带；如缺失需安装一次）
- 见 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)

## 开发运行

```bash
cd tools/packer
npm install
npm run tauri dev
```

## 构建单文件 exe

1.（可选）替换图标：`src-tauri/icons/` 已内置一套占位蓝色图标，可直接构建。
   要换成自己的图标，用任意 1024×1024 PNG 重新生成：
   ```bash
   npm run tauri icon path/to/logo.png
   ```
2. 构建：
   ```bash
   npm run tauri build
   ```
3. 产物：
   - **单文件可执行**：`src-tauri/target/release/godot-minigame-packer.exe`
     —— 模板已编译进去，可直接拷走单独运行（依赖系统 WebView2）。
   - 安装包（可选）：`src-tauri/target/release/bundle/nsis/*.exe`。
     若只想要单文件，忽略安装包、直接用上面的 `.exe` 即可。

> Cargo release profile 已开 `opt-level="z" + lto + strip + panic=abort` 以减小体积。

## 使用

1. **导出目录 (src)**：选 Godot Web 导出所在目录（含 `build.js` / `build.wasm` / `build.pck`）。
2. **兼容引擎目录**（可选）：含 `godot.js` + `godot.wasm.br`（无 EH/SIMD 的小游戏兼容引擎）。
   留空则用导出自带的 wasm（多数标准 Web 导出带 wasm-eh，真机会 `CompileError`，仅供模拟器/占位）。
3. **导出基名 (exe)**：默认 `build`。
4. **屏幕方向**：竖屏 / 横屏。
5. **输出目录 (out)**：生成的小游戏工程目录（微信/抖音**分别用不同输出目录**，二者 game.json 不可共存）。
6. 点「开始适配」，日志区显示每一步；完成后用对应平台开发者工具导入**输出目录**。

## 与命令行脚本的关系

本工具与 [`tools/adapt-minigame.js`](../adapt-minigame.js) 功能等价，共享同一套
`wechat-templates` / `tiktok-templates` 模板（编译期嵌入）。两者的补丁点、产物结构一致；
命令行适合 CI/批处理，GUI 适合手动操作。

> 修改了模板后需**重新 `npm run tauri build`** 才会更新嵌入到 exe 里的内容。
