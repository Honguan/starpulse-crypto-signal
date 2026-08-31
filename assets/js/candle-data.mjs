const CANDLE_BASE_URL = "https://raw.githubusercontent.com/Honguan/starpulse-crypto-signal/live-data/data/candles";
const COIN_ID = /^[a-z0-9][a-z0-9._~-]{0,127}$/i;

export async function loadCandles(coinId, version = "", fetchImpl = fetch) {
  if (!COIN_ID.test(coinId)) throw new Error("invalid coin id");
  const response = await fetchImpl(`${CANDLE_BASE_URL}/${encodeURIComponent(coinId)}.json?t=${encodeURIComponent(version)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`candle request failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.schemaVersion !== 1 || payload.coinId !== coinId || (version && payload.updatedAt !== version)
      || !Array.isArray(payload.candles) || payload.candles.length > 60
      || !payload.candles.every((row) => Array.isArray(row) && row.length === 5 && row.every(Number.isFinite))) {
    throw new Error("invalid candle payload");
  }
  return payload.candles;
}
