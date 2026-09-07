"""Integration tests: TEST_DATABASE_URL must point to disposable starpulse_test."""
from copy import deepcopy
import os
import unittest


class DatabaseCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        dsn = os.environ.get("TEST_DATABASE_URL")
        if not dsn:
            raise unittest.SkipTest("TEST_DATABASE_URL is unset; real PostgreSQL integration tests require starpulse_test")
        from services.storage import Store
        cls.store = Store(dsn)
        with cls.store.connect() as conn:
            if conn.execute("SELECT current_database() AS name").fetchone()["name"] != "starpulse_test":
                raise RuntimeError("Refusing integration-test mutations outside starpulse_test")
        cls.store.migrate()

    def setUp(self):
        with self.store.connect() as conn:
            if conn.execute("SELECT current_database() AS name").fetchone()["name"] != "starpulse_test":
                raise RuntimeError("Refusing integration-test cleanup outside starpulse_test")
            conn.execute("TRUNCATE signal_events, signal_results, signals, candles, derivatives, latest_analysis, data_health, metadata")


class StorageTests(DatabaseCase):
    def test_migrations_idempotent_and_timescale_enabled(self):
        self.store.migrate()
        with self.store.connect() as conn:
            before = conn.execute("SELECT * FROM schema_migrations ORDER BY name").fetchall()
            hypertables = conn.execute("SELECT hypertable_name FROM timescaledb_information.hypertables").fetchall()
        self.store.migrate()
        with self.store.connect() as conn:
            after = conn.execute("SELECT * FROM schema_migrations ORDER BY name").fetchall()
        self.assertTrue(before)
        self.assertEqual(before, after)
        self.assertIn({"hypertable_name": "candles"}, hypertables)

    def test_candle_dedup_closed_time_filter_and_reconnection(self):
        from services.storage import EXCHANGE, Store
        row = {"exchange": EXCHANGE, "symbol": "BTCUSDT", "timeframe": "15m", "open_time": 0,
               "close_time": 899_999, "open": 100, "high": 102, "low": 98, "close": 101, "volume": 10}
        self.store.save_candles([row, row])
        self.store.save_candles([dict(row, close=102)])
        self.assertEqual(self.store.candles("BTCUSDT", "15m", 899_998), [])
        reconnected = Store(self.store.dsn)
        self.assertEqual(reconnected.candles("BTCUSDT", "15m", 900_000), [row])
        self.assertEqual(reconnected.latest_candle("BTCUSDT", "15m"), row)

    def test_derivative_cannot_be_read_before_it_was_available(self):
        from services.storage import EXCHANGE
        old = {"exchange": EXCHANGE, "symbol": "BTCUSDT", "timestamp": 100, "available_at": 120, "funding_rate": .001}
        delayed = dict(old, timestamp=150, available_at=300, funding_rate=.002)
        self.store.save_derivative(old)
        self.store.save_derivative(delayed)
        self.store.save_derivative(delayed)
        self.assertIsNone(self.store.derivative("BTCUSDT", 119))
        self.assertEqual(self.store.derivative("BTCUSDT", 200), old)
        self.assertEqual(self.store.derivative("BTCUSDT", 300), delayed)

    def test_signal_snapshot_is_immutable_events_unique_and_progress_persists(self):
        from services.storage import Store
        initial = {"id": "integration-signal", "symbol": "BTCUSDT", "created_at": 100,
                   "status": "WAITING_TRIGGER", "features": {"price": 100},
                   "events": [{"status": "WAITING_TRIGGER", "at": 100}]}
        self.store.save_signal(initial)
        updated = deepcopy(initial)
        updated.update(status="ACTIVE", last_candle_time=200, features={"price": 105})
        updated["events"].append({"status": "ACTIVE", "at": 200})
        self.store.save_signal(updated)
        self.store.save_signal(updated)
        self.store.save_signal(initial)
        reconnected = Store(self.store.dsn)
        detail = reconnected.signal(initial["id"])
        self.assertEqual(detail["snapshot"], initial)
        self.assertEqual(detail["payload"], updated)
        self.assertEqual(reconnected.signals(active=True), [updated])
        with reconnected.connect() as conn:
            events = conn.execute("SELECT payload FROM signal_events WHERE signal_id=%s ORDER BY sequence", (initial["id"],)).fetchall()
        self.assertEqual([row["payload"] for row in events], updated["events"])


if __name__ == "__main__":
    unittest.main()
