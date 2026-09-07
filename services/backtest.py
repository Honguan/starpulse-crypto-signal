"""Closed-candle historical replay using the live hypothetical state machine.

Metrics use equal initial risk per trade, realized fees/slippage from signals,
and chronological closed-trade cumulative R (not compounded account equity).
MFE/MAE are whole-bar estimates, including exit bars. Open trades are excluded.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from .signals import advance, detect_setup, inputs_healthy, _finite

INTERVALS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


def replay(candles, feature_provider, market_provider=None, derivatives_provider=None):
    """Providers receive (closed_history, as_of); never the future input array.

    The feature provider returns {timeframe: features} for the latest bar's
    symbol. Market and derivative providers default to unavailable/empty data.
    Only closed 15m boundaries create and advance candidates; equal-time bars
    from all symbols/timeframes are made available together. Input is sorted;
    Binance's inclusive close_time becomes actionable at close_time + 1 ms.
    """
    batches = defaultdict(list)
    seen = {}
    for candle in candles:
        if not isinstance(candle, dict) or candle.get("timeframe") not in INTERVALS:
            raise ValueError("Invalid candle timeframe")
        if any(not _finite(candle.get(k)) for k in ("open_time", "close_time", "open", "high", "low", "close", "volume")):
            raise ValueError("Nonfinite candle")
        interval = INTERVALS[candle["timeframe"]]
        if candle["open_time"] % interval or candle["close_time"] not in (candle["open_time"] + interval - 1, candle["open_time"] + interval):
            raise ValueError("Invalid candle interval")
        if not candle.get("exchange") or not candle.get("symbol"):
            raise ValueError("Missing candle identity")
        if not (0 < candle["low"] <= min(candle["open"], candle["close"]) <= max(candle["open"], candle["close"]) <= candle["high"]) or candle["volume"] < 0:
            raise ValueError("Invalid candle OHLCV")
        key = (candle["exchange"], candle["symbol"], candle["timeframe"], candle["open_time"])
        if candle["close_time"] < candle["open_time"]:
            raise ValueError("Candle closes before open")
        if key in seen:
            if seen[key] != candle:
                raise ValueError("Conflicting duplicate candle")
            continue
        seen[key] = candle
        batches[candle["close_time"]].append(deepcopy(candle))
    history, signals = [], {}
    for closed_at in sorted(batches):
        as_of = closed_at + 1
        batch = sorted(batches[closed_at], key=lambda c: (c["symbol"], c["timeframe"]))
        history.extend(batch)
        for candle in batch:
            if candle["timeframe"] != "15m":
                continue
            symbol_history = [c for c in history if c["symbol"] == candle["symbol"]]
            features = feature_provider(deepcopy(symbol_history), as_of)
            market = market_provider(deepcopy(history), as_of) if market_provider else {}
            derivatives = derivatives_provider(deepcopy(symbol_history), as_of) if derivatives_provider else {}
            current = dict(candle, allow_trigger=bool(inputs_healthy(features, market, derivatives, as_of)))
            if any(s["symbol"] == candle["symbol"] and s["status"] == "TRIGGERED" for s in signals.values()):
                # Entry health must be known at the OPEN, not the future close.
                opened = candle["open_time"]
                before = [c for c in history if c["close_time"] + 1 <= opened]
                symbol_before = [c for c in before if c["symbol"] == candle["symbol"]]
                entry_features = feature_provider(deepcopy(symbol_before), opened)
                entry_market = market_provider(deepcopy(before), opened) if market_provider else {}
                entry_derivatives = derivatives_provider(deepcopy(symbol_before), opened) if derivatives_provider else {}
                current["allow_entry"] = bool(inputs_healthy(entry_features, entry_market, entry_derivatives, opened))
            for key, signal in list(signals.items()):
                if signal["symbol"] == candle["symbol"]:
                    signals[key] = advance(signal, current)
            signal = detect_setup(candle["symbol"], features, market, derivatives, as_of)
            if signal is not None:
                signals.setdefault(signal["id"], signal)
    snapshots = list(signals.values())
    return {"signals": snapshots, "summary": summary(snapshots)}


def _metrics(signals):
    closed = sorted((s for s in signals if "exit_time" in s), key=lambda s: (s["exit_time"], s["id"]))
    values = [s["realized_r"] for s in closed]
    gains, losses = sum(max(v, 0) for v in values), -sum(min(v, 0) for v in values)
    equity = peak = drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    count = len(closed)
    triggered = sum(any(e["status"] == "TRIGGERED" for e in s["events"]) for s in signals)
    return {"count": len(signals), "triggered": triggered,
            "trigger_rate": triggered / len(signals) if signals else 0,
            "closed": count, "wins": sum(v > 0 for v in values), "losses": sum(v < 0 for v in values),
            "win_rate": sum(v > 0 for v in values) / count if count else None,
            "loss_rate": sum(v < 0 for v in values) / count if count else None,
            "profit_factor": gains / losses if losses else None,
            "expectancy_r": sum(values) / count if count else None,
            "average_rr": sum(s.get("entry_risk_reward", s["risk_reward"]) for s in closed) / count if count else None,
            "max_drawdown_r": drawdown,
            "mfe_r": sum(s["mfe_r"] for s in closed) / count if count else None,
            "mae_r": sum(s["mae_r"] for s in closed) / count if count else None,
            "holding_time_ms": sum(s["exit_time"] - s["entry_time"] for s in closed) / count if count else None}


def summary(signals):
    result = _metrics(signals)
    result["groups"] = {}
    for field in ("symbol", "setup", "direction", "market_regime", "volatility_regime", "timeframe", "month"):
        groups = defaultdict(list)
        for signal in signals:
            if field == "market_regime":
                key = (signal.get("market") or {}).get("label", "unknown")
            elif field == "month":
                key = datetime.fromtimestamp(signal["created_at"] / 1000, timezone.utc).strftime("%Y-%m")
            else:
                key = signal.get(field, "unknown")
            groups[key].append(signal)
        result["groups"][field] = {key: _metrics(group) for key, group in groups.items()}
    return result
