// ==UserScript==
// @name         GAO UI Extension
// @namespace    o_z_
// @version      0.2.1
// @description  Frontend-only UI helpers for Gun Art Online.
// @match        https://gunartonline.pages.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const ATTR = "data-gao-ext";
  const HIDDEN = "gao-ext-hidden";
  const RESTORE_PATTERN = /(HP|MP|生命|魔力)/i;
  const MAX_DELAY_MS = 80;
  const FORGE_HISTORY_KEY = "gao-ext-forge-history-v1";
  const FORGE_HISTORY_LIMIT = 24;
  const MAX_FORGE_ROWS = 48;
  const FORGE_MATCH_WINDOW_MS = 60 * 1000;
  const DEFAULT_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
  };
  const INVENTORY_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  };
  const INVENTORY_ACQUIRED_AT_PATTERN =
    /時間\s*[·:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
  const PAD_WIDTH = 2;
  const QUALITY_PREFIX_PATTERN = /^[^\s]+\s+的\s+/;
  const RECIPE_TYPE_TO_KEY = {
    短刀: "dagger",
    細劍: "rapier",
    單手劍: "sword",
    盾牌: "shield",
    大衣: "coat",
    盔甲: "armor",
    太刀: "katana",
    弓: "bow",
    雙手劍: "greatsword",
    雙手斧: "axe",
    手槍: "pistol",
    衝鋒槍: "smg",
    輕機槍: "lmg",
    狙擊槍: "sniper",
  };
  const FLAVOR_TYPE_PATTERNS = [
    ["dagger", /短刀|匕首/],
    ["rapier", /細劍|刺劍/],
    ["sword", /單手劍/],
    ["shield", /盾/],
    ["coat", /大衣|外衣/],
    ["armor", /盔甲|鎧甲/],
    ["katana", /太刀/],
    ["bow", /弓/],
    ["greatsword", /雙手劍|巨劍/],
    ["axe", /雙手斧|戰斧/],
    ["pistol", /手槍/],
    ["smg", /衝鋒槍/],
    ["lmg", /輕機槍|機槍/],
    ["sniper", /狙擊槍|狙擊步槍/],
  ];

  let currentPath = "";
  let pageObserver = null;
  let forgeBootstrapObserver = null;
  let queuedMount = false;
  let queuedPageRefresh = false;
  let forgeStatus = "";
  let forgeStatusTone = "";
  let forgeReplayBusy = false;
  const warnings = new Set();

  function boot() {
    injectStyles();
    hookRouteChanges();
    mountForRoute();
  }

  // 依目前路由切到對應增強邏輯，
  // 並在路徑變更時重設舊頁面的 observer。
  function mountForRoute() {
    const path = location.pathname;
    if (currentPath !== path) {
      currentPath = path;
      disconnectPageObserver();
    }
    if (path === "/tower") {
      return mountMainObservedPage(() => {
        enhanceBattleReport();
      });
    }
    if (path === "/inventory") {
      return mountMainObservedPage(() => {
        syncInventoryForgeMaterials();
      }, INVENTORY_OBSERVER_OPTIONS);
    }
    if (path === "/forge") return mountForgePage();
    if (path === "/market") {
      return mountObservedPage(document.body, () => {
        enhanceMarketBuyMax();
        enhanceMarketBoardRefresh();
      });
    }
    if (path.startsWith("/records/")) {
      return mountMainObservedPage(enhanceBattleReport);
    }
    return disconnectPageObserver();
  }

  function mountMainObservedPage(refresh, observerOptions) {
    mountObservedPage(findMainRoot(), refresh, observerOptions);
  }

  function mountForgePage() {
    console.log("mountForgePage");
    const root = findForgeRoot();
    if (!root) {
      disconnectPageObserver();
      setTimeout(scheduleMountForRoute, MAX_DELAY_MS);
      return;
    }
    const parts = findForgeParts(root);
    if (!parts) {
      watchForgeStructure(root);
      return;
    }
    disconnectForgeBootstrapObserver();
    mountForgeObservedPage(parts);
  }

  // 統一處理「先刷新一次，再掛 MutationObserver」的流程，
  // 讓不同頁面只要提供 root 與 refresh 即可共用。
  function mountObservedPage(root, refresh, observerOptions) {
    const roots = Array.isArray(root)
      ? root.filter(Boolean)
      : root
        ? [root]
        : [];
    if (roots.length === 0) {
      disconnectPageObserver();
      setTimeout(scheduleMountForRoute, MAX_DELAY_MS);
      return;
    }
    refresh();
    disconnectPageObserver();
    pageObserver = new MutationObserver(() => schedulePageRefresh(refresh));
    for (const target of roots) {
      pageObserver.observe(target, observerOptions || DEFAULT_OBSERVER_OPTIONS);
    }
  }

  function mountForgeObservedPage(parts) {
    const refresh = () => {
      bindForgeCommitButtons();
      syncForgeHistoryPanel();
    };
    refresh();
    disconnectPageObserver();
    pageObserver = new MutationObserver(() => schedulePageRefresh(refresh));
    pageObserver.observe(parts.root, {
      childList: true,
    });
    for (const target of [
      parts.weaponSection,
      parts.recipeSection,
      parts.legend,
    ]) {
      pageObserver.observe(target, {
        childList: true,
        subtree: true,
      });
    }
  }

  function scheduleMountForRoute() {
    if (queuedMount) return;
    queuedMount = true;
    requestAnimationFrame(() => {
      queuedMount = false;
      mountForRoute();
    });
  }

  function hookRouteChanges() {
    for (const key of ["pushState", "replaceState"]) {
      const original = history[key];
      history[key] = function patchedHistory(...args) {
        const result = original.apply(this, args);
        setTimeout(scheduleMountForRoute, MAX_DELAY_MS);
        return result;
      };
    }
    addEventListener("popstate", scheduleMountForRoute);
  }

  function schedulePageRefresh(refresh) {
    const path = currentPath;
    if (queuedPageRefresh) return;
    queuedPageRefresh = true;
    requestAnimationFrame(() => {
      queuedPageRefresh = false;
      if (location.pathname !== path) return;
      refresh();
    });
  }

  function disconnectPageObserver() {
    pageObserver?.disconnect();
    pageObserver = null;
    disconnectForgeBootstrapObserver();
  }

  function findMainRoot() {
    return document.querySelector("main.page-main, main");
  }

  function findForgeRoot() {
    return document.querySelector("main.forge-main") ?? findMainRoot();
  }

  function disconnectForgeBootstrapObserver() {
    forgeBootstrapObserver?.disconnect();
    forgeBootstrapObserver = null;
  }

  function findForgeParts(root) {
    const sections = root.querySelectorAll("section");
    const weaponSection = sections[0];
    const recipeSection = sections[1];
    const legend = root.querySelector(".legend");
    if (!weaponSection || !recipeSection || !legend) return null;
    return { root, weaponSection, recipeSection, legend };
  }

  function watchForgeStructure(root) {
    if (forgeBootstrapObserver) return;
    // 鍛造頁的區塊會分階段掛載，先盯住 root，
    // 等必要 section/legend 出現後再正式綁功能。
    forgeBootstrapObserver = new MutationObserver(() => {
      if (!findForgeParts(root)) return;
      disconnectForgeBootstrapObserver();
      scheduleMountForRoute();
    });
    forgeBootstrapObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function injectStyles() {
    if (document.querySelector(`style[${ATTR}="styles"]`)) return;
    const style = document.createElement("style");
    style.setAttribute(ATTR, "styles");
    style.textContent = `
      .${HIDDEN} { display: none !important; }
      .gao-ext-details { border: 1px solid var(--border-faint); background: var(--bg-elevated); margin-top: var(--s-3); }
      .gao-ext-details > summary { cursor: pointer; padding: var(--s-3) var(--s-4); font-family: var(--font-display); font-size: 11px; font-weight: 800; letter-spacing: var(--tracking-widest); color: var(--cyan-300); }
      .gao-ext-panel { padding: 0 var(--s-4) var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); }
      .gao-ext-details .bl-log { margin: 0; }
      .gao-ext-floor { margin-left: var(--s-3); color: var(--gold-300); font-family: var(--font-mono); font-size: var(--fs-xs); }
      .gao-ext-note { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--lime-300); margin: var(--s-2) 0; }
      .gao-ext-count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); }
      .gao-ext-organize { margin-left: auto; }
      .gao-ext-history { margin: 0; }
      .gao-ext-history > summary { font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--magenta-300); }
      .gao-ext-history-list { display: flex; flex-direction: column; gap: var(--s-3); }
      .gao-ext-history-entry { border-top: 1px solid var(--border-faint); padding-top: var(--s-3); }
      .gao-ext-history-entry:first-child { border-top: 0; padding-top: 0; }
      .gao-ext-history-head { display: flex; gap: var(--s-2); align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
      .gao-ext-history-name { font-weight: 700; color: var(--text-primary); }
      .gao-ext-history-meta,
      .gao-ext-history-materials,
      .gao-ext-history-empty,
      .gao-ext-history-status { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-tertiary); }
      .gao-ext-history-status[data-tone="error"] { color: var(--danger-300, #ff8a8a); }
      .gao-ext-history-status[data-tone="success"] { color: var(--lime-300); }
      .gao-ext-history-actions { display: flex; gap: var(--s-2); align-items: flex-start; margin-top: var(--s-2); flex-wrap: wrap; }
      .gao-ext-history-materials { flex: 1 1 220px; min-width: 0; }
      .gao-ext-history-replay { font-size: var(--fs-sm); border: 1px solid var(--border-strong); padding: 8px 10px; cursor: pointer; }
      .gao-ext-history-delete { font-size: var(--fs-sm); border: 1px solid var(--border-strong); padding: 8px 10px; cursor: pointer; }
      .gao-ext-history-replay[disabled] { opacity: 0.6; cursor: wait; }
      .gao-ext-history-delete[disabled] { opacity: 0.6; cursor: wait; }
      .gao-ext-material-block { margin-top: var(--s-4); border-top: 1px solid var(--border-soft); padding-top: var(--s-4); padding-bottom: var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); }
      .gao-ext-material-title { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); letter-spacing: 0.08em; }
      .gao-ext-material-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
      .gao-ext-material-list { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); },
    `;
    document.head.appendChild(style);
  }

  function bindForgeCommitButtons() {
    for (const button of document.querySelectorAll(".recipe__cta")) {
      if (button.dataset.gaoExtBound === "1") continue;
      button.dataset.gaoExtBound = "1";
      button.addEventListener("click", () => captureForgeHistory(button));
    }
  }

  // 把當前配方畫面上的材料、名稱與 recipe 資訊擷取成快照，
  // 寫入 localStorage 供後續回放與背包比對使用。
  function captureForgeHistory(button) {
    if (button.disabled) return;
    const recipe = button.closest(".recipe");
    if (!recipe) return;
    const materials = [...recipe.querySelectorAll(".mat-row")]
      .map((row) => {
        const name = row
          .querySelector(".mat-row__sel-name")
          ?.textContent.trim();
        const qty = Number(row.querySelector(".qval")?.textContent.trim() || 0);
        if (!name || name.includes("選擇材料") || qty < 1) return null;
        return { name, qty };
      })
      .filter(Boolean);
    if (materials.length === 0) return;
    const recipeName =
      recipe.querySelector(".recipe__name")?.textContent.trim() || "未命名配方";
    const entry = {
      id: `forge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      recipeId:
        recipe.querySelector(".recipe__id")?.textContent.trim() || "UNKNOWN",
      recipeName,
      weaponType: recipeName,
      weaponTypeKey: RECIPE_TYPE_TO_KEY[recipeName] || "",
      recipeDesc:
        recipe.querySelector(".recipe__desc")?.textContent.trim() || "",
      weaponName: findForgeNameInput()?.value.trim() || "",
      requiredQty: Number(
        (recipe.querySelector(".recipe__count")?.textContent || "")
          .split("/")[1]
          ?.trim() || 0,
      ),
      materials,
    };
    writeForgeHistory(
      [entry, ...readForgeHistory()].slice(0, FORGE_HISTORY_LIMIT),
    );
    setForgeStatus(
      `已記錄 ${entry.recipeName} / ${entry.weaponName || "未命名"} 的材料配置。`,
      "success",
    );
    syncForgeHistoryPanel();
  }

  // 確保鍛造履歷面板存在於正確位置，
  // 並依目前狀態整塊重繪內容與按鈕可用性。
  function syncForgeHistoryPanel() {
    if (location.pathname !== "/forge") return;
    const root = findForgeRoot();
    const recipeSection = root?.querySelectorAll("section")?.[1];
    const legend = root?.querySelector(".legend");
    if (!root || !recipeSection || !legend) return;

    let details = root.querySelector(`[${ATTR}="forge-history"]`);
    if (!details) {
      details = document.createElement("details");
      details.className = "gao-ext-details gao-ext-history";
      details.setAttribute(ATTR, "forge-history");
      const summary = document.createElement("summary");
      summary.textContent = "FORGE HISTORY 鍛造履歷";
      const panel = document.createElement("div");
      panel.className = "gao-ext-panel";
      details.append(summary, panel);
      // 履歷內容會整塊 replaceChildren，改用事件代理，
      // 讓重播/刪除按鈕不用每次重綁監聽器。
      details.addEventListener("click", (event) => {
        const button = event.target.closest("[data-gao-ext-action]");
        if (!button) return;
        event.preventDefault();
        if (button.dataset.gaoExtAction === "replay-forge") {
          replayForgeHistory(button);
          return;
        }
        if (button.dataset.gaoExtAction === "delete-forge-history") {
          deleteForgeHistoryEntry(button);
        }
      });
      root.insertBefore(details, recipeSection);
    } else if (details.nextElementSibling !== recipeSection) {
      root.insertBefore(details, recipeSection);
    }

    const isOpen = details.open;
    const panel = details.querySelector(".gao-ext-panel");
    const nodes = [];

    if (forgeStatus) {
      const status = document.createElement("div");
      status.className = "gao-ext-history-status";
      if (forgeStatusTone) status.dataset.tone = forgeStatusTone;
      setTextIfChanged(status, forgeStatus);
      nodes.push(status);
    }

    const history = readForgeHistory();
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gao-ext-history-empty";
      setTextIfChanged(empty, "目前還沒有鍛造紀錄。");
      nodes.push(empty);
    } else {
      const list = document.createElement("div");
      list.className = "gao-ext-history-list";
      for (const entry of history) {
        const item = document.createElement("article");
        item.className = "gao-ext-history-entry";
        const name = escapeHtml(entry.weaponName || "未命名");
        const meta = escapeHtml(
          `${entry.recipeId} · ${entry.recipeName} · ${formatForgeTime(entry.createdAt)}`,
        );
        const materials = escapeHtml(
          entry.materials
            .map((material) => `${material.name}×${material.qty}`)
            .join(", "),
        );
        const disabled = forgeReplayBusy ? "disabled" : "";
        item.innerHTML = `
          <div class="gao-ext-history-head">
            <strong class="gao-ext-history-name">${name}</strong>
            <span class="gao-ext-history-meta">${meta}</span>
          </div>
          <div class="gao-ext-history-actions">
            <div class="gao-ext-history-materials">${materials}</div>
            <button
              type="button"
              class="chip gao-ext-organize gao-ext-history-replay"
              data-gao-ext-action="replay-forge"
              data-entry-id="${entry.id}"
              ${disabled}
            >再鍛一次</button>
            <button
              type="button"
              class="chip gao-ext-history-delete"
              data-gao-ext-action="delete-forge-history"
              data-entry-id="${entry.id}"
              ${disabled}
            >移除</button>
          </div>
        `;
        list.appendChild(item);
      }
      nodes.push(list);
    }

    panel.replaceChildren(...nodes);
    details.open = isOpen;
  }

  // 這層只負責回放流程的忙碌狀態、訊息與錯誤呈現，
  // 真正的 DOM 回填細節交給 restoreForgeRecipe。
  async function replayForgeHistory(button) {
    if (forgeReplayBusy) return;
    const entry = readForgeHistory().find(
      (item) => item.id === button.dataset.entryId,
    );
    if (!entry) {
      setForgeStatus("找不到這筆鍛造紀錄。", "error");
      syncForgeHistoryPanel();
      return;
    }
    forgeReplayBusy = true;
    button.disabled = true;
    setForgeStatus(`正在回填 ${entry.recipeName} 的材料與名稱...`, "success");
    syncForgeHistoryPanel();
    try {
      await restoreForgeRecipe(entry);
      setForgeStatus(
        `已回填 ${entry.recipeName} / ${entry.weaponName || "未命名"}。`,
        "success",
      );
    } catch (error) {
      console.error(error);
      setForgeStatus(error.message, "error");
    } finally {
      forgeReplayBusy = false;
      syncForgeHistoryPanel();
    }
  }

  function deleteForgeHistoryEntry(button) {
    if (forgeReplayBusy) return;
    const entryId = button.dataset.entryId;
    if (!entryId) return;
    const history = readForgeHistory();
    const entry = history.find((item) => item.id === entryId);
    if (!entry) {
      setForgeStatus("找不到要刪除的鍛造紀錄。", "error");
      syncForgeHistoryPanel();
      return;
    }
    writeForgeHistory(history.filter((item) => item.id !== entryId));
    setForgeStatus(
      `已刪除 ${entry.recipeName} / ${entry.weaponName || "未命名"} 的鍛造紀錄。`,
      "success",
    );
    syncForgeHistoryPanel();
  }

  // 依履歷逐步操作現有鍛造 UI：重設列數、搜尋材料、補數量，
  // 故意走真實事件鏈，讓站內反應與手動操作一致。
  async function restoreForgeRecipe(entry) {
    const nameInput = findForgeNameInput();
    if (!nameInput)
      throw new Error("GAO extension: forge name input not found.");
    const findRecipe = () =>
      [...document.querySelectorAll(".recipe")].find(
        (recipe) =>
          recipe.querySelector(".recipe__id")?.textContent.trim() ===
          entry.recipeId,
      );
    if (!findRecipe())
      throw new Error(`GAO extension: recipe ${entry.recipeId} not found.`);

    const waitForUi = () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, MAX_DELAY_MS));
      });
    // 單純呼叫 click() 有時不會觸發站內自訂互動，
    // 這裡補完整的 pointer/mouse 事件鏈來模擬真人操作。
    const triggerClick = (element) => {
      if (!element) return;
      const pointerSupported = typeof PointerEvent === "function";
      const pointerInit = { bubbles: true, cancelable: true, pointerId: 1 };
      const mouseInit = { bubbles: true, cancelable: true, buttons: 1 };
      if (pointerSupported) {
        element.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
      }
      element.dispatchEvent(new MouseEvent("mousedown", mouseInit));
      if (pointerSupported) {
        element.dispatchEvent(new PointerEvent("pointerup", pointerInit));
      }
      element.dispatchEvent(new MouseEvent("mouseup", mouseInit));
      element.dispatchEvent(new MouseEvent("click", mouseInit));
    };

    setInputValue(nameInput, entry.weaponName || "");
    await waitForUi();

    // 先把現有材料列清空，再擴到目標列數，
    // 後面才能按履歷順序一列列回填材料與數量。
    for (let i = 0; i < MAX_FORGE_ROWS; i += 1) {
      const recipe = findRecipe();
      const remove = recipe?.querySelector(".mat-row__rm");
      if (!remove) break;
      triggerClick(remove);
      await waitForUi();
    }
    if (findRecipe()?.querySelector(".mat-row__rm")) {
      throw new Error(
        `GAO extension: failed to reset recipe ${entry.recipeId}.`,
      );
    }

    for (let i = 0; i < MAX_FORGE_ROWS; i += 1) {
      const recipe = findRecipe();
      const rowCount = recipe?.querySelectorAll(".mat-row").length ?? 0;
      if (rowCount >= entry.materials.length) break;
      const add = recipe?.querySelector(".mat-add");
      if (!add) {
        throw new Error(
          `GAO extension: add material button missing for ${entry.recipeId}.`,
        );
      }
      triggerClick(add);
      await waitForUi();
    }
    const finalRowCount =
      findRecipe()?.querySelectorAll(".mat-row").length ?? 0;
    if (finalRowCount < entry.materials.length) {
      throw new Error(
        `GAO extension: failed to grow recipe ${entry.recipeId} to ${entry.materials.length} rows.`,
      );
    }

    for (const [rowIndex, material] of entry.materials.entries()) {
      const row = findRecipe()?.querySelectorAll(".mat-row")[rowIndex];
      const trigger = row?.querySelector(".ss__trigger");
      if (!row || !trigger) {
        throw new Error(`GAO extension: forge row ${rowIndex + 1} not found.`);
      }
      triggerClick(trigger);
      await waitForUi();

      const input = document.querySelector(".ss__search-input");
      if (!input) {
        throw new Error("GAO extension: material search input not found.");
      }
      setInputValue(input, material.name);
      await waitForUi();

      const option = [...document.querySelectorAll(".ss__list .ss__opt")].find(
        (candidate) =>
          candidate.textContent.replace(/剩餘\s*\d+.*$/, "").trim() ===
          material.name,
      );
      if (!option) {
        throw new Error(
          `GAO extension: material option "${material.name}" not found.`,
        );
      }
      triggerClick(option);
      await waitForUi();

      for (let qty = 1; qty < material.qty; qty += 1) {
        const activeRow = findRecipe()?.querySelectorAll(".mat-row")[rowIndex];
        const plus = activeRow?.querySelector(".mat-row__qty .qbtn:last-child");
        if (!plus || plus.disabled) {
          throw new Error(
            `GAO extension: insufficient stock for row ${rowIndex + 1}.`,
          );
        }
        triggerClick(plus);
        await waitForUi();
      }
    }
  }

  function readForgeHistory() {
    try {
      const raw = localStorage.getItem(FORGE_HISTORY_KEY);
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  function writeForgeHistory(history) {
    try {
      localStorage.setItem(FORGE_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error(error);
      setForgeStatus("鍛造履歷儲存失敗，請查看 console 錯誤。", "error");
    }
  }

  function findForgeNameInput() {
    return document.querySelector(
      'main.forge-main input[type="text"], main.forge-main input',
    );
  }

  function formatForgeTime(value) {
    return new Date(value).toLocaleString("zh-TW", {
      hour12: false,
    });
  }

  function setForgeStatus(message, tone) {
    forgeStatus = message;
    forgeStatusTone = tone;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  // 背包詳情切換時，嘗試從鍛造履歷推回這件成品的材料來源，
  // 找到就動態插入一塊只讀的材料摘要。
  function syncInventoryForgeMaterials() {
    console.log("syncInventoryForgeMaterials");
    const detail = document.querySelector(".inv-right .detail-card");
    if (!detail) return;
    const item = readInventoryCraftedItem(detail);
    const entry = item ? findMatchingForgeEntry(item) : null;
    renderInventoryForgeMaterials(detail, item, entry);
  }

  function readInventoryCraftedItem(detail) {
    const rawName =
      detail.querySelector(".detail__name")?.textContent.trim() || "";
    const weaponName = rawName.replace(QUALITY_PREFIX_PATTERN, "").trim();
    const typeKey = readInventoryTypeKey(detail);
    const acquiredAtRange = readInventoryAcquiredAtRange(detail);
    if (!weaponName || !typeKey) return null;
    if (!acquiredAtRange) {
      warnOnce(
        "inventory-acquired-time",
        "GAO extension: inventory acquired time not found.",
      );
      return null;
    }
    return { weaponName, typeKey, acquiredAtRange };
  }

  // 從履歷中挑出最可能對應這件背包成品的一筆紀錄，
  // 比對條件包含名稱、武器類型與取得時間附近的窗口。
  function findMatchingForgeEntry(item) {
    // 背包看不到 recipe id，只能用名稱正規化、武器類型，
    // 再加上取得時間窗口去推回最可能的鍛造紀錄。
    return (
      readForgeHistory()
        .filter((entry) => entry.weaponType && entry.weaponTypeKey)
        .filter(
          (entry) =>
            normalizeInventoryMatchText(entry.weaponName) ===
              normalizeInventoryMatchText(item.weaponName) &&
            entry.weaponTypeKey === item.typeKey &&
            isForgeEntryWithinInventoryTimeWindow(entry, item.acquiredAtRange),
        )
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        )[0] ?? null
    );
  }

  function renderInventoryForgeMaterials(detail, item, entry) {
    console.log("renderInventoryForgeMaterials", { item, entry });
    const signature =
      item && entry ? buildInventoryForgeSignature(item, entry) : "none";
    if (detail.dataset.gaoExtForgeMaterials === signature) return;
    detail.dataset.gaoExtForgeMaterials = signature;
    detail.querySelector(`[${ATTR}="inventory-materials"]`)?.remove();
    if (!entry) return;
    const block = document.createElement("div");
    block.className = "gao-ext-material-block";
    block.setAttribute(ATTR, "inventory-materials");
    const materials = escapeHtml(
      entry.materials
        .map((material) => `${material.name}×${material.qty}`)
        .join(", "),
    );
    block.innerHTML = `
      <div class="gao-ext-material-title">使用材料 / FORGE MATERIALS</div>
      <div class="gao-ext-material-meta">${escapeHtml(
        `${entry.weaponType} · ${formatForgeTime(entry.createdAt)}`,
      )}</div>
      <div class="gao-ext-material-list">${materials}</div>
    `;
    const anchor = detail.querySelector(".actions") ?? detail.lastElementChild;
    anchor?.insertAdjacentElement("beforebegin", block);
  }

  function buildInventoryForgeSignature(item, entry) {
    return `${item.weaponName}|${item.typeKey}|${item.acquiredAtRange.startMs}|${entry.id}`;
  }

  function readInventoryTypeKey(detail) {
    const style =
      detail
        .querySelector(".preview-cell span, .preview-cell")
        ?.getAttribute("style") || "";
    const iconMatch = style.match(/\/icons\/([a-z-]+)\.svg/i);
    if (iconMatch?.[1]) return iconMatch[1].toLowerCase();
    const flavor = detail.querySelector(".flavor")?.textContent.trim() || "";
    for (const [candidate, pattern] of FLAVOR_TYPE_PATTERNS) {
      if (pattern.test(flavor)) return candidate;
    }
    return "";
  }

  function readInventoryAcquiredAtRange(detail) {
    const timeText = readInventoryAcquiredTimeText(detail);
    if (!timeText) return null;
    const match = timeText.match(INVENTORY_ACQUIRED_AT_PATTERN);
    if (!match) return null;
    const startMs = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      0,
      0,
    ).getTime();
    if (Number.isNaN(startMs)) return null;
    return {
      startMs,
      endMs: startMs + FORGE_MATCH_WINDOW_MS - 1,
    };
  }

  function readInventoryAcquiredTimeText(detail) {
    let element = detail.querySelector(".actions");
    while (element?.previousElementSibling) {
      element = element.previousElementSibling;
      const text = element.textContent.replace(/\s+/g, " ").trim();
      if (INVENTORY_ACQUIRED_AT_PATTERN.test(text)) return text;
    }
    for (const child of detail.children) {
      const text = child.textContent.replace(/\s+/g, " ").trim();
      if (INVENTORY_ACQUIRED_AT_PATTERN.test(text)) return text;
    }
    return "";
  }

  function normalizeInventoryMatchText(value) {
    return value.toLowerCase().replace(/\s+/g, "");
  }

  function isForgeEntryWithinInventoryTimeWindow(entry, acquiredAtRange) {
    const createdAtMs = Date.parse(entry.createdAt);
    if (Number.isNaN(createdAtMs)) return false;
    if (createdAtMs < acquiredAtRange.startMs) {
      return acquiredAtRange.startMs - createdAtMs < FORGE_MATCH_WINDOW_MS;
    }
    if (createdAtMs > acquiredAtRange.endMs) {
      return createdAtMs - acquiredAtRange.endMs < FORGE_MATCH_WINDOW_MS;
    }
    return true;
  }

  // 把原始戰報拆成「掉落物」與「戰報」兩個可折疊區塊，
  // 同時保留原始內容來源，避免重跑時越拆越亂。
  function enhanceBattleReport() {
    const buildDetails = (title, meta) => {
      const details = document.createElement("details");
      details.className = "gao-ext-details";
      const summary = document.createElement("summary");
      summary.textContent = `${title} / ${meta}`;
      const panel = document.createElement("div");
      panel.className = "gao-ext-panel";
      details.append(summary, panel);
      return details;
    };
    const cloneReportNode = (element) => {
      const clone = element.cloneNode(true);
      clone.classList.remove(HIDDEN);
      clone.removeAttribute(ATTR);
      clone
        .querySelectorAll(`[${ATTR}]`)
        .forEach((child) => child.removeAttribute(ATTR));
      clone
        .querySelectorAll(`.${HIDDEN}`)
        .forEach((child) => child.classList.remove(HIDDEN));
      return clone;
    };

    for (const inner of document.querySelectorAll(".bl__inner")) {
      // MutationObserver 會重複進來，先用目前內容做簽章，
      // 沒變動就跳過，避免一直拆裝同一份戰報 DOM。
      const signature = [...inner.children]
        .filter((child) => !child.matches(`details[${ATTR}]`))
        .map((child) => child.textContent.trim())
        .join("|");
      if (inner.dataset.gaoExtBattle === signature) continue;

      for (const detail of inner.querySelectorAll(
        `:scope > details[${ATTR}]`,
      )) {
        detail.remove();
      }
      for (const element of inner.querySelectorAll(`:scope > .${HIDDEN}`)) {
        element.classList.remove(HIDDEN);
      }

      const children = [...inner.children];
      const pre = children.find((child) => child.classList.contains("bl-pre"));
      const head = children.find((child) =>
        child.classList.contains("bl-head"),
      );
      const logs = children.filter((child) =>
        child.classList.contains("bl-log"),
      );
      if (!pre || logs.length === 0) {
        warnOnce("battle", "GAO extension: battle report structure not found.");
        continue;
      }

      inner.dataset.gaoExtBattle = signature;
      const anchor = head || logs[0];
      const rewards = logs.flatMap((log) => [
        ...log.querySelectorAll(
          '.bl-row[data-act="reward"], .bl-row[data-line="reward"]',
        ),
      ]);
      if (rewards.length > 0) {
        const drops = buildDetails("掉落物 · DROPS", `${rewards.length} lines`);
        drops.setAttribute(ATTR, "drops");
        const dropLog = document.createElement("div");
        dropLog.className = "bl-log";
        dropLog.append(...rewards.map(cloneReportNode));
        drops.querySelector(".gao-ext-panel").appendChild(dropLog);
        inner.insertBefore(drops, anchor);
      }

      const eventCount = logs.reduce((sum, log) => {
        return (
          sum +
          log.querySelectorAll(
            '.bl-row:not([data-act="reward"], [data-line="reward"])',
          ).length
        );
      }, 0);
      const report = buildDetails("戰報 · BATTLE LOG", `${eventCount} events`);
      report.setAttribute(ATTR, "report");
      const panel = report.querySelector(".gao-ext-panel");
      if (head) panel.appendChild(cloneReportNode(head));
      for (const log of logs) {
        const clone = cloneReportNode(log);
        for (const reward of clone.querySelectorAll(
          '.bl-row[data-act="reward"], .bl-row[data-line="reward"]',
        )) {
          reward.remove();
        }
        panel.appendChild(clone);
      }
      inner.insertBefore(report, anchor);

      if (head) head.classList.add(HIDDEN);
      for (const log of logs) log.classList.add(HIDDEN);
    }
  }

  function enhanceMarketBuyMax() {
    console.log("enhanceMarketBuyMax");
    const detail = document.querySelector(".detail");
    if (!detail || detail.querySelector(`[${ATTR}="max-buy"]`)) return;
    const max = Number(
      detail.textContent.match(/剩餘庫存：\s*(\d+)\s*件/)?.[1] || 0,
    );
    const input = detail.querySelector(
      'input[inputmode="numeric"], input[type="text"]',
    );
    const plus = [...detail.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === "+",
    );
    if (!max || !input || !plus) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-icon";
    button.setAttribute(ATTR, "max-buy");
    button.textContent = "MAX";
    button.style.cssText = "width:42px;height:28px;font-size:10px;";
    button.addEventListener("click", () => setInputValue(input, String(max)));
    plus.insertAdjacentElement("afterend", button);
  }

  function enhanceMarketBoardRefresh() {
    console.log("enhanceMarketBoardRefresh");
    const chips = document.querySelector(".chips");
    if (!chips || chips.querySelector(`[${ATTR}="organize-market"]`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip gao-ext-organize";
    button.setAttribute(ATTR, "organize-market");
    button.textContent = "更新";
    button.addEventListener("click", () => {
      const row = document.querySelector(".search-row");
      const search = [...(row?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent.trim() === "搜尋",
      );
      if (!search) {
        warnOnce(
          "market-refresh",
          "GAO extension: market refresh control not found.",
        );
        return;
      }
      search.click();
    });
    button.title = "其實這個按鈕跟你直接按上面的搜尋功能一樣";
    chips.appendChild(button);
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setTextIfChanged(element, value) {
    if (!element || element.textContent === value) return;
    element.textContent = value;
  }

  function warnOnce(key, message) {
    if (warnings.has(key)) return;
    warnings.add(key);
    console.warn(message);
  }

  boot();
})();
