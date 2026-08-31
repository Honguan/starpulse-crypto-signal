import { marketFor } from "./market-summary.mjs";

export const SIGNAL_SCHEMA_VERSION = 2;
export const SIGNAL_PAYLOAD_MAX_BYTES = 180 * 1024;

export class SignalPayloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SignalPayloadError";
    this.code = code;
  }
}

function reject(message) {
  throw new SignalPayloadError("schema", `訊號資料格式錯誤：${message}`);
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(path);
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || !value) reject(path);
}

function array(value, path) {
  if (!Array.isArray(value)) reject(path);
}

function finiteNumbers(value, path = "payload") {
  if (typeof value === "number" && !Number.isFinite(value)) reject(path);
  if (Array.isArray(value)) value.forEach((item, index) => finiteNumbers(item, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => finiteNumbers(item, `${path}.${key}`));
}

function validatePlan(plan, path) {
  record(plan, path);
  string(plan.direction, `${path}.direction`);
  string(plan.status, `${path}.status`);
  string(plan.planState, `${path}.planState`);
  if (!Number.isFinite(plan.score)) reject(`${path}.score`);
  if (plan.entryZone !== null) {
    record(plan.entryZone, `${path}.entryZone`);
    if (!Number.isFinite(plan.entryZone.low) || !Number.isFinite(plan.entryZone.high)) reject(`${path}.entryZone`);
  }
  if (plan.stopLoss !== null && !Number.isFinite(plan.stopLoss)) reject(`${path}.stopLoss`);
  array(plan.takeProfit, `${path}.takeProfit`);
  if (!plan.takeProfit.every(Number.isFinite)) reject(`${path}.takeProfit`);
  record(plan.conditions, `${path}.conditions`);
  if (!Object.values(plan.conditions).every((value) => typeof value === "boolean")) reject(`${path}.conditions`);
}

function validateSignal(signal, index) {
  const path = `signals[${index}]`;
  record(signal, path);
  ["coinId", "name", "symbol", "primaryDirection", "riskLevel", "liveMode", "sourceMode"].forEach((key) => string(signal[key], `${path}.${key}`));
  if (!["低", "中", "高"].includes(signal.riskLevel)) reject(`${path}.riskLevel`);
  ["price", "change24h", "marketCapRank"].forEach((key) => {
    if (!Number.isFinite(signal[key])) reject(`${path}.${key}`);
  });
  record(signal.priceSource, `${path}.priceSource`);
  record(signal.indicatorSource, `${path}.indicatorSource`);
  ["source", "instrument", "quoteAsset"].forEach((key) => string(signal.priceSource[key], `${path}.priceSource.${key}`));
  ["source", "instrument", "timeframe"].forEach((key) => string(signal.indicatorSource[key], `${path}.indicatorSource.${key}`));
  if (signal.priceSource.instrument !== signal.coinId || signal.indicatorSource.instrument !== signal.coinId) reject(`${path}.source instrument`);
  if (!["websocket", "snapshot-only"].includes(signal.liveMode)) reject(`${path}.liveMode`);
  if (signal.liveMode === "websocket") {
    record(signal.liveInstrument, `${path}.liveInstrument`);
    ["source", "symbol", "baseAsset", "quoteAsset"].forEach((key) => string(signal.liveInstrument[key], `${path}.liveInstrument.${key}`));
  } else if (signal.liveInstrument !== null) reject(`${path}.liveInstrument`);
  record(signal.plans, `${path}.plans`);
  validatePlan(signal.plans.long, `${path}.plans.long`);
  validatePlan(signal.plans.short, `${path}.plans.short`);
  record(signal.strategy, `${path}.strategy`);
  record(signal.strategy.indicators, `${path}.strategy.indicators`);
  string(signal.strategy.planState, `${path}.strategy.planState`);
  if (typeof signal.hasCandles !== "boolean") reject(`${path}.hasCandles`);
}

export function validateSignalPayload(payload) {
  record(payload, "payload");
  if (payload.schemaVersion !== SIGNAL_SCHEMA_VERSION) reject("schemaVersion");
  string(payload.updatedAt, "updatedAt");
  string(payload.status, "status");
  string(payload.strategySource, "strategySource");
  if (typeof payload.live !== "boolean") reject("live");
  const market = record(payload.market, "market");
  ["condition", "riskLevel", "btcDirection", "ethDirection", "summary"].forEach((key) => string(market[key], `market.${key}`));
  const metrics = record(market.metrics, "market.metrics");
  const quality = record(payload.dataQuality, "dataQuality");
  ["source", "status"].forEach((key) => string(quality[key], `dataQuality.${key}`));
  ["successCount", "failedCount", "requestFailureCount", "missingHistoryCount", "concurrency"].forEach((key) => {
    if (!Number.isInteger(quality[key]) || quality[key] < 0) reject(`dataQuality.${key}`);
  });
  array(quality.failures, "dataQuality.failures");
  quality.failures.forEach((failure, index) => {
    record(failure, `dataQuality.failures[${index}]`);
    ["coinId", "resource", "classification"].forEach((key) => string(failure[key], `dataQuality.failures[${index}].${key}`));
  });
  array(payload.signals, "signals");
  if (!payload.signals.length) reject("signals");
  payload.signals.forEach(validateSignal);
  const expectedMarket = marketFor(payload.signals);
  if (market.condition !== expectedMarket.condition || market.riskLevel !== expectedMarket.riskLevel
    || Object.keys(metrics).length !== Object.keys(expectedMarket.metrics).length
    || Object.entries(expectedMarket.metrics).some(([key, value]) => metrics[key] !== value)) reject("market aggregation");
  finiteNumbers(payload);
  return payload;
}

export function parseSignalPayload(text) {
  try {
    return validateSignalPayload(JSON.parse(text));
  } catch (error) {
    if (error instanceof SignalPayloadError) throw error;
    throw new SignalPayloadError("parse", "訊號 JSON 無法解析");
  }
}
