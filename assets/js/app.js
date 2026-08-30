import { renderDashboard } from "./signal-render.js";
import { getStrongNotifications } from "./notification.js";
import { startLivePrices, syncLiveStatus } from "./live-prices.js";
import { prepareSnapshot } from "./data-freshness.mjs";

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

function render() {
  if (!signalData) {
    return;
  }
  renderDashboard(signalData, {
    symbolFilter: normalizeSymbol(coinInput.value),
    favoriteOnly,
    favoriteCoinIds
  });
  syncLiveStatus();
}

function setMode(mode) {
  favoriteOnly = mode === "favorites";
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  render();
}

async function loadSignals(url = "data/signals.json") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`signals.json 讀取失敗：HTTP ${response.status}`);
  }
  return response.json();
}

function clearDashboard() {
  document.querySelector("#status").replaceChildren();
  document.querySelector("#market").replaceChildren();
  document.querySelector("#plan-list").replaceChildren();
}

async function refreshLiveSignals() {
  try {
    signalData = prepareSnapshot(await loadSignals(`${LIVE_DATA_URL}?t=${Math.floor(Date.now() / LIVE_REFRESH_MS)}`));
    errorEl.hidden = signalData.freshness.state === "fresh";
    errorEl.textContent = signalData.freshness.state === "delayed"
      ? "策略資料更新延遲，暫不顯示為即時資料。"
      : "策略資料已過期，交易計畫僅供參考且不可執行。";
  } catch {
    try {
      signalData = signalData
        ? prepareSnapshot(signalData, { fallback: signalData.freshness?.fallback })
        : prepareSnapshot(await loadSignals(), { fallback: true });
    } catch (error) {
      signalData = undefined;
      clearDashboard();
      errorEl.textContent = error.message || "沒有可用的近期策略資料。";
      errorEl.hidden = false;
      return false;
    }
    errorEl.textContent = signalData.freshness.fallback && signalData.freshness.state === "stale"
      ? "即時策略資料無法讀取；備援資料已過期，交易計畫不可執行。"
      : signalData.freshness.fallback
        ? "即時策略資料暫時無法讀取，顯示近期備援快照。"
        : "即時策略資料暫時無法更新，保留最後一次快照。";
    errorEl.hidden = false;
  }
  render();
  return true;
}

async function init() {
  try {
    if (!await refreshLiveSignals()) return;
    startLivePrices();
    getStrongNotifications(signalData);
    globalThis.setInterval(refreshLiveSignals, LIVE_REFRESH_MS);
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error.message || "資料讀取失敗，請稍後再試。";
  }
}

coinInput.addEventListener("input", () => {
  render();
});

addFavoriteButton.addEventListener("click", () => {
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
