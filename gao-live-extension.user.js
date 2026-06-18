// ==UserScript==
// @name         GAO UI Extension
// @namespace    o_z_
// @version      0.2.11
// @description  Frontend-only UI helpers for Gun Art Online.
// @match        https://gunartonline.pages.dev/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const ATTR = "data-gao-ext";
  const HIDDEN = "gao-ext-hidden";
  const RESTORE_PATTERN = /(HP|MP|生命|魔力)/i;
  const MAX_DELAY_MS = 80;
  const MAX_FORGE_ROWS = 48;
  const FORGE_HISTORY_KEY = "gao-ext-forge-history-v2";
  const FORGE_MATERIAL_MAP_KEY = "gao-ext-forge-material-map-v1";
  const ME_SNAPSHOT_KEY = "gao-ext-me-snapshot-v1";
  const FORGE_HISTORY_LIMIT = 24;
  const PENDING_CRAFT_REQUEST_WINDOW_MS = 2 * 60 * 1000;
  const PENDING_FORGE_REPLAY_CONTEXT_WINDOW_MS = 10 * 1000;
  const DEFAULT_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
  };
  const INVENTORY_OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  };
  const INVENTORY_CATEGORY_KEYS = [
    "all",
    "weapon",
    "material",
    "consumable",
    "skillbook",
    "ammo",
  ];
  const INVENTORY_COLOR_OPTIONS = [
    { key: "red", label: "紅", hex: "#ff5a5a" },
    { key: "orange", label: "橙", hex: "#ff9f43" },
    { key: "yellow", label: "黃", hex: "#ffd23f" },
    { key: "green", label: "綠", hex: "#4ade80" },
    { key: "blue", label: "藍", hex: "#38bdf8" },
    { key: "purple", label: "紫", hex: "#c084fc" },
  ];
  const INVENTORY_SORT_KEY_BY_LABEL = {
    品質: "quality",
    種類: "type",
    時間: "time",
    攻: "atk",
    防: "def",
    幸: "luck",
    重: "weight",
    耐: "dur",
  };
  const INVENTORY_COLOR_ROW_LABEL = "顏色 ·";
  const INVENTORY_ACTIVE_COLOR_BORDER = "2px solid var(--text-primary)";
  const INVENTORY_ACTIVE_COLOR_GLOW = "0 0 0 1px";
  const INVENTORY_EQUIPMENT_CELL_SELECTOR =
    ".inv-center .grid-wrap .cell.cell--filled";
  const INVENTORY_SELECTED_EQUIPMENT_CELL_SELECTOR =
    ".inv-center .grid-wrap .cell.cell--selected";
  const EQUIPMENT_QUALITY_ROLL_KEY = "quality";
  const INVENTORY_BASE_STAT_FIELDS = [
    { key: "atk", statLabel: "ATK", rollKey: "atk" },
    { key: "def", statLabel: "DEF", rollKey: "def" },
    { key: "luck", statLabel: "LUCK", rollKey: "luck" },
    { key: "weight", statLabel: "WT", rollKey: "weight" },
    { key: "durability", statLabel: "DUR", rollKey: "durability" },
  ];
  const PAD_WIDTH = 2;
  const CRAFT_HOOK_FLAG = "__gaoExtCraftHookInstalled";
  const qualityTable = [
    {
      name: "傳說",
      qualityMult: 2.3,
      weightMult: 0.82,
      min: 0.984,
      max: Infinity,
    },
    {
      name: "神話",
      qualityMult: 2.1,
      weightMult: 0.84,
      min: 0.9648,
      max: 0.984,
    },
    {
      name: "史詩",
      qualityMult: 2,
      weightMult: 0.85,
      min: 0.932,
      max: 0.9648,
    },
    {
      name: "完美",
      qualityMult: 1.85,
      weightMult: 0.87,
      min: 0.8784,
      max: 0.932,
    },
    {
      name: "頂級",
      qualityMult: 1.65,
      weightMult: 0.88,
      min: 0.8024,
      max: 0.8784,
    },
    {
      name: "精良",
      qualityMult: 1.5,
      weightMult: 0.9,
      min: 0.7072,
      max: 0.8024,
    },
    {
      name: "高級",
      qualityMult: 1.33,
      weightMult: 0.93,
      min: 0.6,
      max: 0.7072,
    },
    {
      name: "上等",
      qualityMult: 1.16,
      weightMult: 0.96,
      min: 0.4928,
      max: 0.6,
    },
    {
      name: "普通",
      qualityMult: 1,
      weightMult: 1,
      min: 0.3976,
      max: 0.4928,
    },
    {
      name: "次等",
      qualityMult: 0.9,
      weightMult: 1.01,
      min: 0.3216,
      max: 0.3976,
    },
    {
      name: "劣質",
      qualityMult: 0.8,
      weightMult: 1.02,
      min: 0.268,
      max: 0.3216,
    },
    {
      name: "破爛",
      qualityMult: 0.7,
      weightMult: 1.03,
      min: 0.2344,
      max: 0.268,
    },
    {
      name: "垃圾般",
      qualityMult: 0.55,
      weightMult: 1.06,
      min: 0.216,
      max: 0.2344,
    },
    {
      name: "屎一般",
      qualityMult: 0.4,
      weightMult: 1.1,
      min: -Infinity,
      max: 0.216,
    },
  ];

  let currentPath = "";
  let pageObserver = null;
  let forgeBootstrapObserver = null;
  let queuedMount = false;
  let queuedPageRefresh = false;
  let forgeStatus = "";
  let forgeStatusTone = "";
  let forgeReplayBusy = false;
  let pendingForgeReplayContext = null;
  const pendingCraftRequests = [];
  let latestForgeInventory = [];
  let inventoryItems = [];
  let inventoryById = new Map();
  let equipmentItems = [];
  let equipmentById = new Map();
  const warnings = new Set();

  function boot() {
    installNetworkHooks();
    hookRouteChanges();
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          injectStyles();
          mountForRoute();
        },
        {
          once: true,
        },
      );
      return;
    }
    injectStyles();
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
        syncInventoryDetailEnhancements();
      }, INVENTORY_OBSERVER_OPTIONS);
    }
    if (path === "/forge") return mountForgePage();
    if (path === "/market") {
      return mountObservedPage(document.body, () => {
        enhanceMarketBuyMax();
        enhanceMarketBoardRefresh();
      });
    }
    if (path === "/town") {
      return mountMainObservedPage(syncTownMineMpEstimate);
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
      for (const button of document.querySelectorAll(".recipe__cta")) {
        if (button.dataset.gaoExtBound === "1") continue;
        button.dataset.gaoExtBound = "1";
        button.addEventListener(
          "click",
          () => {
            if (button.disabled) return;
            const recipe = button.closest(".recipe");
            if (!recipe) return;
            const recipeId = readForgeRecipeId(recipe);
            const recipeName = readForgeRecipeName(recipe);
            if (!recipeId && !recipeName) return;
            pendingForgeReplayContext = {
              capturedAt: Date.now(),
              recipeId,
              recipeName,
            };
          },
          {
            capture: true,
          },
        );
      }
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

  function installNetworkHooks() {
    if (window[CRAFT_HOOK_FLAG] === "1") return;
    window[CRAFT_HOOK_FLAG] = "1";
    if (typeof window.fetch !== "function") return;
    const originalFetch = window.fetch;
    window.fetch = async function gaoExtFetch(...args) {
      const [requestInfo, requestInit] = args;
      const url =
        typeof requestInfo === "string"
          ? requestInfo
          : requestInfo instanceof URL
            ? requestInfo.toString()
            : requestInfo?.url
              ? String(requestInfo.url)
              : "";
      const flags = {
        isCraftRequest: requestPathMatches(url, /\/craft\/?$/i),
        isMeRequest: requestPathMatches(url, /\/me\/?$/i),
        isRecipesRequest: requestPathMatches(url, /\/recipes\/?$/i),
        isInventoryItemsRequest: requestPathMatches(
          url,
          /\/api\/inventory\/?$/i,
        ),
        isEquipmentRequest: requestPathMatches(
          url,
          /\/api\/forge\/equipment\/?$/i,
        ),
      };
      let pendingRequestId = "";
      if (flags.isCraftRequest) {
        const body = requestInit?.body;
        const bodyText =
          typeof body === "string"
            ? body
            : body instanceof URLSearchParams
              ? body.toString()
              : typeof requestInfo?.body === "string"
                ? requestInfo.body
                : "";
        const payload = parseJsonText(bodyText);
        if (payload) {
          pendingRequestId = queueCraftRequest(payload);
        }
      }
      const response = await originalFetch.apply(this, args);
      if (flags.isCraftRequest && !response?.ok && pendingRequestId) {
        const index = pendingCraftRequests.findIndex(
          (request) => request.id === pendingRequestId,
        );
        if (index >= 0) {
          pendingCraftRequests.splice(index, 1);
        }
      }
      await handleHookedFetchResponse(url, response, flags);
      return response;
    };
  }

  function requestPathMatches(url, pattern) {
    if (!url) return false;
    try {
      return pattern.test(new URL(url, location.origin).pathname);
    } catch {
      return pattern.test(String(url));
    }
  }

  async function handleHookedFetchResponse(url, response, flags) {
    if (
      !response?.ok ||
      (!flags.isCraftRequest &&
        !flags.isMeRequest &&
        !flags.isRecipesRequest &&
        !flags.isInventoryItemsRequest &&
        !flags.isEquipmentRequest)
    ) {
      return;
    }
    try {
      const payload = parseJsonText(await response.clone().text());
      if (!payload) return;
      if (flags.isMeRequest) {
        writeMeSnapshot(payload);
        return;
      }
      if (flags.isRecipesRequest) {
        mergeForgeMaterialMapFromInventory(payload?.inventory);
        return;
      }
      if (flags.isInventoryItemsRequest) {
        inventoryItems = Array.isArray(payload?.items) ? payload.items : [];
        inventoryById = buildInventoryById(inventoryItems);
        return;
      }
      if (flags.isEquipmentRequest) {
        equipmentItems = Array.isArray(payload?.equipment)
          ? payload.equipment
          : [];
        equipmentById = buildInventoryById(equipmentItems);
        return;
      }
      if (flags.isCraftRequest) {
        handleCraftResponse(payload);
      }
    } catch (error) {
      console.error("GAO extension: fetch hook failed.", url, error);
    }
  }

  function buildInventoryById(items) {
    const next = new Map();
    for (const item of items) {
      const itemId = normalizeNumericId(item?.id);
      if (!itemId) continue;
      next.set(itemId, item);
    }
    return next;
  }

  function queueCraftRequest(payload) {
    let replayContext = null;
    if (pendingForgeReplayContext) {
      const context = pendingForgeReplayContext;
      pendingForgeReplayContext = null;
      if (
        Date.now() - context.capturedAt <=
        PENDING_FORGE_REPLAY_CONTEXT_WINDOW_MS
      ) {
        replayContext = context;
      }
    }
    const resultItemId = normalizeNumericId(payload?.result_item_id);
    const weaponName = String(payload?.weapon_name || "").trim();
    const recipeId =
      normalizeForgeRecipeId(payload?.recipe_id) ||
      replayContext?.recipeId ||
      "";
    const recipeName = String(
      replayContext?.recipeName || payload?.name || "",
    ).trim();
    const materials = resolveCraftRequestMaterials(payload?.materials);
    const request =
      resultItemId && weaponName && materials.length > 0
        ? {
            id: `craft-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            capturedAt: new Date().toISOString(),
            resultItemId,
            weaponName,
            recipeId,
            recipeName,
            materials,
          }
        : null;
    if (!request) return "";
    prunePendingCraftRequests();
    pendingCraftRequests.push(request);
    return request.id;
  }

  function resolveCraftRequestMaterials(materials) {
    if (!Array.isArray(materials) || materials.length === 0) return [];
    if (latestForgeInventory.length > 0) {
      const materialMap = readForgeMaterialMap();
      const missingIds = materials
        .map((material) => normalizeNumericId(material?.item_id))
        .filter((itemId) => itemId && !materialMap[String(itemId)]);
      if (missingIds.length > 0) {
        mergeForgeMaterialMapFromInventory(latestForgeInventory);
      }
    }
    const materialMap = readForgeMaterialMap();
    const resolved = [];
    for (const material of materials) {
      const itemId = normalizeNumericId(material?.item_id);
      const quantity = Number(material?.quantity || 0);
      const name = itemId ? materialMap[String(itemId)] : "";
      if (!itemId || quantity < 1 || !name) {
        console.error("GAO extension: forge material map miss.", {
          material,
          materialMap,
        });
        return [];
      }
      resolved.push({ name, quantity });
    }
    return resolved;
  }

  function prunePendingCraftRequests() {
    const cutoff = Date.now() - PENDING_CRAFT_REQUEST_WINDOW_MS;
    for (let index = pendingCraftRequests.length - 1; index >= 0; index -= 1) {
      const requestTime = Date.parse(pendingCraftRequests[index].capturedAt);
      if (!Number.isNaN(requestTime) && requestTime >= cutoff) continue;
      pendingCraftRequests.splice(index, 1);
    }
  }

  function parseJsonText(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      console.error(error);
      return null;
    }
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
      .gao-ext-history-footer,
      .gao-ext-history-empty,
      .gao-ext-history-status { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-tertiary); }
      .gao-ext-history-status[data-tone="error"] { color: var(--danger-300, #ff8a8a); }
      .gao-ext-history-status[data-tone="success"] { color: var(--lime-300); }
      .gao-ext-history-actions { display: flex; gap: var(--s-2); align-items: flex-start; margin-top: var(--s-2); flex-wrap: wrap; }
      .gao-ext-history-materials { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
      .gao-ext-history-buttons { display: flex; gap: var(--s-2); align-items: flex-start; justify-content: flex-end; margin-left: auto; flex-wrap: wrap; }
      .gao-ext-history-footer { margin-top: var(--s-1); display: flex; gap: 4px; align-items: center; flex-wrap: wrap; color: var(--text-secondary); word-break: break-word; }
      .gao-ext-history-stat[data-roll-tone="muted"] { color: var(--text-muted); }
      .gao-ext-history-stat[data-roll-tone="cyan"] { color: var(--cyan-200); }
      .gao-ext-history-stat[data-roll-tone="gold"] { color: var(--gold-400); }
      .gao-ext-history-separator { color: var(--text-tertiary); }
      .gao-ext-history-replay { font-size: var(--fs-sm); border: 1px solid var(--border-strong); padding: 8px 10px; cursor: pointer; }
      .gao-ext-history-delete { font-size: var(--fs-sm); border: 1px solid var(--border-strong); padding: 8px 10px; cursor: pointer; }
      .gao-ext-history-replay[disabled] { opacity: 0.6; cursor: wait; }
      .gao-ext-history-delete[disabled] { opacity: 0.6; cursor: wait; }
      .gao-ext-mine-estimate { color: var(--text-secondary); }
      .gao-ext-mine-estimate-value { color: var(--lime-300); }
      .gao-ext-mine-estimate[data-state="error"] .gao-ext-mine-estimate-value { color: var(--text-muted); }
      .gao-ext-material-block { margin-top: var(--s-4); border-top: 1px solid var(--border-soft); padding-top: var(--s-4); padding-bottom: var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); }
      .gao-ext-material-title { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); letter-spacing: 0.08em; }
      .gao-ext-material-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
      .gao-ext-material-list { font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); }
      .gao-ext-inline-stat { margin-left: 4px; font-size: 11px; color: var(--text-tertiary); }
      .gao-ext-inline-stat[data-state="error"] { color: var(--danger-300, #ff8a8a); }
    `;
    document.head.appendChild(style);
  }

  function mergeForgeMaterialMapFromInventory(inventory) {
    if (!Array.isArray(inventory) || inventory.length === 0) return;
    latestForgeInventory = inventory;
    const materialMap = readForgeMaterialMap();
    let changed = false;
    for (const item of inventory) {
      const itemId = normalizeNumericId(item?.item_id);
      const name = String(item?.name || "").trim();
      if (!itemId || !name || materialMap[String(itemId)] === name) continue;
      materialMap[String(itemId)] = name;
      changed = true;
    }
    if (changed) {
      writeForgeMaterialMap(materialMap);
    }
  }

  function readForgeMaterialMap() {
    try {
      const raw = localStorage.getItem(FORGE_MATERIAL_MAP_KEY);
      const parsed = JSON.parse(raw || "{}");
      return normalizeForgeMaterialMap(parsed);
    } catch (error) {
      console.error(error);
      return {};
    }
  }

  function writeForgeMaterialMap(materialMap) {
    try {
      localStorage.setItem(
        FORGE_MATERIAL_MAP_KEY,
        JSON.stringify(normalizeForgeMaterialMap(materialMap)),
      );
    } catch (error) {
      console.error(error);
      setForgeStatus("鍛造材料對照表儲存失敗，請查看 console 錯誤。", "error");
    }
  }

  function normalizeForgeMaterialMap(materialMap) {
    if (!materialMap || typeof materialMap !== "object") return {};
    const normalizedEntries = [];
    for (const [itemId, name] of Object.entries(materialMap)) {
      const normalizedId = normalizeNumericId(itemId);
      const normalizedName = String(name || "").trim();
      if (!normalizedId || !normalizedName) continue;
      normalizedEntries.push([String(normalizedId), normalizedName]);
    }
    return Object.fromEntries(normalizedEntries);
  }

  function writeMeSnapshot(payload) {
    if (!payload || typeof payload !== "object") return;
    if (!payload.character || typeof payload.character !== "object") {
      console.error("GAO extension: /me payload has no character.", payload);
      return;
    }
    try {
      localStorage.setItem(
        ME_SNAPSHOT_KEY,
        JSON.stringify({ character: payload.character }),
      );
    } catch (error) {
      console.error("GAO extension: /me snapshot save failed.", error);
    }
  }

  function readMeSnapshot() {
    try {
      const raw = localStorage.getItem(ME_SNAPSHOT_KEY);
      const parsed = JSON.parse(raw || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("GAO extension: /me snapshot read failed.", error);
      return null;
    }
  }

  function handleCraftResponse(payload) {
    const craftedId = normalizeNumericId(payload?.crafted?.id);
    if (!craftedId) return;
    prunePendingCraftRequests();
    const craftedItemId = normalizeNumericId(payload?.crafted?.item_id);
    const weaponName = String(payload?.crafted?.weapon_name || "").trim();
    let request = null;
    for (let index = pendingCraftRequests.length - 1; index >= 0; index -= 1) {
      const pendingRequest = pendingCraftRequests[index];
      if (craftedItemId && pendingRequest.resultItemId !== craftedItemId)
        continue;
      if (weaponName && pendingRequest.weaponName !== weaponName) continue;
      request = pendingCraftRequests.splice(index, 1)[0];
      break;
    }
    if (!request) {
      console.error(
        `GAO extension: /craft response #${craftedId} has no pending request.`,
        payload,
      );
      setForgeStatus("收到 /craft 回應，但找不到對應的鍛造請求。", "error");
      syncForgeHistoryPanel();
      return;
    }
    const crafted = payload.crafted;
    const recipeName = String(request.recipeName || payload?.name || "").trim();
    const entry = {
      id: `crafted-${craftedId}`,
      craftedId,
      atk: Number(crafted?.atk || 0),
      def: Number(crafted?.def || 0),
      luck: Number(crafted?.luck || 0),
      weight: Number(crafted?.weight || 0),
      durability: Number(crafted?.durability || 0),
      createdAt: String(crafted?.created_at || request.capturedAt || ""),
      weaponName: String(crafted?.weapon_name || ""),
      recipeId: normalizeForgeRecipeId(request.recipeId),
      recipeName,
      name_rolls:
        crafted?.name_rolls && typeof crafted.name_rolls === "object"
          ? crafted.name_rolls
          : {},
      qualityName: String(payload.qualityName || ""),
      materials: request.materials,
    };
    const history = readForgeHistory().filter(
      (item) =>
        item.id !== entry.id &&
        (!item.craftedId || item.craftedId !== entry.craftedId),
    );
    writeForgeHistory([entry, ...history].slice(0, FORGE_HISTORY_LIMIT));
    setForgeStatus(
      `已記錄 ${describeForgeRecipe(entry)} / ${entry.weaponName || "未命名"} #${craftedId}。`,
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
    if (!root || !recipeSection) return;
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
      details.addEventListener("click", (event) => {
        const button = event.target.closest("[data-gao-ext-action]");
        if (!button) return;
        event.preventDefault();
        if (button.dataset.gaoExtAction === "replay-forge") {
          void replayForgeHistory(button);
          return;
        }
        if (button.dataset.gaoExtAction !== "delete-forge-history") return;
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
          `已刪除 ${entry.weaponName || "未命名"} 的鍛造紀錄。`,
          "success",
        );
        syncForgeHistoryPanel();
      });
    }
    if (details.nextElementSibling !== recipeSection) {
      root.insertBefore(details, recipeSection);
    }
    const isOpen = details.open;
    const panel = details.querySelector(".gao-ext-panel");
    panel.replaceChildren(...buildForgeHistoryPanelNodes(readForgeHistory()));
    details.open = isOpen;
  }

  function buildForgeHistoryPanelNodes(history) {
    const nodes = [];
    if (forgeStatus) {
      const status = document.createElement("div");
      status.className = "gao-ext-history-status";
      if (forgeStatusTone) status.dataset.tone = forgeStatusTone;
      setTextIfChanged(status, forgeStatus);
      nodes.push(status);
    }
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gao-ext-history-empty";
      setTextIfChanged(empty, "目前還沒有鍛造紀錄。");
      nodes.push(empty);
      return nodes;
    }
    const list = document.createElement("div");
    list.className = "gao-ext-history-list";
    for (const entry of history) {
      const item = document.createElement("article");
      item.className = "gao-ext-history-entry";
      const name = escapeHtml(entry.weaponName || "未命名");
      const meta = escapeHtml(buildForgeHistoryMeta(entry));
      const disabled = forgeReplayBusy ? "disabled" : "";
      const materials = escapeHtml(
        entry.materials
          .map((material) => `${material.name}×${material.quantity}`)
          .join(", "),
      );
      const footer = buildForgeHistoryFooterMarkup(entry);
      item.innerHTML = `
        <div class="gao-ext-history-head">
          <strong class="gao-ext-history-name">${name}</strong>
          <span class="gao-ext-history-meta">${meta}</span>
        </div>
        <div class="gao-ext-history-actions">
          <div class="gao-ext-history-materials">${materials}</div>
          <div class="gao-ext-history-buttons">
            <button
              type="button"
              class="chip gao-ext-history-replay"
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
        </div>
        <div class="gao-ext-history-footer">${footer}</div>
      `;
      list.appendChild(item);
    }
    nodes.push(list);
    return nodes;
  }

  function buildForgeHistoryFooterMarkup(entry) {
    const rollCyanMin = 0.5;
    const rollGoldMin = 0.9;
    const formatValue = (value) => {
      const normalized = Number(value);
      if (!Number.isFinite(normalized)) return "N/A";
      return String(normalized);
    };
    const getRollTone = (value) => {
      const roll = Number(value);
      if (!Number.isFinite(roll) || roll < rollCyanMin) return "muted";
      if (roll < rollGoldMin) return "cyan";
      return "gold";
    };
    return INVENTORY_BASE_STAT_FIELDS.map((field) => {
      const statValue = escapeHtml(formatValue(entry?.[field.key]));
      const rollValue = escapeHtml(
        formatValue(entry?.name_rolls?.[field.rollKey]),
      );
      const tone = getRollTone(entry?.name_rolls?.[field.rollKey]);
      return `<span class="gao-ext-history-stat" data-roll-tone="${tone}">${field.statLabel} ${statValue}(${rollValue})</span>`;
    }).join('<span class="gao-ext-history-separator">/</span>');
  }

  function buildForgeHistoryMeta(entry) {
    const parts = [];
    if (entry.craftedId) parts.push(`#${entry.craftedId}`);
    if (entry.qualityName) parts.push(entry.qualityName);
    if (entry.recipeName) parts.push(entry.recipeName);
    if (entry.createdAt) {
      parts.push(
        new Date(entry.createdAt).toLocaleString("zh-TW", {
          hour12: false,
        }),
      );
    }
    return parts.join(" · ");
  }

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
    const recipeLabel = describeForgeRecipe(entry);
    setForgeStatus(`正在回填 ${recipeLabel} 的材料與名稱...`, "success");
    syncForgeHistoryPanel();
    try {
      await restoreForgeRecipe(entry);
      setForgeStatus(
        `已回填 ${recipeLabel} / ${entry.weaponName || "未命名"}。`,
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

  async function restoreForgeRecipe(entry) {
    if (entry.materials.length === 0) {
      throw new Error("GAO extension: forge history has no materials.");
    }
    const nameInput = document.querySelector(
      'main.forge-main input[type="text"], main.forge-main input',
    );
    if (!nameInput) {
      throw new Error("GAO extension: forge name input not found.");
    }
    if (!findForgeRecipeByHistoryEntry(entry)) {
      throw new Error(
        `GAO extension: recipe ${describeForgeRecipe(entry)} not found.`,
      );
    }
    setInputValue(nameInput, entry.weaponName || "");
    await waitForForgeUi();
    await resetForgeRecipeRows(entry);
    await ensureForgeRecipeRowCount(entry);
    for (const [rowIndex, material] of entry.materials.entries()) {
      await restoreForgeRecipeMaterial(entry, rowIndex, material);
    }
  }

  function findForgeRecipeByHistoryEntry(entry) {
    const expectedRecipeId = normalizeForgeRecipeId(entry.recipeId);
    const expectedRecipeName = String(entry.recipeName || "").trim();
    return (
      [...document.querySelectorAll(".recipe")].find((recipe) => {
        if (
          expectedRecipeId &&
          readForgeRecipeId(recipe) === expectedRecipeId
        ) {
          return true;
        }
        return Boolean(
          expectedRecipeName &&
          readForgeRecipeName(recipe) === expectedRecipeName,
        );
      }) ?? null
    );
  }

  async function resetForgeRecipeRows(entry) {
    for (let index = 0; index < MAX_FORGE_ROWS; index += 1) {
      const recipe = findForgeRecipeByHistoryEntry(entry);
      const remove = recipe?.querySelector(".mat-row__rm");
      if (!remove) return;
      triggerForgeClick(remove);
      await waitForForgeUi();
    }
    if (findForgeRecipeByHistoryEntry(entry)?.querySelector(".mat-row__rm")) {
      throw new Error(
        `GAO extension: failed to reset recipe ${describeForgeRecipe(entry)}.`,
      );
    }
  }

  async function ensureForgeRecipeRowCount(entry) {
    const targetCount = entry.materials.length;
    for (let index = 0; index < MAX_FORGE_ROWS; index += 1) {
      const recipe = findForgeRecipeByHistoryEntry(entry);
      const rowCount = recipe?.querySelectorAll(".mat-row").length ?? 0;
      if (rowCount >= targetCount) return;
      const add = recipe?.querySelector(".mat-add");
      if (!add) {
        throw new Error(
          `GAO extension: add material button missing for ${describeForgeRecipe(entry)}.`,
        );
      }
      triggerForgeClick(add);
      await waitForForgeUi();
    }
    const finalRowCount =
      findForgeRecipeByHistoryEntry(entry)?.querySelectorAll(".mat-row")
        .length ?? 0;
    if (finalRowCount < targetCount) {
      throw new Error(
        `GAO extension: failed to grow recipe ${describeForgeRecipe(entry)} to ${targetCount} rows.`,
      );
    }
  }

  async function restoreForgeRecipeMaterial(entry, rowIndex, material) {
    const row =
      findForgeRecipeByHistoryEntry(entry)?.querySelectorAll(".mat-row")[
        rowIndex
      ];
    const trigger = row?.querySelector(".ss__trigger");
    if (!row || !trigger) {
      throw new Error(`GAO extension: forge row ${rowIndex + 1} not found.`);
    }
    triggerForgeClick(trigger);
    await waitForForgeUi();
    const input = document.querySelector(".ss__search-input");
    if (!input) {
      throw new Error("GAO extension: material search input not found.");
    }
    setInputValue(input, material.name);
    await waitForForgeUi();
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
    triggerForgeClick(option);
    await waitForForgeUi();
    await setForgeRecipeMaterialQuantity(entry, rowIndex, material.quantity);
  }

  async function setForgeRecipeMaterialQuantity(entry, rowIndex, quantity) {
    for (
      let currentQuantity = 1;
      currentQuantity < quantity;
      currentQuantity += 1
    ) {
      const row =
        findForgeRecipeByHistoryEntry(entry)?.querySelectorAll(".mat-row")[
          rowIndex
        ];
      const plus = row?.querySelector(".mat-row__qty .qbtn:last-child");
      if (!plus || plus.disabled) {
        throw new Error(
          `GAO extension: insufficient stock for row ${rowIndex + 1}.`,
        );
      }
      triggerForgeClick(plus);
      await waitForForgeUi();
    }
  }

  function waitForForgeUi() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, MAX_DELAY_MS));
    });
  }

  function triggerForgeClick(element) {
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
  }

  function describeForgeRecipe(entry) {
    return entry.recipeName || entry.recipeId || "這筆配方";
  }

  function normalizeNumericId(value) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 1) return null;
    return normalized;
  }

  function normalizeForgeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const craftedId = normalizeNumericId(entry.craftedId);
    if (!craftedId) return null;
    const recipeName = String(entry.recipeName || "").trim();
    return {
      id: String(entry.id || `crafted-${craftedId}`),
      craftedId,
      atk: Number(entry.atk || 0),
      def: Number(entry.def || 0),
      luck: Number(entry.luck || 0),
      weight: Number(entry.weight || 0),
      durability: Number(entry.durability || 0),
      createdAt: String(entry.createdAt || ""),
      weaponName: String(entry.weaponName || ""),
      recipeId: normalizeForgeRecipeId(entry.recipeId),
      recipeName,
      name_rolls:
        entry.name_rolls && typeof entry.name_rolls === "object"
          ? entry.name_rolls
          : {},
      qualityName: String(entry.qualityName || ""),
      materials: normalizeForgeMaterials(entry.materials),
    };
  }

  function normalizeForgeMaterials(materials) {
    if (!Array.isArray(materials)) return [];
    return materials
      .map((material) => {
        const name = String(material?.name || "").trim();
        const quantity = Number(material?.quantity ?? material?.qty ?? 0);
        if (!name || quantity < 1) return null;
        return { name, quantity };
      })
      .filter(Boolean);
  }

  function normalizeForgeRecipeId(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function readForgeHistory() {
    try {
      const raw = localStorage.getItem(FORGE_HISTORY_KEY);
      const parsed = JSON.parse(raw || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeForgeHistoryEntry).filter(Boolean);
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

  function syncTownMineMpEstimate() {
    const current = document.querySelector(`[${ATTR}="town-mine-mp-estimate"]`);
    const stats = document.querySelector(".mine-stats");
    if (!stats) {
      current?.remove();
      return;
    }
    const elapsedSeconds = readTownMineElapsedSeconds();
    const character = readMeSnapshot()?.character;
    const hasCharacter = character && typeof character === "object";
    const efficiency = Number(character?.talents?.efficiency ?? 0);
    const characterMP = Number(character?.mp ?? 0);
    const defaultMpCost = Math.floor(
      elapsedSeconds / 60 / (3 / (1 + 0.02 * efficiency)),
    );
    const mpCost =
      hasCharacter && elapsedSeconds != null
        ? Math.floor(Math.min(defaultMpCost, characterMP))
        : null;
    const signature = `${elapsedSeconds ?? "na"}|${hasCharacter ? efficiency : "no-character"}|${mpCost ?? "na"}`;
    const estimate = current || document.createElement("span");
    if (estimate.dataset.gaoExtSignature === signature) return;
    estimate.dataset.gaoExtSignature = signature;
    estimate.className = "gao-ext-mine-estimate";
    estimate.setAttribute(ATTR, "town-mine-mp-estimate");
    if (!hasCharacter || elapsedSeconds == null) {
      estimate.dataset.state = "error";
    } else {
      delete estimate.dataset.state;
    }
    estimate.innerHTML = ` · expected_mp = <span class="gao-ext-mine-estimate-value">${escapeHtml(mpCost == null ? "N/A" : String(mpCost))}</span> ${escapeHtml("(重整刷新)")}`;
    if (!current) {
      stats.append(estimate);
    }
  }

  function readTownMineElapsedSeconds() {
    if (!document.querySelector(".mine-active")) return 0;
    const elapsedValue = [...document.querySelectorAll(".mine-info__row")]
      .find((row) =>
        String(row.querySelector(".mine-info__lab")?.textContent || "")
          .trim()
          .toLowerCase()
          .includes("elapsed"),
      )
      ?.querySelector(".mine-info__val")?.textContent;
    return (
      parseMineDurationSeconds(elapsedValue) ??
      parseMineDurationSeconds(
        document.querySelector(".mine-gauge__time")?.textContent,
      )
    );
  }

  function parseMineDurationSeconds(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const colonParts = text
      .split(":")
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part));
    if (colonParts.length === 2) {
      return colonParts[0] * 60 + colonParts[1];
    }
    if (colonParts.length === 3) {
      return colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2];
    }
    const hours = Number(text.match(/(\d+)\s*(?:h|hr|hour|hours|小時)/i)?.[1]);
    const minutes = Number(
      text.match(/(\d+)\s*(?:m|min|mins|minute|minutes|分鐘|分)/i)?.[1],
    );
    const seconds = Number(
      text.match(/(\d+)\s*(?:s|sec|secs|second|seconds|秒)/i)?.[1],
    );
    if (
      !Number.isFinite(hours) &&
      !Number.isFinite(minutes) &&
      !Number.isFinite(seconds)
    ) {
      return null;
    }
    return (
      (Number.isFinite(hours) ? hours : 0) * 3600 +
      (Number.isFinite(minutes) ? minutes : 0) * 60 +
      (Number.isFinite(seconds) ? seconds : 0)
    );
  }

  function setForgeStatus(message, tone) {
    forgeStatus = message;
    forgeStatusTone = tone;
  }

  function readForgeRecipeId(recipe) {
    return normalizeForgeRecipeId(
      recipe?.querySelector(".recipe__id")?.textContent,
    );
  }

  function readForgeRecipeName(recipe) {
    return String(
      recipe?.querySelector(".recipe__name")?.textContent || "",
    ).trim();
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  // 背包詳情切換時，同步這件裝備的鍛造材料摘要與原始最大屬性。
  function syncInventoryDetailEnhancements() {
    const detail = document.querySelector(".inv-right .detail-card");
    if (!detail) return;
    syncVisibleEquipmentItemIds();
    const selected = document.querySelector(
      INVENTORY_SELECTED_EQUIPMENT_CELL_SELECTOR,
    );
    const itemId = normalizeNumericId(selected?.dataset.gaoExtItemId);
    if (selected && !itemId) {
      warnOnce(
        "inventory-selected-item-id",
        "GAO extension: selected inventory item id missing.",
      );
    }
    const equipment = itemId ? (equipmentById.get(itemId) ?? null) : null;
    const entry = itemId
      ? (readForgeHistory().find(
          (historyEntry) => historyEntry.craftedId === itemId,
        ) ?? null)
      : null;
    renderInventoryBaseStatsInline(detail, itemId, equipment);
    renderInventoryForgeMaterials(detail, itemId, entry);
  }

  function syncVisibleEquipmentItemIds() {
    const cells = [
      ...document.querySelectorAll(INVENTORY_EQUIPMENT_CELL_SELECTOR),
    ];
    if (cells.length === 0) return;
    const categoryButtons = [...document.querySelectorAll(".inv-left .cat")];
    const activeCategoryIndex = categoryButtons.findIndex((button) =>
      button.classList.contains("cat--active"),
    );
    const colorRow = [...document.querySelectorAll(".inv-center > div")].find(
      (element) =>
        String(element.textContent || "").includes(INVENTORY_COLOR_ROW_LABEL),
    );
    const colorButtons = colorRow
      ? [...colorRow.querySelectorAll("button")].slice(1)
      : [];
    const activeColorIndex = colorButtons.findIndex((button) => {
      const style = button?.getAttribute?.("style") || "";
      return (
        style.includes(INVENTORY_ACTIVE_COLOR_BORDER) &&
        style.includes(INVENTORY_ACTIVE_COLOR_GLOW)
      );
    });
    const sortLabel = String(
      document.querySelector(".inv-center .toolbar .seg__btn--active")
        ?.textContent || "",
    ).trim();
    const uiState = {
      categoryKey: INVENTORY_CATEGORY_KEYS[activeCategoryIndex] ?? null,
      colorKey: INVENTORY_COLOR_OPTIONS[activeColorIndex]?.key ?? null,
      searchText: String(
        document.querySelector(".inv-center .toolbar input")?.value || "",
      ).trim(),
      sortKey: INVENTORY_SORT_KEY_BY_LABEL[sortLabel] || "quality",
    };
    const visibleIds =
      uiState.categoryKey &&
      uiState.categoryKey !== "all" &&
      uiState.categoryKey !== "weapon"
        ? []
        : filterAndSortEquipmentItems(equipmentItems, uiState)
            .map((item) => normalizeNumericId(item?.id ?? item?.item_id))
            .filter(Boolean);
    for (const [index, cell] of cells.entries()) {
      const itemId = visibleIds[index];
      if (itemId) {
        const nextValue = String(itemId);
        if (cell.dataset.gaoExtItemId !== nextValue) {
          cell.dataset.gaoExtItemId = nextValue;
        }
        continue;
      }
      if (cell.dataset.gaoExtItemId) {
        delete cell.dataset.gaoExtItemId;
      }
    }
  }

  function filterAndSortEquipmentItems(items, uiState) {
    const searchText = uiState.searchText.toLowerCase();
    return items
      .filter(
        (item) => !uiState.colorKey || item?.color_tag === uiState.colorKey,
      )
      .filter((item) => {
        if (!searchText) return true;
        return String(item?.weapon_name ?? item?.name ?? "")
          .toLowerCase()
          .includes(searchText);
      })
      .slice()
      .sort((left, right) =>
        compareEquipmentItems(left, right, uiState.sortKey),
      );
  }

  function compareEquipmentItems(left, right, sortKey) {
    switch (sortKey) {
      case "quality":
        return (
          (right?.name_rolls?.quality ?? -1) - (left?.name_rolls?.quality ?? -1)
        );
      case "time":
        return (
          new Date(right?.created_at ?? 0).getTime() -
          new Date(left?.created_at ?? 0).getTime()
        );
      case "type":
        return String(left?.name ?? "").localeCompare(
          String(right?.name ?? ""),
        );
      case "atk":
        return Number(right?.atk || 0) - Number(left?.atk || 0);
      case "def":
        return Number(right?.def || 0) - Number(left?.def || 0);
      case "luck":
        return Number(right?.luck || 0) - Number(left?.luck || 0);
      case "weight":
        return Number(right?.weight || 0) - Number(left?.weight || 0);
      case "dur":
        return Number(right?.durability || 0) - Number(left?.durability || 0);
      default:
        return 0;
    }
  }

  function renderInventoryBaseStatsInline(detail, itemId, equipment) {
    const signature =
      itemId && equipment
        ? [
            itemId,
            equipment?.name_rolls?.[EQUIPMENT_QUALITY_ROLL_KEY] ?? "",
            ...INVENTORY_BASE_STAT_FIELDS.flatMap((field) => [
              equipment?.[field.key] ?? "",
              equipment?.name_rolls?.[field.rollKey] ?? "",
            ]),
          ].join("|")
        : "none";
    if (
      detail.dataset.gaoExtBaseStats === signature &&
      hasRenderedInventoryBaseStats(detail, equipment)
    ) {
      return;
    }
    detail.dataset.gaoExtBaseStats = signature;
    for (const element of detail.querySelectorAll(
      `[${ATTR}="inventory-base-stat-inline"]`,
    )) {
      element.remove();
    }
    if (!equipment) return;
    const qualityRoll = readPositiveRoll(
      equipment?.name_rolls?.[EQUIPMENT_QUALITY_ROLL_KEY],
    );
    const valueByLabel = new Map(
      INVENTORY_BASE_STAT_FIELDS.map((field) =>
        buildInventoryBaseStatRow({ equipment, field, qualityRoll }),
      ).map((stat) => [stat.statLabel, stat]),
    );
    for (const row of detail.querySelectorAll(".stats-grid .sg-row")) {
      const label = String(
        row.querySelector(".sg-row__l")?.textContent || "",
      ).trim();
      const stat = valueByLabel.get(label);
      const valueNode = row.querySelector(".sg-row__v");
      if (!stat || !valueNode) continue;
      const element = document.createElement("span");
      element.className = "gao-ext-inline-stat";
      element.setAttribute(ATTR, "inventory-base-stat-inline");
      if (stat.error) {
        element.dataset.state = "error";
      }
      element.textContent = stat.error
        ? `(${stat.error})`
        : `(${String(stat.value)})`;
      valueNode.append(element);
    }
  }

  function calculateBaseStatValue({
    currentValue,
    nameRoll,
    quality,
    statLabel,
  }) {
    if (statLabel === "WT") {
      return Math.floor((currentValue * nameRoll) / quality.weightMult);
    }

    return Math.floor(currentValue / nameRoll / quality.qualityMult);
  }

  function getQualityByRoll(qualityRoll) {
    const roll = Number(qualityRoll);

    if (!Number.isFinite(roll)) {
      return null;
    }

    return (
      qualityTable.find((row) => roll > row.min && roll <= row.max) ?? null
    );
  }

  function buildInventoryBaseStatRow(options) {
    const { equipment, field, qualityRoll } = options;

    const currentValue = Number(equipment?.[field.key]);
    const nameRoll = readPositiveRoll(equipment?.name_rolls?.[field.rollKey]);
    const quality = getQualityByRoll(qualityRoll);

    if (!Number.isFinite(currentValue) || !quality || !nameRoll) {
      return {
        statLabel: field.statLabel,
        error: "N/A",
        value: null,
      };
    }

    return {
      statLabel: field.statLabel,
      error: "",
      value: calculateBaseStatValue({
        currentValue,
        nameRoll,
        quality,
        statLabel: field.statLabel,
      }),
    };
  }

  function hasRenderedInventoryBaseStats(detail, equipment) {
    if (!equipment) {
      return (
        detail.querySelectorAll(`[${ATTR}="inventory-base-stat-inline"]`)
          .length === 0
      );
    }
    return (
      detail.querySelectorAll(`[${ATTR}="inventory-base-stat-inline"]`)
        .length === INVENTORY_BASE_STAT_FIELDS.length
    );
  }

  function readPositiveRoll(value) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) return null;
    return normalized;
  }

  function renderInventoryForgeMaterials(detail, itemId, entry) {
    const signature = itemId && entry ? `${itemId}|${entry.id}` : "none";
    if (detail.dataset.gaoExtForgeMaterials === signature) return;
    detail.dataset.gaoExtForgeMaterials = signature;
    detail.querySelector(`[${ATTR}="inventory-materials"]`)?.remove();
    if (!entry) return;
    const materials = escapeHtml(
      entry.materials
        .map((material) => `${material.name}×${material.quantity}`)
        .join(", "),
    );
    const block = document.createElement("div");
    block.className = "gao-ext-material-block";
    block.setAttribute(ATTR, "inventory-materials");
    block.innerHTML = `
      <div class="gao-ext-material-title">${escapeHtml("使用材料 / FORGE MATERIALS")}</div>
      <div class="gao-ext-material-meta">${escapeHtml(buildForgeHistoryMeta(entry))}</div>
      <div class="gao-ext-material-list">${materials}</div>
    `;
    const anchor = detail.querySelector(".actions") ?? detail.lastElementChild;
    anchor?.insertAdjacentElement("beforebegin", block);
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
