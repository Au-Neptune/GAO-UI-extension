// ==UserScript==
// @name         Gun Art Online UI Extension
// @namespace    o_z_
// @version      0.4.1
// @description  Gun Art Online 前端加強輔助，提供鍛造歷史紀錄、裝備分數及白值顯示、戰報摺疊、背景風格轉換等功能。此加強插件保證不會自動發送api請求，也不會修改任何現有的api請求參數。
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
  const BATTLE_SIGNATURE_LINE_COUNT = 2;
  const FORGE_HISTORY_KEY = "gao-ext-forge-history-v2";
  const FORGE_MATERIAL_MAP_KEY = "gao-ext-forge-material-map-v1";
  const ME_SNAPSHOT_KEY = "gao-ext-me-snapshot-v1";
  const DISPLAY_THEME_KEY = "gao-ext-display-theme-v1";
  const DISPLAY_BACKGROUND_DISABLED_KEY =
    "gao-ext-display-background-disabled-v1";
  const DEFAULT_DISPLAY_THEME_ID = "original";
  const DEFAULT_BACKGROUND_DISABLED = false;
  const DISPLAY_THEMES = Object.freeze({
    original: Object.freeze({
      label: "原始網頁風格（預設）",
      css: "",
    }),
    "twitter-dim": Object.freeze({
      label: "Twitter / X 黯藍主題 (Dim Mode)",
      css: `
        :root {
          --bg-void: #10171e;
          --bg-deep: #15202b;
          --bg-panel: #1e2732;
          --bg-elevated: #273340;
          --bg-input: #19212a;
          --bg-overlay: rgba(21, 32, 43, 0.78);
          --border-faint: rgba(56, 68, 77, 0.15);
          --border-soft: rgba(56, 68, 77, 0.35);
          --border-default: #38444d;
          --border-strong: #516270;
          --text-primary: #ffffff;
          --text-secondary: #e1e8ed;
          --text-tertiary: #aab8c2;
          --text-muted: #8594a6;
          --text-inverse: #15202b;
        }
      `,
    }),
    "twitter-black": Object.freeze({
      label: "Twitter / X 極緻純黑",
      css: `
        :root {
          --bg-void: #000000;
          --bg-deep: #000000;
          --bg-panel: #15181c;
          --bg-elevated: #202327;
          --bg-input: #16181c;
          --bg-overlay: rgba(0, 0, 0, 0.8);
          --border-faint: rgba(47, 51, 54, 0.2);
          --border-soft: rgba(47, 51, 54, 0.4);
          --border-default: #2f3336;
          --border-strong: #454b50;
          --text-primary: #e7e9ea;
          --text-secondary: #cdd9e5;
          --text-tertiary: #909dab;
          --text-muted: #768390;
          --text-inverse: #000000;
        }
      `,
    }),
    discord: Object.freeze({
      label: "Discord 經典暗灰主題",
      css: `
        :root {
          --bg-void: #111214;
          --bg-deep: #1e1f22;
          --bg-panel: #2b2d31;
          --bg-elevated: #313338;
          --bg-input: #1e1f22;
          --bg-overlay: rgba(17, 18, 20, 0.8);
          --border-faint: rgba(63, 65, 71, 0.2);
          --border-soft: rgba(63, 65, 71, 0.4);
          --border-default: #3f4147;
          --border-strong: #4e5058;
          --text-primary: #f2f3f5;
          --text-secondary: #dbdee1;
          --text-tertiary: #a5a9b0;
          --text-muted: #80848e;
          --text-inverse: #111214;
        }
      `,
    }),
    facebook: Object.freeze({
      label: "Facebook 舒適暖灰主題",
      css: `
        :root {
          --bg-void: #121213;
          --bg-deep: #18191a;
          --bg-panel: #242526;
          --bg-elevated: #2f3032;
          --bg-input: #3a3b3c;
          --bg-overlay: rgba(18, 18, 19, 0.83);
          --border-faint: rgba(62, 64, 66, 0.25);
          --border-soft: rgba(62, 64, 66, 0.45);
          --border-default: #3e4042;
          --border-strong: #505356;
          --text-primary: #ffffff;
          --text-secondary: #e4e6eb;
          --text-tertiary: #b0b3b8;
          --text-muted: #94969b;
          --text-inverse: #18191a;
        }
      `,
    }),
  });
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
  const EQUIPMENT_QUALITY_ROLL_KEY = "quality";
  const INVENTORY_LAYOUT_MODE_GRID = "grid";
  const INVENTORY_LAYOUT_MODE_LIST = "list";
  const INVENTORY_LAYOUT_MODE_KEY = "gao-ext-inventory-layout-v1";
  const INVENTORY_EQUIPMENT_GRID_SELECTOR = ".inv-center .grid-wrap .igrid";
  const INVENTORY_QUALITY_COLOR_BY_NAME = Object.freeze({
    傳說: "var(--q-legendary)",
    神話: "var(--q-mythic)",
    史詩: "var(--q-epic)",
    完美: "var(--q-rare)",
    頂級: "var(--q-rare)",
    精良: "var(--q-superior)",
    高級: "var(--q-fine)",
    上等: "var(--q-uncommon)",
    普通: "var(--q-common)",
    次等: "var(--q-poor)",
    劣質: "var(--q-trash)",
    破爛: "var(--q-trash)",
    垃圾般: "var(--q-shit)",
    屎一般: "var(--q-shit)",
  });
  const INVENTORY_SLOT_LABEL_BY_KEY = Object.freeze({
    head: "頭部",
    body: "身體",
    gloves: "手套",
    shoes: "鞋子",
    main_hand: "主手",
    off_hand: "副手",
    underwear: "內衣",
    necklace: "項鍊",
    ring: "戒指",
    earring: "耳環",
  });
  const INVENTORY_TYPE_LABEL_BY_TAG = Object.freeze({
    Katana: "太刀",
    Sword: "單手劍",
    Dagger: "短刀",
    Rapier: "細劍",
    Axe: "雙手斧",
    GreatSword: "雙手劍",
    Bow: "弓",
    Pistol: "手槍",
    SMG: "衝鋒槍",
    LMG: "輕機槍",
    Sniper: "狙擊槍",
    Shield: "盾牌",
    BareHand: "空手",
    Universal: "通用",
    Gun: "通用槍械",
    Chain: "鎖鏈",
  });
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
  let equipmentItems = [];
  let equipmentById = new Map();
  let inventoryEquipmentLayoutMode = readInventoryEquipmentLayoutMode();
  const inventoryEquipmentListRenderStates = new WeakMap();
  const warnings = new Set();

  function boot() {
    installNetworkHooks();
    hookRouteChanges();
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          injectStyles();
          applyDisplayPreferences(readDisplayPreferences());
          mountForRoute();
        },
        {
          once: true,
        },
      );
      return;
    }
    injectStyles();
    applyDisplayPreferences(readDisplayPreferences());
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
        syncInventoryEquipmentListLayout();
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
    if (path === "/settings") {
      return mountMainObservedPage(syncSettingsDisplayOptions);
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
      await handleHookedFetchResponse({
        url,
        response,
        flags,
        pendingRequestId,
      });
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

  async function handleHookedFetchResponse(options) {
    const { url, response, flags, pendingRequestId } = options;
    if (
      !response?.ok ||
      (!flags.isCraftRequest &&
        !flags.isMeRequest &&
        !flags.isRecipesRequest &&
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
      if (flags.isEquipmentRequest) {
        equipmentItems = Array.isArray(payload?.equipment)
          ? payload.equipment
          : [];
        const nextEquipmentById = new Map();
        for (const item of equipmentItems) {
          const itemId = normalizeNumericId(item?.id);
          if (!itemId) continue;
          nextEquipmentById.set(itemId, item);
        }
        equipmentById = nextEquipmentById;
        return;
      }
      if (flags.isCraftRequest) {
        handleCraftResponse(payload, pendingRequestId);
      }
    } catch (error) {
      console.error("GAO extension: fetch hook failed.", url, error);
    }
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
    let materialMap = readForgeMaterialMap();
    const hasMissingIds = materials.some((material) => {
      const itemId = normalizeNumericId(material?.item_id);
      return Boolean(itemId && !materialMap[String(itemId)]);
    });
    if (hasMissingIds && latestForgeInventory.length > 0) {
      const merged = mergeForgeMaterialMapEntries({
        materialMap,
        inventory: latestForgeInventory,
      });
      materialMap = merged.materialMap;
      if (merged.changed) {
        writeForgeMaterialMap(materialMap);
      }
    }
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
      .gao-ext-inventory-layout-toggle { font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px; padding: 2px 8px; border: 1px solid var(--border-soft); background: none; color: var(--text-muted); cursor: pointer; }
      .gao-ext-inventory-layout-toggle[data-mode="list"] { color: var(--cyan-300); border-color: var(--cyan-400); background: rgba(0, 203, 240, 0.08); }
      .gao-ext-inventory-list { display: flex; flex-direction: column; gap: 6px; width: 100%; max-height: 600px; overflow-y: auto; overflow-x: hidden; padding-right: 4px; box-sizing: border-box; }
      .gao-ext-inventory-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--bg-panel); border: 1px solid var(--border-soft); cursor: pointer; transition: all 0.15s ease-out; box-sizing: border-box; width: 100%; font: inherit; text-align: left; }
      .gao-ext-inventory-row:hover { background: rgba(255, 255, 255, 0.02); border-color: var(--border-strong); }
      .gao-ext-inventory-row[data-selected="true"] { background: rgba(0, 203, 240, 0.08); border-color: var(--cyan-400); box-shadow: 0 0 12px rgba(0, 203, 240, 0.15); }
      .gao-ext-inventory-row-main { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; margin-right: 12px; }
      .gao-ext-inventory-row-type { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); width: 32px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gao-ext-inventory-row-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gao-ext-inventory-row-marker { font-size: 10px; flex-shrink: 0; font-family: var(--font-mono); font-weight: 600; }
      .gao-ext-inventory-row-stats { display: grid; grid-template-columns: 62px 56px 52px 52px 90px; gap: 2px; flex-shrink: 0; text-align: left; }
      .gao-ext-inventory-stat-tag { color: var(--text-muted); margin-right: 4px; font-size: 10px; }
      .gao-ext-inventory-stat-value { font-weight: 500; color: var(--lime-300); }
      .gao-ext-inventory-stat-value[data-broken="true"] { color: var(--red-400); }
      .gao-ext-settings-stack { display: flex; flex-direction: column; gap: var(--s-3); margin-top: var(--s-3); }
      .gao-ext-settings-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-4); background: var(--bg-elevated); border: 1px solid var(--border-faint); }
      .gao-ext-settings-copy { min-width: 0; }
      .gao-ext-settings-title { font-family: var(--font-display); font-size: var(--fs-xs); font-weight: 700; letter-spacing: var(--tracking-wider); text-transform: uppercase; color: var(--text-primary); margin-bottom: 6px; }
      .gao-ext-settings-description { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); line-height: var(--lh-relax); }
      .gao-ext-settings-toggle { flex-shrink: 0; position: relative; width: 56px; height: 28px; background: var(--bg-input); border: 1px solid var(--border-soft); box-shadow: none; clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px); transition: all var(--dur-med); cursor: pointer; }
      .gao-ext-settings-toggle span { position: absolute; top: 4px; bottom: 4px; width: 20px; left: 4px; background: var(--border-default); box-shadow: none; clip-path: polygon(2px 0, 100% 0, 100% calc(100% - 2px), calc(100% - 2px) 100%, 0 100%, 0 2px); transition: all var(--dur-med); }
      .gao-ext-settings-toggle[data-enabled="true"] { background: var(--cyan-500); border-color: var(--cyan-300); }
      .gao-ext-settings-toggle[data-enabled="true"] span { left: 30px; background: var(--bg-void); }
      .gao-ext-settings-select { flex: 0 1 280px; min-width: 180px; padding: 8px 10px; background: var(--bg-input); border: 1px solid var(--border-soft); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-xs); }
    `;
    document.head.appendChild(style);
  }

  function syncSettingsDisplayOptions() {
    let block = null;
    for (const heading of document.querySelectorAll(".blk__title")) {
      if (!heading.textContent?.includes("Display")) continue;
      block = heading.closest(".blk");
      break;
    }
    if (!block) return;
    let controls = block.querySelector(`[${ATTR}="settings-display-options"]`);
    if (!controls) {
      controls = createSettingsDisplayControls();
      block.appendChild(controls);
    }
    const preferences = readDisplayPreferences();
    const toggle = controls.querySelector(
      `[${ATTR}="settings-background-toggle"]`,
    );
    toggle.dataset.enabled = String(preferences.backgroundDisabled);
    toggle.setAttribute("aria-pressed", String(preferences.backgroundDisabled));
    const select = controls.querySelector(`[${ATTR}="settings-theme-select"]`);
    select.value = preferences.themeId;
    applyDisplayPreferences(preferences);
  }

  function createSettingsDisplayControls() {
    const controls = document.createElement("div");
    controls.className = "gao-ext-settings-stack";
    controls.setAttribute(ATTR, "settings-display-options");
    const backgroundToggle = document.createElement("button");
    backgroundToggle.type = "button";
    backgroundToggle.className = "gao-ext-settings-toggle";
    backgroundToggle.setAttribute(ATTR, "settings-background-toggle");
    backgroundToggle.setAttribute("aria-label", "關閉背景亮光及格子");
    backgroundToggle.appendChild(document.createElement("span"));
    backgroundToggle.addEventListener("click", () => {
      const preferences = readDisplayPreferences();
      writeDisplayPreferences({
        ...preferences,
        backgroundDisabled: !preferences.backgroundDisabled,
      });
      syncSettingsDisplayOptions();
    });
    const themeSelect = document.createElement("select");
    themeSelect.className = "gao-ext-settings-select";
    themeSelect.setAttribute(ATTR, "settings-theme-select");
    themeSelect.setAttribute("aria-label", "畫面風格");
    for (const [themeId, theme] of Object.entries(DISPLAY_THEMES)) {
      const option = document.createElement("option");
      option.value = themeId;
      option.textContent = theme.label;
      themeSelect.appendChild(option);
    }
    themeSelect.addEventListener("change", () => {
      const preferences = readDisplayPreferences();
      writeDisplayPreferences({ ...preferences, themeId: themeSelect.value });
    });
    controls.append(
      createSettingsDisplayRow({
        title: "BACKGROUND EFFECTS / 關閉背景亮光及格子",
        description: "移除全頁背景亮光與格子 · 僅影響本裝置",
        control: backgroundToggle,
      }),
      createSettingsDisplayRow({
        title: "VISUAL STYLE / 畫面風格",
        description: "選擇介面配色；可切回原始網頁風格 · 僅影響本裝置",
        control: themeSelect,
      }),
    );
    return controls;
  }

  function createSettingsDisplayRow(options) {
    const row = document.createElement("div");
    row.className = "gao-ext-settings-row";
    const copy = document.createElement("div");
    copy.className = "gao-ext-settings-copy";
    const title = document.createElement("div");
    title.className = "gao-ext-settings-title";
    title.textContent = options.title;
    const description = document.createElement("div");
    description.className = "gao-ext-settings-description";
    description.textContent = options.description;
    copy.append(title, description);
    row.append(copy, options.control);
    return row;
  }

  function readDisplayPreferences() {
    const themeId =
      localStorage.getItem(DISPLAY_THEME_KEY) ?? DEFAULT_DISPLAY_THEME_ID;
    if (!Object.hasOwn(DISPLAY_THEMES, themeId)) {
      throw new Error(`GAO extension: unsupported display theme "${themeId}".`);
    }
    const backgroundValue = localStorage.getItem(
      DISPLAY_BACKGROUND_DISABLED_KEY,
    );
    if (
      backgroundValue !== null &&
      backgroundValue !== "true" &&
      backgroundValue !== "false"
    ) {
      throw new Error("GAO extension: invalid background preference.");
    }
    return Object.freeze({
      themeId,
      backgroundDisabled:
        backgroundValue === null
          ? DEFAULT_BACKGROUND_DISABLED
          : backgroundValue === "true",
    });
  }

  function writeDisplayPreferences(preferences) {
    localStorage.setItem(DISPLAY_THEME_KEY, preferences.themeId);
    localStorage.setItem(
      DISPLAY_BACKGROUND_DISABLED_KEY,
      String(preferences.backgroundDisabled),
    );
    applyDisplayPreferences(preferences);
  }

  function applyDisplayPreferences(preferences) {
    const theme = DISPLAY_THEMES[preferences.themeId];
    const backgroundCss = preferences.backgroundDisabled
      ? "#root { background: none; } .gao-bg { background:none; } html[data-bg=on] #root, html[data-bg=on] .gao-bg { background-image: none; }"
      : "";
    let style = document.querySelector(`style[${ATTR}="display-preferences"]`);
    if (!style) {
      style = document.createElement("style");
      style.setAttribute(ATTR, "display-preferences");
      document.head.appendChild(style);
    }
    style.textContent = `${theme.css}\n${backgroundCss}`;
  }

  function mergeForgeMaterialMapFromInventory(inventory) {
    if (!Array.isArray(inventory) || inventory.length === 0) return;
    latestForgeInventory = inventory;
    const materialMap = readForgeMaterialMap();
    const merged = mergeForgeMaterialMapEntries({
      materialMap,
      inventory,
    });
    if (merged.changed) {
      writeForgeMaterialMap(merged.materialMap);
    }
  }

  function mergeForgeMaterialMapEntries(options) {
    const { materialMap, inventory } = options;
    const entries = { ...materialMap };
    let changed = false;
    for (const item of inventory) {
      const itemId = normalizeNumericId(item?.item_id);
      const name = String(item?.name || "").trim();
      if (!itemId || !name || entries[String(itemId)] === name) continue;
      entries[String(itemId)] = name;
      changed = true;
    }
    return {
      materialMap: changed ? entries : materialMap,
      changed,
    };
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

  function handleCraftResponse(payload, pendingRequestId) {
    const crafted = payload?.crafted;
    const craftedId = normalizeNumericId(crafted?.id);
    if (!craftedId) return;
    prunePendingCraftRequests();
    let request = null;
    if (pendingRequestId) {
      const index = pendingCraftRequests.findIndex(
        (pendingRequest) => pendingRequest.id === pendingRequestId,
      );
      if (index >= 0) {
        request = pendingCraftRequests.splice(index, 1)[0];
      }
    }
    if (!request) {
      console.error(
        `GAO extension: /craft response #${craftedId} has no pending request.`,
        { pendingRequestId, payload },
      );
      setForgeStatus("收到 /craft 回應，但找不到對應的鍛造請求。", "error");
      syncForgeHistoryPanel();
      return;
    }
    const craftedItemId = normalizeNumericId(crafted?.item_id);
    const weaponName = String(crafted?.weapon_name || "").trim();
    const responseMismatched =
      (craftedItemId && request.resultItemId !== craftedItemId) ||
      (weaponName && request.weaponName !== weaponName);
    if (responseMismatched) {
      console.error("GAO extension: /craft response mismatched request.", {
        request,
        payload,
      });
      setForgeStatus("收到 /craft 回應，但與鍛造請求不一致。", "error");
      syncForgeHistoryPanel();
      return;
    }
    const entry = buildForgeHistoryEntry({
      payload,
      request,
      crafted,
      craftedId,
    });
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

  function buildForgeHistoryEntry(options) {
    const { payload, request, crafted, craftedId } = options;
    const recipeName = String(request.recipeName || payload?.name || "").trim();
    return {
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
        const quantity = Number(material?.quantity ?? 0);
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
    const equipment = readReactFiber(detail, "detail").return?.memoizedProps
      ?.eq;
    if (!equipment || typeof equipment !== "object") {
      throw new Error("GAO extension: detail Fiber equipment prop missing.");
    }
    const itemId = normalizeNumericId(equipment.id);
    if (!itemId) {
      throw new Error("GAO extension: inventory detail equipment id missing.");
    }
    const entry = itemId
      ? (readForgeHistory().find(
          (historyEntry) => historyEntry.craftedId === itemId,
        ) ?? null)
      : null;
    renderInventoryBaseStatsInline(detail, itemId, equipment);
    renderInventoryForgeMaterials(detail, itemId, entry);
  }

  function readReactFiber(element, label) {
    const fiberProperty = Object.keys(element).find((property) =>
      property.startsWith("__reactFiber$"),
    );
    if (!fiberProperty || !element[fiberProperty]) {
      throw new Error(
        `GAO extension: ${label} React Fiber property not found.`,
      );
    }
    return element[fiberProperty];
  }

  function createInventoryEquipmentLayoutToggle() {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "條列模式";
    toggle.className = "gao-ext-inventory-layout-toggle";
    toggle.setAttribute(ATTR, "inventory-layout-toggle");
    toggle.addEventListener("click", () => {
      inventoryEquipmentLayoutMode =
        inventoryEquipmentLayoutMode === INVENTORY_LAYOUT_MODE_GRID
          ? INVENTORY_LAYOUT_MODE_LIST
          : INVENTORY_LAYOUT_MODE_GRID;
      localStorage.setItem(
        INVENTORY_LAYOUT_MODE_KEY,
        inventoryEquipmentLayoutMode,
      );
      syncInventoryEquipmentListLayout();
    });
    return toggle;
  }

  function readInventoryEquipmentLayoutMode() {
    const storedMode = localStorage.getItem(INVENTORY_LAYOUT_MODE_KEY);
    return storedMode === INVENTORY_LAYOUT_MODE_LIST
      ? INVENTORY_LAYOUT_MODE_LIST
      : INVENTORY_LAYOUT_MODE_GRID;
  }

  function syncInventoryEquipmentListLayout() {
    const grid = document.querySelector(INVENTORY_EQUIPMENT_GRID_SELECTOR);
    if (!grid) {
      document.querySelector(`[${ATTR}="inventory-list"]`)?.remove();
      return;
    }
    const wrapper = grid.closest(".grid-wrap");
    const header = wrapper?.querySelector(":scope > .grid-wrap__head");
    if (!wrapper || !header) {
      throw new Error(
        "GAO extension: inventory equipment grid structure missing.",
      );
    }
    const controls = header.lastElementChild;
    if (!(controls instanceof HTMLElement)) {
      throw new Error("GAO extension: inventory layout controls missing.");
    }
    let toggle = controls.querySelector(`[${ATTR}="inventory-layout-toggle"]`);
    if (!toggle) {
      toggle = createInventoryEquipmentLayoutToggle();
      controls.insertBefore(toggle, controls.firstChild);
    }
    if (toggle.dataset.mode === inventoryEquipmentLayoutMode) {
      return;
    }
    const isListMode =
      inventoryEquipmentLayoutMode === INVENTORY_LAYOUT_MODE_LIST;
    toggle.dataset.mode = inventoryEquipmentLayoutMode;
    toggle.setAttribute("aria-pressed", String(isListMode));

    if (inventoryEquipmentLayoutMode === INVENTORY_LAYOUT_MODE_GRID) {
      grid.classList.remove(HIDDEN);
      wrapper.querySelector(`[${ATTR}="inventory-list"]`)?.remove();
      return;
    }
    grid.classList.add(HIDDEN);
    let list = wrapper.querySelector(`[${ATTR}="inventory-list"]`);
    if (!list) {
      list = document.createElement("div");
      list.className = "gao-ext-inventory-list";
      list.setAttribute(ATTR, "inventory-list");
    }
    if (list.previousElementSibling !== grid) {
      grid.insertAdjacentElement("afterend", list);
    }
    const items = readVisibleInventoryEquipment(grid);
    if (!shouldRenderInventoryEquipmentList(list, items)) return;
    list.replaceChildren(...items.map(createInventoryEquipmentListRow));
  }

  function readVisibleInventoryEquipment(grid) {
    return [...grid.querySelectorAll(":scope > .cell.cell--filled")].map(
      (cell) => {
        const itemId = normalizeNumericId(
          readReactFiber(cell, "inventory equipment").key,
        );
        if (!itemId) {
          throw new Error(
            "GAO extension: inventory equipment Fiber key missing.",
          );
        }
        const equipment = equipmentById.get(itemId);
        if (!equipment) {
          throw new Error(
            `GAO extension: equipment ${itemId} missing from equipment cache.`,
          );
        }
        return { cell, equipment, itemId };
      },
    );
  }

  function shouldRenderInventoryEquipmentList(list, items) {
    const previousState = inventoryEquipmentListRenderStates.get(list);
    const isUnchanged =
      previousState?.length === items.length &&
      previousState.every((previousItem, index) => {
        const currentItem = items[index];
        return (
          previousItem.cell === currentItem.cell &&
          previousItem.className === currentItem.cell.className &&
          previousItem.equipment === currentItem.equipment &&
          previousItem.itemId === currentItem.itemId
        );
      });
    if (isUnchanged) return false;
    inventoryEquipmentListRenderStates.set(
      list,
      items.map(({ cell, equipment, itemId }) => ({
        cell,
        className: cell.className,
        equipment,
        itemId,
      })),
    );
    return true;
  }

  function createInventoryEquipmentListRow({ cell, equipment }) {
    const quality = getQualityByRoll(equipment.name_rolls?.quality);
    const qualityColor =
      INVENTORY_QUALITY_COLOR_BY_NAME[quality?.name] ?? "var(--q-common)";
    const displayName = String(
      equipment.weapon_name ?? equipment.name ?? "未命名",
    );
    const durability = equipment.durability ?? 0;
    const maxDurability = equipment.max_durability ?? durability;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "gao-ext-inventory-row";
    row.dataset.selected = String(cell.classList.contains("cell--selected"));
    row.style.borderLeft = `3px solid ${qualityColor}`;
    row.title = displayName;
    row.setAttribute("aria-label", displayName);
    row.addEventListener("click", () => cell.click());
    row.append(
      createInventoryEquipmentRowMain({
        cell,
        displayName,
        equipment,
        qualityColor,
      }),
      createInventoryEquipmentRowStats({
        equipment,
        durability,
        maxDurability,
      }),
    );
    return row;
  }

  function createInventoryEquipmentRowMain(options) {
    const { cell, displayName, equipment, qualityColor } = options;
    const main = document.createElement("div");
    main.className = "gao-ext-inventory-row-main";
    const type = document.createElement("span");
    type.className = "gao-ext-inventory-row-type";
    const slot = String(equipment.equipment_slot ?? "").trim();
    let typeLabel = INVENTORY_SLOT_LABEL_BY_KEY[slot];
    if (!typeLabel && Array.isArray(equipment.tags)) {
      for (const tag of equipment.tags) {
        const tagLabel = INVENTORY_TYPE_LABEL_BY_TAG[String(tag)];
        if (!tagLabel) continue;
        typeLabel = tagLabel;
        break;
      }
    }
    type.textContent = typeLabel || "未分類";
    type.title = type.textContent;
    const name = document.createElement("span");
    name.className = "gao-ext-inventory-row-name";
    name.style.color = qualityColor;
    name.textContent = displayName;
    main.append(type);
    if (cell.classList.contains("cell--equipped")) {
      main.append(
        createInventoryEquipmentRowMarker("[E]", "var(--magenta-300)"),
      );
    }
    if (equipment.locked) {
      main.append(createInventoryEquipmentRowMarker("🔒", "var(--gold-400)"));
    }
    main.append(name);
    return main;
  }

  function createInventoryEquipmentRowMarker(text, color) {
    const marker = document.createElement("span");
    marker.className = "gao-ext-inventory-row-marker";
    marker.style.color = color;
    marker.textContent = text;
    return marker;
  }

  function createInventoryEquipmentRowStats(options) {
    const { equipment, durability, maxDurability } = options;
    const stats = document.createElement("div");
    stats.className = "gao-ext-inventory-row-stats";
    stats.append(
      createInventoryEquipmentStat("ATK", equipment.atk),
      createInventoryEquipmentStat("DEF", equipment.def),
      createInventoryEquipmentStat("LUC", equipment.luck),
      createInventoryEquipmentStat("WT", equipment.weight),
      createInventoryEquipmentStat(
        "DUR",
        `${durability}/${maxDurability}`,
        Number(durability) <= 0,
      ),
    );
    return stats;
  }

  function createInventoryEquipmentStat(label, value, isBroken = false) {
    const stat = document.createElement("span");
    const tag = document.createElement("span");
    tag.className = "gao-ext-inventory-stat-tag";
    tag.textContent = label;
    const statValue = document.createElement("span");
    statValue.className = "gao-ext-inventory-stat-value";
    statValue.dataset.broken = String(isBroken);
    statValue.textContent = String(value ?? 0);
    stat.append(tag, statValue);
    return stat;
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
      value:
        field.statLabel === "WT"
          ? Math.floor((currentValue * nameRoll) / quality.weightMult)
          : Math.floor(currentValue / nameRoll / quality.qualityMult),
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
  // 同時復用 details/panel 外殼，避免連續戰鬥時重建整組 DOM。
  function enhanceBattleReport() {
    for (const inner of document.querySelectorAll(".bl__inner")) {
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

      const lineRows = logs.flatMap((log) => [
        ...log.querySelectorAll(":scope > .bl-row[data-line]"),
      ]);
      const signature = [
        lineRows.length,
        ...lineRows
          .slice(-BATTLE_SIGNATURE_LINE_COUNT)
          .map((row) => `${row.dataset.line}:${row.textContent.trim()}`),
      ].join("|");
      if (inner.dataset.gaoExtBattle === signature) continue;

      const logNodes = logs.flatMap((log) => [...log.children]);
      const lineRowSet = new Set(lineRows);
      const dropRows = [];
      const reportRows = [];

      for (const node of logNodes) {
        if (lineRowSet.has(node)) continue;
        const targetRows =
          node.dataset.act === "reward" ? dropRows : reportRows;
        targetRows.push(node);
      }

      for (const row of lineRows) {
        const targetRows =
          row.dataset.line === "reward" ? dropRows : reportRows;
        targetRows.push(row);
      }
      const anchor = head || logs[0];
      const dropsPanel = ensureBattleDetails(inner, {
        attrValue: "drops",
        anchor,
        summaryText: `掉落物 · DROPS / ${dropRows.length} lines`,
      });
      renderBattlePanel(dropsPanel, null, dropRows);

      const reportPanel = ensureBattleDetails(inner, {
        attrValue: "report",
        anchor,
        summaryText: `戰報 · BATTLE LOG / ${reportRows.length} events`,
      });
      renderBattlePanel(reportPanel, head, reportRows);
      if (head) head.classList.add(HIDDEN);
      for (const log of logs) log.classList.add(HIDDEN);
      inner.dataset.gaoExtBattle = signature;
    }
  }

  function cloneBattleReportNode(element) {
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
  }

  function ensureBattleDetails(inner, options) {
    const { anchor, attrValue, summaryText } = options;
    let details = inner.querySelector(
      `:scope > details[${ATTR}="${attrValue}"]`,
    );
    if (!details) {
      details = document.createElement("details");
      details.className = "gao-ext-details";
      details.setAttribute(ATTR, attrValue);
      const summary = document.createElement("summary");
      const panel = document.createElement("div");
      panel.className = "gao-ext-panel";
      details.append(summary, panel);
    }

    setTextIfChanged(details.querySelector("summary"), summaryText);
    if (details.nextElementSibling !== anchor)
      inner.insertBefore(details, anchor);
    return details.querySelector(".gao-ext-panel");
  }

  function renderBattlePanel(panel, header, rows) {
    const nodes = [];
    const log = document.createElement("div");
    log.className = "bl-log";
    log.append(...rows.map(cloneBattleReportNode));
    if (header) nodes.push(cloneBattleReportNode(header));
    nodes.push(log);
    panel.replaceChildren(...nodes);
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
