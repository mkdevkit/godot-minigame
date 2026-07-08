<script setup>
import { reactive, ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const form = reactive({
  platform: "wechat",
  src: "",
  engine: "",
  exe: "build",
  out: "",
  orientation: "portrait",
});

const running = ref(false);
const logs = ref([]);
const ok = ref(null); // null | true | false

const canRun = computed(() => form.src && form.out && form.exe && !running.value);

async function pickDir(field) {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === "string") {
    form[field] = selected;
    // Convenience: default output next to src the first time.
    if (field === "src" && !form.out) {
      form.out = selected.replace(/[\\/]+$/, "") + "-minigame";
    }
  }
}

async function run() {
  running.value = true;
  ok.value = null;
  logs.value = ["开始适配…"];
  try {
    const report = await invoke("run_adapt", {
      options: {
        platform: form.platform,
        src: form.src,
        engine: form.engine,
        exe: form.exe,
        out: form.out,
        orientation: form.orientation,
      },
    });
    logs.value = report.logs;
    ok.value = report.ok;
    if (!report.ok && report.error) logs.value.push("失败：" + report.error);
  } catch (e) {
    ok.value = false;
    logs.value.push("调用失败：" + (e?.message || String(e)));
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <main class="wrap">
    <header>
      <h1>Godot Web 导出 → 小游戏打包工具</h1>
      <p class="sub">
        选择 Godot Web 导出目录与（可选的）无 EH 兼容引擎，一键生成微信 / 抖音小游戏工程。
        模板已内置进本程序，无需 Node。
      </p>
    </header>

    <section class="card">
      <div class="row">
        <label>目标平台</label>
        <div class="seg">
          <button :class="{ active: form.platform === 'wechat' }" @click="form.platform = 'wechat'">微信</button>
          <button :class="{ active: form.platform === 'tiktok' }" @click="form.platform = 'tiktok'">抖音</button>
        </div>
      </div>

      <div class="row">
        <label>导出目录 (src) <span class="req">*</span></label>
        <div class="pick">
          <input v-model="form.src" placeholder="含 build.js / build.wasm / build.pck 的目录" />
          <button @click="pickDir('src')">选择…</button>
        </div>
      </div>

      <div class="row">
        <label>兼容引擎目录</label>
        <div class="pick">
          <input v-model="form.engine" placeholder="可选：含 godot.js + godot.wasm.br（无 EH）。留空则用导出自带 wasm" />
          <button @click="pickDir('engine')">选择…</button>
        </div>
      </div>

      <div class="row two">
        <div>
          <label>导出基名 (exe) <span class="req">*</span></label>
          <input v-model="form.exe" placeholder="build" />
        </div>
        <div>
          <label>屏幕方向</label>
          <div class="seg">
            <button :class="{ active: form.orientation === 'portrait' }" @click="form.orientation = 'portrait'">竖屏</button>
            <button :class="{ active: form.orientation === 'landscape' }" @click="form.orientation = 'landscape'">横屏</button>
          </div>
        </div>
      </div>

      <div class="row">
        <label>输出目录 (out) <span class="req">*</span></label>
        <div class="pick">
          <input v-model="form.out" placeholder="生成的小游戏工程目录" />
          <button @click="pickDir('out')">选择…</button>
        </div>
      </div>

      <div class="actions">
        <button class="run" :disabled="!canRun" @click="run">
          {{ running ? "适配中…" : "开始适配" }}
        </button>
        <span v-if="ok === true" class="ok">✓ 完成</span>
        <span v-if="ok === false" class="fail">✗ 失败</span>
      </div>
    </section>

    <section class="card logs" v-if="logs.length">
      <div class="log-head">日志</div>
      <pre>{{ logs.join("\n") }}</pre>
    </section>
  </main>
</template>
