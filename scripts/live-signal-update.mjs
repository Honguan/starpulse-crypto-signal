const API = "https://api.coingecko.com/api/v3";
const HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * HOUR;
const MAX_HISTORY = 24 * 30;
const MAX_CANDLES = 60;

export async function fetchMarkets(fetchImpl = fetch) {
  const headers = process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
  const response = await fetchImpl(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=7d`, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko markets failed: HTTP ${response.status}`);
  }
  return response.json();
}

export function updateHistory(state, coins, now = Date.now()) {
  const bucket = Math.floor(now / HOUR) * HOUR;
  state.history ||= {};

  coins.forEach((coin) => {
    const price = Number(coin.current_price);
    if (!coin.id || !Number.isFinite(price) || price <= 0) {
      return;
    }
    const history = state.history[coin.id] ||= [];
    if (history.at(-1)?.[0] === bucket) {
      history[history.length - 1][1] = price;
    } else {
      history.push([bucket, price]);
    }
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
  });

  return state;
}

export function updateCandles(state, coins, now = Date.now()) {
  const bucket = Math.floor(now / FOUR_HOURS) * FOUR_HOURS;
  state.candles ||= {};

  coins.forEach((coin) => {
    const price = Number(coin.current_price);
    if (!coin.id || !Number.isFinite(price) || price <= 0) return;
    const candles = state.candles[coin.id] ||= [];
    const candle = candles.at(-1);
    if (!candle || candle[0] !== bucket) {
      candles.push([bucket, price, price, price, price]);
    } else {
      candle[2] = Math.max(candle[2], price);
      candle[3] = Math.min(candle[3], price);
      candle[4] = price;
    }
    if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);
  });

  return state;
}

export async function fetchHistory(coinId, fetchImpl = fetch) {
  const headers = process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
  const response = await fetchImpl(`${API}/coins/${coinId}/market_chart?vs_currency=usd&days=30&interval=hourly`, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko history ${coinId} failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return (payload.prices || []).map(([timestamp, price]) => [Math.floor(timestamp / HOUR) * HOUR, Number(price)]);
}

export async function fetchOHLC(coinId, fetchImpl = fetch) {
  const headers = process.env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY } : {};
  const response = await fetchImpl(`${API}/coins/${coinId}/ohlc?vs_currency=usd&days=30`, { headers });
  if (!response.ok) {
    throw new Error(`CoinGecko OHLC ${coinId} failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return payload
    .map(([timestamp, open, high, low, close]) => [Math.floor(timestamp / FOUR_HOURS) * FOUR_HOURS, Number(open), Number(high), Number(low), Number(close)])
    .filter((candle) => candle.slice(1).every((value) => Number.isFinite(value)))
    .slice(-MAX_CANDLES);
}

export async function fillMissingHistory(state, coins, fetchImpl = fetch, delayMs = 700) {
  for (const [index, coin] of coins.entries()) {
    if (state.history?.[coin.id]?.length) {
      continue;
    }
    try {
      state.history ||= {};
      state.history[coin.id] = await fetchHistory(coin.id, fetchImpl);
    } catch {
      state.history ||= {};
      state.history[coin.id] = [];
    }
    if (index < coins.length - 1 && delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return state;
}

export async function fillMissingCandles(state, coins, fetchImpl = fetch, delayMs = 700) {
  for (const [index, coin] of coins.entries()) {
    if (state.candles?.[coin.id]?.length) continue;
    try {
      state.candles ||= {};
      state.candles[coin.id] = await fetchOHLC(coin.id, fetchImpl);
    } catch {
      state.candles ||= {};
      state.candles[coin.id] = [];
    }
    if (index < coins.length - 1 && delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return state;
}
