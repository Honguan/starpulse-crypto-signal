import assert from "node:assert/strict";
import { applyTicker } from "../assets/js/live-prices.js";

function element(textContent = "") {
  return {
    textContent,
    dataset: {},
    classList: { add() {}, remove() {} }
  };
}

const price = element("100");
const change = element("0%");
const state = element("等待回踩");
const card = {
  dataset: { symbol: "BTCUSDT", direction: "做多", entryLow: "99", entryHigh: "101", stopLoss: "96", takeProfit: "104" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? price : selector === "[data-live-change]" ? change : selector === "[data-plan-state]" ? state : null;
  }
};
const root = { querySelector: () => card };

assert.equal(applyTicker({ s: "BTCUSDT", c: "105", P: "1.23" }, root), true);
assert.equal(price.textContent, "105");
assert.equal(change.textContent, "+1.23%");
assert.equal(state.textContent, "已到止盈區");

const insufficientState = element("資料不足");
const insufficientCard = {
  dataset: { symbol: "ETHUSDT", direction: "觀望", entryLow: "", entryHigh: "", stopLoss: "", takeProfit: "" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? element("50") : selector === "[data-plan-state]" ? insufficientState : null;
  }
};
assert.equal(applyTicker({ s: "ETHUSDT", c: "51", P: "1" }, { querySelector: () => insufficientCard }), true);
assert.equal(insufficientState.textContent, "資料不足");

console.log("live price check ok");
