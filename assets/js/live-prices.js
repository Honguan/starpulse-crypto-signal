import { planStateFor } from "./strategy.mjs";

const BINANCE_STREAM = "wss://stream.binance.com:9443/ws/!miniTicker@arr";
const MAX_RECONNECT_DELAY = 30000;
const FLASH_MS = 650;

let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let liveState;

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) {
    return value;
  }
  if (price >= 1000) {
    return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  return price.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function formatChange(value) {
  const change = Number(value);
  if (!Number.isFinite(change)) {
    return value;
  }
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function readPreviousPrice(priceEl) {
  const rawValue = priceEl.dataset.liveLastPrice || priceEl.textContent || "";
  return Number.parseFloat(rawValue.replace(/,/g, ""));
}

function flashPrice(priceEl, nextPrice) {
  const previousPrice = readPreviousPrice(priceEl);
  priceEl.classList.remove("price-up", "price-down");

  if (Number.isFinite(previousPrice) && nextPrice !== previousPrice) {
    priceEl.classList.add(nextPrice > previousPrice ? "price-up" : "price-down");
    globalThis.setTimeout(() => priceEl.classList.remove("price-up", "price-down"), FLASH_MS);
  }
}

export function setLiveState(nextState, root = globalThis.document) {
  liveState = nextState;
  if (!root) {
    return;
  }
  const liveEl = root.querySelector('[data-status-value="live"]');
  if (liveEl) {
    liveEl.textContent = nextState ? "LIVE" : "OFFLINE";
  }
}

export function syncLiveStatus(root = globalThis.document) {
  if (liveState !== undefined) {
    setLiveState(liveState, root);
  }
}

export function applyTicker(ticker, root = globalThis.document) {
  const symbol = ticker?.s;
  const nextPrice = Number(ticker?.c);
  const nextChange = Number(ticker?.P);

  if (!root || !symbol || !symbol.endsWith("USDT") || !Number.isFinite(nextPrice)) {
    return false;
  }

  const card = root.querySelector(`.card[data-symbol="${symbol}"]`);
  if (!card) {
    return false;
  }

  const priceEl = card.querySelector("[data-live-price]");
  const changeEl = card.querySelector("[data-live-change]");

  if (priceEl) {
    flashPrice(priceEl, nextPrice);
    priceEl.dataset.liveLastPrice = String(nextPrice);
    priceEl.textContent = formatPrice(nextPrice);
  }

  if (changeEl && Number.isFinite(nextChange)) {
    changeEl.textContent = formatChange(nextChange);
  }

  ["long", "short"].forEach((direction) => {
    const box = card.querySelector(`[data-plan="${direction}"]`);
    const stateEl = card.querySelector(`[data-${direction}-plan-state]`);
    if (!box || !stateEl) return;
    const values = [box.dataset.entryLow, box.dataset.entryHigh, box.dataset.stopLoss, box.dataset.takeProfit];
    if (box.dataset.planStatus !== "可執行" || values.some((value) => value === "")) return;
    const [entryLow, entryHigh, stopLoss, takeProfit] = values.map(Number);
    if (![entryLow, entryHigh, stopLoss, takeProfit].every(Number.isFinite)) return;
    stateEl.textContent = planStateFor({
      direction: box.dataset.planDirection,
      status: box.dataset.planStatus,
      entryZone: { low: entryLow, high: entryHigh },
      stopLoss,
      takeProfit: [takeProfit]
    }, nextPrice);
  });

  const primaryStateEl = card.querySelector("[data-plan-state]");
  const primaryDirection = card.querySelector('[data-plan-status="可執行"]')?.dataset.planDirection;
  const primaryPlan = primaryDirection === "做空" ? card.querySelector('[data-plan="short"]') : card.querySelector('[data-plan="long"]');
  if (primaryStateEl && primaryPlan) {
    const values = [primaryPlan.dataset.entryLow, primaryPlan.dataset.entryHigh, primaryPlan.dataset.stopLoss, primaryPlan.dataset.takeProfit];
    if (primaryPlan.dataset.planStatus === "可執行" && values.every((value) => value !== "")) {
      const [entryLow, entryHigh, stopLoss, takeProfit] = values.map(Number);
      primaryStateEl.textContent = planStateFor({ direction: primaryPlan.dataset.planDirection, status: primaryPlan.dataset.planStatus, entryZone: { low: entryLow, high: entryHigh }, stopLoss, takeProfit: [takeProfit] }, nextPrice);
    }
  }

  return true;
}

function scheduleReconnect(WebSocketImpl) {
  if (reconnectTimer) {
    return;
  }

  const delay = Math.min(MAX_RECONNECT_DELAY, 1000 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = globalThis.setTimeout(() => {
    reconnectTimer = undefined;
    connect(WebSocketImpl);
  }, delay);
}

function connect(WebSocketImpl) {
  if (!WebSocketImpl) {
    setLiveState(false);
    return;
  }

  socket = new WebSocketImpl(BINANCE_STREAM);

  socket.onopen = () => {
    reconnectAttempt = 0;
    setLiveState(true);
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const tickers = Array.isArray(payload) ? payload : [payload];
      tickers.forEach((ticker) => applyTicker(ticker));
    } catch {
      // Ignore malformed stream frames and keep the live connection open.
    }
  };

  socket.onerror = () => {
    setLiveState(false);
    socket.close();
  };

  socket.onclose = () => {
    setLiveState(false);
    scheduleReconnect(WebSocketImpl);
  };
}

export function startLivePrices(options = {}) {
  const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;

  if (socket && [0, 1].includes(socket.readyState)) {
    syncLiveStatus();
    return;
  }

  connect(WebSocketImpl);
}
