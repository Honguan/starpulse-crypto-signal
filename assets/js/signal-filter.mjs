export function normalizeSearch(value) {
  const query = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]+USDT$/.test(query) && query.length > 4 ? query.slice(0, -4) : query;
}

export function matchesSearch(signal, query, exact = false) {
  const normalized = normalizeSearch(query);
  return [signal.symbol, signal.coinId, signal.name, signal.liveInstrument?.symbol]
    .some((value) => exact ? String(value || "").toUpperCase() === normalized : String(value || "").toUpperCase().includes(normalized));
}

export function selectSignals(signals, settings = {}) {
  const score = (signal) => Math.max(signal.plans?.long?.score || 0, signal.plans?.short?.score || 0);
  const rank = (signal) => signal.marketCapRank || Number.MAX_SAFE_INTEGER;
  const result = signals.filter((signal) => matchesSearch(signal, settings.symbolFilter)
    && (!settings.favoriteOnly || settings.favoriteCoinIds?.has(signal.coinId))
    && (!settings.direction || signal.primaryDirection === settings.direction));
  result.sort((a, b) => {
    const difference = settings.sort === "rank" ? rank(a) - rank(b)
      : settings.sort === "change-desc" ? b.change24h - a.change24h
        : settings.sort === "change-asc" ? a.change24h - b.change24h : score(b) - score(a);
    return difference || rank(a) - rank(b) || a.coinId.localeCompare(b.coinId);
  });
  return result;
}
