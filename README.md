# Godot Web 导出 → 微信 / 抖音小游戏 适配工具

把一份 **Godot 4.x Web 导出**（`build.js` / `build.wasm` / `build.pck` + 音频 worklet）就地改造成可导入**微信 / 抖音**开发者工具的**小游戏**工程。

- 引擎版本（本项目）：Godot **4.6.4**（pck），运行引擎用无 EH 兼容构建
- 核心脚本：[`tools/adapt-minigame.js`](./adapt-minigame.js)，支持 `--platform wechat|tiktok` 与 `--out`
- 跨平台能力 SDK（登录/广告/分享/系统能力）：见 [`tools/godot-sdk/`](./godot-sdk/README.md)
- 浏览器环境适配层参考并复用了社区项目 [AnranS/godot_for_minigame](https://github.com/AnranS/godot_for_minigame)（MIT）

---

## 一、做了什么（本次适配实现）

| 目标 | 实现 |
|---|---|
| **引擎 WASM 压缩 + 分包** | 默认模式：`build.wasm` 22MB → Brotli → `engine/build.wasm.br` 4.7MB。引擎替换模式：直接拷贝 EH-free 的 `godot.wasm.br`（6.0MB）。均放入 `engine/` **分包**，启动时 `wx.loadSubpackage('engine')` 再下载。 |
| **pck 加载** | `build.pck` → `engine/build.zip`（微信 `FileSystemManager` 拒绝读取 `.pck` 扩展名，必须改名）；`fetch.js` 用 `getFileSystemManager().readFile` 读本地字节。 |
| **WASM 加载走 WXWebAssembly** | `adapter.js` 把 `WebAssembly.instantiate*` 路由到 `WXWebAssembly.instantiate("engine/xxx.wasm.br")`；`fetch.js` 对 `.wasm` 请求返回空 stub，避免引擎去 fetch。 |
| **替代 IndexedDB（wxFileSystem）** | `wxfs-adapter.js` 暴露 `__wxfs.restore/flush`，映射 `/userfs ↔ wx.env.USER_DATA_PATH/user`；胶水层 `GodotFS.init`（还原）与 `GodotFS.sync`（刷盘）被改写为调用 `__wxfs`；loader 额外做定时刷盘 + `wx.onHide` 兜底。 |
| **浏览器环境适配** | 复用 `adapter.js`（window/document/canvas/WebGL/WebAudio）、`fetch.js`（fetch/XHR）。 |
| **胶水层补丁** | 对 `build.js`/`godot.js` 打 8 处补丁（见「五、原理」），产出 `js/libs/godot.js`。 |
| **音频进度兼容** | `audio-compat.js`：包装 `wx.createWebAudioContext` 注入 `estimatePlaybackPosition()`；`wx.onShow` 恢复挂起的 AudioContext（iOS 后台恢复）；`__installSoundPosBridge` 由 loader 用 `engine.rtenv` 注入。 |
| **工程配置** | 生成 `game.json`（`engine`/`subpacks` 分包 + `workers`）；`project.config.json` 增加 `packOptions.ignore` 排除 `game/`、`tools/`、`main.js`，避免原始 36MB 导出被重复打包。 |

---

## 二、必须知道的限制

1. **标准 Web 导出的 WASM 带异常处理（wasm-eh），微信无法编译。**
   `build.wasm` 含 EH（Tag 节区），`WXWebAssembly.compile` 会报
   `CompileError: unexpected section <Exception>`——**连开发者工具模拟器默认也拒绝**，真机同样不支持。
   → 必须使用**无 EH / 无 SIMD 的小游戏兼容引擎**（`godot.js` + `godot.wasm.br`），用 `--engine` 传入。

2. **引擎与 pck 必须同 Godot 版本（同一 patch）。**
   UID 索引表由编辑器在导出时生成，不同 patch 版本（如 4.6.1 vs 4.6.4）的哈希不兼容，
   报 `Unrecognized UID: ... (resource_uid.cpp:212)`。必须用**同 Godot 版本号**的编辑器导出 pck，并用该版本的引擎模板编译 wasm。

3. **`FileSystemManager` 不允许读取 `.pck`。** 已自动改名为 `engine/build.zip`（微信/抖音均按 `.zip` 处理）。

4. **总包体积 ≈ 19–20MB**（`build.zip` 13.5MB + `godot.wasm.br` 6.0MB + 主包 ~0.4MB），
   逼近**未开通虚拟支付的 20MB 上限**。超限时：开通虚拟支付（上限 30MB），或把 pck 改为 CDN 下载（首次下载写本地再读）。
   > 微信小游戏：主包 ≤ 4MB；普通分包无单包大小限制；总包 ≤ 20MB（未开虚拟支付）/ 30MB（已开）。

5. **音频为尽力而为。** 走微信 WebAudio；position worklet 已禁用（保留主输出 Worklet 高性能）。
   `Module._JS_Sound_GetPlaybackPos` / `Module.audioChannels` 是 **Unity WebGL 风格**桥接，**标准 Godot 不会调用**，对当前引擎是无害空操作（已做防御性 guard），仅供自编引擎使用。

6. **需要 WebGL2**（Godot 4 Compatibility 渲染器 = GLES3/WebGL2），请使用较新基础库（≥ 3.2）。

7. **开发者工具 `access_token expired` 等报错**属登录/游客态，与本适配无关。

8. **微信禁止 `eval` 和 `new Function()`。** Godot jsbb 绑定的 `CompileFunctionSource` 依赖动态编译，会报 `eval is not a function`。这是引擎 C++ 源码层问题，需自编引擎时替换为 MinigameBuilder 或预编译绑定（参考 godot_for_minigame）。

9. **Emscripten 未导出的属性会 `abort()`。** `rtenv.FS` 是 getter，访问未导出的 `FS` 会直接中止进程。loader 已改用 `mod["FS"]` 方括号安全探测。若自编引擎开启了 `FORCE_FILESYSTEM` 则 `FS` 可用，wxFS 会自动生效。

---

## 三、tools 目录结构

```
tools/
├── adapt-minigame.js          # 主脚本（--platform / --out；打补丁 + 压缩/拷贝 + 生成运行时 + 写 game.json）
├── wechat-templates/          # 微信平台运行时模板
│   ├── adapter.js             # [MIT 复用] 浏览器环境 polyfill；WASM 候选路径由脚本改写
│   ├── audio-compat.js        # 音频进度估算 + iOS 恢复 + sound-pos 桥接（入口首个 import）
│   ├── fetch.js               # [MIT 复用] fetch/XHR polyfill；本地文件读取；.wasm stub
│   ├── game.js                # 入口：按序 import audio-compat/adapter/fetch/wxfs/minigame-sdk/loader
│   ├── game.json              # 微信清单模板（subpackages + workers 对象；{{{ORIENTATION}}} 占位）
│   ├── image_loader.js        # [MIT 复用] waitForImage
│   ├── loader.js              # 加载画面 + 启动引擎 + wxFS 还原/同步 + 音频桥接
│   ├── minigame-sdk.js        # 跨平台能力 SDK（wx/tt 统一）→ window.MiniGameSDK
│   ├── wxfs-adapter.js        # /userfs ↔ USER_DATA_PATH 同步（替代 IndexedDB）
│   └── worker/position_reporting.js
├── tiktok-templates/          # 抖音平台运行时模板（运行时文件同微信，跨平台 wx||tt）
│   ├── ...（同上）
│   └── game.json              # 抖音清单模板（subPackages 驼峰 + workers 字符串 + enableIOSHighPerformanceMode）
└── godot-sdk/                 # 给「自编引擎」的能力集成包（C++ module + JS library + GDScript autoload）
    ├── modules/minigame_sdk/  # C++ 引擎模块（拷进 <godot-source>/modules/）
    ├── gdscript/minigame_sdk.gd  # 纯 GDScript autoload（零编译方案）
    └── README.md              # 集成说明与 API 一览
```

> 运行时文件（adapter/fetch/loader/audio-compat/wxfs-adapter/image_loader/game.js/minigame-sdk/worker）
> 内部统一用 `_api = wx || tt`，微信/抖音两套模板内容一致，**差异只在 `game.json`**：
> - 微信：`subpackages`（或驼峰）、`workers` 为对象、`iOSHighPerformance`
> - 抖音：`subPackages`（**驼峰**）、`workers` 为**字符串**目录、`enableIOSHighPerformanceMode`
>
> `tools/` 已被 `project.config.json → packOptions.ignore` 排除，不会打进小游戏包。
> 兼容引擎文件（`godot.js` + `godot.wasm.br`）**不随仓库携带**，由使用者自行提供并用 `--engine` 指向。

---

## 四、用法

```bash
# 微信（默认平台），引擎替换模式（推荐，可真机运行）：就地产出到工程根
node tools/adapt-minigame.js --platform wechat --engine <你的引擎目录> --exe build --src game --orientation portrait

# 抖音：产出到独立目录 dist/tiktok（避免与微信 game.json 冲突）
node tools/adapt-minigame.js --platform tiktok --out dist/tiktok --engine <你的引擎目录> --exe build --src game --orientation landscape

# 默认模式（用工程自带 wasm，仅当该 wasm 本身无 EH 时可用）
node tools/adapt-minigame.js --exe build --src game
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--platform <p>` | `wechat` | 目标平台：`wechat` / `tiktok`（抖音）。决定用哪套 `*-templates` 和 `game.json`。 |
| `--out <dir>` | 工程根 | 输出目录（相对工程根）。指向独立目录时会额外生成最小 `project.config.json`，可直接导入。 |
| `--engine <dir>` | 空 | 兼容引擎目录，需含 `godot.js` + `godot.wasm.br`（无 EH/SIMD）。留空则用工程自带 `<exe>.js/.wasm`。 |
| `--exe <name>` | `build` | 导出基名（对应 `<exe>.js/.wasm/.pck`）。 |
| `--src <dir>` | `game` | 存放 Web 导出文件的目录（相对工程根）。 |
| `--orientation <o>` | `portrait` | 写入 `game.json` 屏幕方向，可选 `portrait` / `landscape`。 |

- 两个平台的 `game.json`/API 不能共存于同一目录：微信就地产出、抖音用 `--out` 指到独立目录。
- 脚本**幂等**，可反复运行；每次会 prune `engine/` 内的过期文件。
- 运行前置：Node.js ≥ 16（用内置 zlib 做 Brotli）。
- 运行后：对应平台开发者工具 → 小游戏 → 导入，目录选**输出目录**；首次到「详情 → 本地设置」按需开启 WASM 实验特性。

---

## 五、原理

### 5.1 为什么需要适配
Godot Web 导出面向浏览器，依赖 DOM/`window`/`document`/WebGL/WebAudio/`fetch`/IndexedDB；而微信小游戏没有这些，且大 WASM 只能通过 `WXWebAssembly.instantiate(path)` 从**包内文件路径**加载（不能用任意 buffer）。因此需要：环境 polyfill + WXWebAssembly 路由 + 本地文件读取 + IndexedDB 替代 + 分包。

### 5.2 脚本流水线（`adapt-minigame.js`）
1. **打补丁**：`<engine>.js` → `js/libs/godot.js`
2. **提供 WASM**：拷贝兼容 `godot.wasm.br`（`--engine`）或 Brotli 压缩自带 `build.wasm` → `engine/<base>.wasm.br`
3. **拷贝资源**：`build.pck` → `engine/build.zip`（改扩展名）；音频 worklet；启动图 → `images/logo.png`
4. **生成运行时层**：`adapter.js` / `audio-compat.js` / `fetch.js` / `wxfs-adapter.js` / `game.js` / `js/loader.js` / `js/image_loader.js` / `js/worker/position_reporting.js` + 分包占位 `game.js`
5. **写 `game.json`**（分包 + workers）

### 5.3 胶水层 8 处补丁（对 `build.js` / `godot.js`）
1. **preamble**：文件头声明 `document/window/navigator` 指向 `GameGlobal.__adapter.*`
2. **postamble**：把 `Engine` / `Godot` 挂到 `GameGlobal`，供 loader 取用
3. **canvas.parentElement guard**：`parentElement` 为空时兜底到 `document.body`
4. **GL.createContext fallback**：canvas 为空 / `getContext` 失败时回退到 `GameGlobal.canvas` 或缓存 context
5. **connectPositionWorklet neutralise**：AudioWorkletNode 无法连原生音频节点，改为仅 `start()`（保留主输出 Worklet）
6. **isWebGLAvailable guard**：加 try/catch，默认返回 true
7. **wxFS restore（GodotFS.init）**：去掉 IDBFS 挂载，改为用 `__wxfs.restore` 从 wx 磁盘同步还原
8. **wxFS flush（GodotFS.sync）**：改为用 `__wxfs.flush` 刷盘到 wx 磁盘

> 补丁基于精确字符串匹配、幂等；命中情况会在运行日志中逐条打印（`✓ / = / !`）。

### 5.4 启动流程（运行时）
```
game.js
 └─ import audio-compat.js   // 必须先于 adapter：adapter 在 import 时就缓存了 wx.createWebAudioContext
 └─ import adapter.js        // 装 window/document/canvas/WebGL/WebAudio/WebAssembly(→WXWebAssembly)
 └─ import fetch.js          // 装 fetch/XHR；.wasm 返回 stub，本地文件走 getFileSystemManager
 └─ import wxfs-adapter.js   // 装 GameGlobal.__wxfs
 └─ import minigame-sdk.js   // 装 window.MiniGameSDK（登录/广告/分享/系统能力）
 └─ import js/loader.js  (→ import js/libs/godot.js 定义 Engine/Godot)
 └─ new Loader().load():
      1. 加载图片 → 显示加载画面
      2. wx.loadSubpackage('engine')            // 下载 wasm.br + build.zip + worklet
      3. new Engine(); engine.startGame({ canvas, executable:"engine/godot", mainPack:"engine/build.zip" })
           └─ instantiateWasm → WXWebAssembly.instantiate("engine/godot.wasm.br")
           └─ 读 pck：fetch("engine/build.zip") → getFileSystemManager.readFile → copyToFS
           └─ GodotFS.init → __wxfs.restore("/userfs")   // 从 wx 磁盘还原存档
      4. __installSoundPosBridge(engine.rtenv)   // 音频位置桥接（Godot 下为无害空操作）
      5. setInterval + wx.onHide → __wxfs.flush("/userfs")   // 定时/切后台刷盘
```

### 5.5 输出结构（工程根）
```
├── game.js / game.json / project.config.json / project.private.config.json
├── adapter.js / audio-compat.js / fetch.js / wxfs-adapter.js / minigame-sdk.js
├── engine/                     # 分包
│   ├── godot.wasm.br  (或 build.wasm.br)   # 引擎 WASM（EH-free）
│   ├── build.zip                            # pck（改名）
│   ├── godot.audio.worklet.js / godot.audio.position.worklet.js
│   └── game.js                              # 分包占位
├── subpacks/game.js            # 预留分包占位
├── js/
│   ├── libs/godot.js           # 打补丁后的引擎胶水
│   ├── loader.js / image_loader.js
│   └── worker/position_reporting.js
├── images/logo.png             # 加载画面 / 启动图
├── game/                       # 原始 Web 导出（源，已被 ignore 不打包）
└── tools/                      # 本工具（已被 ignore 不打包）
```

---

## 六、跨平台能力 SDK（登录 / 广告 / 分享 / 系统能力）

运行时适配层 `minigame-sdk.js` 把微信/抖音都支持的能力统一成一套接口，挂到
`window.MiniGameSDK`。Godot 侧有三种调用方式（详见 [`tools/godot-sdk/README.md`](./godot-sdk/README.md)）：

- **C++ module**（`tools/godot-sdk/modules/minigame_sdk/`）：拷进自编引擎 `modules/`，
  Web 平台经 `AddJSLibraries` 链接桥接 JS（`godot_js_mg_*`），暴露 `MiniGameSDK` 引擎单例，
  C++ / GDScript 均可调（信号回 JSON 串）。
- **GDScript autoload**（`tools/godot-sdk/gdscript/minigame_sdk.gd`）：零编译，
  用 `JavaScriptBridge.get_interface("MiniGameSDK")` 调用（信号回 Dictionary）。
- **GodotJS autoload**（`tools/godot-sdk/godotjs/minigame_sdk.ts`）：用 TS/JS（quickjs-ng/v8）
  写逻辑时用，同样走 `JavaScriptBridge`，异步接口返回 Promise。

三者 API 一致，且**都不使用 `eval`**（走 `godot_js_wrapper_*`/自定义导入函数），
在禁用 `eval` 的小游戏环境可用。接口：`login` / `get_user_profile` /
`show_rewarded_video` / `show_interstitial` / `share` / `show_share_menu` /
`vibrate` / `set/get_clipboard` / `storage_set/get/remove` / `get_system_info` /
`configure`。异步结果统一为 `{ ok, data, err }`（C++ 版回传 JSON 串，GDScript 版回传 Dictionary）。

---

## 七、复用到新项目
1. 把 Web 导出放到某目录（如 `game/`），文件名基为 `<exe>`（如 `build`）。
2. 准备一份同 major.minor 的**无 EH 兼容引擎**（`godot.js` + `godot.wasm.br`）。
3. 拷贝 `tools/` 目录到新工程，运行（按平台，抖音建议 `--out` 到独立目录）：
   ```bash
   node tools/adapt-minigame.js --platform wechat --engine <引擎目录> --exe <基名> --src <导出目录> --orientation <portrait|landscape>
   node tools/adapt-minigame.js --platform tiktok --out dist/tiktok --engine <引擎目录> --exe <基名> --src <导出目录>
   ```
4. 需要平台能力（登录/广告/分享等）时，集成 `tools/godot-sdk/`（C++ module 或 GDScript autoload）。
5. 确认 `project.config.json` 的 `packOptions.ignore` 排除了源导出目录与 `tools/`。

---

## 八、来源与许可
- `adapter.js` / `fetch.js` / `image_loader.js` / `worker/position_reporting.js` 复用并改编自 [AnranS/godot_for_minigame](https://github.com/AnranS/godot_for_minigame)（MIT）。
- `wxfs-adapter.js` / `audio-compat.js` 基于使用者提供的适配代码整理。
