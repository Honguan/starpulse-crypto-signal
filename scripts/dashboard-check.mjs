import assert from "node:assert/strict";
import fs from "node:fs";
import { matchesSearch, normalizeSearch, selectSignals } from "../assets/js/signal-filter.mjs";

const signals = [
  { coinId: "wrapped-bitcoin", symbol: "WBTC", name: "包裝比特幣", marketCapRank: 3, change24h: -2, primaryDirection: "觀望", plans: { long: { score: 80 } } },
  { coinId: "ethereum", symbol: "ETH", name: "以太幣", marketCapRank: 2, change24h: 6, primaryDirection: "做空", plans: { short: { score: 100 } } },
  { coinId: "bitcoin", symbol: "BTC", name: "比特幣", liveInstrument: { symbol: "BTCUSDT" }, marketCapRank: 1, change24h: 1, primaryDirection: "做多", plans: { long: { score: 100 } } }
];
const original = structuredClone(signals);
const ids = (settings) => selectSignals(signals, settings).map((signal) => signal.coinId);
assert.equal(normalizeSearch("  btcusdt  "), "BTC");
assert.equal(normalizeSearch(" wrapped-bitcoin "), "WRAPPED-BITCOIN");
assert.equal(normalizeSearch(" 比特幣 "), "比特幣");
assert.equal(normalizeSearch("   "), "");
assert.deepEqual(ids({ symbolFilter: "wrapped-bitcoin" }), ["wrapped-bitcoin"]);
assert.deepEqual(ids({ symbolFilter: "以太幣" }), ["ethereum"]);
assert(matchesSearch(signals[2], "BTCUSDT", true));
assert(!matchesSearch(signals[0], "BTCUSDT", true));
assert.deepEqual(ids({ symbolFilter: "   " }), ["bitcoin", "ethereum", "wrapped-bitcoin"]);
assert.deepEqual(ids({ sort: "rank" }), ["bitcoin", "ethereum", "wrapped-bitcoin"]);
assert.deepEqual(ids({ sort: "change-desc" }), ["ethereum", "bitcoin", "wrapped-bitcoin"]);
assert.deepEqual(ids({ sort: "change-asc" }), ["wrapped-bitcoin", "bitcoin", "ethereum"]);
assert.deepEqual(ids({ favoriteOnly: true, favoriteCoinIds: new Set(["ethereum", "bitcoin"]), direction: "做空" }), ["ethereum"]);
assert.deepEqual(ids({ favoriteOnly: true, favoriteCoinIds: new Set() }), []);
assert.deepEqual(ids({ direction: "觀望" }), ["wrapped-bitcoin"]);
assert.deepEqual(signals, original, "sorting and filtering preserve input objects and order");

// Exercise the real app, renderer, schema, and snapshot path without a browser or network.
class Node {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.className = "";
    this.value = "";
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      }
    };
  }
  append(...children) { children.forEach((child) => { child.parent = this; }); this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { document.activeElement = this; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
  matches(selector) {
    const attribute = selector.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
    const className = selector.match(/^\.([\w-]+)/)?.[1];
    if (className && !this.classList.contains(className)) return false;
    if (attribute) {
      const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return key in this.dataset && (attribute[2] === undefined || this.dataset[key] === attribute[2]);
    }
    return className ? true : this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")])
      .filter((node) => selector === "*" || node.matches(selector));
  }
  querySelector(selector) {
    if (selector.includes(" > ")) {
      const [parent, child] = selector.split(" > ");
      return this.querySelector(parent)?.children.find((node) => node.matches(child)) || null;
    }
    return this.querySelectorAll(selector)[0] || null;
  }
}
const roots = Object.fromEntries([
  "error", "coin-symbol", "add-favorite", "clear-symbol", "refresh-signals", "direction-filter", "sort-order",
  "action-feedback", "status", "market", "plan-list", "result-count", "loading", "status-announcer"
].map((id) => [`#${id}`, new Node()]));
const modes = ["all", "browse", "favorites"].map((mode) => {
  const node = new Node("button");
  node.dataset.mode = mode;
  return node;
});
const body = new Node();
body.append(...Object.values(roots), ...modes);
const documentListeners = {};
globalThis.document = {
  hidden: false,
  createElement: (tag) => new Node(tag),
  createTextNode: (text) => Object.assign(new Node("#text"), { textContent: text }),
  querySelector: (selector) => roots[selector] || body.querySelector(selector),
  querySelectorAll: (selector) => body.querySelectorAll(selector),
  addEventListener: (name, callback) => { documentListeners[name] = callback; }
};
globalThis.WebSocket = undefined;
globalThis.addEventListener = () => {};
const intervals = [];
globalThis.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => { throw new Error("storage unavailable"); },
  removeItem() {}
};
let requests = 0;
globalThis.fetch = async () => { requests += 1; throw new Error("offline"); };
const flush = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!roots["#refresh-signals"].disabled) return;
  }
  assert.fail("refresh did not finish");
};
await import("../assets/js/app.js");
await flush();
assert.equal(requests, 2, "initial live and fallback requests both fail");
const refreshInterval = intervals.find((interval) => interval.delay === 10 * 60 * 1000);
assert(refreshInterval, "initial failure must retain automatic refresh");
assert.match(roots["#error"].textContent, /沒有可用/);
assert.equal(roots["#refresh-signals"].disabled, false);
assert.equal(roots["#plan-list"].getAttribute("aria-busy"), "false");

const payload = JSON.parse(fs.readFileSync(new URL("../data/signals.json", import.meta.url), "utf8"));
payload.updatedAt = new Date().toISOString();
const response = () => ({ ok: true, text: async () => JSON.stringify(payload) });
globalThis.fetch = async () => { requests += 1; return response(); };
refreshInterval.callback();
await flush();
assert.equal(roots["#error"].hidden, true, "automatic retry restores dashboard");
assert.equal(document.querySelectorAll(".card").length, 5);

let release;
globalThis.fetch = () => { requests += 1; return new Promise((resolve) => { release = resolve; }); };
const refreshing = roots["#refresh-signals"].listeners.click();
assert.equal(roots["#refresh-signals"].disabled, true);
assert.equal(roots["#plan-list"].getAttribute("aria-busy"), "true");
const requestsWhileBusy = requests;
await roots["#refresh-signals"].listeners.click();
assert.equal(requests, requestsWhileBusy, "a second refresh does not duplicate requests");
release(response());
await refreshing;
assert.equal(roots["#refresh-signals"].disabled, false);
assert.equal(roots["#plan-list"].getAttribute("aria-busy"), "false");

const firstCard = document.querySelectorAll(".card")[0];
const favorite = firstCard.querySelector(".favorite-toggle");
documentListeners.click({ target: { closest: () => favorite } });
assert.match(roots["#action-feedback"].textContent, /無法儲存最愛/);
const updatedCard = document.querySelectorAll(".card").find((card) => card.dataset.coinId === firstCard.dataset.coinId);
assert.notEqual(updatedCard, firstCard, "storage failure must still rerender");
assert.equal(updatedCard.querySelector(".favorite-toggle").getAttribute("aria-pressed"), "true");
assert.equal(modes[2].textContent, "最愛 (1)");

const analysisSummary = updatedCard.querySelector(".analysis-details > summary");
analysisSummary.focus();
roots["#sort-order"].listeners.change();
assert.notEqual(document.activeElement, analysisSummary);
assert.equal(document.activeElement.parent.className, "analysis-details", "refresh keeps analysis focus instead of moving it to the chart");
roots["#coin-symbol"].focus();

modes[1].listeners.click();
assert.equal(document.querySelectorAll(".card").length, payload.signals.length, "browse exposes every asset");
modes[2].listeners.click();
assert.equal(document.querySelectorAll(".card").length, 1, "favorites mode limits results");
roots["#coin-symbol"].value = "does-not-exist";
roots["#coin-symbol"].listeners.input();
assert.equal(document.querySelectorAll(".card").length, 0);
assert.match(roots["#plan-list"].children[0].textContent, /沒有符合/);
roots["#clear-symbol"].listeners.click();
assert.equal(document.activeElement, roots["#coin-symbol"], "clear restores search focus");

const originalNow = Date.now;
Date.now = () => Date.parse(payload.updatedAt) + 61 * 60 * 1000;
intervals.find((interval) => interval.delay === 30000).callback();
assert.match(roots["#error"].textContent, /過期/);
assert.equal(document.querySelector('[data-status-value="freshness"]').textContent, "過期");
assert.equal(document.querySelector('[data-plan-state]').textContent, "資料過期");
Date.now = originalNow;
console.log("dashboard check ok");
