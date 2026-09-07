import { renderDashboard } from "./signal-render.js";
import { startLivePrices } from "./live-prices.js";
import { prepareSnapshot } from "./data-freshness.mjs";
import { parseSignalPayload } from "./signal-schema.mjs";
import { loadLastKnownGood, saveLastKnownGood } from "./snapshot-store.mjs";
import { matchesSearch } from "./signal-filter.mjs";

const errorEl = document.querySelector("#error");
const coinInput = document.querySelector("#coin-symbol");
const addFavoriteButton = document.querySelector("#add-favorite");
const clearSymbolButton = document.querySelector("#clear-symbol");
const modeButtons = document.querySelectorAll("[data-mode]");
const refreshButton = document.querySelector("#refresh-signals");
const directionFilter = document.querySelector("#direction-filter");
const sortOrder = document.querySelector("#sort-order");
const feedback = document.querySelector("#action-feedback");
const FAVORITES_KEY = "starpulse.favoriteCoinIds";
const LIVE_DATA_URL = "https://raw.githubusercontent.com/Honguan/starpulse-crypto-signal/live-data/data/signals.json";
const LIVE_REFRESH_MS = 10 * 60 * 1000;
let signalData;
let favoriteOnly = false;
let showAll = false;
let refreshing = false;
let favoriteCoinIds = readFavorites();

function readFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteCoinIds].sort()));
    feedback.textContent = "最愛已更新。";
  } catch {
    feedback.textContent = "瀏覽器無法儲存最愛；本次操作仍有效，重新載入後不會保留。";
  }
}

function loadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorMessage(error) {
  return {
    network: "策略資料網路讀取失敗",
    parse: "策略 JSON 已截斷或損壞",
    schema: "策略資料欄位或版本無效",
    stale: "策略資料時間已失效",
    render: "策略畫面無法安全呈現"
  }[error?.code] || "策略資料更新失敗";
}

function setError(message = "") {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  if (errorEl.textContent !== message) errorEl.textContent = message;
  errorEl.hidden = false;
}

function focusedCardControl() {
  const active = document.activeElement;
  const card = active?.closest?.(".card");
  const type = active?.classList?.contains("favorite-toggle") ? "favorite"
    : active?.tagName === "SUMMARY" ? active.closest("[data-chart-details]") ? "chart" : "analysis" : "";
  return card && type ? { coinId: card.dataset.coinId, type } : null;
}

function restoreCardFocus(focus) {
  if (!focus) return;
  const card = [...document.querySelectorAll(".card")].find((candidate) => candidate.dataset.coinId === focus.coinId);
  const selector = focus.type === "chart" ? "[data-chart-details] > summary"
    : focus.type === "analysis" ? ".analysis-details > summary" : ".favorite-toggle";
  const target = card?.querySelector(selector);
  (target || [...modeButtons].find((button) => button.getAttribute("aria-pressed") === "true"))?.focus();
}

function renderData(data) {
  const focus = focusedCardControl();
  renderDashboard(data, {
    symbolFilter: coinInput.value,
    favoriteOnly,
    favoriteCoinIds,
    showAll,
    direction: directionFilter.value,
    sort: sortOrder.value
  });
  const query = coinInput.value.trim();
  const matches = query ? data.signals.filter((signal) => matchesSearch(signal, query, true)) : [];
  addFavoriteButton.disabled = matches.length !== 1 || favoriteCoinIds.has(matches[0]?.coinId);
  addFavoriteButton.textContent = matches.length === 1 && favoriteCoinIds.has(matches[0].coinId) ? "已加入最愛" : "加入最愛";
  addFavoriteButton.title = matches.length === 1 ? "" : "輸入完整代號或名稱，或使用卡片星號收藏";
  const favoriteMode = [...modeButtons].find((button) => button.dataset.mode === "favorites");
  favoriteMode.textContent = `最愛 (${favoriteCoinIds.size})`;
  restoreCardFocus(focus);
  startLivePrices();
}

function render() {
  if (!signalData) return false;
  try {
    renderData(signalData);
    return true;
  } catch {
    setError(errorMessage({ code: "render" }));
    return false;
  }
}

function setMode(mode) {
  favoriteOnly = mode === "favorites";
  showAll = mode === "browse";
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  render();
}

async function loadSignals(url = "data/signals.json") {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw loadError("network", `signals.json 讀取失敗：HTTP ${response.status}`);
    return parseSignalPayload(await response.text());
  } catch (error) {
    if (typeof error?.code === "string") throw error;
    throw loadError("network", "signals.json request failed");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function clearDashboard() {
  document.querySelector("#status").replaceChildren();
  document.querySelector("#market").replaceChildren();
  document.querySelector("#plan-list").replaceChildren();
  document.querySelector("#result-count").textContent = "沒有可用資料，請重新整理。";
  signalData = undefined;
  addFavoriteButton.disabled = true;
  startLivePrices();
}

async function fallbackSnapshot() {
  try {
    const stored = loadLastKnownGood();
    if (stored) return stored;
  } catch {
    // Invalid or expired browser snapshots are removed by loadLastKnownGood.
  }
  return prepareSnapshot(await loadSignals(), { fallback: true });
}

async function refreshLiveSignals() {
  if (refreshing) return false;
  refreshing = true;
  refreshButton.disabled = true;
  refreshButton.textContent = "更新中…";
  document.querySelector("#plan-list").setAttribute("aria-busy", "true");
  try {
    const candidate = prepareSnapshot(await loadSignals(`${LIVE_DATA_URL}?t=${Math.floor(Date.now() / LIVE_REFRESH_MS)}`));
    try {
      renderData(candidate);
    } catch {
      throw loadError("render", "render failed");
    }
    signalData = candidate;
    try {
      saveLastKnownGood(candidate);
    } catch {
      // Storage availability must not invalidate a usable in-memory snapshot.
    }
    setError(candidate.freshness.state === "fresh" ? "" : candidate.freshness.state === "delayed"
      ? "策略資料更新延遲，暫不顯示為即時資料。"
      : "策略資料已過期，交易計畫僅供參考且不可執行。");
  } catch (liveError) {
    try {
      const candidate = signalData
        ? prepareSnapshot(signalData, { fallback: signalData.freshness?.fallback })
        : await fallbackSnapshot();
      renderData(candidate);
      signalData = candidate;
    } catch (fallbackError) {
      clearDashboard();
      setError(`${errorMessage(fallbackError)}；沒有可用的有效快照。`);
      return false;
    }
    setError(`${errorMessage(liveError)}；${signalData.freshness.fallback ? "顯示已驗證的備援快照。" : "保留最後一次有效快照。"}`);
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "重新整理資料";
    document.querySelector("#loading").hidden = true;
    document.querySelector("#plan-list").setAttribute("aria-busy", "false");
  }
  return true;
}

async function init() {
  try {
    globalThis.setInterval(() => {
      refreshLiveSignals().catch((error) => {
        setError(errorMessage(error));
      });
    }, LIVE_REFRESH_MS);
    globalThis.setInterval(() => {
      if (!signalData) return;
      const previousState = signalData.freshness?.state;
      try {
        prepareSnapshot(signalData, { fallback: signalData.freshness?.fallback });
        if (signalData.freshness.state !== previousState) {
          render();
          setError(signalData.freshness.state === "stale" ? "策略資料已過期，交易計畫不可執行。" : "策略資料更新延遲。");
        }
      } catch {
        clearDashboard();
        setError("備援資料已失效，請重新整理。");
      }
    }, 30000);
    await refreshLiveSignals();
  } catch (error) {
    setError(error.message || "資料讀取失敗，請稍後再試。");
  }
}

coinInput.addEventListener("input", () => {
  feedback.textContent = "";
  render();
});

addFavoriteButton.addEventListener("click", () => {
  if (!signalData) return;
  const query = coinInput.value.trim();
  const matches = query ? signalData.signals.filter((signal) => matchesSearch(signal, query, true)) : [];
  if (matches.length !== 1) return;
  favoriteCoinIds.add(matches[0].coinId);
  saveFavorites();
  render();
});

clearSymbolButton.addEventListener("click", () => {
  coinInput.value = "";
  render();
  coinInput.focus();
});

directionFilter.addEventListener("change", render);
sortOrder.addEventListener("change", render);
refreshButton.addEventListener("click", refreshLiveSignals);

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".favorite-toggle");
  if (!button) {
    return;
  }
  const coinId = button.dataset.coinId;
  if (favoriteCoinIds.has(coinId)) {
    favoriteCoinIds.delete(coinId);
  } else {
    favoriteCoinIds.add(coinId);
  }
  saveFavorites();
  render();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshLiveSignals();
  else startLivePrices();
});
globalThis.addEventListener("online", refreshLiveSignals);

init();
