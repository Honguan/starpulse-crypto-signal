import assert from "node:assert/strict";
import { planStateFor, strategyFor } from "../assets/js/strategy.mjs";

function series(values) {
  return values.map((price, index) => [Date.UTC(2026, 0, 1, index), price]);
}

const insufficient = strategyFor(series([100, 101, 102]), 102);
assert.equal(insufficient.planState, "資料不足");

const uptrend = series([
  ...Array.from({ length: 200 }, (_, index) => 100 + index * 0.25),
  ...Array.from({ length: 18 }, (_, index) => 149.75 - index * 0.18),
  ...Array.from({ length: 9 }, (_, index) => 146.5 + index * 0.2)
]);
const longResult = strategyFor(uptrend, 148.1);
assert.equal(longResult.plans.long.status, "可執行");
assert.equal(longResult.plans.short.status, "等待條件");
assert.equal(longResult.primaryDirection, "做多");
assert(longResult.plans.long.stopLoss < longResult.plans.long.entryZone.low);
assert(longResult.plans.long.takeProfit[0] > longResult.plans.long.entryZone.high);
assert(longResult.plans.long.takeProfit[1] > longResult.plans.long.takeProfit[0]);
assert(longResult.plans.short.stopLoss > longResult.plans.short.entryZone.high);
assert(longResult.plans.short.takeProfit[0] < longResult.plans.short.entryZone.low);
assert(longResult.plans.short.takeProfit[1] < longResult.plans.short.takeProfit[0]);

const downtrend = series([
  ...Array.from({ length: 200 }, (_, index) => 150 - index * 0.25),
  ...Array.from({ length: 18 }, (_, index) => 100.25 + index * 0.18),
  ...Array.from({ length: 9 }, (_, index) => 103.5 - index * 0.2)
]);
const shortResult = strategyFor(downtrend, 101.9);
assert.equal(shortResult.plans.short.status, "可執行");
assert.equal(shortResult.plans.long.status, "等待條件");
assert.equal(shortResult.primaryDirection, "做空");

assert.equal(planStateFor({ direction: "做多", status: "可執行", entryZone: { low: 99, high: 101 }, stopLoss: 96, takeProfit: [104, 106] }, 105), "已到止盈區");
assert.equal(planStateFor({ direction: "做空", status: "可執行", entryZone: { low: 99, high: 101 }, stopLoss: 104, takeProfit: [96, 94] }, 105), "停損失效");
assert.equal(planStateFor({ direction: "做多", status: "等待條件", entryZone: { low: 99, high: 101 }, stopLoss: 96, takeProfit: [104, 106] }, 100), "等待條件");

console.log("strategy check ok");
