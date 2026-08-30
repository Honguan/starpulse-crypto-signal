import assert from "node:assert/strict";
import fs from "node:fs";
import { parseSignalPayload, validateSignalPayload } from "../assets/js/signal-schema.mjs";

const valid = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));

assert.equal(validateSignalPayload(valid), valid);
assert.equal(parseSignalPayload(JSON.stringify(valid)).signals.length, valid.signals.length);
assert.throws(() => parseSignalPayload('{"schemaVersion":1'), { code: "parse" });

for (const invalid of [
  { ...valid, schemaVersion: 99 },
  { ...valid, market: null },
  { ...valid, signals: [] },
  { ...valid, signals: valid.signals.map((signal, index) => index ? signal : { ...signal, reasons: null }) },
  { ...valid, signals: valid.signals.map((signal, index) => index ? signal : { ...signal, price: NaN }) },
  { ...valid, signals: valid.signals.map((signal, index) => index ? signal : { ...signal, change24h: null }) },
  { ...valid, signals: valid.signals.map((signal, index) => index ? signal : { ...signal, details: [null] }) },
  { ...valid, signals: valid.signals.map((signal, index) => index ? signal : { ...signal, candles: [[1, 2, null, 4, 5]] }) }
]) assert.throws(() => validateSignalPayload(invalid), { code: "schema" });

console.log("signal schema check ok");
