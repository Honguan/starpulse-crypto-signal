import assert from "node:assert/strict";
import { applyTicker, setLiveState } from "../assets/js/live-prices.js";

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
const primaryState = element("等待回踩");
const primaryRr = element("2.5:1");
const longBox = { dataset: { planDirection: "做多", planStatus: "可執行", entryLow: "99", entryHigh: "101", stopLoss: "96", takeProfit: "104" } };
const shortBox = { dataset: { planDirection: "做空", planStatus: "可執行", entryLow: "104", entryHigh: "106", stopLoss: "110", takeProfit: "100" } };
const card = {
  dataset: { livePair: "BTCUSDT", snapshotPrice: "100" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? price
      : selector === "[data-live-change]" ? change
        : selector === '[data-plan="long"]' ? longBox
          : selector === '[data-plan="short"]' ? shortBox
            : selector === "[data-long-plan-state]" ? longState
              : selector === "[data-short-plan-state]" ? shortState
                : selector === '[data-plan-status="可執行"]' ? longBox
                  : selector === "[data-plan-state]" ? primaryState
                    : selector === "[data-plan-rr]" ? primaryRr : null;
  }
};
const root = { querySelector: (selector) => selector.includes('data-live-pair="BTCUSDT"') ? card : null };

assert.equal(applyTicker({ s: "BTCUSDT", c: "104", P: "1.23" }, root), true);
assert.equal(price.textContent, "104");
assert.equal(change.textContent, "+1.23%");
assert.equal(longState.textContent, "已到止盈區");
assert.equal(shortState.textContent, "可進場");
assert.equal(primaryRr.textContent, "2.5:1");

applyTicker({ s: "BTCUSDT", c: "96", P: "-1" }, root);
assert.equal(primaryState.textContent, "停損失效");
assert.equal(primaryRr.textContent, "-");
assert.equal(applyTicker({ s: "BTCUSDT", c: "110", P: "10" }, root), false);
assert.equal(price.textContent, "96");
assert.equal(applyTicker({ s: "ETHUSDT", c: "100", P: "1" }, root), false);

const insufficientState = element("資料不足");
const insufficientCard = {
  dataset: { livePair: "ETHUSDT", snapshotPrice: "50" },
  querySelector(selector) {
    return selector === "[data-live-price]" ? element("50")
      : selector === '[data-plan="long"]' || selector === '[data-plan="short"]' ? { dataset: { planDirection: "觀望", planStatus: "資料不足", entryLow: "", entryHigh: "", stopLoss: "", takeProfit: "" } }
        : selector === "[data-long-plan-state]" || selector === "[data-short-plan-state]" ? insufficientState : null;
  }
};
assert.equal(applyTicker({ s: "ETHUSDT", c: "51", P: "1" }, { querySelector: () => insufficientCard }), true);
assert.equal(insufficientState.textContent, "資料不足");

const websocketState = element("連線中…");
const strategyFreshness = element("過期");
setLiveState(true, { querySelector: (selector) => selector.includes("websocket") ? websocketState : strategyFreshness });
assert.equal(websocketState.textContent, "已連線");
assert.equal(strategyFreshness.textContent, "過期");

console.log("live price check ok");
