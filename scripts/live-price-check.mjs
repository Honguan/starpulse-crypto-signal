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
const longState = element("等待回踩");
const shortState = element("條件不足");
const longBox = { dataset: { planDirection: "做多", planStatus: "可執行", entryLow: "99", entryHigh: "101", stopLoss: "96", takeProfit: "104" } };
const shortBox = { dataset: { planDirection: "做空", planStatus: "可執行", entryLow: "104", entryHigh: "106", stopLoss: "110", takeProfit: "100" } };
const card = {
  dataset: { symbol: "BTCUSDT" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? price
      : selector === "[data-live-change]" ? change
        : selector === '[data-plan="long"]' ? longBox
          : selector === '[data-plan="short"]' ? shortBox
            : selector === "[data-long-plan-state]" ? longState
              : selector === "[data-short-plan-state]" ? shortState : null;
  }
};
const root = { querySelector: () => card };

assert.equal(applyTicker({ s: "BTCUSDT", c: "105", P: "1.23" }, root), true);
assert.equal(price.textContent, "105");
assert.equal(change.textContent, "+1.23%");
assert.equal(longState.textContent, "已到止盈區");
assert.equal(shortState.textContent, "可進場");

const insufficientState = element("資料不足");
const insufficientCard = {
  dataset: { symbol: "ETHUSDT" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? element("50")
      : selector === '[data-plan="long"]' || selector === '[data-plan="short"]' ? { dataset: { planDirection: "觀望", planStatus: "資料不足", entryLow: "", entryHigh: "", stopLoss: "", takeProfit: "" } }
        : selector === "[data-long-plan-state]" || selector === "[data-short-plan-state]" ? insufficientState : null;
  }
};
assert.equal(applyTicker({ s: "ETHUSDT", c: "51", P: "1" }, { querySelector: () => insufficientCard }), true);
assert.equal(insufficientState.textContent, "資料不足");

console.log("live price check ok");
