import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { strategyFor } from "../assets/js/strategy.mjs";
import { SIGNAL_PAYLOAD_MAX_BYTES, SIGNAL_SCHEMA_VERSION } from "../assets/js/signal-schema.mjs";
import { fetchJson } from "./api-request.mjs";

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
  const riskLevel = riskLevelFor(coin, change24h);
  const fallbackStrategy = strategyFor([], [], coin.current_price);
  const rank = coin.market_cap_rank || index + 1;

  return {
    coinId: coin.id,
    name: coin.name || coin.id,
    symbol: String(coin.symbol || "").toUpperCase(),
    price: number(coin.current_price),
    priceSource: { source: "CoinGecko", instrument: coin.id, quoteAsset: "USD" },
    indicatorSource: { source: "CoinGecko", instrument: coin.id, timeframe: "1h / 4h" },
    liveMode: "snapshot-only",
    liveInstrument: null,
    change24h,
    marketCapRank: rank,
    riskLevel,
    plans: fallbackStrategy.plans,
    primaryDirection: "觀望",
    hasCandles: false,
    strategy: { indicators: fallbackStrategy.indicators, planState: fallbackStrategy.planState },
    sourceMode: "fallback"
  };
}

async function fetchPage(page) {
  const url = `${API}?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false&price_change_percentage=7d`;
  const headers = process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
  return fetchJson(url, { headers, label: `CoinGecko page ${page}` });
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
    status: "degraded",
    live: false,
    strategySource: "CoinGecko 市場快照（備援）",
    updatedAt: UPDATED_AT,
    dataQuality: { source: "CoinGecko", status: "degraded", successCount: signals.length, failedCount: 0, requestFailureCount: 0, missingHistoryCount: signals.length, concurrency: 1, failures: [] },
    market,
    signals
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = await buildSignals();
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) + 1 > SIGNAL_PAYLOAD_MAX_BYTES) throw new Error("signals payload exceeds 180 KiB budget");
  fs.writeFileSync("data/signals.json", `${json}\n`);
  console.log(`generated ${payload.signals.length} signals`);
}
