import unittest
from unittest.mock import patch

import httpx

from services import collector as c


def kline(opened, step=900_000):
    return [opened, "10", "12", "8", "11", "5", opened + step - 1, "0", 2, "0", "0", "0"]


class MemoryStore:
    def __init__(self):
        self.rows, self.health, self.derivatives = [], {}, []

    def latest_candle(self, symbol, timeframe):
        rows = [r for r in self.rows if r["symbol"] == symbol and r["timeframe"] == timeframe]
        return max(rows, key=lambda r: r["open_time"]) if rows else None

    def save_candles(self, rows):
        self.rows.extend(rows)

    def record_health(self, key, source, updated_at, status, error):
        self.health[key] = dict(status=status, updated_at=updated_at, error=error)

    def save_derivative(self, row):
        self.derivatives.append(row)


class CollectorTests(unittest.TestCase):
    def client(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return client

    def test_retry_rate_limit_then_success_is_bounded(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(429, headers={"Retry-After": "9999"}) if len(calls) < 3 else httpx.Response(200, json={"ok": True})

        with patch.object(c.time, "sleep") as sleep:
            self.assertEqual(c.request_json(self.client(handler), "/test"), {"ok": True})
        self.assertEqual(len(calls), 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [30, 30])

    def test_451_is_not_retried(self):
        with patch.object(c.time, "sleep") as sleep:
            with self.assertRaises(httpx.HTTPStatusError):
                c.request_json(self.client(lambda _: httpx.Response(451)), "/test")
            sleep.assert_not_called()

    def test_timeout_and_server_failure_stop_after_three(self):
        for timeout in (True, False):
            calls = []

            def handler(request):
                calls.append(request)
                if timeout:
                    raise httpx.ReadTimeout("timeout", request=request)
                return httpx.Response(503)

            with self.subTest(timeout=timeout), patch.object(c.time, "sleep"):
                with self.assertRaises(httpx.HTTPError):
                    c.request_json(self.client(handler), "/test")
            self.assertEqual(len(calls), 3)

    def test_pagination_closed_only_and_restart_watermark(self):
        store, starts = MemoryStore(), []
        step = c.INTERVALS["15m"]
        now = 300 * step + 200

        def handler(request):
            self.assertEqual(request.url.host, "fapi.binance.com")
            self.assertEqual(request.url.path, "/fapi/v1/klines")
            start = int(request.url.params["startTime"])
            starts.append(start)
            self.assertEqual(int(request.url.params["endTime"]), 300 * step - 1)
            rows = [kline(t) for t in range(start, min(start + 100 * step, 300 * step), step)]
            if rows[-1][0] == 299 * step:
                rows.append(kline(300 * step))
            return httpx.Response(200, json=rows)

        client = self.client(handler)
        self.assertEqual(c.collect_candles(store, client, "BTCUSDT", "15m", now), 300 * step - 1)
        self.assertEqual(len(store.rows), 220)
        self.assertEqual(starts, [80 * step, 180 * step, 280 * step])
        c.collect_candles(store, client, "BTCUSDT", "15m", now)
        self.assertEqual(len(starts), 3)

    def test_gap_does_not_advance_watermark(self):
        store = MemoryStore()
        step = c.INTERVALS["15m"]
        client = self.client(lambda _: httpx.Response(200, json=[kline(0), kline(2 * step)]))
        with self.assertRaisesRegex(ValueError, "gap"):
            c.collect_candles(store, client, "BTCUSDT", "15m", 3 * step)
        self.assertFalse(store.rows)

    def test_restart_after_mid_backfill_failure(self):
        store = MemoryStore()
        step = c.INTERVALS["15m"]
        starts = []

        def handler(request):
            start = int(request.url.params["startTime"])
            starts.append(start)
            return httpx.Response(200, json=[kline(0)]) if start == 0 else httpx.Response(200, json=[])

        with self.assertRaises(ValueError):
            c.collect_candles(store, self.client(handler), "BTCUSDT", "15m", 2 * step)
        self.assertEqual(len(store.rows), 1)
        c.collect_candles(store, self.client(lambda _: httpx.Response(200, json=[kline(step)])), "BTCUSDT", "15m", 2 * step)
        self.assertEqual([row["open_time"] for row in store.rows], [0, step])

    def test_malformed_candle_boundaries_prices_and_volume(self):
        for index, bad in ((0, 1), (0, True), (6, 900_000), (1, "NaN"), (2, "9"), (3, "13"), (4, "-1"), (5, "-1")):
            raw = kline(0)
            raw[index] = bad
            with self.subTest(index=index, bad=bad), self.assertRaises(ValueError):
                c.parse_candle(raw, "BTCUSDT", "15m")

    def derivative_handler(self, now, optional_failure=False, stale=False):
        def handler(request):
            if request.url.path.endswith("premiumIndex"):
                return httpx.Response(200, json={"symbol": "BTCUSDT", "time": now - (999_999 if stale else 0), "lastFundingRate": "0.0001"})
            if request.url.path.endswith("openInterest"):
                return httpx.Response(200, json={"symbol": "BTCUSDT", "time": now, "openInterest": "123"})
            if optional_failure:
                return httpx.Response(400)
            if request.url.path.endswith("openInterestHist"):
                return httpx.Response(200, json=[
                    {"symbol": "BTCUSDT", "timestamp": now - 3_600_000, "sumOpenInterest": "100"},
                    {"symbol": "BTCUSDT", "timestamp": now, "sumOpenInterest": "110"}])
            return httpx.Response(200, json=[{"symbol": "BTCUSDT", "timestamp": now, "longShortRatio": "1.2", "buySellRatio": "1.3"}])
        return handler

    def test_derivatives_use_history_units_and_observation_times(self):
        store, now = MemoryStore(), 1_800_000_000_000
        with patch.object(c.time, "monotonic", return_value=1):
            c.collect_derivatives(store, self.client(self.derivative_handler(now)), "BTCUSDT", now)
        result = store.derivatives[0]
        self.assertAlmostEqual(result["oi_change_1h"], 0.1)
        self.assertEqual(result["open_interest"], 123)
        self.assertEqual(result["available_at"], now)
        self.assertEqual(result["status"], "healthy")

    def test_network_delay_is_included_in_receive_time(self):
        store, now = MemoryStore(), 1_800_000_000_000
        with patch.object(c.time, "monotonic", side_effect=[0, 20, 25]):
            c.collect_derivatives(store, self.client(self.derivative_handler(now + 20_000)), "BTCUSDT", now)
        self.assertEqual(store.derivatives[0]["available_at"], now + 25_000)
        self.assertEqual(store.derivatives[0]["timestamp"], now + 20_000)

    def test_optional_failure_is_explicit_missing_and_degraded(self):
        store, now = MemoryStore(), 1_800_000_000_000
        c.collect_derivatives(store, self.client(self.derivative_handler(now, optional_failure=True)), "BTCUSDT", now)
        self.assertEqual(len(store.derivatives[0]["missing_fields"]), 5)
        self.assertEqual(store.derivatives[0]["status"], "degraded")
        self.assertIsNone(store.derivatives[0]["oi_change_1h"])

    def test_stale_funding_fails_closed(self):
        store, now = MemoryStore(), 1_800_000_000_000
        with self.assertRaisesRegex(ValueError, "stale"):
            c.collect_derivatives(store, self.client(self.derivative_handler(now, stale=True)), "BTCUSDT", now)
        self.assertFalse(store.derivatives)

    def test_future_source_time_beyond_clock_tolerance_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "future"):
            c.observed({"symbol": "BTCUSDT", "time": 6001}, "BTCUSDT", 1000)

    def test_clock_skew_delays_availability_without_rewriting_receipt(self):
        store, now = MemoryStore(), 1_800_000_000_000
        with patch.object(c.time, "monotonic", return_value=1):
            c.collect_derivatives(store, self.client(self.derivative_handler(now + 1_200)), "BTCUSDT", now)
        result = store.derivatives[0]
        self.assertEqual(result["received_at"], now)
        self.assertEqual(result["available_at"], now + 1_200)
        self.assertEqual(result["clock_skew_ms"], 1_200)
        self.assertTrue(all(result["available_at"] >= value for key, value in result.items() if key.endswith("timestamp")))
        self.assertGreater(result["available_at"], now + 1_199)
        self.assertEqual(result["status"], "healthy")

    def test_optional_source_clock_can_delay_entire_snapshot(self):
        store, now = MemoryStore(), 1_800_000_000_000
        base = self.derivative_handler(now)

        def handler(request):
            if request.url.path.endswith("globalLongShortAccountRatio"):
                return httpx.Response(200, json=[{"symbol": "BTCUSDT", "timestamp": now + 4_000, "longShortRatio": "1.2"}])
            return base(request)

        with patch.object(c.time, "monotonic", return_value=1):
            c.collect_derivatives(store, self.client(handler), "BTCUSDT", now)
        result = store.derivatives[0]
        self.assertEqual(result["timestamp"], now)
        self.assertEqual(result["received_at"], now)
        self.assertEqual(result["available_at"], now + 4_000)
        self.assertEqual(result["clock_skew_ms"], 4_000)

    def test_hourly_baseline_age_does_not_hide_fresh_latest_ratio(self):
        now = 1_800_000_000_000
        base = self.derivative_handler(now)
        for latest_age, missing in ((6_000_000, False), (7_200_001, True)):
            store = MemoryStore()

            def handler(request):
                if request.url.path.endswith("takerlongshortRatio"):
                    return httpx.Response(200, json=[
                        {"timestamp": now - 9_600_000, "buySellRatio": "1.1"},
                        {"timestamp": now - latest_age, "buySellRatio": "1.2"}])
                return base(request)

            with self.subTest(latest_age=latest_age), patch.object(c.time, "monotonic", return_value=1):
                c.collect_derivatives(store, self.client(handler), "BTCUSDT", now)
            row = store.derivatives[0]
            self.assertEqual("taker_long_short_ratio" in row["missing_fields"], missing)
            self.assertEqual(row["taker_long_short_ratio"], None if missing else 1.2)

    def test_invalid_symbol_does_not_stop_other_symbols(self):
        store = MemoryStore()
        info = {"symbols": [{"symbol": symbol, "status": "TRADING", "contractType": "PERPETUAL", "quoteAsset": "USDT"} for symbol in ("ETHUSDT", "ENAUSDT")]}
        with patch.dict("os.environ", {"SYMBOLS": "BTCUSDT,ETHUSDT,ENAUSDT"}), patch.object(c, "collect_candles", return_value=123) as candles, patch.object(c, "collect_derivatives", return_value=123) as derivatives:
            c.collect_once(store, self.client(lambda _: httpx.Response(200, json=info)), 123)
        self.assertEqual(candles.call_count, 8)
        self.assertEqual(derivatives.call_count, 2)
        self.assertEqual(store.health["derivatives:BTCUSDT"]["status"], "unavailable")

    def test_default_and_explicit_symbol_mapping(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(c.configured_symbols(), ("BTCUSDT", "ETHUSDT", "ENAUSDT"))
        with patch.dict("os.environ", {"SYMBOLS": " btcusdt , ethusdt ,SOLUSDT,BNBUSDT,SUIUSDT,BTCUSDT "}):
            self.assertEqual(c.configured_symbols(), ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "SUIUSDT"))
        with patch.dict("os.environ", {"SYMBOLS": "SOLUSDT"}), self.assertRaisesRegex(ValueError, "include"):
            c.configured_symbols()
        with patch.dict("os.environ", {"SYMBOLS": "BTCUSD"}), self.assertRaises(ValueError):
            c.configured_symbols()


if __name__ == "__main__":
    unittest.main()
