import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";
import { SIGNAL_PAYLOAD_MAX_BYTES, SIGNAL_SCHEMA_VERSION } from "../assets/js/signal-schema.mjs";
import { signalFor } from "./generate_signals.mjs";
import { fetchMarkets, refreshTimeSeries } from "./live-signal-update.mjs";
import { fetchVerifiedInstruments } from "./binance-instruments.mjs";

const outputDir = process.env.LIVE_DATA_DIR || "data";
const stateFile = process.env.LIVE_STATE_FILE || path.join(outputDir, "price-history.json");
const signalsFile = path.join(outputDir, "signals.json");

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return state.version === 2 ? state : {};
  } catch {
    return {};
  }
}

function updatedAt(now) {
  return new Date(now).toISOString();
}

function signalFrom(coin, index, hourly, candles4h, now, liveInstrument) {
  const base = signalFor(coin, index);
  const strategy = strategyFor(hourly, candles4h, coin.current_price, now);
  const volatility = strategy.indicators.volatility || 0;
  const riskLevel = volatility >= 4 ? "高" : volatility >= 2 ? "中" : "低";

  return {
    ...base,
    liveMode: liveInstrument ? "websocket" : "snapshot-only",
    liveInstrument: liveInstrument || null,
    price: Number(coin.current_price),
    change24h: Number(coin.price_change_percentage_24h) || 0,
    riskLevel,
    plans: strategy.plans,
    primaryDirection: strategy.primaryDirection,
    hasCandles: candles4h.length > 0,
    strategy: { indicators: strategy.indicators, planState: strategy.planState },
    sourceMode: "live"
  };
}

export function buildLivePayload(coins, state, now = Date.now(), liveInstruments = new Map()) {
  const signals = coins.map((coin, index) => ({
    ...signalFrom(coin, index, state.hourly?.[coin.id] || [], state.fourHourly?.[coin.id] || [], now, liveInstruments.get(coin.id))
  }));
  const count = (direction) => signals.filter((signal) => signal.primaryDirection === direction).length;

  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    project: "StarPulse Crypto Signal",
    status: state.dataQuality?.status || "degraded",
    live: true,
    strategySource: "CoinGecko hourly／4h OHLC",
    updatedAt: updatedAt(now),
    dataQuality: state.dataQuality || { source: "CoinGecko", status: "degraded", successCount: 0, failedCount: 0, requestFailureCount: 0, missingHistoryCount: signals.length, concurrency: 1, failures: [] },
    market: {
      condition: count("做多") > count("做空") ? "偏多" : count("做空") > count("做多") ? "偏空" : "震盪",
      riskLevel: signals.filter((signal) => signal.riskLevel === "高").length > 20 ? "高" : "中",
      btcDirection: signals.find((signal) => signal.coinId === "bitcoin")?.primaryDirection || "觀望",
      ethDirection: signals.find((signal) => signal.coinId === "ethereum")?.primaryDirection || "觀望",
      summary: "CoinGecko 市值前 100，1h／4h 策略資料。"
    },
    signals
  };
}

export function writeCandleSnapshots(directory, payload, state) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  for (const signal of payload.signals) {
    if (!signal.hasCandles) continue;
    fs.writeFileSync(path.join(directory, `${encodeURIComponent(signal.coinId)}.json`), `${JSON.stringify({
      schemaVersion: 1,
      coinId: signal.coinId,
      updatedAt: payload.updatedAt,
      candles: state.fourHourly[signal.coinId].slice(-60)
    })}\n`);
  }
}

export async function updateLiveSignals(now = Date.now()) {
  const coins = await fetchMarkets();
  const liveInstruments = await fetchVerifiedInstruments(coins);
  const state = readState();
  await refreshTimeSeries(state, coins, now);
  for (const failure of state.dataQuality.failures) console.warn(`CoinGecko ${failure.resource} ${failure.coinId}: ${failure.classification}${failure.status ? ` HTTP ${failure.status}` : ""}`);
  const payload = buildLivePayload(coins, state, now, liveInstruments);
  const candlesDir = path.join(outputDir, "candles");

  fs.mkdirSync(outputDir, { recursive: true });
  writeCandleSnapshots(candlesDir, payload, state);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
  const signalsJson = JSON.stringify(payload);
  if (Buffer.byteLength(signalsJson) + 1 > SIGNAL_PAYLOAD_MAX_BYTES) throw new Error("signals payload exceeds 180 KiB budget");
  fs.writeFileSync(signalsFile, `${signalsJson}\n`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await updateLiveSignals();
  console.log(`updated ${payload.signals.length} live signals`);
}
