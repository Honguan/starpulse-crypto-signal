import assert from "node:assert/strict";
import fs from "node:fs";
import { marketFor } from "../assets/js/market-summary.mjs";

const data = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));
assert(data.signals.length >= 10 && data.signals.length <= 100, "signals count is within expected range");
assert.equal(data.schemaVersion, 2, "fallback data exposes signal schema version");
assert(data.signals.every((signal) => signal.plans?.long && signal.plans?.short), "signals expose long and short plans");
assert(data.signals.every((signal) => signal.hasCandles === false && !("candles" in signal)), "fallback excludes eager candle data");
assert(data.dataQuality?.status === "degraded" && data.dataQuality.missingHistoryCount === data.signals.length, "fallback publishes explicit data quality");
assert(data.signals.every((signal) => signal.coinId && signal.priceSource?.instrument === signal.coinId && signal.indicatorSource?.instrument === signal.coinId), "signals identify CoinGecko source instruments");
assert(data.signals.every((signal) => signal.liveMode === "snapshot-only" && signal.liveInstrument === null), "fallback signals are explicitly snapshot-only");
assert(data.signals.every((signal) => !("winRate" in signal) && !("ev" in signal) && !("rr" in signal)), "fallback data excludes unsupported performance metrics");
assert(data.signals.every((signal) => signal.sourceMode === "fallback" && !("plans" in signal.strategy)), "fallback uses the normalized strategy shape");
assert(data.signals.every((signal) => !("vegas" in signal) && !("tdSequential" in signal)), "fallback data excludes unimplemented named indicators");
assert(!("btcVegas" in data.market) && !("ethVegas" in data.market), "market summary excludes unimplemented Vegas labels");
assert(data.market.condition === "震盪" && data.signals.every((signal) => signal.primaryDirection === "觀望" && !("direction" in signal)), "fallback data does not claim an actionable setup");
assert.deepEqual(
  { condition: data.market.condition, riskLevel: data.market.riskLevel, metrics: data.market.metrics },
  marketFor(data.signals),
  "fallback publishes the shared auditable market aggregation"
);
console.log("check ok");
