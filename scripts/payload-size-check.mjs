import assert from "node:assert/strict";
import fs from "node:fs";
import { SIGNAL_PAYLOAD_MAX_BYTES } from "../assets/js/signal-schema.mjs";

const bytes = fs.statSync("data/signals.json").size;
const payload = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));

assert(bytes <= SIGNAL_PAYLOAD_MAX_BYTES, `signals.json is ${bytes} bytes; budget is ${SIGNAL_PAYLOAD_MAX_BYTES}`);
assert(payload.signals.length <= 100);
assert(payload.signals.every((signal) => signal.hasCandles === false
  && !["candles", "details", "reasons", "warnings", "direction", "entryZone", "stopLoss", "takeProfit", "strategySource", "baseAsset", "timeframe", "updatedAt"].some((key) => key in signal)
  && !("plans" in signal.strategy)), "fallback signals must use the normalized compact shape");

console.log(`payload size check ok: ${bytes}/${SIGNAL_PAYLOAD_MAX_BYTES} bytes`);
