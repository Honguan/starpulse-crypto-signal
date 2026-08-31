import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLivePayload, writeCandleSnapshots } from "./update-live-signals.mjs";
import { fetchHistory, fetchMarkets, fetchOHLC, refreshTimeSeries } from "./live-signal-update.mjs";
import { fetchVerifiedInstruments, verifiedInstruments } from "./binance-instruments.mjs";
import { validateSignalPayload } from "../assets/js/signal-schema.mjs";
import { fetchJson } from "./api-request.mjs";

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

const response = (status, payload, retryAfter) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => name === "retry-after" ? retryAfter || null : null },
  json: async () => payload
});

await assert.rejects(fetchJson("timeout", {
  fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(resolve, 50);
    signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
  }),
  timeoutMs: 5,
  retries: 0
}), { classification: "timeout" });

let retryCalls = 0;
const retryDelays = [];
assert.deepEqual(await fetchJson("rate-limit", {
  fetchImpl: async () => ++retryCalls === 1 ? response(429, {}, "2") : response(200, { ok: true }),
  retries: 1,
  sleepImpl: async (delay) => retryDelays.push(delay),
  random: () => 0
}), { ok: true });
assert.deepEqual(retryDelays, [2000]);

retryCalls = 0;
assert.deepEqual(await fetchJson("upstream", {
  fetchImpl: async () => ++retryCalls === 1 ? response(500, {}) : response(200, { ok: true }),
  retries: 1,
  sleepImpl: async () => {},
  random: () => 0
}), { ok: true });

retryCalls = 0;
await assert.rejects(fetchJson("bounded", {
  fetchImpl: async () => { retryCalls += 1; return response(500, {}); },
  sleepImpl: async () => {},
  random: () => 0
}), { classification: "upstream", status: 500 });
assert.equal(retryCalls, 3);

retryCalls = 0;
await assert.rejects(fetchJson("permanent", { fetchImpl: async () => { retryCalls += 1; return response(404, {}); } }), { classification: "http", status: 404 });
assert.equal(retryCalls, 1);
await assert.rejects(fetchJson("malformed", { fetchImpl: async () => ({ ...response(200, {}), json: async () => { throw new SyntaxError(); } }) }), { classification: "malformed-json" });

const duplicateAndMissing = [...coins, { id: "wrapped-bitcoin", symbol: "btc" }, { id: "dogecoin", symbol: "doge" }];
const liveInstruments = verifiedInstruments(duplicateAndMissing, [
  { symbol: "BTCUSDT", status: "TRADING", isSpotTradingAllowed: true, baseAsset: "BTC", quoteAsset: "USDT" },
  { symbol: "ETHUSDT", status: "BREAK", isSpotTradingAllowed: true, baseAsset: "ETH", quoteAsset: "USDT" }
]);
assert.equal(liveInstruments.get("bitcoin").symbol, "BTCUSDT");
assert.equal(liveInstruments.has("wrapped-bitcoin"), false);
assert.equal(liveInstruments.has("ethereum"), false);
assert.equal(liveInstruments.has("dogecoin"), false);
assert.equal((await fetchVerifiedInstruments(coins, async (url) => {
  assert(url.startsWith("https://data-api.binance.vision/"));
  return { ok: false };
})).size, 0);
const duplicatePayload = buildLivePayload(duplicateAndMissing, {}, now, liveInstruments);
assert.deepEqual(duplicatePayload.signals.filter((signal) => signal.symbol === "BTC").map((signal) => signal.coinId), ["bitcoin", "wrapped-bitcoin"]);
assert.equal(duplicatePayload.signals.find((signal) => signal.coinId === "wrapped-bitcoin").liveMode, "snapshot-only");

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
assert.deepEqual({ version: state.version, hourly: state.hourly, fourHourly: state.fourHourly }, before);

const staleState = {
  version: 2,
  hourly: { bitcoin: hourly, delisted: hourly },
  fourHourly: { bitcoin: fourHourly, delisted: fourHourly }
};
await refreshTimeSeries(staleState, [coins[0]], now, async () => { throw new Error("retained series should not be fetched"); }, 0);
assert.deepEqual(Object.keys(staleState.hourly), ["bitcoin"]);
assert.deepEqual(Object.keys(staleState.fourHourly), ["bitcoin"]);

const payload = buildLivePayload(coins, state, now, liveInstruments);
assert.equal(validateSignalPayload(payload), payload);
assert.equal(payload.signals.length, 2);
assert.equal(payload.updatedAt, "2026-01-10T12:10:00.000Z");
assert.equal(payload.signals[0].coinId, "bitcoin");
assert.equal(payload.signals[0].symbol, "BTC");
assert.equal(payload.signals[0].liveMode, "websocket");
assert.equal(payload.signals[0].liveInstrument.symbol, "BTCUSDT");
assert.equal(payload.signals[1].liveMode, "snapshot-only");
assert.equal(payload.signals[1].liveInstrument, null);
assert.deepEqual(payload.signals[0].priceSource, { source: "CoinGecko", instrument: "bitcoin", quoteAsset: "USD" });
assert.equal(payload.signals[0].indicatorSource.instrument, "bitcoin");
assert.equal(payload.status, "normal");
assert.deepEqual(payload.dataQuality, { source: "CoinGecko", status: "normal", successCount: 1, failedCount: 0, requestFailureCount: 0, missingHistoryCount: 0, concurrency: 1, failures: [] });
assert(!("winRate" in payload.signals[0]));
assert(!("ev" in payload.signals[0]));
assert(!("rr" in payload.signals[0]));
assert.equal(payload.signals[0].sourceMode, "live");
assert.deepEqual(Object.keys(payload.signals[0].strategy).sort(), ["indicators", "planState"]);
assert(!("vegas" in payload.signals[0]));
assert(!("tdSequential" in payload.signals[0]));
assert.notEqual(payload.signals[0].strategy.planState, "資料不足");
assert.equal(payload.signals[0].hasCandles, true);
assert.equal("candles" in payload.signals[0], false);
assert.equal("direction" in payload.signals[0], false);
assert.equal(payload.signals[1].strategy.planState, "資料不足");
assert.equal(payload.market.condition, "震盪");
assert.equal(payload.signals[0].primaryDirection, "觀望");
assert.equal(payload.market.btcDirection, payload.signals.find((signal) => signal.coinId === "bitcoin").primaryDirection);
assert.equal(payload.market.ethDirection, payload.signals.find((signal) => signal.coinId === "ethereum").primaryDirection);

const trendHourly = [
  ...Array.from({ length: 201 }, (_, index) => 100 + index * 0.25),
  ...Array.from({ length: 15 }, (_, index) => 150 - (index + 1) * 0.2),
  ...Array.from({ length: 14 }, (_, index) => 147 + (index + 1) * 0.05)
].map((priceValue, index) => [Date.UTC(2026, 0, 1, index), priceValue]);
const trendCandles = trendHourly.filter(([timestamp]) => timestamp % FOUR_HOURS === 0)
  .map(([timestamp, close]) => [timestamp, close, close + 1, close - 1, close]);
const directional = buildLivePayload([{ ...coins[0], current_price: 148.1 }], { hourly: { bitcoin: trendHourly }, fourHourly: { bitcoin: trendCandles } }, trendHourly.at(-1)[0]);
assert.equal(directional.signals[0].primaryDirection, "做多");
assert.equal(directional.market.btcDirection, "做多");

const candleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "starpulse-candles-"));
try {
  writeCandleSnapshots(candleDirectory, payload, state);
  assert.deepEqual(fs.readdirSync(candleDirectory), ["bitcoin.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(candleDirectory, "bitcoin.json"), "utf8")), {
    schemaVersion: 1,
    coinId: "bitcoin",
    updatedAt: payload.updatedAt,
    candles: fourHourly
  });
} finally {
  fs.rmSync(candleDirectory, { recursive: true, force: true });
}

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

const partial = { version: 2, hourly: {}, fourHourly: {} };
await refreshTimeSeries(partial, coins, now, async (url) => {
  if (url.includes("ethereum")) return response(500, {});
  return url.includes("market_chart") ? response(200, { prices: hourly }) : response(200, fourHourly);
}, 0, { retries: 0 });
assert.equal(partial.dataQuality.status, "degraded");
assert.equal(partial.dataQuality.successCount, 1);
assert.equal(partial.dataQuality.failedCount, 1);
assert.equal(partial.dataQuality.requestFailureCount, 2);
assert.equal(partial.dataQuality.missingHistoryCount, 1);
assert.deepEqual(partial.dataQuality.failures.map(({ coinId, resource, classification }) => ({ coinId, resource, classification })), [
  { coinId: "ethereum", resource: "hourly", classification: "upstream" },
  { coinId: "ethereum", resource: "ohlc", classification: "upstream" }
]);
assert.equal(buildLivePayload(coins, partial, now).status, "degraded");

const missedWindows = {
  version: 2,
  hourly: { bitcoin: hourly.slice(0, -3) },
  fourHourly: { bitcoin: fourHourly.slice(0, -2) }
};
const backfillRequests = [];
await refreshTimeSeries(missedWindows, [coins[0]], now, async (url) => {
  backfillRequests.push(url);
  return url.includes("market_chart") ? response(200, { prices: hourly }) : response(200, fourHourly);
}, 0);
assert.equal(backfillRequests.length, 2);
assert(backfillRequests.some((url) => url.includes("market_chart")) && backfillRequests.some((url) => url.includes("ohlc")));
assert.deepEqual(missedWindows.hourly.bitcoin, hourly);
assert.deepEqual(missedWindows.fourHourly.bitcoin, fourHourly);
assert.equal(missedWindows.dataQuality.status, "normal");

console.log("live update check ok");
