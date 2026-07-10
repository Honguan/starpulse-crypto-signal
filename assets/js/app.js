import { renderDashboard } from "./signal-render.js";
import { getStrongNotifications } from "./notification.js";
import { startLivePrices, syncLiveStatus } from "./live-prices.js";

const errorEl = document.querySelector("#error");
const coinInput = document.querySelector("#coin-symbol");
const addFavoriteButton = document.querySelector("#add-favorite");
const clearSymbolButton = document.querySelector("#clear-symbol");
const modeButtons = document.querySelectorAll("[data-mode]");
const FAVORITES_KEY = "starpulse.favoriteSymbols";
const LIVE_DATA_URL = "https://raw.githubusercontent.com/Honguan/starpulse-crypto-signal/live-data/data/signals.json";
const LIVE_REFRESH_MS = 10 * 60 * 1000;
let signalData;
let favoriteOnly = false;
let favoriteSymbols = readFavorites();

function normalizeSymbol(value) {
  const symbol = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!symbol) {
    return "";
  }
  return symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
}

function readFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteSymbols].sort()));
}

function render() {
  if (!signalData) {
    return;
  }
  renderDashboard(signalData, {
    symbolFilter: normalizeSymbol(coinInput.value),
    favoriteOnly,
    favoriteSymbols
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

async function refreshLiveSignals() {
  try {
    signalData = await loadSignals(`${LIVE_DATA_URL}?t=${Math.floor(Date.now() / LIVE_REFRESH_MS)}`);
    errorEl.hidden = true;
  } catch {
    if (!signalData) {
      signalData = await loadSignals();
    }
    errorEl.textContent = "即時策略資料暫時無法讀取，顯示備援快照。";
    errorEl.hidden = false;
  }
  render();
}

async function init() {
  try {
    await refreshLiveSignals();
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
  const symbol = normalizeSymbol(coinInput.value);
  if (!symbol) {
    return;
  }
  favoriteSymbols.add(symbol);
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
  const symbol = button.dataset.symbol;
  if (favoriteSymbols.has(symbol)) {
    favoriteSymbols.delete(symbol);
  } else {
    favoriteSymbols.add(symbol);
  }
  saveFavorites();
  render();
});

init();
