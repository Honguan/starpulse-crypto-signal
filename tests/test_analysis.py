"""Golden EMA/MACD and independently calculable Wilder/VWAP fixtures."""

import math
import unittest

from services.analysis import INTERVALS, analyze, regime


def candles(values, timeframe="1h", symbol="BTCUSDT", volume=10):
    interval = INTERVALS[timeframe]
    return [{"exchange": "binance", "symbol": symbol, "timeframe": timeframe,
             "open_time": i * interval, "close_time": (i + 1) * interval - 1,
             "open": price, "high": price + 1, "low": price - 1,
             "close": price, "volume": volume} for i, price in enumerate(values)]


class AnalysisTests(unittest.TestCase):
    def test_golden_ema_and_macd(self):
        # Existing v1 golden fixture: SMA seed, alpha=2/(period+1).
        values = [100 + i * .17 + math.sin(i * .71) * 3 + math.cos(i * .19) for i in range(80)]
        result = analyze(candles(values), 80 * INTERVALS["1h"])
        self.assertAlmostEqual(result["ema20"], 111.44449996311305)
        self.assertAlmostEqual(result["ema50"], 109.19206703056811)
        self.assertAlmostEqual(result["rsi"], 51.03, delta=.005)
        self.assertAlmostEqual(result["macd"]["line"], .6582578339983343)
        self.assertAlmostEqual(result["macd"]["signal"], 1.1208499903176286)
        self.assertAlmostEqual(result["macd"]["histogram"], -.4625921563192943)
        self.assertFalse(result["available"])
        self.assertIn("ema200", result["missing"])

    def test_wilder_and_vwap(self):
        # Constant TR=2 and gains=1; Wilder update preserves these means.
        rows = candles(list(range(100, 320)))
        result = analyze(rows, 220 * INTERVALS["1h"])
        self.assertTrue(result["available"])
        self.assertEqual(result["atr"], 2)
        self.assertEqual(result["rsi"], 100)
        self.assertEqual(result["vwap"], 309.5)
        self.assertEqual(result["ema200"], 219.5)
        self.assertEqual(result["volume_ma20"], 10)
        self.assertEqual(result["volume_ratio"], 1)
        self.assertEqual(result["trend"], "bullish")
        # After fourteen TR=2 samples, a TR=16 gives (13*2+16)/14=3.
        rows = candles([100] * 15)
        rows[-1].update(high=108, low=92)
        self.assertEqual(analyze(rows, 15 * INTERVALS["1h"])["atr"], 3)

    def test_weighted_vwap(self):
        rows = candles([100] * 19 + [120])
        rows[-1]["volume"] = 30
        result = analyze(rows, 20 * INTERVALS["1h"])
        self.assertAlmostEqual(result["vwap"], (190 * 100 + 30 * 120) / 220)
        self.assertEqual(result["volume_ma20"], 11)

    def test_zero_volume_and_warmup_are_unavailable(self):
        rows = candles([100] * 220, volume=0)
        result = analyze(rows, 220 * INTERVALS["1h"])
        self.assertIsNone(result["vwap"])
        self.assertIsNone(result["volume_ratio"])
        self.assertFalse(result["available"])
        self.assertEqual(result["trend"], "neutral")
        short = analyze(rows[:10], 220 * INTERVALS["1h"])
        self.assertIsNone(short["atr"])
        self.assertIsNone(short["rsi"])
        self.assertEqual(short["trend"], "unknown")

    def test_invalid_candles_fail_closed(self):
        rows = candles(list(range(100, 320)))
        at = 220 * INTERVALS["1h"]
        for bad in (rows[:-2] + rows[-1:], rows[::-1], rows + rows[-1:],
                    rows[:-1] + [dict(rows[-1], close=float("nan"))],
                    rows[:-1] + [dict(rows[-1], low=1000)]):
            with self.subTest(last=bad[-1]["open_time"]):
                self.assertFalse(analyze(bad, at)["valid"])
        self.assertEqual(analyze(rows, at - 1)["error"], "unclosed_candle")
        self.assertTrue(analyze(rows, at)["valid"])

    def test_pivots_only_exist_after_confirmation(self):
        rows = candles([100, 102, 110, 104, 103, 101, 105, 107])
        before = analyze(rows[:4], 4 * INTERVALS["1h"])
        after = analyze(rows[:5], 5 * INTERVALS["1h"])
        self.assertEqual(before["structure"]["pivots"], [])
        self.assertEqual(after["structure"]["pivots"][0]["price"], 111)
        self.assertEqual(after["structure"]["pivots"][0]["confirmed_at"], rows[4]["close_time"])
        full = analyze(rows, 8 * INTERVALS["1h"])
        self.assertEqual(full["structure"]["pivots"][0], after["structure"]["pivots"][0])

    def test_structure_breaks_and_change_of_character(self):
        rows = candles([100, 104, 110, 105, 103, 98, 102, 106, 115, 105, 101, 95])
        result = analyze(rows, 12 * INTERVALS["1h"])
        events = result["structure"]["events"]
        self.assertEqual([(e["type"], e["direction"]) for e in events], [("BOS", "bullish"), ("CHoCH", "bearish")])
        self.assertEqual(result["structure"]["pivots"][-1]["label"], "HH")

    def test_each_swing_break_is_reported_once(self):
        rows = candles([100, 104, 110, 105, 103, 98, 102, 106, 115, 116, 117])
        result = analyze(rows, 11 * INTERVALS["1h"])
        self.assertEqual(len(result["structure"]["events"]), 1)
        self.assertEqual(result["structure"]["events"][0]["confirmed_at"], rows[8]["close_time"])

    def test_equal_swings_do_not_invent_lower_structure(self):
        values = [100, 102, 110, 104, 103, 101, 105, 110, 104, 103]
        for side, prices in (("high", values), ("low", [220 - v for v in values])):
            with self.subTest(side=side):
                result = analyze(candles(prices), len(prices) * INTERVALS["1h"])
                pivots = [p for p in result["structure"]["pivots"] if p["side"] == side]
                self.assertEqual(len(pivots), 2)
                self.assertEqual(pivots[0]["price"], pivots[1]["price"])
                self.assertIsNone(pivots[1]["label"])

    def test_zones_include_confluence_and_prior_range(self):
        result = analyze(candles([100] * 220), 220 * INTERVALS["1h"])
        sources = {source for zone in result["support"] + result["resistance"] for source in zone["sources"]}
        self.assertTrue({"ema20", "ema50", "ema200", "vwap", "previous_20_high", "previous_20_low"} <= sources)
        self.assertTrue(any(z["strength"] >= 4 for z in result["support"]))

    def test_regime_missing_majors_and_coverage(self):
        result = regime({}, {}, 0)
        self.assertFalse(result["available"])
        self.assertIsNone(result["score"])
        self.assertEqual(result["risk"], "extreme")
        self.assertEqual(result["coverage"]["ratio"], 0)

    def test_regime_full_coverage_and_staleness(self):
        at = 220 * INTERVALS["1h"]
        features = {s: {"1h": analyze(candles(list(range(100, 320)), symbol=s), at)} for s in ("BTCUSDT", "ETHUSDT")}
        result = regime(features, {}, at)
        self.assertTrue(result["available"])
        self.assertEqual(result["risk"], "high")
        self.assertIn("funding", result["missing"])
        full = regime(features, {"BTCUSDT": {"timestamp": at, "funding_rate": 0, "oi_change_pct": 0}}, at)
        self.assertEqual(full["coverage"]["ratio"], 1)
        self.assertEqual(full["label"], "strong_bullish")
        self.assertEqual(full["risk"], "low")
        self.assertEqual(regime(features, {}, at + 3 * INTERVALS["1h"])["label"], "unavailable")

    def test_regime_boundary_grace_and_derivative_ratio(self):
        at = 220 * INTERVALS["1h"]
        features = {s: {"1h": analyze(candles(list(range(100, 320)), symbol=s), at)} for s in ("BTCUSDT", "ETHUSDT")}
        boundary = at + INTERVALS["1h"]
        self.assertTrue(regime(features, {}, boundary + 120_000)["available"])
        self.assertFalse(regime(features, {}, boundary + 120_001)["available"])
        derivatives = {"BTCUSDT": {"available_at": at, "funding_rate": 0, "oi_change_1h": .05}}
        result = regime(features, derivatives, at)
        self.assertEqual(result["oi_change_pct"], 5)
        self.assertEqual(result["risk"], "medium")
        derivatives["BTCUSDT"]["stale"] = True
        self.assertIn("funding", regime(features, derivatives, at)["missing"])

    def test_regime_rejects_snapshots_not_yet_available(self):
        at = 220 * INTERVALS["1h"]
        features = {s: {"1h": analyze(candles(list(range(100, 320)), symbol=s), at)} for s in ("BTCUSDT", "ETHUSDT")}
        derivative = {"timestamp": at, "available_at": at + 1, "funding_rate": .003, "oi_change_1h": 0}
        result = regime(features, {"BTCUSDT": derivative}, at)
        self.assertIn("funding", result["missing"])
        self.assertIsNone(result["funding_rate"])
        self.assertEqual(result["risk"], "high")
        self.assertEqual(regime(features, {"BTCUSDT": derivative}, at + 1)["risk"], "extreme")
        features["BTCUSDT"]["1h"]["as_of"] = at + 1
        unavailable = regime(features, {}, at)
        self.assertFalse(unavailable["available"])
        self.assertIn("btc_trend", unavailable["missing"])


if __name__ == "__main__":
    unittest.main()
