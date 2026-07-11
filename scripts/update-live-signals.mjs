import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";
import { signalFor } from "./generate_signals.mjs";
import { fetchMarkets, fillMissingCandles, fillMissingHistory, updateCandles, updateHistory } from "./live-signal-update.mjs";

const outputDir = process.env.LIVE_DATA_DIR || "data";
const stateFile = path.join(outputDir, "price-history.json");
const signalsFile = path.join(outputDir, "signals.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { history: {} };
  }
}

function updatedAt(now) {
  return new Date(now).toISOString().slice(0, 19).replace("T", " ");
}

function signalFrom(coin, index, history, now) {
  const base = signalFor(coin, index);
  const strategy = strategyFor(history, coin.current_price);
  const primaryPlan = strategy.primaryDirection === "做多" ? strategy.plans.long : strategy.primaryDirection === "做空" ? strategy.plans.short : null;
  const active = Boolean(primaryPlan && primaryPlan.status === "可執行");
  const volatility = strategy.indicators.volatility || 0;
  const riskLevel = volatility >= 4 ? "高" : volatility >= 2 ? "中" : "低";

  return {
    ...base,
    coinId: coin.id,
    price: Number(coin.current_price),
    change24h: Number(coin.price_change_percentage_24h) || 0,
    direction: strategy.primaryDirection,
    confidence: Math.max(strategy.plans.long.score, strategy.plans.short.score),
    winRate: strategy.indicators.rsi14 || 0,
    ev: active ? 1 : 0,
    rr: active ? 2.5 : 0,
    riskLevel,
    timeframe: "1h / 4h",
    entryZone: primaryPlan?.entryZone || null,
    stopLoss: primaryPlan?.stopLoss || null,
    takeProfit: primaryPlan?.takeProfit || [],
    plans: strategy.plans,
    primaryDirection: strategy.primaryDirection,
    candles: [],
    strategy: { ...strategy, dataSource: "CoinGecko Demo", updatedAt: updatedAt(now) },
    vegas: { ...base.vegas, text: `4h EMA20 ${strategy.indicators.ema4h20 || "-"} / EMA50 ${strategy.indicators.ema4h50 || "-"}` },
    tdSequential: { ...base.tdSequential, riskText: `1h RSI ${strategy.indicators.rsi14 || "-"} / MACD ${strategy.indicators.macd || "-"}` },
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

export function buildLivePayload(coins, state, now = Date.now()) {
  const signals = coins.map((coin, index) => ({
    ...signalFrom(coin, index, state.history[coin.id] || [], now),
    candles: state.candles?.[coin.id] || []
  }));
  const count = (direction) => signals.filter((signal) => signal.direction === direction).length;

  return {
    project: "StarPulse Crypto Signal",
    status: "normal",
    live: true,
    strategySource: "CoinGecko Demo／1h／4h",
    updatedAt: updatedAt(now),
    market: {
      condition: count("做多") > count("做空") ? "偏多" : count("做空") > count("做多") ? "偏空" : "震盪",
      riskLevel: signals.filter((signal) => signal.riskLevel === "高").length > 20 ? "高" : "中",
      btcDirection: signals.find((signal) => signal.symbol === "BTCUSDT")?.direction || "觀望",
      ethDirection: signals.find((signal) => signal.symbol === "ETHUSDT")?.direction || "觀望",
      btcVegas: signals.find((signal) => signal.symbol === "BTCUSDT")?.vegas.state || "neutral",
      ethVegas: signals.find((signal) => signal.symbol === "ETHUSDT")?.vegas.state || "neutral",
      summary: "CoinGecko 市值前 100，1h／4h 策略資料。"
    },
    signals,
    watchlist: signals.filter((signal) => signal.direction === "觀望").slice(0, 20).map((signal) => ({ symbol: signal.symbol, reason: signal.strategy.planState })),
    highRisk: signals.filter((signal) => signal.riskLevel === "高").slice(0, 20).map((signal) => ({ symbol: signal.symbol, reason: `波動 ${signal.strategy.indicators.volatility}%` }))
  };
}

export async function updateLiveSignals(now = Date.now()) {
  const coins = await fetchMarkets();
  const state = readState();
  await fillMissingHistory(state, coins);
  await fillMissingCandles(state, coins);
  updateHistory(state, coins, now);
  updateCandles(state, coins, now);
  const payload = buildLivePayload(coins, state, now);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
  fs.writeFileSync(signalsFile, `${JSON.stringify(payload)}\n`);
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await updateLiveSignals();
  console.log(`updated ${payload.signals.length} live signals`);
}
