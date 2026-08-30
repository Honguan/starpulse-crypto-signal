const USDT_PAIRS = new Map([
  ["bitcoin", "BTCUSDT"],
  ["ethereum", "ETHUSDT"],
  ["binancecoin", "BNBUSDT"],
  ["solana", "SOLUSDT"],
  ["ripple", "XRPUSDT"],
  ["dogecoin", "DOGEUSDT"],
  ["cardano", "ADAUSDT"],
  ["tron", "TRXUSDT"],
  ["chainlink", "LINKUSDT"],
  ["avalanche-2", "AVAXUSDT"],
  ["polkadot", "DOTUSDT"],
  ["litecoin", "LTCUSDT"],
  ["bitcoin-cash", "BCHUSDT"]
]);

export function verifiedInstruments(coins, exchangeSymbols) {
  const active = new Map(exchangeSymbols
    .filter((item) => item.status === "TRADING" && item.isSpotTradingAllowed && item.quoteAsset === "USDT")
    .map((item) => [item.symbol, item]));

  return new Map(coins.flatMap((coin) => {
    const symbol = USDT_PAIRS.get(coin.id);
    const instrument = active.get(symbol);
    return instrument && instrument.baseAsset === symbol.slice(0, -4)
      ? [[coin.id, { source: "Binance Spot", symbol, baseAsset: instrument.baseAsset, quoteAsset: "USDT" }]]
      : [];
  }));
}

export async function fetchVerifiedInstruments(coins, fetchImpl = fetch) {
  try {
    const response = await fetchImpl("https://api.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false");
    if (!response.ok) return new Map();
    return verifiedInstruments(coins, (await response.json()).symbols || []);
  } catch {
    return new Map();
  }
}
