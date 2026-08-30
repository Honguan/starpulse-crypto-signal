import { fetchJson } from "./api-request.mjs";

const API = "https://api.coingecko.com/api/v3";
const HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * HOUR;
const MIN_HOURLY = 220;
const MIN_4H = 50;
const MAX_HISTORY = 24 * 30;
const MAX_CANDLES = 60;

function headers() {
  return process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
}

function expectedClose(now, interval) {
  return Math.floor(now / interval) * interval;
}

function continuousTail(rows, interval, minimum, width, now) {
  if (!Array.isArray(rows) || rows.length < minimum || rows.at(-1)?.[0] !== expectedClose(now, interval)) return false;
  return rows.slice(-minimum).every((row, index, tail) =>
    Array.isArray(row)
      && row.length >= width
      && row[0] % interval === 0
      && row.slice(1, width).every((value) => Number.isFinite(Number(value)) && Number(value) > 0)
      && (!index || row[0] - tail[index - 1][0] === interval));
}

function normalized(rows, interval, width, now, limit) {
  const latest = expectedClose(now, interval);
  const byTimestamp = new Map();
  for (const row of rows || []) {
    const values = Array.isArray(row) ? row.slice(0, width).map(Number) : [];
    if (values.length === width
        && Number.isFinite(values[0])
        && values[0] % interval === 0
        && values[0] <= latest
        && values.slice(1).every((value) => Number.isFinite(value) && value > 0)) {
      byTimestamp.set(values[0], values);
    }
  }
  return [...byTimestamp.values()].sort((a, b) => a[0] - b[0]).slice(-limit);
}

export async function fetchMarkets(fetchImpl = fetch, requestOptions = {}) {
  return fetchJson(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=7d`, { fetchImpl, headers: headers(), label: "CoinGecko markets", ...requestOptions });
}

export async function fetchHistory(coinId, fetchImpl = fetch, now = Date.now(), requestOptions = {}) {
  const payload = await fetchJson(`${API}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=30&interval=hourly`, { fetchImpl, headers: headers(), label: `CoinGecko history ${coinId}`, ...requestOptions });
  return normalized(payload.prices, HOUR, 2, now, MAX_HISTORY);
}

export async function fetchOHLC(coinId, fetchImpl = fetch, now = Date.now(), requestOptions = {}) {
  return normalized(await fetchJson(`${API}/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=30`, { fetchImpl, headers: headers(), label: `CoinGecko OHLC ${coinId}`, ...requestOptions }), FOUR_HOURS, 5, now, MAX_CANDLES);
}

export async function refreshTimeSeries(state, coins, now = Date.now(), fetchImpl = fetch, delayMs = 4000, requestOptions = {}) {
  state.version = 2;
  state.hourly ||= {};
  state.fourHourly ||= {};
  const failures = [];

  for (const [index, coin] of coins.entries()) {
    if (!coin.id) continue;
    let requested = false;
    if (!continuousTail(state.hourly[coin.id], HOUR, MIN_HOURLY, 2, now)) {
      requested = true;
      try {
        state.hourly[coin.id] = await fetchHistory(coin.id, fetchImpl, now, requestOptions);
      } catch (error) {
        state.hourly[coin.id] ||= [];
        failures.push({ coinId: coin.id, resource: "hourly", classification: error.classification || "unknown", status: error.status || null });
      }
    }
    if (!continuousTail(state.fourHourly[coin.id], FOUR_HOURS, MIN_4H, 5, now)) {
      requested = true;
      try {
        state.fourHourly[coin.id] = await fetchOHLC(coin.id, fetchImpl, now, requestOptions);
      } catch (error) {
        state.fourHourly[coin.id] ||= [];
        failures.push({ coinId: coin.id, resource: "ohlc", classification: error.classification || "unknown", status: error.status || null });
      }
    }
    if (requested && index < coins.length - 1 && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const missingHistoryCount = coins.filter((coin) => !continuousTail(state.hourly[coin.id], HOUR, MIN_HOURLY, 2, now) || !continuousTail(state.fourHourly[coin.id], FOUR_HOURS, MIN_4H, 5, now)).length;
  const failedCount = new Set(failures.map((failure) => failure.coinId)).size;
  state.dataQuality = {
    source: "CoinGecko",
    status: failures.length || missingHistoryCount ? "degraded" : "normal",
    successCount: coins.length - missingHistoryCount,
    failedCount,
    requestFailureCount: failures.length,
    missingHistoryCount,
    concurrency: 1,
    failures
  };
  return state;
}
