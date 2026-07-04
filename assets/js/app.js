import { renderDashboard } from "./signal-render.js";
import { getStrongNotifications } from "./notification.js";

const errorEl = document.querySelector("#error");

async function loadSignals() {
  const response = await fetch("data/signals.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`signals.json 讀取失敗：HTTP ${response.status}`);
  }
  return response.json();
}

async function init() {
  try {
    const data = await loadSignals();
    renderDashboard(data);
    getStrongNotifications(data);
  } catch (error) {
    errorEl.hidden = false;
    errorEl.textContent = error.message || "資料讀取失敗，請稍後再試。";
  }
}

init();
