import assert from "node:assert/strict";
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));
assert(data.signals.length >= 10 && data.signals.length <= 100, "signals count is within expected range");
assert.equal(data.schemaVersion, 1, "fallback data exposes signal schema version");
assert(data.signals.every((signal) => signal.plans?.long && signal.plans?.short), "signals expose long and short plans");
assert(data.signals.every((signal) => Array.isArray(signal.candles)), "signals expose candles");
assert(data.dataQuality?.status === "degraded" && data.dataQuality.missingHistoryCount === data.signals.length, "fallback publishes explicit data quality");
assert(data.signals.every((signal) => signal.coinId && signal.priceSource?.instrument === signal.coinId && signal.indicatorSource?.instrument === signal.coinId), "signals identify CoinGecko source instruments");
assert(data.signals.every((signal) => signal.liveMode === "snapshot-only" && signal.liveInstrument === null), "fallback signals are explicitly snapshot-only");
assert(data.signals.every((signal) => !("winRate" in signal) && !("ev" in signal) && !("rr" in signal)), "fallback data excludes unsupported performance metrics");
assert(data.signals.every((signal) => signal.sourceMode === "fallback" && signal.details.every((detail) => detail.sourceMode === "fallback" && detail.calculationMode)), "fallback details identify their source and calculation mode");
assert(data.signals.every((signal) => !("vegas" in signal) && !("tdSequential" in signal)), "fallback data excludes unimplemented named indicators");
assert(!("btcVegas" in data.market) && !("ethVegas" in data.market), "market summary excludes unimplemented Vegas labels");
assert(data.market.condition === "震盪" && data.signals.every((signal) => signal.primaryDirection === "觀望" && signal.direction === "觀望"), "fallback data does not claim an actionable setup");
console.log("check ok");
