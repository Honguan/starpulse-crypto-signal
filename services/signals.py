"""Deterministic, hypothetical Trend Pullback lifecycle; times are UTC milliseconds.

Only closed 15m candles advance state. A close-confirmed trigger enters at the
following candle open (5 bps adverse slippage). Fees are 4 bps per side. TP1
closes half; TP2 closes the rest. Ambiguous OHLC bars stop before taking profit.
"""
from copy import deepcopy
from hashlib import sha256
import math

TERMINAL = {"TP2", "STOPPED", "INVALIDATED", "EXPIRED", "CANCELLED", "NO_TRADE"}
STATES = {"SCANNING", "SETUP_FOUND", "WAITING_TRIGGER", "ENTRY_ZONE", "TRIGGERED", "ACTIVE", "TP1"} | TERMINAL
INTERVAL = 900_000
FEE_RATE = 0.0004
SLIPPAGE = 0.0005


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _event(signal, status, at, reason=None):
    signal["status"] = status
    event = {"status": status, "at": at}
    if reason:
        event["reason"] = reason
    signal["events"].append(event)


def expire(signal, as_of):
    """Expire pending setups without requiring market data; positions stay open."""
    result = deepcopy(signal)
    if result["status"] in {"SETUP_FOUND", "WAITING_TRIGGER", "ENTRY_ZONE", "TRIGGERED"} and as_of >= result["expires_at"]:
        _event(result, "EXPIRED", result["expires_at"], "Setup expired before entry")
    return result


def inputs_healthy(features_by_tf, market, derivatives, as_of):
    """Shared live/replay gate for opening hypothetical exposure."""
    if not market or market.get("available") is not True or not derivatives:
        return None
    if not _finite(market.get("as_of")) or not 0 <= as_of - market["as_of"] <= 300_000:
        return None
    if any(item.get("stale") or item.get("status") == "stale" or item.get("risk_level", item.get("risk")) == "extreme"
           or item.get("as_of", as_of) > as_of
           for item in (market or {}, derivatives or {})):
        return None
    if any(not _finite(derivatives.get(k)) for k in ("funding_rate", "open_interest", "oi_change_1h")):
        return None
    if derivatives["open_interest"] <= 0 or abs(derivatives["funding_rate"]) >= .003 or abs(derivatives["oi_change_1h"]) >= .3:
        return None
    for key in ("timestamp", "available_at", "funding_timestamp", "oi_timestamp"):
        stamp = derivatives.get(key)
        if not _finite(stamp) or not 0 <= as_of - stamp <= 300_000:
            return None
    for name, tf in (("15m", 900_000), ("1h", 3_600_000), ("4h", 14_400_000), ("1d", 86_400_000)):
        feature = features_by_tf.get(name, {})
        stamp = feature.get("close_time", feature.get("as_of"))
        if (stamp is None or stamp > as_of or as_of - stamp > tf + 120_000
                or feature.get("as_of", as_of) > as_of or feature.get("stale")
                or feature.get("valid") is not True or feature.get("available") is not True):
            return None
        structure = feature.get("structure", {})
        for item in structure.get("pivots", []) + structure.get("events", []):
            if not _finite(item.get("confirmed_at")) or item["confirmed_at"] > as_of:
                return None
    return True


def detect_setup(symbol, features_by_tf, market, derivatives, as_of):
    """Return an immutable candidate; caller deduplicates its stable id.

    Only healthy, available point-in-time inputs may create a candidate.
    Unconfirmed structure cannot create setups. NO_TRADE records the RR veto.
    """
    if not inputs_healthy(features_by_tf, market, derivatives, as_of):
        return None
    hour, higher = features_by_tf["1h"], features_by_tf["4h"]
    trigger_feature = features_by_tf["15m"]
    if higher.get("trend") not in {"bullish", "bearish"} or hour.get("trend") != higher["trend"]:
        return None
    long = higher["trend"] == "bullish"
    direction = "LONG" if long else "SHORT"
    if market.get("label") not in ({"bullish", "strong_bullish"} if long else {"bearish", "strong_bearish"}):
        return None
    atr, price = hour.get("atr"), hour.get("close", hour.get("price"))
    if not all(_finite(x) and x > 0 for x in (atr, price)):
        return None
    rsi = hour.get("rsi")
    if not _finite(rsi) or not ((40 <= rsi <= 65) if long else (35 <= rsi <= 60)):
        return None
    structure = higher.get("structure", {})
    if structure.get("trend") != higher["trend"]:
        return None
    latest = {side: [p for p in structure.get("pivots", []) if p["side"] == side and p["confirmed_at"] <= as_of] for side in ("high", "low")}
    if not all(latest.values()) or latest["high"][-1].get("label") != ("HH" if long else "LH") or latest["low"][-1].get("label") != ("HL" if long else "LL"):
        return None
    pivots = [p for p in structure.get("pivots", []) if p["side"] == ("low" if long else "high") and p["confirmed_at"] <= as_of]
    if not pivots:
        return None
    pivot = pivots[-1]
    anchor = pivot["confirmed_at"]
    if anchor is None or anchor > as_of:
        return None
    zones = hour.get("support" if long else "resistance", []) + higher.get("support" if long else "resistance", [])
    zones = [z for z in zones if _finite(z.get("low")) and _finite(z.get("high")) and 0 < z["low"] <= z["high"] and
             (z["low"] <= price if long else z["high"] >= price)]
    if not zones:
        return None
    zone = min(zones, key=lambda z: abs(price - (z["low"] + z["high"]) / 2))
    if abs(price - (zone["low"] + zone["high"]) / 2) > 2 * atr:
        return None
    entry = zone["high"] if long else zone["low"]
    boundary = pivot["price"]
    if not _finite(boundary) or boundary <= 0:
        return None
    stop = min(zone["low"], boundary) - atr * .25 if long else max(zone["high"], boundary) + atr * .25
    opposing = hour.get("resistance" if long else "support", []) + higher.get("resistance" if long else "support", [])
    targets = sorted({z["low"] if long else z["high"] for z in opposing
                      if _finite(z.get("low")) and _finite(z.get("high")) and 0 < z["low"] <= z["high"] and (z["low"] > entry if long else z["high"] < entry)}, reverse=not long)
    if len(targets) < 2 or stop <= 0:
        return None
    risk = abs(entry - stop)
    rr = abs(targets[0] - entry) / risk if risk else 0
    histogram = (hour.get("macd") or {}).get("histogram")
    components = {"market": 20, "trend": 20, "structure": 20, "derivatives": 15,
                  "volume": 10 if (trigger_feature.get("volume_ratio") or 0) >= 1 else 0,
                  "momentum": 10 if _finite(histogram) and (histogram > 0 if long else histogram < 0) else 0,
                  "risk_reward": 5 if rr >= 1.5 else 0}
    signal = {"id": sha256(f"{symbol}|{direction}|trend_pullback|{anchor}".encode()).hexdigest(),
              "symbol": symbol, "direction": direction, "setup": "trend_pullback", "strategy_version": "trend_pullback_v1", "timeframe": "15m",
              "created_at": as_of, "expires_at": as_of + 86_400_000,
              "anchor_time": anchor, "features": deepcopy(features_by_tf),
              "market": deepcopy(market), "derivatives": deepcopy(derivatives),
              "entry_zone": deepcopy(zone), "stop_loss": stop, "take_profit": targets[:2],
              "risk_reward": rr, "events": [], "fills": [], "remaining": 1.0,
              "setup_score": sum(components.values()), "score_components": components,
              "volatility_regime": "extreme" if atr / price >= .08 else "high" if atr / price >= .04 else "normal" if atr / price >= .02 else "low",
              "risk_level": market.get("risk", "unknown"),
              "trigger_volume_min": features_by_tf.get("15m", {}).get("volume_ma20"),
              "fee_rate": FEE_RATE, "slippage": SLIPPAGE, "hypothetical": True}
    _event(signal, "SCANNING", as_of)
    _event(signal, "SETUP_FOUND", as_of)
    _event(signal, "WAITING_TRIGGER" if rr >= 1.5 else "NO_TRADE", as_of,
           None if rr >= 1.5 else "TP1 risk/reward below 1.5")
    return signal


def advance(signal, candle):
    """Consume one closed candle. Optional candle as_of guards unfinished input.

    Callers must supply only closed bars; unknown future OHLC cannot be inferred
    by this pure function. Duplicate/older bars are idempotently ignored.
    """
    result = deepcopy(signal)
    if result["status"] in TERMINAL:
        return result
    if candle.get("symbol") != result["symbol"] or candle.get("timeframe") != "15m":
        return result
    opened, closed = candle["open_time"], candle["close_time"]
    if opened + INTERVAL > candle.get("as_of", opened + INTERVAL) or closed <= result.get("last_candle_time", result["created_at"]) or opened < result["created_at"]:
        return result
    if opened % INTERVAL or closed not in (opened + INTERVAL - 1, opened + INTERVAL) or not all(_finite(candle[k]) and candle[k] > 0 for k in ("open", "high", "low", "close")):
        raise ValueError("Invalid candle")
    if candle["low"] > min(candle["open"], candle["close"]) or candle["high"] < max(candle["open"], candle["close"]):
        raise ValueError("Inconsistent OHLC")
    previous = result.get("last_candle_time")
    if previous is not None and closed - previous > INTERVAL:
        _event(result, "CANCELLED", opened, "Data gap: outcomes unknown")
        result["data_uncertain"] = True
        return result
    result["last_candle_time"] = closed
    long = result["direction"] == "LONG"
    sign = 1 if long else -1
    active = result["status"] in {"ACTIVE", "TP1"}
    if not active and opened >= result["expires_at"]:
        _event(result, "EXPIRED", opened, "Setup expired before entry")
        return result
    if result["status"] == "TRIGGERED":
        if candle.get("allow_entry", candle.get("allow_trigger")) is False:
            _event(result, "CANCELLED", opened, "Current health blocks new entry")
            return result
        # No reconstruction of a missed next-open execution from a later bar.
        if opened != result["trigger_open_time"] + INTERVAL:
            _event(result, "CANCELLED", opened, "Missing next entry candle")
            return result
        entry = candle["open"] * (1 + sign * result["slippage"])
        risk = sign * (entry - result["stop_loss"])
        reward = sign * (result["take_profit"][0] - entry)
        if risk <= 0 or reward / risk < 1.5:
            _event(result, "CANCELLED", opened, "Gap/slippage violates TP1 risk/reward")
            return result
        result.update(entry_price=entry, entry_time=opened, initial_risk=risk,
                      entry_risk_reward=reward / risk,
                      realized_r=-entry * result["fee_rate"] / risk, mfe_r=0.0, mae_r=0.0)
        _event(result, "ACTIVE", opened, "Hypothetical next-open entry")
        active = True
    if active:
        entry, risk = result["entry_price"], result["initial_risk"]
        favorable = (candle["high"] - entry) if long else (entry - candle["low"])
        adverse = (entry - candle["low"]) if long else (candle["high"] - entry)
        # Bar-resolution excursions include the whole exit bar; intrabar path is unknown.
        result["mfe_r"] = max(result["mfe_r"], favorable / risk)
        result["mae_r"] = max(result["mae_r"], adverse / risk)
        stop = result["stop_loss"]
        stopped = candle["low"] <= stop if long else candle["high"] >= stop
        if stopped:
            price = min(candle["open"], stop) if long else max(candle["open"], stop)
            _fill(result, price, result["remaining"], closed, "STOPPED")
        else:
            for index, target in enumerate(result["take_profit"]):
                status = "TP1" if index == 0 else "TP2"
                if index == 0 and result["remaining"] < 1:
                    continue
                if candle["high"] >= target if long else candle["low"] <= target:
                    _fill(result, target, .5 if index == 0 else result["remaining"], closed, status)
        return result
    if closed >= result["expires_at"]:
        _event(result, "EXPIRED", closed)
        return result
    stop = result["stop_loss"]
    if candle["low"] <= stop if long else candle["high"] >= stop:
        _event(result, "INVALIDATED", closed, "Structure stop breached before entry")
        return result
    zone = result["entry_zone"]
    touched = candle["low"] <= zone["high"] and candle["high"] >= zone["low"]
    if touched:
        _event(result, "ENTRY_ZONE", closed)
    rejection = (candle["close"] > zone["high"] and candle["close"] > candle["open"]) if long else (candle["close"] < zone["low"] and candle["close"] < candle["open"])
    volume_min = result.get("trigger_volume_min")
    volume_ok = volume_min is not None and candle.get("volume", 0) >= volume_min > 0
    if (touched or result["status"] == "ENTRY_ZONE") and rejection and volume_ok and candle.get("allow_trigger") is not False:
        result["trigger_open_time"] = opened
        result["trigger_time"] = closed
        _event(result, "TRIGGERED", closed, "Closed 15m rejection")
    return result


def _fill(signal, price, fraction, at, status):
    sign = 1 if signal["direction"] == "LONG" else -1
    price *= 1 - sign * signal["slippage"]
    pnl_r = fraction * (sign * (price - signal["entry_price"]) - price * signal["fee_rate"]) / signal["initial_risk"]
    signal["fills"].append({"at": at, "price": price, "fraction": fraction, "pnl_r": pnl_r, "status": status})
    signal["remaining"] -= fraction
    signal["realized_r"] += pnl_r
    _event(signal, status, at)
    if not signal["remaining"]:
        signal["exit_time"] = at
