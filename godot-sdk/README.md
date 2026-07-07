# MiniGameSDK — Godot 跨平台小游戏能力集成包

把「微信 / 抖音都支持的能力」（登录 + 用户信息、激励视频 + 插屏广告、分享转发、
系统能力：震动 / 剪贴板 / KV 存储 / 系统信息）统一封装，暴露给 Godot 使用。

运行时 JS 适配层是 `tools/<platform>-templates/minigame-sdk.js`，它在启动时把
统一接口挂到 `window.MiniGameSDK`（小游戏里 `window === GameGlobal`）。本包提供
**三种**让 Godot 调到它的方式，按脚本语言选用：

| 方式 | 适用 | 是否需重编引擎 | 调用形态 |
|---|---|---|---|
| **A. C++ module** | 需要真正的 C++ 层接口 | 是（自编引擎） | `MiniGameSDK` 引擎单例（C++/GDScript 均可） |
| **B. GDScript autoload** | 只想 GDScript 调、零编译 | 否 | Autoload 节点 `MiniGameSDK`（信号回结果） |
| **C. GodotJS (quickjs-ng/v8)** | 用 TS/JS 写游戏逻辑 | 否 | Autoload 节点 `MiniGameSDK`（Promise 回结果） |

> 三种方式对脚本暴露的 API 名一致，可无缝切换（异步结果：A/B 用信号、C 用 Promise）。
> 底层都走 emscripten 的 `godot_js_wrapper_*` / 自定义 `godot_js_mg_*` 导入函数，
> **不使用 `eval`**，因此在禁用 `eval` 的小游戏环境可用。

---

## 目录

```
tools/godot-sdk/
├── modules/minigame_sdk/           # 方式 A：引擎 C++ module（拷进自编引擎的 modules/）
│   ├── config.py                   #   can_build/configure
│   ├── SCsub                       #   Web 平台注册 JS library
│   ├── register_types.h/.cpp       #   注册 MiniGameSDK 单例（SCENE 级）
│   ├── minigame_sdk.h/.cpp         #   单例实现（extern "C" 调 JS）
│   └── js/library_godot_minigame.js#   emscripten JS library（godot_js_mg_* → window.MiniGameSDK）
├── gdscript/minigame_sdk.gd        # 方式 B：纯 GDScript autoload（JavaScriptBridge.get_interface）
└── godotjs/                        # 方式 C：GodotJS（TS/JS）autoload
    ├── minigame_sdk.ts             #   JavaScriptBridge.get_interface + Promise 封装
    └── README.md                   #   GodotJS 集成说明
```

---

## 方式 A：C++ module（自编引擎）

1. 复制模块到引擎源码树：
   ```
   cp -r tools/godot-sdk/modules/minigame_sdk  <godot-source>/modules/
   ```
2. 编译时用 `minigame=yes` **显式开启**（默认 `no`，不加则不编入引擎）。Web 模板示例
   （无 EH/SIMD 的小游戏兼容配置）：
   ```
   scons platform=web target=template_release minigame=yes
   ```
   模块 `config.py` 通过 `get_opts` 注册了该选项，`can_build` 读 `env["minigame"]`
   决定是否编译；SCsub 会在 `platform == "web"` 时通过
   `env.AddJSLibraries(["js/library_godot_minigame.js"])` 把桥接 JS 链接进去。
3. 用该引擎导出 Web，再跑 `adapt-minigame.js`。运行时 `minigame-sdk.js` 提供
   `window.MiniGameSDK`，C++ 单例通过 `godot_js_mg_*` 导入函数调用它。
4. GDScript 直接用引擎单例（无需 autoload）：
   ```gdscript
   MiniGameSDK.configure({ "rewardedAdUnitId": "adunit-xxxx" })
   MiniGameSDK.login_completed.connect(func(r): print("code=", JSON.parse_string(r)))
   MiniGameSDK.login()
   ```
   > C++ 单例的异步结果通过信号回传，参数是 **JSON 字符串**（`{ok,data,err}`）。

C++ 侧直接调用示例：
```cpp
MiniGameSDK::get_singleton()->show_rewarded_video("adunit-xxxx");
// 结果连接到信号 rewarded_video_closed(String result_json)
```

非 Web 平台（编辑器/桌面调试）：所有调用是安全空操作，同步 getter 返回
`{"ok":false,...,"err":"not a mini-game platform"}`，异步接口也会 deferred 发一个
失败信号，方便本地跑通逻辑。

---

## 方式 B：GDScript autoload（零编译）

1. 把 `gdscript/minigame_sdk.gd` 放进项目（如 `res://autoload/minigame_sdk.gd`）。
2. 项目设置 → Autoload 注册，名字 **MiniGameSDK**。
   > 若同时用了方式 A 的 C++ 单例，二者同名——**只启用其一**。
3. 用法与方式 A 完全一致，但异步结果信号参数已是**解析好的 Dictionary**：
   ```gdscript
   MiniGameSDK.configure({ "rewardedAdUnitId": "adunit-xxxx" })
   MiniGameSDK.rewarded_video_closed.connect(func(r: Dictionary):
       if r.ok and r.data.isEnded: _grant_reward())
   MiniGameSDK.show_rewarded_video()
   ```

---

## 方式 C：GodotJS（TS/JS，零编译）

用 GodotJS（quickjs-ng / v8）写游戏逻辑时使用。详见
[`godotjs/README.md`](./godotjs/README.md)。异步接口返回 **Promise**（其它两种是信号）：

```ts
const sdk = MiniGameSDK.instance!;
sdk.configure({ rewardedAdUnitId: "adunit-xxxx" });
const ad = await sdk.show_rewarded_video();
if (ad.ok && ad.data.isEnded) grantReward();
```

> GodotJS 脚本在引擎内嵌 JS 运行时，够不到宿主 `window.MiniGameSDK`，但同样通过
> `JavaScriptBridge.get_interface` 打通（C++ 单例桥接），不用 `eval`。

---

## API 一览（三种方式一致）

| 方法 | 类型 | 结果 |
|---|---|---|
| `configure(cfg)` | 同步 | 配置广告位等（`rewardedAdUnitId` / `interstitialAdUnitId`） |
| `get_platform()` | 同步 | `"wechat"` / `"douyin"` / `"unknown"` |
| `login()` | 异步 | 信号 `login_completed` → `{ code }` |
| `get_user_profile(desc)` | 异步 | 信号 `user_profile_completed` → `{ userInfo }` |
| `show_rewarded_video(ad_unit_id="")` | 异步 | 信号 `rewarded_video_closed` → `{ isEnded }` |
| `show_interstitial(ad_unit_id="")` | 异步 | 信号 `interstitial_closed` → `{ shown }` |
| `share(title, image_url, query)` | 异步 | 信号 `share_completed` |
| `show_share_menu()` | 同步 | — |
| `vibrate(type="short")` | 同步 | `"short"` / `"long"` |
| `set_clipboard(text)` | 异步 | 信号 `clipboard_written` |
| `get_clipboard()` | 异步 | 信号 `clipboard_read` → `{ text }` |
| `storage_set(key, value)` | 同步 | 返回结果（A: JSON 串 / B: Dictionary） |
| `storage_get(key)` | 同步 | `{ value }` |
| `storage_remove(key)` | 同步 | — |
| `get_system_info()` | 同步 | 平台原始 systemInfo |

结果统一结构：`{ "ok": bool, "data": {...}, "err": "..." }`。
异步结果传递方式：**A**（C++）用信号回 JSON 串、**B**（GDScript）用信号回 Dictionary、
**C**（GodotJS）用 `Promise` resolve 对象。

---

## 广告位注意
`adUnitId` 需在各平台后台申请（微信 / 抖音格式不同）。广告实例按 `adUnitId` 缓存复用
（平台要求）。未配置且未传入时返回 `no ...AdUnitId configured` 错误。

## 登录说明
`login()` 只返回临时 `code`，需业务后端用平台密钥换取 `openid`/`session_key`。
适配层不做换取，避免把密钥放进客户端。
