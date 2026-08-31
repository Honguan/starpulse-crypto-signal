import assert from "node:assert/strict";
import { renderCandleChart } from "../assets/js/candle-chart.mjs";
import { loadCandles } from "../assets/js/candle-data.mjs";

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

let requestedUrl;
assert.deepEqual(await loadCandles("bitcoin", "2026-08-31T00:00:00Z", async (url, options) => {
  requestedUrl = url;
  assert.deepEqual(options, { cache: "no-store" });
  return { ok: true, json: async () => ({ schemaVersion: 1, coinId: "bitcoin", updatedAt: "2026-08-31T00:00:00Z", candles }) };
}), candles);
assert(requestedUrl.endsWith("/bitcoin.json?t=2026-08-31T00%3A00%3A00Z"));
await assert.rejects(loadCandles("../bitcoin", "", async () => ({ ok: true })), /invalid coin id/);
await assert.rejects(loadCandles("bitcoin", "", async () => ({ ok: true, json: async () => ({ schemaVersion: 1, coinId: "ethereum", candles }) })), /invalid candle payload/);

console.log("candle chart check ok");
