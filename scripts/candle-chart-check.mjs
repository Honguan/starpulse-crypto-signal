import assert from "node:assert/strict";
import { renderCandleChart } from "../assets/js/candle-chart.mjs";

const calls = [];
const context = new Proxy({}, {
  get: (_, key) => (...args) => calls.push([key, args])
});
const canvas = { width: 480, height: 240, getContext: () => context };
const candles = [
  [0, 100, 105, 95, 102],
  [1, 102, 108, 99, 106],
  [2, 106, 110, 103, 104]
];
const plans = {
  long: { entryZone: { low: 101, high: 103 }, stopLoss: 95, takeProfit: [108, 112] },
  short: { entryZone: { low: 105, high: 107 }, stopLoss: 112, takeProfit: [100, 96] }
};

assert.equal(renderCandleChart(canvas, candles, plans), true);
assert(calls.some(([name]) => name === "fillRect"));
assert(calls.some(([name]) => name === "stroke"));
assert.equal(renderCandleChart(canvas, [], plans), false);

console.log("candle chart check ok");
