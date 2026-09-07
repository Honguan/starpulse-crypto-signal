"""Real database pipeline tests; lifecycle cases explicitly stub indicators only."""
from copy import deepcopy
from unittest.mock import patch
import unittest

from services.analysis import INTERVALS, analyze
from tests.test_storage import DatabaseCase

NOW = 300 * INTERVALS["1d"]
SYMBOLS = ("BTCUSDT", "ETHUSDT", "ENAUSDT")


class PipelineTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch("services.pipeline.symbols", return_value=SYMBOLS))

    def seed_candles(self):
        rows = []
        for symbol in SYMBOLS:
            for timeframe, interval in INTERVALS.items():
                for i in range(240):
                    opened = NOW - (240 - i) * interval
                    price = 100 + i * .1
                    rows.append({"exchange": "binance_usdm", "symbol": symbol, "timeframe": timeframe,
                                 "open_time": opened, "close_time": opened + interval - 1,
                                 "open": price, "high": price + 1, "low": price - 1,
                                 "close": price, "volume": 10})
        self.store.save_candles(rows)

    def seed_derivatives(self, at, available_at=None):
        self.store.record_health("exchange_info", "binance_usdm", at, "healthy")
        for symbol in SYMBOLS:
            self.store.record_health(f"derivatives:{symbol}", "binance_usdm", at, "healthy")
            for timeframe in INTERVALS:
                latest = self.store.candles(symbol, timeframe, at, limit=1)
                self.store.record_health(f"candles:{symbol}:{timeframe}", "binance_usdm", latest[-1]["close_time"] if latest else None, "healthy")
            self.store.save_derivative({"exchange": "binance_usdm", "symbol": symbol,
                                        "timestamp": at, "available_at": at if available_at is None else available_at,
                                        "funding_timestamp": at, "oi_timestamp": at,
                                        "funding_rate": .0001, "open_interest": 1000, "oi_change_1h": .01})

    def fixture_analysis(self, rows, as_of):
        """Known qualifying setup, keeping actual candle cutoffs and all other logic real."""
        if not rows:
            return analyze(rows, as_of)
        candle = rows[-1]
        self.assertLessEqual(candle["open_time"] + INTERVALS[candle["timeframe"]], as_of)
        structure = {"trend": "bullish", "pivots": [
            {"side": "high", "price": 105, "confirmed_at": NOW - 1000, "label": "HH"},
            {"side": "low", "price": 98, "confirmed_at": NOW - 1000, "label": "HL"}]}
        return {"valid": True, "available": True, "trend": "bullish", "as_of": as_of,
                "close_time": candle["close_time"], "close": 101, "price": 101, "atr": 4, "rsi": 50,
                "macd": {"histogram": 1}, "structure": structure, "volume_ma20": 10, "volume_ratio": 1.5,
                "support": [{"low": 98, "high": 100}],
                "resistance": [{"low": 110, "high": 111}, {"low": 120, "high": 121}]}

    def seed_backlog(self, second_high=111):
        rows = []
        for i, (opened_price, high, low, close) in enumerate(((100, 102, 99, 101), (100, second_high, 99, min(110, second_high)), (110, 121, 109, 120))):
            opened = NOW + i * INTERVALS["15m"]
            rows.append({"exchange": "binance_usdm", "symbol": "BTCUSDT", "timeframe": "15m",
                         "open_time": opened, "close_time": opened + INTERVALS["15m"] - 1,
                         "open": opened_price, "high": high, "low": low, "close": close, "volume": 20})
        self.store.save_candles(rows)
        # Keep the market's other symbols current at each historical checkpoint.
        for symbol in SYMBOLS[1:]:
            self.store.save_candles([dict(row, symbol=symbol) for row in rows])
        return NOW + 3 * INTERVALS["15m"]

    def test_real_indicators_write_analysis_and_missing_or_stale_inputs_block_signals(self):
        from services.pipeline import run
        cold = run(self.store, NOW)
        self.assertFalse(cold["available"])
        self.assertEqual(self.store.signals(), [])
        self.seed_candles()
        self.seed_derivatives(NOW)
        market = run(self.store, NOW)
        self.assertTrue(market["available"])
        self.assertEqual(self.store.analysis("market")["payload"]["score"], market["score"])
        for symbol in SYMBOLS:
            result = self.store.analysis(symbol)["payload"]
            self.assertEqual(result["status"], "healthy")
            self.assertTrue(all(f["available"] for f in result["features"].values()))
        # Monotonic data has no confirmed pullback and must never fabricate a setup.
        self.assertEqual(self.store.signals(), [])
        stale = run(self.store, NOW + 2 * INTERVALS["1d"])
        self.assertFalse(stale["available"])
        self.assertEqual(self.store.analysis("BTCUSDT")["payload"]["status"], "stale")
        self.assertEqual(self.store.signals(), [])

    def test_stubbed_indicators_backlog_is_chronological_restart_safe_and_idempotent(self):
        from services.pipeline import run
        from services.storage import Store
        self.seed_candles()
        self.seed_derivatives(NOW)
        with patch("services.pipeline.analyze", side_effect=self.fixture_analysis):
            run(self.store, NOW)
            initial = self.store.signals("BTCUSDT")
            self.assertEqual(len(initial), 1)
            snapshot = deepcopy(initial[0])
            self.assertEqual(snapshot["status"], "WAITING_TRIGGER")
            final_time = self.seed_backlog()
            for i in (1, 2, 3):
                self.seed_derivatives(NOW + i * INTERVALS["15m"])
            restarted = Store(self.store.dsn)
            run(restarted, final_time)
            detail = restarted.signal(snapshot["id"])
            result = detail["payload"]
            self.assertEqual(detail["snapshot"], snapshot)
            self.assertEqual(result["status"], "TP2")
            self.assertEqual([e["status"] for e in result["events"]][-4:], ["TRIGGERED", "ACTIVE", "TP1", "TP2"])
            self.assertEqual(result["entry_time"], NOW + INTERVALS["15m"])
            self.assertEqual([f["fraction"] for f in result["fills"]], [.5, .5])
            run(Store(self.store.dsn), final_time)
            self.assertEqual(restarted.signal(snapshot["id"]), detail)
            self.assertEqual(len(restarted.signals("BTCUSDT")), 1)
            with restarted.connect() as conn:
                count = conn.execute("SELECT count(*) AS n FROM signal_events WHERE signal_id=%s", (snapshot["id"],)).fetchone()["n"]
            self.assertEqual(count, len(result["events"]))

    def test_stubbed_indicators_future_available_derivatives_cannot_trigger_history(self):
        from services.pipeline import run
        self.seed_candles()
        self.seed_derivatives(NOW)
        with patch("services.pipeline.analyze", side_effect=self.fixture_analysis):
            run(self.store, NOW)
            initial = self.store.signals("BTCUSDT")[0]
            final_time = self.seed_backlog()
            # The trigger-time measurement arrived after its candle; it was not usable then.
            self.seed_derivatives(NOW + INTERVALS["15m"], available_at=final_time)
            self.seed_derivatives(final_time)
            run(self.store, final_time)
            result = self.store.signal(initial["id"])["payload"]
            self.assertNotIn("TRIGGERED", [event["status"] for event in result["events"]])
            self.assertNotIn("entry_price", result)
            self.assertEqual(self.store.signal(initial["id"])["snapshot"], initial)

    def test_stubbed_qualifying_setup_is_blocked_by_missing_derivatives_or_failed_source(self):
        from services.pipeline import run
        self.seed_candles()
        with patch("services.pipeline.analyze", side_effect=self.fixture_analysis):
            run(self.store, NOW)
            self.assertEqual(self.store.signals(), [])
            self.seed_derivatives(NOW)
            self.store.record_health("exchange_info", "binance_usdm", NOW, "degraded", "refresh failed")
            run(self.store, NOW)
            self.assertEqual(self.store.signals(), [])
            self.store.record_health("exchange_info", "binance_usdm", NOW, "healthy")
            self.store.record_health("candles:BTCUSDT:1h", "binance_usdm", NOW, "degraded", "refresh failed")
            run(self.store, NOW)
            self.assertEqual(self.store.signals("BTCUSDT"), [])
            self.assertEqual(self.store.signals("ETHUSDT"), [])
            self.assertEqual(self.store.signals("ENAUSDT"), [])
            self.assertEqual(self.store.analysis("market")["payload"]["status"], "stale")

    def test_failed_current_source_blocks_pending_exposure_but_active_position_settles(self):
        from services.pipeline import run
        from services.signals import advance
        self.seed_candles()
        self.seed_derivatives(NOW)
        with patch("services.pipeline.analyze", side_effect=self.fixture_analysis):
            run(self.store, NOW)
            initial = {symbol: self.store.signals(symbol)[0] for symbol in SYMBOLS}
            final_time = self.seed_backlog(second_high=105)
            for i in (1, 2, 3):
                self.seed_derivatives(NOW + i * INTERVALS["15m"])
            eth_bars = self.store.candles("ETHUSDT", "15m", final_time, after=NOW)
            triggered = advance(initial["ETHUSDT"], eth_bars[0])
            self.assertEqual(triggered["status"], "TRIGGERED")
            self.store.save_signal(triggered)
            ena_bars = self.store.candles("ENAUSDT", "15m", final_time, after=NOW)
            active = advance(advance(initial["ENAUSDT"], ena_bars[0]), ena_bars[1])
            self.assertEqual(active["status"], "ACTIVE")
            self.store.save_signal(active)
            self.store.record_health("derivatives:BTCUSDT", "binance_usdm", final_time, "unavailable", "upstream failed")
            run(self.store, final_time)
            waiting = self.store.signal(initial["BTCUSDT"]["id"])["payload"]
            self.assertNotIn("TRIGGERED", [event["status"] for event in waiting["events"]])
            self.assertNotIn("entry_price", waiting)
            cancelled = self.store.signal(initial["ETHUSDT"]["id"])["payload"]
            self.assertEqual(cancelled["status"], "CANCELLED")
            self.assertNotIn("entry_price", cancelled)
            settled = self.store.signal(initial["ENAUSDT"]["id"])["payload"]
            self.assertEqual(settled["status"], "TP2")
            self.assertEqual(settled["remaining"], 0)

    def test_fresh_extreme_risk_is_healthy_data_without_new_setup(self):
        from services.pipeline import run
        self.seed_candles()
        self.seed_derivatives(NOW)

        def volatile_fixture(rows, as_of):
            result = self.fixture_analysis(rows, as_of)
            result["atr"] = 10
            return result

        with patch("services.pipeline.analyze", side_effect=volatile_fixture):
            market = run(self.store, NOW)
        self.assertEqual(market["risk"], "extreme")
        self.assertEqual(market["status"], "healthy")
        for symbol in SYMBOLS:
            self.assertEqual(self.store.analysis(symbol)["payload"]["status"], "healthy")
        self.assertEqual(self.store.signals(), [])

    def test_pending_setup_expires_during_outage_without_new_candles(self):
        from services.pipeline import run
        self.seed_candles()
        self.seed_derivatives(NOW)
        with patch("services.pipeline.analyze", side_effect=self.fixture_analysis):
            run(self.store, NOW)
            initial = self.store.signals("BTCUSDT")[0]
            self.assertEqual(initial["status"], "WAITING_TRIGGER")
            run(self.store, initial["expires_at"] + 1)
        result = self.store.signal(initial["id"])
        self.assertEqual(result["payload"]["status"], "EXPIRED")
        self.assertNotIn("entry_price", result["payload"])
        self.assertEqual(result["snapshot"], initial)


if __name__ == "__main__":
    unittest.main()
