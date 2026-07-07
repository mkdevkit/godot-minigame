/**
 * 微信小游戏文件系统适配器（替代 IndexedDB）
 *
 * 映射 /user -> wx.env.USER_DATA_PATH
 * 暴露 GameGlobal.__wxfs = { restore, flush, ... }
 *
 * 适配自用户提供的 IndexedDB 替代方案。
 */
(function (global) {
  const _api = typeof wx !== "undefined" ? wx : tt;
  const fsMgr = _api.getFileSystemManager();
  const root = _api.env.USER_DATA_PATH + "/user/";

  function _mkdirRecursive(dirPath) {
    if (!dirPath || dirPath === "/") return;
    try { fsMgr.accessSync(dirPath); } catch (_e) {
      const parent = dirPath.split("/").slice(0, -1).join("/");
      if (parent && parent !== dirPath) _mkdirRecursive(parent);
      try { fsMgr.mkdirSync(dirPath, true); } catch (_e2) { /* race */ }
    }
  }

  /**
   * 递归读取目录，返回 { [relPath]: ArrayBuffer }
   */
  function _readdirRecursive(base, rel) {
    rel = rel || "";
    const result = {};
    let entries;
    try { entries = fsMgr.readdirSync(base); } catch (_e) { return result; }
    for (const name of entries) {
      const full = base + "/" + name;
      const key = rel ? rel + "/" + name : name;
      try {
        const stat = fsMgr.statSync(full);
        if (stat.isDirectory()) {
          Object.assign(result, _readdirRecursive(full, key));
        } else {
          result[key] = fsMgr.readFileSync(full);
        }
      } catch (_e) { /* skip inaccessible */ }
    }
    return result;
  }

  /**
   * wx 磁盘 -> MEMFS 还原（启动时调用）
   */
  function restore(memRoot, FS) {
    if (!FS) { console.error("[wxfs] restore: FS not available"); return; }
    _mkdirRecursive(root);
    const files = _readdirRecursive(root.replace(/\/$/, ""));
    console.log("[wxfs] restoring", Object.keys(files).length, "files from", root);
    const parts = memRoot.replace(/\/$/, "").split("/").filter(Boolean);
    let cur = "/";
    for (const p of parts) {
      const next = cur === "/" ? "/" + p : cur + "/" + p;
      try { FS.stat(next); } catch (_e) { FS.mkdir(next); }
      cur = next;
    }
    for (const [fname, buf] of Object.entries(files)) {
      // FS.createDataFile expects a 'binary' encoding string for Uint8Array
      try { FS.createDataFile(memRoot, fname, buf, true, true); } catch (_e) {
        console.warn("[wxfs] skip", fname, _e.message);
      }
    }
  }

  /**
   * MEMFS -> wx 磁盘刷新（定期 / 隐藏时调用）
   */
  function flush(memRoot, FS) {
    if (!FS) { console.error("[wxfs] flush: FS not available"); return; }
    try { FS.stat(memRoot); } catch (_e) {
      console.log("[wxfs] flush: mem root not mounted yet, skip");
      return;
    }
    _mkdirRecursive(root);
    let list;
    try { list = FS.readdir(memRoot); } catch (_e) {
      console.warn("[wxfs] flush: readdir failed, probably not mounted yet");
      return;
    }
    for (const fname of list) {
      if (fname === "." || fname === "..") continue;
      const memPath = memRoot + "/" + fname;
      const localPath = root + fname;
      try {
        const stat = FS.stat(memPath);
        if (FS.isDir(stat.mode)) {
          _flushDir(memPath, localPath, FS);
        } else {
          const buf = FS.readFile(memPath, { encoding: "binary" });
          // Include null bytes to work around Emscripten truncation
          const out = new Uint8Array(buf.length);
          for (let i = 0; i < buf.length; i++) out[i] = (typeof buf[i] === "number") ? buf[i] : buf.charCodeAt(i);
          fsMgr.writeFileSync(localPath, out.buffer);
        }
      } catch (_e) {
        console.warn("[wxfs] flush skip", fname, _e.message || _e);
      }
    }
  }

  function _flushDir(memPath, localPath, FS) {
    _mkdirRecursive(localPath);
    let list;
    try { list = FS.readdir(memPath); } catch (_e) { return; }
    for (const fname of list) {
      if (fname === "." || fname === "..") continue;
      const subMem = memPath + "/" + fname;
      const subLocal = localPath + "/" + fname;
      try {
        const stat = FS.stat(subMem);
        if (FS.isDir(stat.mode)) {
          _flushDir(subMem, subLocal, FS);
        } else {
          const buf = FS.readFile(subMem, { encoding: "binary" });
          const out = new Uint8Array(buf.length);
          for (let i = 0; i < buf.length; i++) out[i] = (typeof buf[i] === "number") ? buf[i] : buf.charCodeAt(i);
          fsMgr.writeFileSync(subLocal, out.buffer);
        }
      } catch (_e) { /* skip inaccessible */ }
    }
  }

  // Export
  global.__wxfs = { restore, flush, root };
})(GameGlobal);
