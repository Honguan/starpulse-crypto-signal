"""Public USD-M perpetual data only; run with ``python -m services.collector``."""

import logging
import math
import os
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

EXCHANGE = "binance_usdm"
BASE_URL = "https://fapi.binance.com"
DEFAULT_SYMBOLS = ("BTCUSDT", "ETHUSDT", "ENAUSDT")
SYMBOLS = {name: name for name in (*DEFAULT_SYMBOLS, "BNBUSDT", "SOLUSDT", "SUIUSDT")}
INTERVALS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}
WARMUP = 220
PAGE_SIZE = 499
LOG = logging.getLogger(__name__)


def number(value):
    if isinstance(value, bool):
        raise ValueError("boolean is not a market number")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("non-finite market number")
    return result


def timestamp(value):
    if type(value) is not int or value < 0:
        raise ValueError("timestamp must be nonnegative UTC milliseconds")
    return value


def request_json(client, path, params=None):
    """Three attempts, bounded backoff; geographic restrictions are never bypassed."""
    for attempt in range(3):
        delay = 2 ** attempt
        try:
            response = client.get(BASE_URL + path, params=params, timeout=15)
            if response.status_code == 429 or response.status_code >= 500:
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        try:
                            delay = (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds()
                        except (ValueError, TypeError):
                            pass
                response.raise_for_status()
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 429 and exc.response.status_code < 500:
                raise
            if attempt == 2:
                raise
        except httpx.RequestError:
            if attempt == 2:
                raise
        time.sleep(min(30, max(0, delay)))


def parse_candle(raw, symbol, timeframe):
    if not isinstance(raw, list) or len(raw) != 12:
        raise ValueError("expected Binance 12-field kline")
    opened, closed = timestamp(raw[0]), timestamp(raw[6])
    step = INTERVALS[timeframe]
    if opened % step or closed != opened + step - 1:
        raise ValueError("invalid UTC candle boundary")
    op, high, low, close, volume = map(number, raw[1:6])
    if min(op, high, low, close) <= 0 or volume < 0 or not low <= min(op, close) <= max(op, close) <= high:
        raise ValueError("invalid OHLC or volume")
    return dict(exchange=EXCHANGE, symbol=symbol, timeframe=timeframe,
                open_time=opened, close_time=closed, open=op, high=high,
                low=low, close=close, volume=volume)


def collect_candles(store, client, symbol, timeframe, now_ms):
    step = INTERVALS[timeframe]
    boundary = now_ms // step * step
    latest = store.latest_candle(symbol, timeframe)
    cursor = latest["open_time"] + step if latest else max(0, boundary - WARMUP * step)
    while cursor < boundary:
        raw = request_json(client, "/fapi/v1/klines", dict(
            symbol=symbol, interval=timeframe, startTime=cursor,
            endTime=boundary - 1, limit=PAGE_SIZE))
        if not isinstance(raw, list) or not raw:
            raise ValueError(f"missing candle at {cursor}")
        rows = [parse_candle(item, symbol, timeframe) for item in raw]
        rows = [row for row in rows if row["close_time"] < boundary]
        if not rows:
            raise ValueError("response contains no closed candles")
        expected = cursor
        for row in rows:
            if row["open_time"] != expected:
                raise ValueError(f"candle gap or duplicate at {expected}")
            expected += step
        # Commit each complete page: a restart resumes at the last persisted bar.
        store.save_candles(rows)
        cursor = expected
    return boundary - 1


def observed(raw, symbol, now_ms, field="time", max_age=300_000):
    if not isinstance(raw, dict) or raw.get("symbol", symbol) != symbol:
        raise ValueError("wrong market symbol")
    value = timestamp(raw[field])
    if value > now_ms + 5_000 or now_ms - value > max_age:
        raise ValueError("stale or future market observation")
    return value


def collect_derivatives(store, client, symbol, now_ms):
    started = time.monotonic()
    funding = request_json(client, "/fapi/v1/premiumIndex", {"symbol": symbol})
    oi = request_json(client, "/fapi/v1/openInterest", {"symbol": symbol})
    received = now_ms + int((time.monotonic() - started) * 1000)
    funding_time = observed(funding, symbol, received)
    oi_time = observed(oi, symbol, received)
    interest = number(oi["openInterest"])
    if interest <= 0:
        raise ValueError("open interest must be positive")
    result = dict(exchange=EXCHANGE, symbol=symbol, timestamp=min(funding_time, oi_time),
                  available_at=received,
                  funding_rate=number(funding["lastFundingRate"]), open_interest=interest,
                  funding_timestamp=funding_time, oi_timestamp=oi_time,
                  oi_change_1h=None, missing_fields=[])
    optional = (
        ("global_long_short_ratio", "globalLongShortAccountRatio", "longShortRatio"),
        ("top_account_long_short_ratio", "topLongShortAccountRatio", "longShortRatio"),
        ("top_position_long_short_ratio", "topLongShortPositionRatio", "longShortRatio"),
        ("taker_long_short_ratio", "takerlongshortRatio", "buySellRatio"),
        ("oi_change_1h", "openInterestHist", "sumOpenInterest"),
    )
    for name, endpoint, field in optional:
        key = f"derivatives:{symbol}:{name}"
        result[name] = None
        try:
            rows = request_json(client, "/futures/data/" + endpoint,
                                dict(symbol=symbol, period="1h", limit=2, endTime=received))
            if not isinstance(rows, list) or not rows:
                raise ValueError("empty statistics")
            times = [observed(row, symbol, received, "timestamp", 10_800_000) for row in rows]
            observed(rows[-1], symbol, received, "timestamp", 7_200_000)
            if times != sorted(set(times)):
                raise ValueError("unordered or duplicate statistics")
            values = [number(row[field]) for row in rows]
            if min(values) < 0:
                raise ValueError("negative statistics")
            if name == "oi_change_1h":
                if len(rows) != 2 or times[1] - times[0] != INTERVALS["1h"] or values[0] <= 0:
                    raise ValueError("OI history lacks consecutive hourly observations")
                result[name] = values[1] / values[0] - 1
            else:
                result[name] = values[-1]
            result[name + "_timestamp"] = times[-1]
            store.record_health(key, EXCHANGE, times[-1], "healthy", None)
        except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError) as exc:
            result["missing_fields"].append(name)
            store.record_health(key, EXCHANGE, None, "unavailable", str(exc))
    result["received_at"] = now_ms + int((time.monotonic() - started) * 1000)
    source_time = max(value for key, value in result.items() if key.endswith("timestamp"))
    # Delay usability for bounded source clock skew; never rewrite the receipt time.
    result["available_at"] = max(result["received_at"], source_time)
    result["clock_skew_ms"] = max(0, source_time - result["received_at"])
    result["updated_at"] = result["timestamp"]
    result["status"] = "degraded" if result["missing_fields"] else "healthy"
    store.save_derivative(result)
    return result["timestamp"]


def configured_symbols():
    symbols = tuple(dict.fromkeys(symbol.strip().upper() for symbol in
                                  os.getenv("SYMBOLS", ",".join(DEFAULT_SYMBOLS)).split(",")))
    if not symbols or any(symbol not in SYMBOLS for symbol in symbols):
        raise ValueError("SYMBOLS must use the explicit BTC/ETH/ENA/BNB/SOL/SUI USDT mapping")
    if not {"BTCUSDT", "ETHUSDT"}.issubset(symbols):
        raise ValueError("SYMBOLS must include BTCUSDT and ETHUSDT for market regime")
    return symbols


def collect_once(store, client, now_ms):
    started = time.monotonic()
    timestamp(now_ms)
    symbols = configured_symbols()
    try:
        info = request_json(client, "/fapi/v1/exchangeInfo")
        markets = {row["symbol"]: row for row in info["symbols"]}
        store.record_health("exchange_info", EXCHANGE, now_ms, "healthy", None)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        store.record_health("exchange_info", EXCHANGE, None, "unavailable", str(exc))
        return
    for symbol in symbols:
        market = markets.get(symbol, {})
        valid = (market.get("contractType") == "PERPETUAL" and
                 market.get("status") == "TRADING" and market.get("quoteAsset") == "USDT")
        jobs = [(f"candles:{symbol}:{tf}", collect_candles, (symbol, tf)) for tf in INTERVALS]
        jobs.append((f"derivatives:{symbol}", collect_derivatives, (symbol,)))
        for key, function, args in jobs:
            try:
                if not valid:
                    raise ValueError("symbol is not a trading USDT perpetual")
                observed_now = now_ms + int((time.monotonic() - started) * 1000)
                updated = function(store, client, *args, observed_now)
                store.record_health(key, EXCHANGE, updated, "healthy", None)
            except (httpx.HTTPError, ValueError, KeyError, TypeError, OverflowError) as exc:
                store.record_health(key, EXCHANGE, None, "unavailable", str(exc))


def main():
    from services.storage import Store
    from services.pipeline import run

    logging.basicConfig(level=logging.INFO)
    configured_symbols()
    store = Store()
    store.migrate()
    with httpx.Client() as client:
        while True:
            started = time.monotonic()
            try:
                collect_once(store, client, int(time.time() * 1000))
                run(store, int(time.time() * 1000))
            except Exception:
                LOG.exception("Collector cycle failed; retrying next cycle")
            time.sleep(max(0, 60 - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
