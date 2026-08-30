import assert from "node:assert/strict";
import { buildLivePayload } from "./update-live-signals.mjs";
import { fetchHistory, fetchMarkets, fetchOHLC, refreshTimeSeries } from "./live-signal-update.mjs";

const HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * HOUR;
const now = Date.UTC(2026, 0, 10, 12, 10);
const hourly = Array.from({ length: 220 }, (_, index) => [Math.floor(now / HOUR) * HOUR - (219 - index) * HOUR, 100 + index / 10]);
const fourHourly = Array.from({ length: 50 }, (_, index) => {
  const close = 100 + index;
  return [Math.floor(now / FOUR_HOURS) * FOUR_HOURS - (49 - index) * FOUR_HOURS, close - 1, close + 2, close - 2, close];
});
const coins = [
  { id: "bitcoin", symbol: "btc", current_price: 122, market_cap_rank: 1 },
  { id: "ethereum", symbol: "eth", current_price: 50, market_cap_rank: 2 }
];

let requests = 0;
const markets = await fetchMarkets(async () => {
  requests += 1;
  return { ok: true, json: async () => coins };
});
assert.equal(requests, 1);
assert.equal(markets.length, 2);

const normalizedHourly = await fetchHistory("bitcoin", async () => ({
  ok: true,
  json: async () => ({ prices: [[now, 999], [now - 10 * 60_000, 101], [now - 10 * 60_000 - HOUR, 100]] })
}), now);
assert.deepEqual(normalizedHourly, [[now - 10 * 60_000 - HOUR, 100], [now - 10 * 60_000, 101]]);

const realCandle = [Math.floor(now / FOUR_HOURS) * FOUR_HOURS, 100, 110, 90, 105];
assert.deepEqual(await fetchOHLC("bitcoin", async () => ({ ok: true, json: async () => [realCandle] }), now), [realCandle]);

const state = { version: 2, hourly: { bitcoin: hourly }, fourHourly: { bitcoin: fourHourly } };
const before = structuredClone(state);
await refreshTimeSeries(state, [coins[0]], now + 20 * 60_000, async () => {
  throw new Error("current authoritative candles must not be synthesized or refetched");
}, 0);
assert.deepEqual(state, before);

const payload = buildLivePayload(coins, state, now);
assert.equal(payload.signals.length, 2);
assert.equal(payload.updatedAt, "2026-01-10T12:10:00.000Z");
assert.equal(payload.signals[0].coinId, "bitcoin");
assert(!("winRate" in payload.signals[0]));
assert(!("ev" in payload.signals[0]));
assert(!("rr" in payload.signals[0]));
assert.notEqual(payload.signals[0].strategy.planState, "資料不足");
assert.deepEqual(payload.signals[0].candles.at(-1), fourHourly.at(-1));
assert.equal(payload.signals[1].strategy.planState, "資料不足");

const missing = structuredClone(state);
missing.hourly.bitcoin.splice(-2, 1);
requests = 0;
await refreshTimeSeries(missing, [coins[0]], now, async (url) => {
  requests += 1;
  assert(url.includes("market_chart"));
  return { ok: true, json: async () => ({ prices: hourly }) };
}, 0);
assert.equal(requests, 1);
assert.deepEqual(missing.hourly.bitcoin, hourly);

console.log("live update check ok");
