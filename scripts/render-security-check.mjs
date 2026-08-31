import assert from "node:assert/strict";
import fs from "node:fs";
import { renderDashboard } from "../assets/js/signal-render.js";

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

const roots = Object.fromEntries(["#status", "#market", "#plan-list"].map((selector) => [selector, new FakeNode("div")]));
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => ({ tagName: "#TEXT", children: [], textContent: text }),
  querySelector: (selector) => roots[selector],
  querySelectorAll: () => []
};

const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const data = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));

renderDashboard(structuredClone(data));
const ordinary = nodes(roots["#plan-list"]);
assert.equal(ordinary.filter((node) => node.tagName === "ARTICLE").length, 5);
assert(/^[a-z0-9][a-z0-9._~-]{0,127}$/i.test(ordinary.find((node) => node.tagName === "ARTICLE").dataset.coinId));
assert(ordinary.some((node) => node.dataset.livePrice === "") && ordinary.some((node) => node.dataset.liveChange === ""));
assert(ordinary.some((node) => node.dataset.plan === "long") && ordinary.some((node) => node.dataset.plan === "short"));
assert(ordinary.some((node) => node.dataset.longPlanState === "") && ordinary.some((node) => node.dataset.shortPlanState === ""));

const favorite = data.signals[7];
renderDashboard(structuredClone(data), { favoriteOnly: true, favoriteCoinIds: new Set([favorite.coinId]) });
assert.deepEqual(nodes(roots["#plan-list"]).filter((node) => node.tagName === "ARTICLE").map((node) => node.dataset.coinId), [favorite.coinId]);

const sparse = structuredClone(data);
sparse.signals = [{ ...sparse.signals[0], strategy: undefined, plans: undefined, candles: undefined, details: undefined, liveInstrument: undefined }];
assert.doesNotThrow(() => renderDashboard(sparse, { symbolFilter: sparse.signals[0].coinId }));
const sparseCard = nodes(roots["#plan-list"]).find((node) => node.tagName === "ARTICLE");
assert.equal(sparseCard.dataset.livePair, "");
assert(nodes(sparseCard).filter((node) => node.dataset.plan).every((node) => node.dataset.planStatus === "資料不足"));

const attack = `<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=1</script>'\"><div data-broken="`;
const malicious = structuredClone(data);
malicious.updatedAt = attack;
malicious.market.summary = attack;
malicious.signals[0].strategy.planState = attack;
malicious.signals[0].strategy.indicators.rsi14 = attack;
malicious.signals[0].plans.long = { ...malicious.signals[0].plans.long, direction: attack, status: attack, planState: attack, conditions: { [attack]: true } };
malicious.signals = [{
  ...malicious.signals[0],
  coinId: `bad\" onmouseover=\"globalThis.pwned=1`,
  symbol: attack,
  name: attack,
  reasons: [attack],
  warnings: [attack],
  details: [{ label: attack, value: attack, sourceMode: attack, calculationMode: attack }],
  liveMode: "websocket",
  liveInstrument: { source: "Binance", symbol: `BAD\" onmouseover=\"globalThis.pwned=1`, baseAsset: attack, quoteAsset: "USDT" }
}];

renderDashboard(malicious, { symbolFilter: attack });
const rendered = Object.values(roots).flatMap(nodes);
assert(!rendered.some((node) => ["IMG", "SCRIPT"].includes(node.tagName)));
assert(rendered.filter((node) => node.textContent === attack).length >= 6);
const card = rendered.find((node) => node.tagName === "ARTICLE");
assert.equal(card.dataset.coinId, "");
assert.equal(card.dataset.livePair, "");
const longPlan = rendered.find((node) => node.dataset.plan === "long");
assert.equal(longPlan.dataset.planDirection, "做多");
assert.equal(longPlan.dataset.planStatus, "資料不足");
assert(!rendered.some((node) => Object.keys(node.attributes || {}).some((name) => name.startsWith("on"))));

const index = fs.readFileSync("index.html", "utf8");
const csp = index.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
assert(csp.includes("default-src 'none'") && csp.includes("script-src 'self'") && csp.includes("script-src-attr 'none'"));
assert(csp.includes("connect-src 'self' https://raw.githubusercontent.com wss://stream.binance.com:9443"));
assert(!csp.includes("'unsafe-inline'") && !csp.includes("'unsafe-eval'") && !/(?:^|\s)https:(?:\s|;|$)/.test(csp));

console.log("render security check ok");
