import copy
import unittest
from services.backtest import replay, summary
from services.signals import advance, detect_setup
from services.analysis import analyze
from tests.test_signals import T, bar, features, market, derivatives


class BacktestTest(unittest.TestCase):
    def test_replay_prefix_invariance_and_no_future(self):
        candles = [bar(-1), bar(0), bar(1, h=125, l=90), bar(2)]
        original = copy.deepcopy(candles)
        def provider(history, as_of):
            self.assertTrue(all(c["close_time"] + 1 <= as_of for c in history))
            return features()
        def m(h, t):
            return dict(market(), as_of=t)
        def d(h, t):
            return dict(derivatives(), timestamp=t, available_at=t, funding_timestamp=t, oi_timestamp=t)
        prefix = replay(candles[:3], provider, m, d)
        full = replay(candles, provider, m, d)
        self.assertEqual(prefix["signals"], full["signals"])
        self.assertEqual(candles, original)
        self.assertEqual(full["summary"]["count"], 1)
        self.assertEqual(full["summary"]["closed"], 1)
        self.assertEqual(full["summary"]["losses"], 1)
        self.assertGreater(full["summary"]["max_drawdown_r"], 1)

    def test_metrics_exclude_open_positions_and_group(self):
        setup = detect_setup("BTCUSDT", features(), market(), derivatives(), T)
        trigger = advance(setup, bar(0))
        active = advance(trigger, bar(1))
        self.assertEqual(summary([active])["closed"], 0)
        done = advance(active, bar(2, h=125, l=99, c=120))
        metrics = summary([done])
        self.assertEqual(metrics["wins"], 1)
        self.assertEqual(metrics["trigger_rate"], 1)
        self.assertIsNone(metrics["profit_factor"])
        self.assertEqual(metrics["expectancy_r"], done["realized_r"])
        self.assertEqual(metrics["groups"]["market_regime"]["bullish"]["closed"], 1)
        self.assertEqual(set(metrics["groups"]), {"symbol", "setup", "direction", "market_regime", "volatility_regime", "timeframe", "month"})

    def test_conflicting_duplicate_rejected(self):
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            replay([bar(0), dict(bar(0), volume=25)], lambda h, t: {})

    def test_real_analysis_warmup_at_exclusive_close_boundary(self):
        observed = []
        candles = [bar(i) for i in range(200)]
        def provider(history, as_of):
            feature = analyze(history, as_of)
            self.assertTrue(feature["valid"], feature["error"])
            self.assertEqual(history[-1]["close_time"] + 1, as_of)
            observed.append(feature)
            return {"15m": feature}
        replay(candles, provider)
        self.assertEqual(len(observed), 200)
        self.assertTrue(observed[-1]["available"])
        self.assertFalse(analyze(candles, candles[-1]["close_time"])["valid"])

    def test_invalid_market_bars_rejected_before_callbacks(self):
        for changed in ({"close_time": T + 2}, {"high": float("nan")}, {"volume": -1}, {"high": 90}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                replay([dict(bar(0), **changed)], lambda h, t: self.fail("Invalid bar reached provider"))


if __name__ == "__main__":
    unittest.main()
