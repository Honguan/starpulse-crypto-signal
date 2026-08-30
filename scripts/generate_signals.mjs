import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";
import { SIGNAL_SCHEMA_VERSION } from "../assets/js/signal-schema.mjs";

const API = "https://api.coingecko.com/api/v3/coins/markets";
const TOP_100_PAGES = [1];
const UPDATED_AT = new Date().toISOString();

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function riskLevelFor(coin, change24h) {
  const volume = number(coin.total_volume);
  if (volume < 1_000_000 || Math.abs(change24h) >= 18) return "高";
  if (volume < 10_000_000 || Math.abs(change24h) >= 10) return "中";
  return "低";
}

export function signalFor(coin, index) {
  const change24h = round(coin.price_change_percentage_24h);
  const change7d = round(coin.price_change_percentage_7d_in_currency);
  const riskLevel = riskLevelFor(coin, change24h);
  const fallbackStrategy = strategyFor([], [], coin.current_price);
  const rank = coin.market_cap_rank || index + 1;

  return {
    coinId: coin.id,
    name: coin.name || coin.id,
    symbol: String(coin.symbol || "").toUpperCase(),
    baseAsset: String(coin.symbol || "").toUpperCase(),
    price: number(coin.current_price),
    priceSource: { source: "CoinGecko", instrument: coin.id, quoteAsset: "USD" },
    indicatorSource: { source: "CoinGecko", instrument: coin.id, timeframe: "1h / 4h" },
    liveMode: "snapshot-only",
    liveInstrument: null,
    change24h,
    marketCapRank: rank,
    direction: "觀望",
    riskLevel,
    timeframe: "1h / 4h",
    plans: fallbackStrategy.plans,
    primaryDirection: "觀望",
    candles: [],
    strategy: fallbackStrategy,
    strategySource: "CoinGecko 市場快照（備援）",
    sourceMode: "fallback",
    details: [
      { label: "市值排名", value: rank, sourceMode: "fallback", calculationMode: "CoinGecko market_cap_rank" },
      { label: "24h 漲跌", value: `${change24h}%`, sourceMode: "fallback", calculationMode: "CoinGecko price_change_percentage_24h" },
      { label: "7d 漲跌", value: `${change7d}%`, sourceMode: "fallback", calculationMode: "CoinGecko price_change_percentage_7d" },
      { label: "24h 成交量", value: `${Math.round(number(coin.total_volume)).toLocaleString("en-US")} USD`, sourceMode: "fallback", calculationMode: "CoinGecko total_volume" }
    ],
    reasons: [
      `市值排名 ${rank}`,
      `24h 漲跌 ${change24h}%`,
      `7d 漲跌 ${change7d}%`
    ],
    warnings: [
      riskLevel === "高" ? "波動或流動性風險偏高" : "輕量分析需等待後續技術指標確認",
      "此版本未逐一計算 K 線技術指標"
    ],
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
    condition: "震盪",
    riskLevel: signals.filter((signal) => signal.riskLevel === "高").length > 80 ? "高" : "中",
    btcDirection: "觀望",
    ethDirection: "觀望",
    summary: "CoinGecko 市值前 100 備援快照已更新。"
  };

  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
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
      .map((signal) => ({ coinId: signal.coinId, symbol: signal.symbol, reason: signal.reasons.join("、") })),
    highRisk: signals
      .filter((signal) => signal.riskLevel === "高")
      .slice(0, 20)
      .map((signal) => ({ coinId: signal.coinId, symbol: signal.symbol, reason: signal.warnings[0] }))
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await buildSignals();
  fs.writeFileSync("data/signals.json", `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`generated ${payload.signals.length} signals`);
}
