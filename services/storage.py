"""PostgreSQL persistence; initial signal snapshots are never overwritten."""
import hashlib
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

EXCHANGE = "binance_usdm"


class Store:
    def __init__(self, dsn=None):
        self.dsn = dsn if dsn is not None else os.environ.get("DATABASE_URL", "")

    def connect(self):
        return psycopg.connect(self.dsn, row_factory=dict_row, connect_timeout=5)

    def migrate(self):
        with self.connect() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(7410201)")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)")
            for path in sorted((Path(__file__).parents[1] / "database/migrations").glob("*.sql")):
                sql = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                row = conn.execute("SELECT checksum FROM schema_migrations WHERE name=%s", (path.name,)).fetchone()
                if row:
                    if row["checksum"] != checksum:
                        raise RuntimeError(f"Migration changed after application: {path.name}")
                    continue
                conn.execute(sql)
                conn.execute("INSERT INTO schema_migrations VALUES (%s,%s)", (path.name, checksum))

    def latest_candle(self, symbol, timeframe):
        rows = self.candles(symbol, timeframe, 2**63 - 1, limit=1)
        return rows[-1] if rows else None

    def candles(self, symbol, timeframe, as_of, limit=240, after=-1):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM candles WHERE exchange=%s AND symbol=%s AND timeframe=%s "
                "AND close_time<=%s AND close_time>%s ORDER BY open_time DESC LIMIT %s",
                (EXCHANGE, symbol, timeframe, as_of, after, limit),
            ).fetchall()
        return list(reversed(rows))

    def save_candles(self, rows):
        columns = "exchange symbol timeframe open_time close_time open high low close volume".split()
        with self.connect() as conn, conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO candles VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                [tuple(row[key] for key in columns) for row in rows],
            )

    def save_derivative(self, row):
        with self.connect() as conn:
            conn.execute("INSERT INTO derivatives VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                         (row["exchange"], row["symbol"], row["timestamp"], row["available_at"], Jsonb(row)))

    def derivative(self, symbol, as_of):
        with self.connect() as conn:
            row = conn.execute("SELECT payload FROM derivatives WHERE exchange=%s AND symbol=%s "
                               "AND timestamp<=%s AND available_at<=%s ORDER BY available_at DESC LIMIT 1",
                               (EXCHANGE, symbol, as_of, as_of)).fetchone()
        return row["payload"] if row else None

    def save_metadata(self, row):
        with self.connect() as conn:
            conn.execute("INSERT INTO metadata VALUES (%s,%s) ON CONFLICT (symbol) DO UPDATE SET payload=excluded.payload",
                         (row["symbol"], Jsonb(row)))

    def record_health(self, key, source, updated_at, status, error=None):
        with self.connect() as conn:
            conn.execute("INSERT INTO data_health VALUES (%s,%s,%s,%s,%s) ON CONFLICT (key) DO UPDATE "
                         "SET source=excluded.source,updated_at=COALESCE(excluded.updated_at,data_health.updated_at),"
                         "status=excluded.status,error=excluded.error", (key, source, updated_at, status, error))

    def health(self):
        with self.connect() as conn:
            return conn.execute("SELECT * FROM data_health ORDER BY key").fetchall()

    def save_analysis(self, key, as_of, payload):
        with self.connect() as conn:
            conn.execute("INSERT INTO latest_analysis VALUES (%s,%s,%s) ON CONFLICT (key) DO UPDATE "
                         "SET updated_at=excluded.updated_at,payload=excluded.payload", (key, as_of, Jsonb(payload)))

    def analysis(self, key):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM latest_analysis WHERE key=%s", (key,)).fetchone()
        return row

    def save_signal(self, signal):
        with self.connect() as conn:
            conn.execute("INSERT INTO signals VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                         (signal["id"], signal["symbol"], signal["created_at"], Jsonb(signal)))
            previous = conn.execute("SELECT payload FROM signal_results WHERE signal_id=%s FOR UPDATE", (signal["id"],)).fetchone()
            if previous and previous["payload"].get("last_candle_time", -1) > signal.get("last_candle_time", -1):
                return
            conn.execute("INSERT INTO signal_results VALUES (%s,%s) ON CONFLICT (signal_id) DO UPDATE SET payload=excluded.payload",
                         (signal["id"], Jsonb(signal)))
            for sequence, event in enumerate(signal.get("events", [])):
                conn.execute("INSERT INTO signal_events VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                             (signal["id"], sequence, Jsonb(event)))

    def signals(self, symbol=None, limit=100, offset=0, active=False):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT r.payload FROM signals s JOIN signal_results r ON s.id=r.signal_id "
                "WHERE (%s::text IS NULL OR s.symbol=%s) AND (NOT %s OR r.payload->>'status' "
                "IN ('SETUP_FOUND','WAITING_TRIGGER','ENTRY_ZONE','TRIGGERED','ACTIVE','TP1')) "
                "ORDER BY s.created_at DESC,s.id LIMIT %s OFFSET %s", (symbol, symbol, active, limit, offset),
            ).fetchall()
        return [r["payload"] for r in rows]

    def signal(self, signal_id):
        with self.connect() as conn:
            row = conn.execute("SELECT s.snapshot,r.payload FROM signals s JOIN signal_results r "
                               "ON s.id=r.signal_id WHERE s.id=%s", (signal_id,)).fetchone()
        return row
