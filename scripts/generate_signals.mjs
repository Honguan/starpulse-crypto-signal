import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";

const API = "https://api.coingecko.com/api/v3/coins/markets";
const TOP_100_PAGES = [1];
const UPDATED_AT = new Date().toISOString().slice(0, 19).replace("T", " ");

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function symbolFor(coin) {
  return `${String(coin.symbol || "").toUpperCase()}USDT`;
}

function directionFor(change24h, change7d, riskLevel) {
  const trend = change24h + change7d / 2;
  if (riskLevel === "高" && Math.abs(change24h) > 18) return "觀望";
  if (trend >= 10) return "強烈做多";
  if (trend >= 3) return "做多";
  if (trend <= -10) return "強烈做空";
  if (trend <= -3) return "做空";
  return "觀望";
}

function riskLevelFor(coin, change24h) {
  const volume = number(coin.total_volume);
  if (volume < 1_000_000 || Math.abs(change24h) >= 18) return "高";
  if (volume < 10_000_000 || Math.abs(change24h) >= 10) return "中";
  return "低";
}

function marketCondition(signals) {
  const longCount = signals.filter((signal) => ["強烈做多", "做多"].includes(signal.direction)).length;
  const shortCount = signals.filter((signal) => ["強烈做空", "做空"].includes(signal.direction)).length;
  if (longCount > shortCount * 1.3) return "偏多";
  if (shortCount > longCount * 1.3) return "偏空";
  return "震盪";
}

function tradeLevels(price, direction) {
  const safePrice = Math.max(number(price), 0.000001);
  const longSide = ["強烈做多", "做多"].includes(direction);
  const shortSide = ["強烈做空", "做空"].includes(direction);
  const entryLow = round(safePrice * 0.995, safePrice < 1 ? 6 : 2);
  const entryHigh = round(safePrice * 1.005, safePrice < 1 ? 6 : 2);
  const stopLoss = round(safePrice * (longSide ? 0.965 : 1.035), safePrice < 1 ? 6 : 2);
  const takeProfit = [
    round(safePrice * (shortSide ? 0.95 : 1.05), safePrice < 1 ? 6 : 2),
    round(safePrice * (shortSide ? 0.92 : 1.08), safePrice < 1 ? 6 : 2)
  ];

  return { entryZone: { low: entryLow, high: entryHigh }, stopLoss, takeProfit };
}

export function signalFor(coin, index) {
  const change24h = round(coin.price_change_percentage_24h);
  const change7d = round(coin.price_change_percentage_7d_in_currency);
  const riskLevel = riskLevelFor(coin, change24h);
  const direction = directionFor(change24h, change7d, riskLevel);
  const confidence = clamp(Math.round(48 + Math.abs(change24h) * 1.4 + Math.abs(change7d) * 0.45), 35, 88);
  const winRate = clamp(Math.round(50 + confidence / 8 - (riskLevel === "高" ? 8 : 0)), 35, 75);
  const ev = direction === "觀望" ? -0.2 : round((winRate - 50) / 10 - (riskLevel === "高" ? 0.8 : 0), 1);
  const rr = direction === "觀望" ? 1.2 : round(1.5 + confidence / 100, 1);
  const vegasState = direction.includes("多") ? "bullish" : direction.includes("空") ? "bearish" : "neutral";
  const tdDirection = change24h > 0 ? "up" : change24h < 0 ? "down" : "none";
  const tdCount = clamp(Math.round(Math.abs(change24h) / 2), 0, 9);
  const tdState = tdCount >= 7 && tdDirection !== "none" ? `${tdDirection}${tdCount}` : "none";
  const levels = tradeLevels(coin.current_price, direction);
  const fallbackStrategy = strategyFor([], coin.current_price);
  const rank = coin.market_cap_rank || index + 1;

  return {
    symbol: symbolFor(coin),
    baseAsset: String(coin.symbol || "").toUpperCase(),
    price: number(coin.current_price),
    change24h,
    marketCapRank: rank,
    direction,
    confidence,
    winRate,
    ev,
    rr,
    riskLevel,
    timeframe: "1h / 4h",
    ...levels,
    plans: fallbackStrategy.plans,
    primaryDirection: "觀望",
    candles: [],
    strategy: fallbackStrategy,
    strategySource: "CoinGecko 市場快照（備援）",
    vegas: {
      state: vegasState,
      pricePosition: vegasState === "bullish" ? "aboveTunnel" : vegasState === "bearish" ? "belowTunnel" : "insideTunnel",
      ema12State: vegasState === "bullish" ? "aboveTunnel" : vegasState === "bearish" ? "belowTunnel" : "insideTunnel",
      ema12: null,
      ema144: null,
      ema169: null,
      tunnelTop: null,
      tunnelBottom: null,
      score: vegasState === "neutral" ? 5 : 10,
      text: `市值排名 ${rank}，以 24h / 7d 動能做輕量趨勢判斷。`
    },
    tdSequential: {
      state: tdState,
      direction: tdDirection,
      count: tdCount,
      riskText: tdState === "none" ? "輕量模式未出現九轉警告。" : `${tdDirection === "up" ? "上漲" : "下跌"}動能 ${tdCount}，避免追價。`,
      scoreImpact: tdCount >= 8 ? -3 : 0
    },
    reasons: [
      `市值排名 ${rank}`,
      `24h 漲跌 ${change24h}%`,
      `7d 漲跌 ${change7d}%`
    ],
    warnings: [
      riskLevel === "高" ? "波動或流動性風險偏高" : "輕量分析需等待後續技術指標確認",
      "此版本未逐一計算 K 線技術指標"
    ],
    detailScores: {
      trend: clamp(Math.round(10 + change7d / 2), 0, 20),
      vegas: vegasState === "neutral" ? 5 : 10,
      momentum: clamp(Math.round(8 + change24h / 2), 0, 15),
      volume: clamp(Math.round(Math.log10(Math.max(number(coin.total_volume), 1))), 0, 10),
      position: 6,
      tdSequential: tdCount,
      risk: riskLevel === "高" ? 3 : riskLevel === "中" ? 6 : 8,
      market: 6,
      longScore: direction.includes("多") ? confidence : Math.max(20, 60 - confidence / 2),
      shortScore: direction.includes("空") ? confidence : Math.max(20, 60 - confidence / 2)
    },
    analysis: {
      trendText: `CoinGecko 市值排名 ${rank}，7d 漲跌 ${change7d}%。`,
      vegasText: "目前為前 100 備援快照，尚未載入 K 線歷史。",
      momentumText: `24h 漲跌 ${change24h}%，以短期動能估算方向。`,
      volumeText: `24h 成交量約 ${Math.round(number(coin.total_volume)).toLocaleString("en-US")} USD。`,
      positionText: "進場、停損、止盈以目前價格百分比估算。",
      tdSequentialText: "輕量模式以漲跌幅估算追價風險，非完整九轉。",
      riskText: `風險等級：${riskLevel}。`,
      marketText: "前 100 模式以整體市值排序提供備援資料。"
    },
    updatedAt: UPDATED_AT
  };
}

async function fetchPage(page) {
  const url = `${API}?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false&price_change_percentage=7d`;
  const headers = process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko page ${page} failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function buildSignals() {
  const coins = (await Promise.all(TOP_100_PAGES.map(fetchPage))).flat().slice(0, 100);
  const signals = coins.map(signalFor);
  const market = {
    condition: marketCondition(signals),
    riskLevel: signals.filter((signal) => signal.riskLevel === "高").length > 80 ? "高" : "中",
    btcDirection: signals.find((signal) => signal.symbol === "BTCUSDT")?.direction || "震盪",
    ethDirection: signals.find((signal) => signal.symbol === "ETHUSDT")?.direction || "震盪",
    btcVegas: signals.find((signal) => signal.symbol === "BTCUSDT")?.vegas.state || "neutral",
    ethVegas: signals.find((signal) => signal.symbol === "ETHUSDT")?.vegas.state || "neutral",
    summary: "CoinGecko 市值前 100 備援快照已更新。"
  };

  return {
    project: "StarPulse Crypto Signal",
    status: "normal",
    live: false,
    strategySource: "CoinGecko 市場快照（備援）",
    updatedAt: UPDATED_AT,
    market,
    signals,
    watchlist: signals
      .filter((signal) => signal.direction === "觀望")
      .slice(0, 20)
      .map((signal) => ({ symbol: signal.symbol, reason: signal.reasons.join("、") })),
    highRisk: signals
      .filter((signal) => signal.riskLevel === "高")
      .slice(0, 20)
      .map((signal) => ({ symbol: signal.symbol, reason: signal.warnings[0] }))
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await buildSignals();
  fs.writeFileSync("data/signals.json", `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`generated ${payload.signals.length} signals`);
}
