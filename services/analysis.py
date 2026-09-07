"""Deterministic analysis of continuous, closed exchange candles."""

import math

INTERVALS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _ema(values, period):
    result = [None] * len(values)
    if len(values) >= period:
        result[period - 1] = sum(values[:period]) / period
        for i in range(period, len(values)):
            result[i] = result[i - 1] + 2 / (period + 1) * (values[i] - result[i - 1])
    return result


def _wilder(values, period=14):
    if len(values) < period:
        return None
    value = sum(values[:period]) / period
    for item in values[period:]:
        value = (value * (period - 1) + item) / period
    return value


def _structure(candles):
    pivots, events = [], []
    latest = {"high": None, "low": None}
    broken = set()
    direction = "neutral"
    for i, candle in enumerate(candles):
        # A pivot becomes usable only when its second right candle closes.
        j = i - 2
        if j >= 2:
            for side in ("high", "low"):
                value = candles[j][side]
                neighbors = [candles[k][side] for k in (j - 2, j - 1, j + 1, j + 2)]
                confirmed = value > max(neighbors) if side == "high" else value < min(neighbors)
                if confirmed:
                    previous = latest[side]
                    label = None
                    if previous and value != previous["price"]:
                        label = ("HH" if value > previous["price"] else "LH") if side == "high" else ("HL" if value > previous["price"] else "LL")
                    pivot = {"side": side, "price": value, "open_time": candles[j]["open_time"],
                             "confirmed_at": candle["close_time"], "label": label}
                    pivots.append(pivot)
                    latest[side] = pivot
        for side, next_direction in (("high", "bullish"), ("low", "bearish")):
            pivot = latest[side]
            if not pivot or (side, pivot["open_time"]) in broken:
                continue
            crossed = candle["close"] > pivot["price"] if side == "high" else candle["close"] < pivot["price"]
            if crossed:
                events.append({"type": "CHoCH" if direction not in ("neutral", next_direction) else "BOS",
                               "direction": next_direction, "level": pivot["price"],
                               "pivot_time": pivot["open_time"], "confirmed_at": candle["close_time"]})
                direction = next_direction
                broken.add((side, pivot["open_time"]))
    return {"trend": direction, "pivots": pivots, "events": events, "last_event": events[-1] if events else None}


def _zones(candles, structure, indicators, atr):
    if atr is None:
        return [], []
    levels = [(p["price"], "swing_" + p["side"]) for p in structure["pivots"][-40:]]
    if len(candles) > 1:
        previous = candles[-21:-1]
        levels += [(max(c["high"] for c in previous), "previous_20_high"),
                   (min(c["low"] for c in previous), "previous_20_low")]
    levels += [(v, k) for k, v in indicators.items() if v is not None]
    width = max(atr * 0.25, candles[-1]["close"] * 1e-8)
    clusters = []
    for price, source in sorted(levels):
        if clusters and price - clusters[-1]["low"] <= width * 2:
            zone = clusters[-1]
            zone["high"] = price
            zone["strength"] += 1
            zone["sources"] = sorted(set(zone["sources"] + [source]))
        else:
            clusters.append({"low": price, "high": price, "strength": 1, "sources": [source]})
    price = candles[-1]["close"]
    support, resistance = [], []
    for zone in clusters:
        midpoint = (zone["low"] + zone["high"]) / 2
        zone["low"] = max(0, zone["low"] - width)
        zone["high"] += width
        (support if midpoint <= price else resistance).append(zone)
    return sorted(support, key=lambda z: z["high"], reverse=True), resistance


def analyze(candles, as_of):
    """Return explicit validity/coverage; never use an open or malformed candle."""
    result = {"valid": False, "available": False, "as_of": as_of, "error": None,
              "availability": {}, "missing": [], "trend": "unknown", "atr": None,
              "rsi": None, "macd": None, "volume_ratio": None, "support": [], "resistance": []}
    if not _finite(as_of) or not isinstance(candles, list) or not candles:
        return dict(result, error="empty_or_invalid_input")
    first = candles[0]
    if not isinstance(first, dict) or first.get("timeframe") not in INTERVALS:
        return dict(result, error="invalid_timeframe")
    interval = INTERVALS[first["timeframe"]]
    for i, c in enumerate(candles):
        if not isinstance(c, dict) or any(c.get(k) != first.get(k) or not c.get(k) for k in ("exchange", "symbol", "timeframe")):
            return dict(result, error="mixed_series")
        if any(not _finite(c.get(k)) for k in ("open_time", "close_time", "open", "high", "low", "close", "volume")):
            return dict(result, error="nonfinite_candle")
        if c["open_time"] % interval or c["close_time"] not in (c["open_time"] + interval - 1, c["open_time"] + interval):
            return dict(result, error="invalid_timestamp")
        if c["open_time"] + interval > as_of:
            return dict(result, error="unclosed_candle")
        if i and c["open_time"] - candles[i - 1]["open_time"] != interval:
            return dict(result, error="unordered_or_gapped_candles")
        if c["low"] <= 0 or c["volume"] < 0 or not (c["low"] <= min(c["open"], c["close"]) <= max(c["open"], c["close"]) <= c["high"]):
            return dict(result, error="invalid_ohlcv")
    closes = [c["close"] for c in candles]
    averages = {f"ema{n}": _ema(closes, n)[-1] for n in (20, 50, 200)}
    changes = [b - a for a, b in zip(closes, closes[1:])]
    gains, losses = _wilder([max(x, 0) for x in changes]), _wilder([max(-x, 0) for x in changes])
    # Preserve v1's zero-loss convention, including a flat series: RSI=100.
    rsi = None if gains is None else (100 - 100 / (1 + gains / losses) if losses else 100)
    # ATR uses the first candle high-low, then true ranges against prior closes.
    ranges = [max(c["high"] - c["low"], abs(c["high"] - closes[i - 1]), abs(c["low"] - closes[i - 1]))
              if i else c["high"] - c["low"] for i, c in enumerate(candles)]
    atr = _wilder(ranges)
    macd = None
    if len(closes) >= 34:
        fast, slow = _ema(closes, 12), _ema(closes, 26)
        line = [fast[i] - slow[i] for i in range(25, len(closes))]
        signal = _ema(line, 9)[-1]
        macd = {"line": line[-1], "signal": signal, "histogram": line[-1] - signal}
    recent = candles[-20:]
    volume = sum(c["volume"] for c in recent)
    volume_ma = volume / 20 if len(candles) >= 20 else None
    vwap = sum((c["high"] + c["low"] + c["close"]) / 3 * c["volume"] for c in recent) / volume if len(candles) >= 20 and volume > 0 else None
    trend = "unknown"
    if averages["ema200"] is not None:
        e20, e50, e200 = (averages[f"ema{n}"] for n in (20, 50, 200))
        trend = "bullish" if closes[-1] > e20 > e50 > e200 else "bearish" if closes[-1] < e20 < e50 < e200 else "neutral"
    structure = _structure(candles)
    support, resistance = _zones(candles, structure, dict(averages, vwap=vwap), atr)
    result.update(valid=True, symbol=first["symbol"], exchange=first["exchange"], timeframe=first["timeframe"],
                  close_time=candles[-1]["close_time"], open_time=candles[-1]["open_time"],
                  price=closes[-1], close=closes[-1], candles=len(candles), **averages,
                  rsi=rsi, atr=atr, macd=macd, vwap=vwap, volume_ma20=volume_ma,
                  volume_ratio=candles[-1]["volume"] / volume_ma if volume_ma else None,
                  trend=trend, structure=structure, support=support, resistance=resistance)
    result["availability"] = {k: result[k] is not None for k in (*averages, "rsi", "atr", "macd", "vwap", "volume_ma20", "volume_ratio")}
    result["availability"].update(trend=trend != "unknown", structure=len(candles) >= 5)
    result["missing"] = [k for k, available in result["availability"].items() if not available]
    result["available"] = not result["missing"]
    return result


def regime(features_by_symbol, derivatives, as_of):
    """Directional composite; coverage and missing derivatives remain explicit."""
    trends = {}
    usable = {}
    for symbol, frames in features_by_symbol.items():
        usable[symbol] = {}
        trends[symbol] = {}
        for timeframe in INTERVALS:
            f = frames.get(timeframe, {})
            close_time = f.get("close_time")
            interval = INTERVALS[timeframe]
            boundary = as_of // interval * interval
            end = math.ceil(close_time / interval) * interval if _finite(close_time) else None
            feature_as_of = f.get("as_of", as_of)
            fresh = end is not None and end <= as_of and _finite(feature_as_of) and feature_as_of <= as_of and (end == boundary or (as_of - boundary <= 120_000 and end == boundary - interval)) and not f.get("stale")
            if f.get("valid") and fresh:
                usable[symbol][timeframe] = f
            trends[symbol][timeframe] = f.get("trend", "unknown") if f.get("valid") and fresh else "unknown"
    majors = {base: next((s for s in usable if s.upper().replace("/", "").replace("-", "") in (base, base + "USDT", base + "USD")), None) for base in ("BTC", "ETH")}
    components, missing = {}, []
    direction = {"bullish": 1, "bearish": -1, "neutral": 0}
    for base, symbol in majors.items():
        samples = [direction[t] for t in trends.get(symbol, {}).values() if t in direction]
        if samples:
            components[base.lower() + "_trend"] = sum(samples) / len(samples)
        else:
            missing.append(base.lower() + "_trend")
    rows = [f for frames in usable.values() for f in frames.values()]
    breadth = [direction[f["trend"]] for f in rows if f.get("trend") in direction]
    if breadth:
        components["breadth"] = sum(breadth) / len(breadth)
    else:
        missing.append("breadth")
    momentum = []
    volatility = []
    for f in rows:
        if _finite(f.get("rsi")) and f.get("macd") and _finite(f["macd"].get("histogram")):
            hist = f["macd"]["histogram"]
            momentum.append(max(-1, min(1, (f["rsi"] - 50) / 50)) * .5 + (.5 if hist > 0 else -.5 if hist < 0 else 0))
        if _finite(f.get("atr")) and _finite(f.get("price")) and f["price"] > 0:
            volatility.append(f["atr"] / f["price"])
    if momentum:
        components["momentum"] = sum(momentum) / len(momentum)
    else:
        missing.append("momentum")
    if not volatility:
        missing.append("volatility")
    funding, oi = [], []
    for d in derivatives.values():
        timestamp = d.get("timestamp", d.get("updated_at", d.get("available_at", d.get("as_of"))))
        available_at = d.get("available_at", timestamp)
        if not _finite(available_at) or available_at > as_of:
            continue
        if d.get("stale") or d.get("status") in ("stale", "error", "unavailable") or not _finite(timestamp) or not 0 <= as_of - timestamp <= 3_600_000:
            continue
        rate = d.get("funding_rate")
        change = d.get("oi_change_pct")
        if change is None and _finite(d.get("oi_change_1h")):
            change = d["oi_change_1h"] * 100
        if _finite(rate):
            funding.append(rate)
        if _finite(change):
            oi.append(change)
    if funding:
        components["funding"] = max(-1, min(1, -sum(funding) / len(funding) / .001))
    else:
        missing.append("funding")
    if not oi:
        missing.append("open_interest")
    required_missing = any(key in missing for key in ("btc_trend", "eth_trend"))
    weights = {"btc_trend": 25, "eth_trend": 20, "breadth": 25, "momentum": 20, "funding": 10}
    total = sum(weights[k] for k in components)
    score = round(50 + 50 * sum(components[k] * weights[k] for k in components) / total, 2) if total and not required_missing else None
    label = "unavailable" if score is None else "strong_bullish" if score >= 76 else "bullish" if score > 55 else "neutral" if score >= 45 else "bearish" if score >= 25 else "strong_bearish"
    vol = max(volatility, default=None)
    pressure = max((abs(r) for r in funding), default=0)
    oi_move = max((abs(x) for x in oi), default=0)
    risk = "extreme" if required_missing or (vol is not None and vol >= .08) or pressure >= .003 or oi_move >= 30 else "high" if missing or (vol is not None and vol >= .04) or pressure >= .001 or oi_move >= 15 else "medium" if vol >= .02 or pressure >= .0005 or oi_move >= 5 else "low"
    return {"available": not required_missing, "as_of": as_of, "score": score, "label": label, "regime": label, "risk": risk,
            "components": components, "timeframe_trends": trends, "missing": missing,
            "coverage": {"available": 7 - len(missing), "total": 7, "ratio": (7 - len(missing)) / 7},
            "volatility": vol, "funding_rate": sum(funding) / len(funding) if funding else None,
            "oi_change_pct": sum(oi) / len(oi) if oi else None}
