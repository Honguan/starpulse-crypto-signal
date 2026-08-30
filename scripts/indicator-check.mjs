import assert from "node:assert/strict";
import { ema, macd, rsi } from "../assets/js/strategy.mjs";

function closeTo(actual, expected, tolerance = 1e-9) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

// Golden outputs generated with technicalindicators 3.1.0 using EMA oscillators/signals.
const volatile = Array.from({ length: 80 }, (_, index) =>
  100 + index * 0.17 + Math.sin(index * 0.71) * 3 + Math.cos(index * 0.19));
const volatileMacd = macd(volatile);
closeTo(ema(volatile, 20).at(-1), 111.44449996311305);
closeTo(ema(volatile, 50).at(-1), 109.19206703056811);
closeTo(rsi(volatile), 51.03, 0.005);
closeTo(volatileMacd.line.at(-1), 0.6582578339983343);
closeTo(volatileMacd.signal.at(-1), 1.1208499903176286);
closeTo(volatileMacd.histogram.at(-1), -0.4625921563192943);

const flat = Array(40).fill(100);
const rising = Array.from({ length: 40 }, (_, index) => index + 1);
const falling = Array.from({ length: 40 }, (_, index) => 40 - index);
assert.equal(rsi(flat), 100);
assert.equal(rsi(rising), 100);
assert.equal(rsi(falling), 0);
assert.equal(ema(flat, 20).at(-1), 100);
assert.equal(ema(rising, 20).at(-1), 30.5);
assert.equal(ema(falling, 20).at(-1), 10.5);
assert.equal(macd(flat).line.at(-1), 0);
closeTo(macd(rising).histogram.at(-1), 0);
closeTo(macd(falling).histogram.at(-1), 0);

assert.deepEqual(ema(Array(19).fill(1), 20), []);
assert.equal(rsi(Array(14).fill(1)), null);
assert.equal(macd(Array(33).fill(1)), null);

console.log("indicator check ok");
