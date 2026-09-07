"""Read-only v2 Core API. ACTIVE represents a simulated position, never an order."""
from contextlib import asynccontextmanager
import time
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
import psycopg

from services.backtest import summary
from services.pipeline import INTERVALS, candle_fresh, sources_healthy, symbols
from services.storage import Store


def get_store():
    return Store()


@asynccontextmanager
async def lifespan(app):
    get_store().migrate()
    yield


app = FastAPI(title="StarPulse v2 Core", version="2.0.0", lifespan=lifespan)


@app.exception_handler(psycopg.Error)
async def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


def now_ms():
    return int(time.time() * 1000)


def view(row, store):
    if row is None:
        raise HTTPException(503, "No analysis yet; collector must complete warmup")
    now = now_ms()
    age = now - row["updated_at"]
    sources = {source["key"]: source for source in store.health()}
    required = ("BTCUSDT", "ETHUSDT") if row["key"] == "market" else (row["key"],)
    stale = age < 0 or age > 120_000 or row["payload"].get("status") == "stale" or not row["payload"].get("available", True)
    stale = stale or not all(sources_healthy(sources, symbol, now) for symbol in required)
    return {**row["payload"], "source": "binance_usdm", "updated_at": row["updated_at"],
            "age_ms": max(0, age), "stale": stale, "status": "stale" if stale else row["payload"].get("status", "healthy")}


@app.get("/health")
def health(store=Depends(get_store)):
    with store.connect() as conn:
        conn.execute("SELECT 1")
    return {"status": "healthy", "service": "api"}


@app.get("/api/v1/health")
def data_health(store=Depends(get_store)):
    now = now_ms()
    rows = store.health()
    for row in rows:
        row["age_ms"] = None if row["updated_at"] is None else now - row["updated_at"]
        parts = row["key"].split(":")
        if row["age_ms"] is None or row["age_ms"] < 0:
            row["status"] = "unavailable"
        elif parts[0] == "candles" and parts[-1] in INTERVALS:
            if not candle_fresh({"close_time": row["updated_at"]}, parts[-1], now):
                row["status"] = "stale"
        elif row["age_ms"] > (7_200_000 if parts[0] == "derivatives" and len(parts) == 3 else 300_000):
            row["status"] = "stale"
    ready = all(sources_healthy({row["key"]: row for row in rows}, symbol, now) for symbol in symbols())
    return {"sources": rows, "status": "healthy" if ready and all(r["status"] == "healthy" for r in rows) else "degraded"}


@app.get("/api/v1/market/regime")
def market(store=Depends(get_store)):
    return view(store.analysis("market"), store)


@app.get("/api/v1/symbols/{symbol}")
def symbol_detail(symbol: str, store=Depends(get_store)):
    if symbol not in symbols():
        raise HTTPException(404, "Symbol not configured")
    return {**view(store.analysis(symbol), store), "signals": store.signals(symbol, limit=20)}


@app.get("/api/v1/symbols/{symbol}/candles")
def candles(symbol: str, timeframe: Literal["15m", "1h", "4h", "1d"] = "4h",
            limit: int = Query(240, ge=1, le=1000), store=Depends(get_store)):
    if symbol not in symbols():
        raise HTTPException(404, "Symbol not configured")
    return {"symbol": symbol, "timeframe": timeframe, "candles": store.candles(symbol, timeframe, now_ms(), limit)}


@app.get("/api/v1/signals")
def signals(symbol: str | None = None, limit: int = Query(100, ge=1, le=1000),
            offset: int = Query(0, ge=0), store=Depends(get_store)):
    if symbol is not None and symbol not in symbols():
        raise HTTPException(404, "Symbol not configured")
    records = store.signals(symbol, limit, offset)
    quality = {}
    for name in {record["symbol"] for record in records}:
        row = store.analysis(name)
        current = view(row, store) if row else {"status": "unavailable", "stale": True}
        quality[name] = {"status": current["status"], "stale": current["stale"]}
    return {"signals": records, "data_quality": quality, "limit": limit, "offset": offset,
            "tracking": "hypothetical"}


@app.get("/api/v1/signals/{signal_id}")
def signal_detail(signal_id: str, store=Depends(get_store)):
    result = store.signal(signal_id)
    if result is None:
        raise HTTPException(404, "Signal not found")
    row = store.analysis(result["payload"]["symbol"])
    return {**result, "tracking": "hypothetical", "stale": row is None or view(row, store)["stale"]}


@app.get("/api/v1/scanner")
def scanner(direction: Literal["LONG", "SHORT"] | None = None,
            setup: Literal["trend_pullback"] | None = None,
            minScore: float = Query(0, ge=0, le=100), store=Depends(get_store)):
    items = []
    market_row = store.analysis("market")
    if market_row is None or view(market_row, store)["stale"]:
        return {"signals": [], "stale": True, "score_is_probability": False}
    if market_row["payload"].get("risk") == "extreme":
        return {"signals": [], "stale": False, "risk": "extreme", "score_is_probability": False}
    for symbol in symbols():
        row = store.analysis(symbol)
        if row is None or view(row, store)["stale"]:
            continue
        items.extend(s for s in store.signals(symbol, limit=1000, active=True)
                     if (direction is None or s["direction"] == direction)
                     and (setup is None or s["setup"] == setup)
                     and s.get("setup_score", 0) >= minScore)
    return {"signals": sorted(items, key=lambda s: s.get("setup_score", 0), reverse=True), "stale": False, "score_is_probability": False}


@app.get("/api/v1/backtest/summary")
def backtest_summary(store=Depends(get_store)):
    # Read all records in pages so a limit never silently becomes a performance sample.
    records, offset = [], 0
    while True:
        page = store.signals(limit=1000, offset=offset)
        records.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return {"source": "recorded_signal_outcomes", "performance_claim": False, **summary(records)}
