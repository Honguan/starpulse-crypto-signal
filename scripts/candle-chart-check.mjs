import assert from "node:assert/strict";
import { describeCandleChart, renderCandleChart } from "../assets/js/candle-chart.mjs";
import { loadCandles } from "../assets/js/candle-data.mjs";

function chartCanvas(clientWidth = 480) {
  const calls = [];
  const context = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, args]) });
  const canvas = {
    clientWidth,
    width: 640,
    height: 240,
    style: {},
    getBoundingClientRect: () => ({ width: canvas.clientWidth }),
    getContext: () => context
  };
  return { calls, canvas };
}

const start = Date.UTC(2026, 7, 30);
const candles = [
  [start, 100, 105, 95, 102],
  [start + 4 * 60 * 60 * 1000, 102, 108, 99, 106],
  [start + 8 * 60 * 60 * 1000, 106, 110, 103, 104]
];
const plans = {
  long: { entryZone: { low: 101, high: 103 }, stopLoss: 95, takeProfit: [108, 112] },
  short: { entryZone: { low: 105, high: 107 }, stopLoss: 112, takeProfit: [100, 96] }
};

const { calls, canvas } = chartCanvas();
assert.equal(renderCandleChart(canvas, candles, plans, 1), true);
assert.deepEqual([canvas.width, canvas.height, canvas.style.height], [480, 200, "200px"]);
assert(calls.some(([name]) => name === "fillRect"));
assert(calls.some(([name]) => name === "stroke"));
assert(calls.filter(([name]) => name === "fillText").length >= 6);
assert(calls.some(([name, args]) => name === "setLineDash" && String(args) === "7,3"));
assert(calls.some(([name, args]) => name === "fillText" && args[0] === "多進場低"));
assert(calls.some(([name, args]) => name === "fillText" && args[0] === "空進場低"));

renderCandleChart(canvas, candles, plans, 2);
assert.deepEqual([canvas.width, canvas.height], [960, 400]);
renderCandleChart(canvas, candles, plans, 3);
assert.deepEqual([canvas.width, canvas.height], [1440, 600]);
canvas.clientWidth = 320;
renderCandleChart(canvas, candles, plans, 2);
assert.deepEqual([canvas.width, canvas.height, canvas.style.height], [640, 400, "200px"]);
canvas.clientWidth = 800;
renderCandleChart(canvas, candles, plans, 2);
assert.deepEqual([canvas.width, canvas.height, canvas.style.height], [1600, 560, "280px"]);

const baseline = chartCanvas();
renderCandleChart(baseline.canvas, candles, {}, 1);
const outlier = chartCanvas();
renderCandleChart(outlier.canvas, candles, { long: { stopLoss: 1_000_000_000 } }, 1);
assert.equal(outlier.calls.find(([name]) => name === "fillRect")[1][3], baseline.calls.find(([name]) => name === "fillRect")[1][3]);
assert.match(describeCandleChart(candles, plans), /可視時間.*最新 K 線開 106.*做多：.*停損 95.*做空：/);
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
