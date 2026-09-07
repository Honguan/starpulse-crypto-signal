"""One closed-candle evaluation shared by the collector and operational CLI."""
import time

from services.analysis import analyze, regime
from services.signals import TERMINAL, advance, detect_setup, expire, inputs_healthy

INTERVALS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}
GRACE_MS = 120_000


def symbols():
    from services.collector import configured_symbols
    return configured_symbols()


def candle_fresh(candle, timeframe, now):
    expected = ((now - GRACE_MS) // INTERVALS[timeframe]) * INTERVALS[timeframe] - 1
    return bool(candle and expected <= candle["close_time"] <= now)


def sources_healthy(sources, symbol, now):
    """Source failures invalidate last-known data even before the next analysis."""
    required = ["exchange_info", f"derivatives:{symbol}"] + [f"candles:{symbol}:{tf}" for tf in INTERVALS]
    for key in required:
        source = sources.get(key, {})
        stamp = source.get("updated_at")
        if source.get("status") != "healthy" or stamp is None or stamp > now:
            return False
        if key.startswith("candles:"):
            if not candle_fresh({"close_time": stamp}, key.rsplit(":", 1)[1], now):
                return False
        elif now - stamp > 300_000:
            return False
    return True


def evaluate(store, as_of):
    """Read only the observations available at this decision time."""
    features, derivatives = {}, {}
    for symbol in symbols():
        features[symbol] = {}
        for timeframe in INTERVALS:
            candles = store.candles(symbol, timeframe, as_of)
            result = analyze(candles, as_of)
            result["status"] = "healthy" if result.get("available") and candle_fresh(candles[-1] if candles else None, timeframe, as_of) else "stale"
            result["stale"] = result["status"] != "healthy"
            features[symbol][timeframe] = result
        derivative = store.derivative(symbol, as_of) or {}
        timestamps = [derivative.get("funding_timestamp", 0), derivative.get("oi_timestamp", 0)]
        healthy = bool(derivative) and all(0 <= as_of - stamp <= 300_000 for stamp in timestamps)
        derivatives[symbol] = {**derivative, "status": derivative.get("status", "healthy") if healthy else "stale", "stale": not healthy}
    market = regime(features, derivatives, as_of)
    return features, derivatives, market


def run(store, now_ms=None):
    now = int(time.time() * 1000) if now_ms is None else now_ms
    # ponytail: one evaluator lock for six symbols; partition by symbol if throughput requires it.
    with store.connect() as lock:
        if not lock.execute("SELECT pg_try_advisory_xact_lock(7410202) AS acquired").fetchone()["acquired"]:
            return {"skipped": "evaluation already running"}
        features, derivatives, market = evaluate(store, now)
        sources = {row["key"]: row for row in store.health()}
        market_sources_healthy = all(sources_healthy(sources, major, now) for major in ("BTCUSDT", "ETHUSDT"))
        market["updated_at"] = now
        market["status"] = "healthy" if market_sources_healthy and market.get("available") else "stale"
        store.save_analysis("market", now, market)
        for symbol in symbols():
            fresh = sources_healthy(sources, symbol, now) and all(not f["stale"] for f in features[symbol].values()) and not derivatives[symbol]["stale"]
            healthy = fresh and bool(inputs_healthy(features[symbol], market, derivatives[symbol], now))
            status = derivatives[symbol].get("status", "healthy") if fresh else "stale"
            store.save_analysis(symbol, now, {"symbol": symbol, "features": features[symbol],
                                             "derivatives": derivatives[symbol], "status": status})
            # Recover every missing closed bar, in chronological order, after a restart.
            active = store.signals(symbol, limit=100_000, active=True)
            for signal in active:
                cursor = signal.get("last_candle_time", signal["created_at"])
                while True:
                    # Read from the oldest outstanding bar; latest-tail queries would skip outage history.
                    with store.connect() as conn:
                        candles = conn.execute("SELECT * FROM candles WHERE exchange='binance_usdm' AND symbol=%s "
                                               "AND timeframe='15m' AND close_time>%s AND close_time<=%s "
                                               "ORDER BY open_time LIMIT 1000", (symbol, cursor, now)).fetchall()
                    if not candles:
                        break
                    for candle in candles:
                        if signal["status"] in TERMINAL:
                            break
                        if signal["status"] not in {"ACTIVE", "TP1"}:
                            decision = candle["close_time"] + 1
                            historic_features, historic_derivatives, historic_market = evaluate(store, decision)
                            candle["allow_trigger"] = healthy and bool(inputs_healthy(historic_features[symbol], historic_market,
                                                                         historic_derivatives[symbol], decision))
                            if signal["status"] == "TRIGGERED":
                                entry_features, entry_derivatives, entry_market = evaluate(store, candle["open_time"])
                                candle["allow_entry"] = healthy and bool(inputs_healthy(entry_features[symbol], entry_market,
                                                                           entry_derivatives[symbol], candle["open_time"]))
                        signal = advance(signal, candle)
                    store.save_signal(signal)
                    cursor = candles[-1]["close_time"]
                    if len(candles) < 1000 or signal["status"] in TERMINAL:
                        break
                expired = expire(signal, now)
                if expired != signal:
                    store.save_signal(expired)
            if healthy and market.get("available") and market.get("risk") != "extreme":
                signal = detect_setup(symbol, features[symbol], market, derivatives[symbol], now)
                if signal and not store.signal(signal["id"]):
                    store.save_signal(signal)
        store.record_health("pipeline", "starpulse", now, "healthy")
        return market
