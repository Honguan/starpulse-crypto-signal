import { planStateFor } from "./strategy.mjs";

const BINANCE_STREAM = "wss://stream.binance.com:9443/stream?streams=";
const MAX_RECONNECT_DELAY = 30000;
const FLASH_MS = 650;
const MAX_SOURCE_DIVERGENCE = 0.05;

let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let liveState;
let cardsBySymbol = new Map();
let subscription = "";
let root = globalThis.document;
let WebSocketImpl = globalThis.WebSocket;
let reconnectSetTimeout = (...args) => globalThis.setTimeout(...args);
let reconnectClearTimeout = (...args) => globalThis.clearTimeout(...args);

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
  const liveEl = root.querySelector('[data-status-value="websocket"]');
  if (liveEl) {
    liveEl.textContent = nextState ? "已連線" : "未連線";
  }
}

export function syncLiveStatus(root = globalThis.document) {
  if (liveState !== undefined) {
    setLiveState(liveState, root);
  }
}

export function applyTicker(ticker, cards = cardsBySymbol) {
  const symbol = ticker?.s;
  const nextPrice = Number(ticker?.c);
  const nextChange = Number(ticker?.P);

  if (!/^[A-Z0-9]+USDT$/.test(symbol || "") || !Number.isFinite(nextPrice)) {
    return false;
  }

  const card = cards.get(symbol);
  if (!card) {
    return false;
  }
  const snapshotPrice = Number(card.dataset.snapshotPrice);
  if (!(snapshotPrice > 0) || Math.abs(nextPrice / snapshotPrice - 1) > MAX_SOURCE_DIVERGENCE) return false;

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
  const primaryRrEl = card.querySelector("[data-plan-rr]");
  const primaryDirection = card.querySelector('[data-plan-status="可執行"]')?.dataset.planDirection;
  const primaryPlan = primaryDirection === "做空" ? card.querySelector('[data-plan="short"]') : card.querySelector('[data-plan="long"]');
  if (primaryStateEl && primaryPlan) {
    const values = [primaryPlan.dataset.entryLow, primaryPlan.dataset.entryHigh, primaryPlan.dataset.stopLoss, primaryPlan.dataset.takeProfit];
    if (primaryPlan.dataset.planStatus === "可執行" && values.every((value) => value !== "")) {
      const [entryLow, entryHigh, stopLoss, takeProfit] = values.map(Number);
      const state = planStateFor({ direction: primaryPlan.dataset.planDirection, status: primaryPlan.dataset.planStatus, entryZone: { low: entryLow, high: entryHigh }, stopLoss, takeProfit: [takeProfit] }, nextPrice);
      primaryStateEl.textContent = state;
      if (state === "停損失效" && primaryRrEl) primaryRrEl.textContent = "-";
    }
  }

  return true;
}

function scheduleReconnect(expectedSubscription) {
  if (reconnectTimer) {
    return;
  }

  const delay = Math.min(MAX_RECONNECT_DELAY, 1000 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = reconnectSetTimeout(() => {
    reconnectTimer = undefined;
    if (subscription === expectedSubscription && !root?.hidden) connect();
  }, delay);
}

function disconnect() {
  if (reconnectTimer) reconnectClearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = undefined;
  }
  setLiveState(false, root);
}

function connect() {
  if (!WebSocketImpl || !subscription) {
    setLiveState(false);
    return;
  }

  const expectedSubscription = subscription;
  const currentSocket = new WebSocketImpl(`${BINANCE_STREAM}${subscription}`);
  socket = currentSocket;

  currentSocket.onopen = () => {
    reconnectAttempt = 0;
    setLiveState(true, root);
  };

  currentSocket.onmessage = (event) => {
    try {
      applyTicker(JSON.parse(event.data).data);
    } catch {
      // Ignore malformed stream frames and keep the live connection open.
    }
  };

  currentSocket.onerror = () => {
    setLiveState(false, root);
    currentSocket.close();
  };

  currentSocket.onclose = () => {
    if (socket !== currentSocket) return;
    socket = undefined;
    setLiveState(false, root);
    scheduleReconnect(expectedSubscription);
  };
}

export function startLivePrices(options = {}) {
  root = options.root || globalThis.document;
  WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
  reconnectSetTimeout = options.setTimeoutImpl || globalThis.setTimeout;
  reconnectClearTimeout = options.clearTimeoutImpl || globalThis.clearTimeout;
  cardsBySymbol = new Map([...root.querySelectorAll(".card[data-live-pair]")]
    .map((card) => [card.dataset.livePair, card])
    .filter(([symbol]) => /^[A-Z0-9]+USDT$/.test(symbol)));
  const nextSubscription = [...cardsBySymbol.keys()].sort().map((symbol) => `${symbol.toLowerCase()}@miniTicker`).join("/");

  if (root.hidden || !nextSubscription) {
    subscription = nextSubscription;
    disconnect();
    return;
  }

  if (subscription === nextSubscription && socket && [0, 1].includes(socket.readyState)) {
    syncLiveStatus(root);
    return;
  }

  disconnect();
  subscription = nextSubscription;
  reconnectAttempt = 0;
  connect();
}
