import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";
import { SIGNAL_SCHEMA_VERSION } from "../assets/js/signal-schema.mjs";
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
  const primaryPlan = strategy.primaryDirection === "做多" ? strategy.plans.long : strategy.primaryDirection === "做空" ? strategy.plans.short : null;
  const volatility = strategy.indicators.volatility || 0;
  const riskLevel = volatility >= 4 ? "高" : volatility >= 2 ? "中" : "低";

  return {
    ...base,
    liveMode: liveInstrument ? "websocket" : "snapshot-only",
    liveInstrument: liveInstrument || null,
    price: Number(coin.current_price),
    change24h: Number(coin.price_change_percentage_24h) || 0,
    direction: strategy.primaryDirection,
    riskLevel,
    timeframe: "1h / 4h",
    entryZone: primaryPlan?.entryZone || null,
    stopLoss: primaryPlan?.stopLoss || null,
    takeProfit: primaryPlan?.takeProfit || [],
    plans: strategy.plans,
    primaryDirection: strategy.primaryDirection,
    candles: [],
    strategySource: "CoinGecko hourly／4h OHLC",
    strategy: { ...strategy, dataSource: "CoinGecko hourly／4h OHLC", updatedAt: updatedAt(now) },
    sourceMode: "live",
    details: [
      { label: "4h EMA20／EMA50", value: `${strategy.indicators.ema4h20 ?? "-"}／${strategy.indicators.ema4h50 ?? "-"}`, sourceMode: "live", calculationMode: "4h close EMA(20,50)" },
      { label: "1h EMA20", value: strategy.indicators.ema1h20 ?? "-", sourceMode: "live", calculationMode: "1h close EMA(20)" },
      { label: "1h RSI14", value: strategy.indicators.rsi14 ?? "-", sourceMode: "live", calculationMode: "1h close RSI(14)" },
      { label: "1h MACD", value: `${strategy.indicators.macd ?? "-"}／${strategy.indicators.macdSignal ?? "-"}`, sourceMode: "live", calculationMode: "1h close MACD(12,26,9)" },
      { label: "條件分數", value: `多 ${strategy.plans.long.score}%／空 ${strategy.plans.short.score}%`, sourceMode: "live", calculationMode: "trend 40 + position 20 + RSI 20 + MACD 20" }
    ],
    reasons: [
      `做多方案：${strategy.plans.long.status}（${strategy.plans.long.score}%）`,
      `做空方案：${strategy.plans.short.status}（${strategy.plans.short.score}%）`,
      `4h EMA20／EMA50：${strategy.indicators.ema4h20 || "-"}／${strategy.indicators.ema4h50 || "-"}`,
      `1h RSI14：${strategy.indicators.rsi14 || "-"}`
    ],
    warnings: strategy.planState === "資料不足"
      ? ["歷史資料不足，暫不提供進出場計畫。"]
      : ["僅供市場分析，不構成投資建議。", "觸及停損或止盈區時請自行依風險計畫處理。"],
    updatedAt: updatedAt(now)
  };
}

export function buildLivePayload(coins, state, now = Date.now(), liveInstruments = new Map()) {
  const signals = coins.map((coin, index) => ({
    ...signalFrom(coin, index, state.hourly?.[coin.id] || [], state.fourHourly?.[coin.id] || [], now, liveInstruments.get(coin.id)),
    candles: state.fourHourly?.[coin.id] || []
  }));
  const count = (direction) => signals.filter((signal) => signal.direction === direction).length;

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
      btcDirection: signals.find((signal) => signal.coinId === "bitcoin")?.direction || "觀望",
      ethDirection: signals.find((signal) => signal.coinId === "ethereum")?.direction || "觀望",
      summary: "CoinGecko 市值前 100，1h／4h 策略資料。"
    },
    signals,
    watchlist: signals.filter((signal) => signal.direction === "觀望").slice(0, 20).map((signal) => ({ coinId: signal.coinId, symbol: signal.symbol, reason: signal.strategy.planState })),
    highRisk: signals.filter((signal) => signal.riskLevel === "高").slice(0, 20).map((signal) => ({ coinId: signal.coinId, symbol: signal.symbol, reason: `波動 ${signal.strategy.indicators.volatility}%` }))
  };
}

export async function updateLiveSignals(now = Date.now()) {
  const coins = await fetchMarkets();
  const liveInstruments = await fetchVerifiedInstruments(coins);
  const state = readState();
  await refreshTimeSeries(state, coins, now);
  for (const failure of state.dataQuality.failures) console.warn(`CoinGecko ${failure.resource} ${failure.coinId}: ${failure.classification}${failure.status ? ` HTTP ${failure.status}` : ""}`);
  const payload = buildLivePayload(coins, state, now, liveInstruments);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
  fs.writeFileSync(signalsFile, `${JSON.stringify(payload)}\n`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await updateLiveSignals();
  console.log(`updated ${payload.signals.length} live signals`);
}
