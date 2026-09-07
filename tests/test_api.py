"""Read-only API integration against a guarded disposable Timescale database."""
from contextlib import ExitStack
import unittest
from unittest.mock import patch

from tests.test_storage import DatabaseCase


class ApiTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        from apps.api import main
        from fastapi.testclient import TestClient
        self.now = 1_800_000_000_000
        stack = self.enterContext(ExitStack())
        original = main.get_store
        previous = dict(main.app.dependency_overrides)
        main.app.dependency_overrides[original] = lambda: self.store
        self.addCleanup(setattr, main.app, "dependency_overrides", previous)
        stack.enter_context(patch.object(main, "get_store", return_value=self.store))
        stack.enter_context(patch.object(main, "now_ms", return_value=self.now))
        stack.enter_context(patch.object(main, "symbols", return_value=("BTCUSDT", "ETHUSDT", "ENAUSDT")))
        self.client = stack.enter_context(TestClient(main.app))

    def seed_healthy_sources(self):
        from services.pipeline import INTERVALS
        self.store.record_health("exchange_info", "binance_usdm", self.now, "healthy")
        for symbol in ("BTCUSDT", "ETHUSDT", "ENAUSDT"):
            self.store.record_health(f"derivatives:{symbol}", "binance_usdm", self.now, "healthy")
            for timeframe, interval in INTERVALS.items():
                closed = self.now // interval * interval - 1
                self.store.record_health(f"candles:{symbol}:{timeframe}", "binance_usdm", closed, "healthy")

    def test_health_queries_database_and_reports_source_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "healthy")
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "degraded")
        self.store.record_health("exchange_info", "binance_usdm", self.now, "healthy")
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "degraded")
        self.seed_healthy_sources()
        health = self.client.get("/api/v1/health").json()
        self.assertEqual(health["status"], "healthy")
        self.assertEqual(next(row for row in health["sources"] if row["key"] == "exchange_info")["age_ms"], 0)

    def test_unknown_symbol_and_signal_are_not_found(self):
        for route in ("/api/v1/symbols/UNKNOWN", "/api/v1/symbols/UNKNOWN/candles", "/api/v1/signals/missing", "/api/v1/signals?symbol=UNKNOWN"):
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 404)

    def test_malformed_query_is_rejected(self):
        routes = ("/api/v1/symbols/BTCUSDT/candles?timeframe=2m", "/api/v1/symbols/BTCUSDT/candles?limit=0",
                  "/api/v1/signals?limit=1001", "/api/v1/signals?offset=-1", "/api/v1/signals?limit=abc",
                  "/api/v1/scanner?direction=UP", "/api/v1/scanner?minScore=101")
        for route in routes:
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 422)

    def test_cold_analysis_is_unavailable(self):
        for route in ("/api/v1/market/regime", "/api/v1/symbols/BTCUSDT"):
            with self.subTest(route=route):
                response = self.client.get(route)
                self.assertEqual(response.status_code, 503)
                self.assertIn("warmup", response.json()["detail"])

    def test_persisted_analysis_reports_freshness_without_fake_data(self):
        self.seed_healthy_sources()
        self.store.save_analysis("market", self.now, {"available": True, "regime": "bullish", "score": 65})
        response = self.client.get("/api/v1/market/regime")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["score"], 65)
        self.assertFalse(payload["stale"])
        self.assertEqual(payload["source"], "binance_usdm")
        self.store.save_analysis("market", self.now - 120_001, {"available": True, "regime": "bullish", "score": 65})
        self.assertTrue(self.client.get("/api/v1/market/regime").json()["stale"])
        self.store.save_analysis("BTCUSDT", self.now, {"available": False, "features": {}})
        symbol = self.client.get("/api/v1/symbols/BTCUSDT").json()
        self.assertTrue(symbol["stale"])
        self.assertEqual(symbol["signals"], [])

    def test_source_failure_invalidates_cached_market_symbol_and_scanner_immediately(self):
        self.seed_healthy_sources()
        self.store.save_analysis("market", self.now, {"available": True, "risk": "low", "status": "healthy"})
        self.store.save_analysis("BTCUSDT", self.now, {"available": True, "status": "healthy"})
        self.store.save_signal({"id": "api-live-source", "symbol": "BTCUSDT", "created_at": self.now,
                                "status": "WAITING_TRIGGER", "direction": "LONG", "setup": "trend_pullback",
                                "setup_score": 90, "events": []})
        self.assertEqual(len(self.client.get("/api/v1/scanner").json()["signals"]), 1)
        self.assertFalse(self.client.get("/api/v1/signals").json()["data_quality"]["BTCUSDT"]["stale"])
        self.assertFalse(self.client.get("/api/v1/market/regime").json()["stale"])
        self.store.record_health("derivatives:BTCUSDT", "binance_usdm", self.now, "unavailable", "upstream failed")
        self.assertTrue(self.client.get("/api/v1/market/regime").json()["stale"])
        self.assertTrue(self.client.get("/api/v1/symbols/BTCUSDT").json()["stale"])
        self.assertTrue(self.client.get("/api/v1/signals/api-live-source").json()["stale"])
        history = self.client.get("/api/v1/signals").json()
        self.assertEqual(history["signals"][0]["status"], "WAITING_TRIGGER")
        self.assertTrue(history["data_quality"]["BTCUSDT"]["stale"])
        scanner = self.client.get("/api/v1/scanner").json()
        self.assertTrue(scanner["stale"])
        self.assertEqual(scanner["signals"], [])

    def test_fresh_extreme_risk_is_not_stale_and_scanner_suppresses_exposure(self):
        self.seed_healthy_sources()
        self.store.save_analysis("market", self.now, {"available": True, "risk": "extreme", "status": "healthy"})
        self.store.save_analysis("BTCUSDT", self.now, {"available": True, "risk": "extreme", "status": "healthy"})
        self.assertFalse(self.client.get("/api/v1/market/regime").json()["stale"])
        self.assertFalse(self.client.get("/api/v1/symbols/BTCUSDT").json()["stale"])
        scanner = self.client.get("/api/v1/scanner").json()
        self.assertFalse(scanner["stale"])
        self.assertEqual(scanner["risk"], "extreme")
        self.assertEqual(scanner["signals"], [])


if __name__ == "__main__":
    unittest.main()
