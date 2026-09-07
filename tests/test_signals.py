import copy
import unittest
from services.signals import advance, detect_setup, expire

T = 90_000_000


def features(short=False):
    trend = "bearish" if short else "bullish"
    hour = {"trend": trend, "close_time": T, "as_of": T, "close": 101 if not short else 99,
            "atr": 4, "rsi": 50,
            "structure": {"pivots": [{"side": "high" if short else "low", "price": 102 if short else 98, "confirmed_at": T - 1000}]},
            "support": [{"low": 98, "high": 100}] if not short else [{"low": 89, "high": 90}, {"low": 79, "high": 80}],
            "resistance": [{"low": 110, "high": 111}, {"low": 120, "high": 121}] if not short else [{"low": 100, "high": 102}]}
    structure = {"trend": trend, "pivots": [
        {"side": "high", "price": 102 if short else 105, "confirmed_at": T - 1000, "label": "LH" if short else "HH"},
        {"side": "low", "price": 95 if short else 98, "confirmed_at": T - 1000, "label": "LL" if short else "HL"}]}
    result = {"1h": hour, "4h": {"trend": trend, "close_time": T, "structure": structure},
              "15m": {"close_time": T, "volume_ma20": 10, "volume_ratio": 1.5}, "1d": {"close_time": T}}
    for value in result.values():
        value.update(valid=True, available=True)
    return result


def market(short=False):
    return {"available": True, "risk": "low", "label": "bearish" if short else "bullish", "as_of": T}


def derivatives():
    return {"funding_rate": .0001, "open_interest": 1000, "oi_change_1h": .01,
            "timestamp": T, "available_at": T, "funding_timestamp": T, "oi_timestamp": T}


def bar(index, o=100, h=102, l=99, c=101, volume=20):
    return {"exchange": "binance", "symbol": "BTCUSDT", "timeframe": "15m", "open_time": T + index * 900_000,
            "close_time": T + (index + 1) * 900_000 - 1, "open": o, "high": h, "low": l, "close": c, "volume": volume}


class SignalsTest(unittest.TestCase):
    def setup_signal(self, short=False):
        return detect_setup("BTCUSDT", features(short), market(short), derivatives(), T)

    def test_expire_without_candles_preserves_positions_and_input(self):
        setup = self.setup_signal()
        for status in ("SETUP_FOUND", "WAITING_TRIGGER", "ENTRY_ZONE", "TRIGGERED"):
            with self.subTest(status=status):
                pending = dict(setup, status=status)
                original = copy.deepcopy(pending)
                self.assertEqual(expire(pending, pending["expires_at"] - 1), pending)
                expired = expire(pending, pending["expires_at"])
                self.assertEqual(expired["status"], "EXPIRED")
                self.assertEqual(expired["events"][-1]["at"], pending["expires_at"])
                self.assertEqual(expire(expired, pending["expires_at"] + 1), expired)
                self.assertEqual(pending, original)
        for status in ("ACTIVE", "TP1", "STOPPED", "CANCELLED"):
            with self.subTest(status=status):
                signal = dict(setup, status=status)
                self.assertEqual(expire(signal, signal["expires_at"] + 1), signal)

    def test_deterministic_snapshot_and_future_stale_risk(self):
        f = features()
        original = copy.deepcopy(f)
        first = detect_setup("BTCUSDT", f, market(), derivatives(), T)
        self.assertEqual(first, detect_setup("BTCUSDT", f, market(), derivatives(), T))
        first["features"]["1h"]["atr"] = 999
        self.assertEqual(f, original)
        self.assertIsNone(detect_setup("BTCUSDT", f, dict(market(), risk="extreme"), derivatives(), T))
        self.assertIsNone(detect_setup("BTCUSDT", f, market(), dict(derivatives(), stale=True), T))
        f["1h"]["close_time"] = T + 1
        self.assertIsNone(detect_setup("BTCUSDT", f, market(), derivatives(), T))

    def test_rr_rejects_near_opposition(self):
        f = features()
        f["1h"]["resistance"][0] = {"low": 102, "high": 103}
        self.assertEqual(detect_setup("BTCUSDT", f, market(), derivatives(), T)["status"], "NO_TRADE")

    def test_required_inputs_structure_and_freshness(self):
        self.assertIsNone(detect_setup("BTCUSDT", features(), {}, {}, T))
        self.assertIsNone(detect_setup("BTCUSDT", features(), market(True), derivatives(), T))
        for changed in ({"available_at": T + 1}, {"funding_rate": float("nan")}, {"oi_timestamp": T - 300001}):
            self.assertIsNone(detect_setup("BTCUSDT", features(), market(), dict(derivatives(), **changed), T))
        f = features()
        f["4h"]["structure"]["pivots"][-1]["label"] = "LL"
        self.assertIsNone(detect_setup("BTCUSDT", f, market(), derivatives(), T))
        f = features()
        f["1d"]["available"] = False
        self.assertIsNone(detect_setup("BTCUSDT", f, market(), derivatives(), T))
        f = features()
        f["4h"]["structure"]["pivots"][-1]["confirmed_at"] = T + 1
        self.assertIsNone(detect_setup("BTCUSDT", f, market(), derivatives(), T))

    def test_score_version_volatility_and_frozen_setup(self):
        f = features()
        f["1h"]["macd"] = {"histogram": 1}
        s = detect_setup("BTCUSDT", f, market(), derivatives(), T)
        self.assertEqual(s["setup_score"], 100)
        self.assertEqual(sum(s["score_components"].values()), 100)
        self.assertEqual(s["strategy_version"], "trend_pullback_v1")
        self.assertEqual(s["volatility_regime"], "normal")
        elevated_risk = detect_setup("BTCUSDT", f, dict(market(), risk="high"), derivatives(), T)
        self.assertEqual(s["volatility_regime"], elevated_risk["volatility_regime"])
        before = copy.deepcopy(s)
        expired = advance(s, bar(96))
        self.assertEqual(s, before)
        self.assertEqual(expired["features"], before["features"])
        self.assertEqual(expired["status"], "EXPIRED")
        self.assertEqual(advance(expired, bar(97)), expired)

    def test_trigger_requires_closed_rejection_and_volume(self):
        s = self.setup_signal()
        future = dict(bar(0), as_of=T)
        self.assertEqual(advance(s, future), s)
        self.assertEqual(advance(s, dict(bar(0), as_of=bar(0)["close_time"])), s)
        self.assertEqual(advance(s, dict(bar(0), as_of=bar(0)["close_time"] + 1))["status"], "TRIGGERED")
        self.assertEqual(advance(s, bar(0, volume=2))["status"], "ENTRY_ZONE")
        t = advance(s, bar(0))
        self.assertEqual(t["status"], "TRIGGERED")
        self.assertNotIn("entry_price", t)
        self.assertEqual(s["status"], "WAITING_TRIGGER")
        self.assertEqual(advance(t, bar(0)), t)

    def test_next_open_entry_and_same_bar_stop_before_tp(self):
        t = advance(self.setup_signal(), bar(0))
        stopped = advance(t, bar(1, o=100, h=125, l=90, c=101))
        self.assertEqual(stopped["status"], "STOPPED")
        self.assertAlmostEqual(stopped["entry_price"], 100.05)
        self.assertEqual([e["status"] for e in stopped["events"]][-2:], ["ACTIVE", "STOPPED"])
        self.assertEqual(len(stopped["fills"]), 1)
        self.assertLess(stopped["realized_r"], -1)

    def test_partial_targets_both_directions(self):
        for short in (False, True):
            with self.subTest(short=short):
                trigger = bar(0, o=101, h=101, l=98, c=99) if short else bar(0)
                t = advance(self.setup_signal(short), trigger)
                first = bar(1, o=100, h=101, l=89, c=90) if short else bar(1, h=111, l=99, c=110)
                p = advance(t, first)
                self.assertEqual(p["status"], "TP1")
                self.assertEqual(p["remaining"], .5)
                second = bar(2, o=90, h=91, l=79, c=80) if short else bar(2, o=110, h=121, l=109, c=120)
                p = advance(p, second)
                self.assertEqual(p["status"], "TP2")
                self.assertEqual(p["remaining"], 0)
                self.assertEqual([f["fraction"] for f in p["fills"]], [.5, .5])
                self.assertGreater(p["realized_r"], 0)

    def test_gap_expiry_invalidation(self):
        s = self.setup_signal()
        self.assertEqual(advance(s, bar(0, l=90))["status"], "INVALIDATED")
        self.assertEqual(advance(s, bar(96))["status"], "EXPIRED")
        t = advance(s, bar(0))
        self.assertEqual(advance(t, bar(1, o=109, h=111, l=108, c=110))["status"], "CANCELLED")
        self.assertEqual(advance(t, bar(2))["status"], "CANCELLED")
        active = advance(t, bar(1))
        gap = advance(active, bar(3))
        self.assertEqual(gap["status"], "CANCELLED")
        self.assertTrue(gap["data_uncertain"])
        self.assertNotIn("exit_time", gap)
        self.assertNotEqual(advance(s, dict(bar(0), allow_trigger=False))["status"], "TRIGGERED")
        self.assertEqual(advance(t, dict(bar(1), allow_trigger=False))["status"], "CANCELLED")


if __name__ == "__main__":
    unittest.main()
