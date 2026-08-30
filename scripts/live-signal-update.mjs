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

export async function fetchMarkets(fetchImpl = fetch) {
  const response = await fetchImpl(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=7d`, { headers: headers() });
  if (!response.ok) throw new Error(`CoinGecko markets failed: HTTP ${response.status}`);
  return response.json();
}

export async function fetchHistory(coinId, fetchImpl = fetch, now = Date.now()) {
  const response = await fetchImpl(`${API}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=30&interval=hourly`, { headers: headers() });
  if (!response.ok) throw new Error(`CoinGecko history ${coinId} failed: HTTP ${response.status}`);
  const payload = await response.json();
  return normalized(payload.prices, HOUR, 2, now, MAX_HISTORY);
}

export async function fetchOHLC(coinId, fetchImpl = fetch, now = Date.now()) {
  const response = await fetchImpl(`${API}/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=30`, { headers: headers() });
  if (!response.ok) throw new Error(`CoinGecko OHLC ${coinId} failed: HTTP ${response.status}`);
  return normalized(await response.json(), FOUR_HOURS, 5, now, MAX_CANDLES);
}

export async function refreshTimeSeries(state, coins, now = Date.now(), fetchImpl = fetch, delayMs = 4000) {
  state.version = 2;
  state.hourly ||= {};
  state.fourHourly ||= {};

  for (const [index, coin] of coins.entries()) {
    if (!coin.id) continue;
    let requested = false;
    if (!continuousTail(state.hourly[coin.id], HOUR, MIN_HOURLY, 2, now)) {
      requested = true;
      try {
        state.hourly[coin.id] = await fetchHistory(coin.id, fetchImpl, now);
      } catch {
        state.hourly[coin.id] ||= [];
      }
    }
    if (!continuousTail(state.fourHourly[coin.id], FOUR_HOURS, MIN_4H, 5, now)) {
      requested = true;
      try {
        state.fourHourly[coin.id] = await fetchOHLC(coin.id, fetchImpl, now);
      } catch {
        state.fourHourly[coin.id] ||= [];
      }
    }
    if (requested && index < coins.length - 1 && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return state;
}
