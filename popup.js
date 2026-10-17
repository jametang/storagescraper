(() => {
  "use strict";

  const HOT_RE =
    /session[_-]?id|sess(ion)?|token|auth|login|jwt|access[_-]?token|refresh[_-]?token|csrf|sid|userid|user[_-]?id|passport|credential|cookie|bearer|api[_-]?key/i;

  const state = {
    origin: "",
    tabUrl: "",
    items: [],
    activeTab: "all",
    query: "",
    hotOnly: false,
    collapsedGroups: new Set(),
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    origin: $("origin"),
    search: $("search"),
    clearSearch: $("btnClearSearch"),
    hotOnly: $("hotOnly"),
    list: $("list"),
    status: $("status"),
    summary: $("summary"),
    toast: $("toast"),
    refresh: $("btnRefresh"),
    copyAll: $("btnCopyAll"),
    counts: {
      all: $("countAll"),
      localStorage: $("countLocal"),
      sessionStorage: $("countSession"),
      cookies: $("countCookies"),
      indexedDB: $("countIdb"),
    },
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      els.toast.hidden = true;
    }, 1400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("已复制");
    }
  }

  function isHot(key, value = "") {
    return HOT_RE.test(key) || HOT_RE.test(String(value).slice(0, 200));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const q = escapeHtml(query);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return safe.replace(re, '<mark class="mark">$1</mark>');
  }

  function formatValue(value) {
    if (value == null) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    const str = String(value);
    if (
      (str.startsWith("{") && str.endsWith("}")) ||
      (str.startsWith("[") && str.endsWith("]"))
    ) {
      try {
        return JSON.stringify(JSON.parse(str), null, 2);
      } catch {
        /* keep raw */
      }
    }
    return str;
  }

  function previewValue(value) {
    const s = formatValue(value);
    return s.length > 180 ? s.slice(0, 180) + "…" : s;
  }

  /** Injected into page: read localStorage + sessionStorage */
  function scrapeWebStorage() {
    function dump(storage) {
      const out = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          out.push({ key, value: storage.getItem(key) });
        }
      } catch (e) {
        return { error: String(e) };
      }
      return { items: out };
    }
    return {
      localStorage: dump(localStorage),
      sessionStorage: dump(sessionStorage),
    };
  }

  /** Injected into page: enumerate IndexedDB databases & sample records */
  async function scrapeIndexedDB() {
    const result = { databases: [], items: [], error: null };

    function requestToPromise(req) {
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IDB request failed"));
      });
    }

    try {
      let names = [];
      if (typeof indexedDB.databases === "function") {
        const dbs = await indexedDB.databases();
        names = (dbs || [])
          .map((d) => d && d.name)
          .filter(Boolean);
      }

      if (!names.length) {
        return result;
      }

      result.databases = names;

      for (const dbName of names.slice(0, 12)) {
        let db;
        try {
          db = await new Promise((resolve, reject) => {
            const open = indexedDB.open(dbName);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error || new Error("open failed"));
            open.onblocked = () => reject(new Error("open blocked"));
            // Don't upgrade — just open existing
            open.onupgradeneeded = () => {};
          });
        } catch (e) {
          result.items.push({
            key: `[${dbName}]`,
            value: `无法打开: ${e.message || e}`,
            meta: { db: dbName },
          });
          continue;
        }

        const storeNames = Array.from(db.objectStoreNames || []);
        for (const storeName of storeNames.slice(0, 20)) {
          try {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const allKeys = await requestToPromise(store.getAllKeys(null, 30));
            const allVals = await requestToPromise(store.getAll(null, 30));
            const count = await requestToPromise(store.count());

            for (let i = 0; i < allKeys.length; i++) {
              const k = allKeys[i];
              const v = allVals[i];
              let keyStr;
              try {
                keyStr = typeof k === "object" ? JSON.stringify(k) : String(k);
              } catch {
                keyStr = String(k);
              }
              result.items.push({
                key: `${dbName} / ${storeName} / ${keyStr}`,
                value: v,
                meta: {
                  db: dbName,
                  store: storeName,
                  count,
                },
              });
            }

            if (count > allKeys.length) {
              result.items.push({
                key: `${dbName} / ${storeName} / …`,
                value: `共 ${count} 条，已展示前 ${allKeys.length} 条`,
                meta: { db: dbName, store: storeName, count },
              });
            }
          } catch (e) {
            result.items.push({
              key: `${dbName} / ${storeName}`,
              value: `读取失败: ${e.message || e}`,
              meta: { db: dbName, store: storeName },
            });
          }
        }
        try {
          db.close();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      result.error = String(e.message || e);
    }
    return result;
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function canInject(url) {
    if (!url) return false;
    return /^(https?|http):/i.test(url) || url.startsWith("file:");
  }

  async function loadCookies(url) {
    try {
      const list = await chrome.cookies.getAll({ url });
      return list.map((c) => ({
        source: "cookies",
        key: c.name,
        value: c.value,
        meta: {
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: c.expirationDate,
          session: c.session,
        },
        hot: isHot(c.name, c.value),
      }));
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }

  async function loadPageData(tabId) {
    const [{ result: web }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeWebStorage,
    });

    let idb = { items: [], databases: [], error: null };
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: scrapeIndexedDB,
      });
      idb = result || idb;
    } catch (e) {
      idb.error = String(e.message || e);
    }

    return { web, idb };
  }

  function normalizeItems({ web, idb, cookies }) {
    const items = [];

    const pushStorage = (source, payload) => {
      if (!payload) return;
      if (payload.error) {
        items.push({
          source,
          key: `(error)`,
          value: payload.error,
          hot: false,
          meta: {},
        });
        return;
      }
      for (const row of payload.items || []) {
        items.push({
          source,
          key: row.key,
          value: row.value,
          hot: isHot(row.key, row.value),
          meta: {},
        });
      }
    };

    pushStorage("localStorage", web?.localStorage);
    pushStorage("sessionStorage", web?.sessionStorage);

    if (Array.isArray(cookies)) {
      items.push(...cookies);
    } else if (cookies?.error) {
      items.push({
        source: "cookies",
        key: `(error)`,
        value: cookies.error,
        hot: false,
        meta: {},
      });
    }

    if (idb?.error) {
      items.push({
        source: "indexedDB",
        key: `(error)`,
        value: idb.error,
        hot: false,
        meta: {},
      });
    }
    for (const row of idb?.items || []) {
      items.push({
        source: "indexedDB",
        key: row.key,
        value: row.value,
        hot: isHot(row.key, formatValue(row.value)),
        meta: row.meta || {},
      });
    }

    // Hot items first within each source later; overall sort: hot first then key
    items.sort((a, b) => {
      if (a.hot !== b.hot) return a.hot ? -1 : 1;
      return String(a.key).localeCompare(String(b.key));
    });

    return items;
  }

  function filteredItems() {
    const q = state.query.trim().toLowerCase();
    return state.items.filter((it) => {
      if (state.activeTab !== "all" && it.source !== state.activeTab) return false;
      if (state.hotOnly && !it.hot) return false;
      if (!q) return true;
      const hay = `${it.key}\n${formatValue(it.value)}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function updateCounts() {
    const base = state.hotOnly
      ? state.items.filter((i) => i.hot)
      : state.items;
    const withQuery = (arr) => {
      const q = state.query.trim().toLowerCase();
      if (!q) return arr;
      return arr.filter((it) =>
        `${it.key}\n${formatValue(it.value)}`.toLowerCase().includes(q)
      );
    };
    const pool = withQuery(base);
    els.counts.all.textContent = String(pool.length);
    for (const src of ["localStorage", "sessionStorage", "cookies", "indexedDB"]) {
      els.counts[src].textContent = String(
        pool.filter((i) => i.source === src).length
      );
    }
  }

  function sourceLabel(source) {
    return (
      {
        localStorage: "localStorage",
        sessionStorage: "sessionStorage",
        cookies: "Cookies",
        indexedDB: "IndexedDB",
      }[source] || source
    );
  }

  function metaLine(it) {
    if (it.source === "cookies" && it.meta) {
      const bits = [
        it.meta.domain,
        it.meta.path,
        it.meta.httpOnly ? "HttpOnly" : null,
        it.meta.secure ? "Secure" : null,
        it.meta.session ? "Session" : null,
      ].filter(Boolean);
      return bits.join(" · ");
    }
    if (it.source === "indexedDB" && it.meta?.store) {
      return `store: ${it.meta.store}${
        it.meta.count != null ? ` · ${it.meta.count} records` : ""
      }`;
    }
    return "";
  }

  function render() {
    updateCounts();
    const items = filteredItems();
    const q = state.query.trim();

    if (!items.length) {
      els.list.innerHTML = `<div class="empty">没有匹配的存储项</div>`;
      els.summary.textContent = `共 ${state.items.length} 项 · 显示 0`;
      return;
    }

    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.source)) groups.set(it.source, []);
      groups.get(it.source).push(it);
    }

    const order = ["localStorage", "sessionStorage", "cookies", "indexedDB"];
    const html = [];

    for (const source of order) {
      const rows = groups.get(source);
      if (!rows?.length) continue;
      const open =
        state.activeTab !== "all" || !state.collapsedGroups.has(source);
      html.push(`
        <section class="group ${open ? "open" : ""}" data-group="${source}">
          <button type="button" class="group-head" data-toggle="${source}">
            <span class="chevron"></span>
            <span>${sourceLabel(source)}</span>
            <span class="badge">${rows.length}</span>
          </button>
          <div class="group-body">
            ${rows
              .map((it, idx) => {
                const id = `${source}-${idx}`;
                const val = formatValue(it.value);
                const long = val.length > 120;
                const meta = metaLine(it);
                return `
                <article class="item ${it.hot ? "hot" : ""}" data-id="${escapeHtml(id)}">
                  <div class="item-row">
                    <div class="item-key">${highlight(it.key, q)}</div>
                    <div class="item-actions">
                      <button type="button" class="mini-btn" data-copy-key="${escapeHtml(it.key)}">键</button>
                      <button type="button" class="mini-btn" data-copy-val>值</button>
                      <button type="button" class="mini-btn" data-copy-pair>KV</button>
                    </div>
                  </div>
                  ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ""}
                  <pre class="item-value ${long ? "collapsed" : ""}" data-full>${highlight(val, q)}</pre>
                  ${
                    long
                      ? `<button type="button" class="mini-btn" data-expand style="margin-top:4px">展开</button>`
                      : ""
                  }
                </article>`;
              })
              .join("")}
          </div>
        </section>
      `);
    }

    els.list.innerHTML = html.join("");
    els.summary.textContent = `共 ${state.items.length} 项 · 显示 ${items.length} · 登录相关 ${
      state.items.filter((i) => i.hot).length
    }`;

    // Bind copy payloads on elements
    els.list.querySelectorAll(".item").forEach((node) => {
      const pre = node.querySelector("[data-full]");
      const fullText = pre ? pre.textContent : "";
      const keyBtn = node.querySelector("[data-copy-key]");
      const key = keyBtn?.getAttribute("data-copy-key") || "";
      node.querySelector("[data-copy-val]")?.addEventListener("click", () =>
        copyText(fullText)
      );
      keyBtn?.addEventListener("click", () => copyText(key));
      node.querySelector("[data-copy-pair]")?.addEventListener("click", () =>
        copyText(JSON.stringify({ key, value: fullText }, null, 2))
      );
      node.querySelector("[data-expand]")?.addEventListener("click", (e) => {
        pre.classList.remove("collapsed");
        e.currentTarget.remove();
      });
    });
  }

  async function refresh() {
    els.status.hidden = true;
    els.summary.textContent = "加载中…";
    els.list.innerHTML = `<div class="empty">读取中…</div>`;

    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("找不到当前标签页");
      if (!canInject(tab.url)) {
        throw new Error(
          "无法在此页面读取存储（chrome://、扩展页、Web Store 等受限页面）"
        );
      }

      state.tabUrl = tab.url;
      try {
        state.origin = new URL(tab.url).origin;
      } catch {
        state.origin = tab.url;
      }
      els.origin.textContent = state.origin;
      els.origin.title = tab.url;

      const [pageData, cookies] = await Promise.all([
        loadPageData(tab.id),
        loadCookies(tab.url),
      ]);

      state.items = normalizeItems({
        web: pageData.web,
        idb: pageData.idb,
        cookies,
      });
      render();
    } catch (e) {
      els.status.hidden = false;
      els.status.textContent = e.message || String(e);
      els.list.innerHTML = `<div class="empty">加载失败</div>`;
      els.summary.textContent = "—";
      state.items = [];
      updateCounts();
    }
  }

  // Events
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeTab = btn.dataset.tab;
      render();
    });
  });

  els.list.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (!toggle) return;
    const source = toggle.getAttribute("data-toggle");
    const group = toggle.closest(".group");
    if (state.collapsedGroups.has(source)) {
      state.collapsedGroups.delete(source);
      group?.classList.add("open");
    } else {
      state.collapsedGroups.add(source);
      group?.classList.remove("open");
    }
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    els.clearSearch.hidden = !state.query;
    render();
  });

  els.clearSearch.addEventListener("click", () => {
    els.search.value = "";
    state.query = "";
    els.clearSearch.hidden = true;
    els.search.focus();
    render();
  });

  els.hotOnly.addEventListener("change", () => {
    state.hotOnly = els.hotOnly.checked;
    render();
  });

  els.refresh.addEventListener("click", refresh);

  els.copyAll.addEventListener("click", () => {
    const payload = filteredItems().map((it) => ({
      source: it.source,
      key: it.key,
      value: it.value,
      meta: it.meta,
      hot: it.hot,
    }));
    copyText(JSON.stringify(payload, null, 2));
  });

  // Default: focus search for quick SESSION_ID hunt
  refresh().then(() => {
    els.search.focus();
    // If any hot items, optionally pre-check when user might want session
    const hotCount = state.items.filter((i) => i.hot).length;
    if (hotCount > 0 && hotCount <= 12) {
      // soft hint via placeholder only — don't auto-filter
      els.search.placeholder = `搜索… 已发现 ${hotCount} 个登录相关项，可勾选「登录相关」`;
    }
  });
})();
