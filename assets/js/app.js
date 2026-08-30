import { renderDashboard } from "./signal-render.js";
import { getStrongNotifications } from "./notification.js";
import { startLivePrices, syncLiveStatus } from "./live-prices.js";
import { prepareSnapshot } from "./data-freshness.mjs";
import { parseSignalPayload } from "./signal-schema.mjs";
import { loadLastKnownGood, saveLastKnownGood } from "./snapshot-store.mjs";

const errorEl = document.querySelector("#error");
const coinInput = document.querySelector("#coin-symbol");
const addFavoriteButton = document.querySelector("#add-favorite");
const clearSymbolButton = document.querySelector("#clear-symbol");
const modeButtons = document.querySelectorAll("[data-mode]");
const FAVORITES_KEY = "starpulse.favoriteCoinIds";
const LIVE_DATA_URL = "https://raw.githubusercontent.com/Honguan/starpulse-crypto-signal/live-data/data/signals.json";
const LIVE_REFRESH_MS = 10 * 60 * 1000;
let signalData;
let favoriteOnly = false;
let favoriteCoinIds = readFavorites();

function normalizeSymbol(value) {
  const symbol = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) {
    return "";
  }
  return symbol.length > 4 && symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function readFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteCoinIds].sort()));
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

function renderData(data) {
  renderDashboard(data, {
    symbolFilter: normalizeSymbol(coinInput.value),
    favoriteOnly,
    favoriteCoinIds
  });
  syncLiveStatus();
}

function render() {
  if (!signalData) return false;
  try {
    renderData(signalData);
    return true;
  } catch {
    errorEl.textContent = errorMessage({ code: "render" });
    errorEl.hidden = false;
    return false;
  }
}

function setMode(mode) {
  favoriteOnly = mode === "favorites";
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  render();
}

async function loadSignals(url = "data/signals.json") {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw loadError("network", "signals.json request failed");
  }
  if (!response.ok) {
    throw loadError("network", `signals.json 讀取失敗：HTTP ${response.status}`);
  }
  try {
    return parseSignalPayload(await response.text());
  } catch (error) {
    if (error?.code) throw error;
    throw loadError("network", "signals.json response failed");
  }
}

function clearDashboard() {
  document.querySelector("#status").replaceChildren();
  document.querySelector("#market").replaceChildren();
  document.querySelector("#plan-list").replaceChildren();
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
    errorEl.hidden = candidate.freshness.state === "fresh";
    errorEl.textContent = candidate.freshness.state === "delayed"
      ? "策略資料更新延遲，暫不顯示為即時資料。"
      : "策略資料已過期，交易計畫僅供參考且不可執行。";
  } catch (liveError) {
    try {
      const candidate = signalData
        ? prepareSnapshot(signalData, { fallback: signalData.freshness?.fallback })
        : await fallbackSnapshot();
      renderData(candidate);
      signalData = candidate;
    } catch (fallbackError) {
      clearDashboard();
      errorEl.textContent = `${errorMessage(fallbackError)}；沒有可用的有效快照。`;
      errorEl.hidden = false;
      return false;
    }
    errorEl.textContent = `${errorMessage(liveError)}；${signalData.freshness.fallback ? "顯示已驗證的備援快照。" : "保留最後一次有效快照。"}`;
    errorEl.hidden = false;
  }
  return true;
}

async function init() {
  try {
    if (!await refreshLiveSignals()) return;
    startLivePrices();
    getStrongNotifications(signalData);
    globalThis.setInterval(() => {
      refreshLiveSignals().catch((error) => {
        errorEl.textContent = errorMessage(error);
        errorEl.hidden = false;
      });
    }, LIVE_REFRESH_MS);
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error.message || "資料讀取失敗，請稍後再試。";
  }
}

coinInput.addEventListener("input", () => {
  render();
});

addFavoriteButton.addEventListener("click", () => {
  if (!signalData) return;
  const query = normalizeSymbol(coinInput.value);
  const matches = signalData.signals.filter((signal) => [signal.symbol, signal.coinId, signal.name].some((value) => String(value || "").toUpperCase() === query));
  if (matches.length !== 1) return;
  favoriteCoinIds.add(matches[0].coinId);
  saveFavorites();
  render();
});

clearSymbolButton.addEventListener("click", () => {
  coinInput.value = "";
  render();
});

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

init();
