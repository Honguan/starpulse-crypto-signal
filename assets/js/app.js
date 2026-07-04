import { renderDashboard } from "./signal-render.js";
import { getStrongNotifications } from "./notification.js";

const errorEl = document.querySelector("#error");
const coinInput = document.querySelector("#coin-symbol");
const clearSymbolButton = document.querySelector("#clear-symbol");
let signalData;

async function loadSignals() {
  const response = await fetch("data/signals.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`signals.json 讀取失敗：HTTP ${response.status}`);
  }
  return response.json();
}

async function init() {
  try {
    signalData = await loadSignals();
    renderDashboard(signalData);
    getStrongNotifications(signalData);
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error.message || "資料讀取失敗，請稍後再試。";
  }
}

coinInput.addEventListener("input", () => {
  if (signalData) {
    renderDashboard(signalData, coinInput.value);
  }
});

clearSymbolButton.addEventListener("click", () => {
  coinInput.value = "";
  if (signalData) {
    renderDashboard(signalData);
  }
});

init();
