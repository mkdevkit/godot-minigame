# MiniGameSDK — GodotJS（quickjs-ng / v8）集成

给用 **GodotJS**（TypeScript/JavaScript 脚本，底层 quickjs-ng 或 v8）写游戏逻辑的项目，
提供一个**不改引擎**的接口层，用法对齐 GDScript / C++ 版。

## 为什么能通

GodotJS 脚本跑在引擎内嵌的 JS 运行时（quickjs-ng），与宿主小游戏 JS 环境
（微信/抖音的 emscripten 层）是**两个隔离的 JS 引擎**，不能直接互访。
但 `JavaScriptBridge` 是 Godot 的 **C++ 单例**，两种脚本语言下都可用：

```
GodotJS(quickjs) ──▶ JavaScriptBridge (C++) ──▶ 宿主 window.MiniGameSDK
```

`window.MiniGameSDK` 由运行时适配层 `minigame-sdk.js` 注入。全程不使用 `eval`
（走 `godot_js_wrapper_*` 导入函数），在禁用 eval 的小游戏环境可用。

## 用法

1. 把 [`minigame_sdk.ts`](./minigame_sdk.ts) 加入 GodotJS 项目（若写纯 JS，去掉类型标注即可）。
2. 注册为 **Autoload**，名字建议 `MiniGameSDK`
   （与 C++ module / GDScript autoload 同名——三选一，只启用其一）。
3. 调用（异步接口返回 `Promise<{ok,data,err}>`，同步接口直接返回）：

```ts
const sdk = MiniGameSDK.instance!;

sdk.configure({ rewardedAdUnitId: "adunit-xxxx" });
console.log("platform:", sdk.get_platform());

// 登录
const r = await sdk.login();
if (r.ok) console.log("code =", r.data.code);

// 激励视频
const ad = await sdk.show_rewarded_video();
if (ad.ok && ad.data.isEnded) grantReward();

// 同步 KV
sdk.storage_set("hp", "100");
const hp = sdk.storage_get("hp"); // { ok, data:{ value }, err }
```

## 与其它两种方案的差异

| 项 | C++ module | GDScript autoload | **GodotJS** |
|---|---|---|---|
| 异步结果 | 信号（JSON 串） | 信号（Dictionary） | **Promise（对象）** |
| 是否改引擎 | 是 | 否 | 否 |
| 脚本语言 | C++/GDScript | GDScript | TS/JS |

API 名（`login` / `get_user_profile` / `show_rewarded_video` / `show_interstitial` /
`share` / `show_share_menu` / `vibrate` / `set_clipboard` / `get_clipboard` /
`storage_set` / `storage_get` / `storage_remove` / `get_system_info` / `configure` /
`get_platform`）与另外两种一致。

## 版本适配提示

不同 GodotJS 版本 API 略有差异，本实现只在两处依赖约定，若报错按此调整：

- **动态方法调用**：用 `jsobj.call("<jsMethod>", ...args)`（`JavaScriptObject`），
  不依赖代理对未知成员名的属性转发。
- **回调创建**：`JavaScriptBridge.create_callback(fn)` 直接传普通 JS 函数
  （GodotJS 会自动包装成 `Callable`）。回调统一收到一个「参数数组」，故取 `args[0]`。
