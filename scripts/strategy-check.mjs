import assert from "node:assert/strict";
import { planStateFor, strategyFor } from "../assets/js/strategy.mjs";

function series(values) {
  return values.map((price, index) => [Date.UTC(2026, 0, 1, index), price]);
}

const insufficient = strategyFor(series([100, 101, 102]), 102);
assert.equal(insufficient.planState, "資料不足");

const longPlan = strategyFor(series([
  ...Array.from({ length: 200 }, (_, index) => 100 + index * 0.25),
  ...Array.from({ length: 18 }, (_, index) => 149.75 - index * 0.18),
  ...Array.from({ length: 9 }, (_, index) => 146.5 + index * 0.2)
]), 148.1);
assert.equal(longPlan.direction, "做多");
assert.equal(longPlan.planState, "可進場");
assert(longPlan.stopLoss < longPlan.entryZone.low);
assert(longPlan.takeProfit[0] > longPlan.entryZone.high);
assert(longPlan.takeProfit[1] > longPlan.takeProfit[0]);

const shortPlan = strategyFor(series([
  ...Array.from({ length: 200 }, (_, index) => 150 - index * 0.25),
  ...Array.from({ length: 18 }, (_, index) => 100.25 + index * 0.18),
  ...Array.from({ length: 9 }, (_, index) => 103.5 - index * 0.2)
]), 101.9);
assert.equal(shortPlan.direction, "做空");
assert.equal(shortPlan.planState, "可進場");
assert(shortPlan.stopLoss > shortPlan.entryZone.high);
assert(shortPlan.takeProfit[0] < shortPlan.entryZone.low);
assert(shortPlan.takeProfit[1] < shortPlan.takeProfit[0]);

assert.equal(planStateFor({ direction: "做多", entryZone: { low: 99, high: 101 }, stopLoss: 96, takeProfit: [104, 106] }, 105), "已到止盈區");
assert.equal(planStateFor({ direction: "做空", entryZone: { low: 99, high: 101 }, stopLoss: 104, takeProfit: [96, 94] }, 105), "停損失效");

console.log("strategy check ok");
