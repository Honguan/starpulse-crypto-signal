CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE candles (
    exchange text NOT NULL,
    symbol text NOT NULL,
    timeframe text NOT NULL CHECK (timeframe IN ('15m','1h','4h','1d')),
    open_time bigint NOT NULL,
    close_time bigint NOT NULL CHECK (close_time > open_time),
    open double precision NOT NULL CHECK (open > 0 AND open < 'Infinity'),
    high double precision NOT NULL CHECK (high >= open AND high < 'Infinity'),
    low double precision NOT NULL CHECK (low > 0 AND low <= open),
    close double precision NOT NULL CHECK (close BETWEEN low AND high),
    volume double precision NOT NULL CHECK (volume >= 0 AND volume < 'Infinity'),
    PRIMARY KEY (exchange, symbol, timeframe, open_time)
);
SELECT create_hypertable('candles', by_range('open_time', 604800000::bigint));
CREATE TABLE derivatives (
    exchange text NOT NULL,
    symbol text NOT NULL,
    timestamp bigint NOT NULL,
    available_at bigint NOT NULL CHECK (available_at >= timestamp),
    payload jsonb NOT NULL,
    PRIMARY KEY (exchange, symbol, timestamp)
);
CREATE INDEX derivatives_available ON derivatives (symbol, available_at DESC);
CREATE TABLE signals (
    id text PRIMARY KEY,
    symbol text NOT NULL,
    created_at bigint NOT NULL,
    snapshot jsonb NOT NULL
);
CREATE INDEX signals_created ON signals (created_at DESC, id);
CREATE TABLE signal_results (
    signal_id text PRIMARY KEY REFERENCES signals(id),
    payload jsonb NOT NULL
);
CREATE TABLE signal_events (
    signal_id text NOT NULL REFERENCES signals(id),
    sequence integer NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (signal_id, sequence)
);
CREATE TABLE latest_analysis (
    key text PRIMARY KEY,
    updated_at bigint NOT NULL,
    payload jsonb NOT NULL
);
CREATE TABLE data_health (
    key text PRIMARY KEY,
    source text NOT NULL,
    updated_at bigint,
    status text NOT NULL CHECK (status IN ('healthy','degraded','stale','unavailable')),
    error text
);
CREATE TABLE metadata (
    symbol text PRIMARY KEY,
    payload jsonb NOT NULL
);
