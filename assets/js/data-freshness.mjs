const MINUTE = 60 * 1000;

export const FRESH_MS = 20 * MINUTE;
export const STALE_MS = 60 * MINUTE;
export const MAX_FALLBACK_MS = 24 * 60 * MINUTE;

function timestampFor(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function freshnessError(message) {
  const error = new Error(message);
  error.code = "stale";
  return error;
}

export function freshnessFor(updatedAt, now = Date.now()) {
  const timestamp = timestampFor(updatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * MINUTE) return { state: "unavailable", age: NaN };

  const age = Math.max(0, now - timestamp);
  return { state: age < FRESH_MS ? "fresh" : age <= STALE_MS ? "delayed" : "stale", age };
}

function disablePlans(data) {
  for (const signal of data.signals || []) {
    signal.direction = "觀望";
    signal.primaryDirection = "觀望";
    if (signal.strategy) {
      signal.strategy.direction = "觀望";
      signal.strategy.primaryDirection = "觀望";
      signal.strategy.planState = "資料過期";
    }
    for (const plan of Object.values(signal.plans || {})) {
      plan.status = "資料過期";
      plan.planState = "資料過期";
    }
  }
}

export function prepareSnapshot(data, { fallback = false, now = Date.now() } = {}) {
  const freshness = freshnessFor(data?.updatedAt, now);
  if (freshness.state === "unavailable") throw freshnessError("策略資料時間格式無效");
  if (fallback && freshness.age > MAX_FALLBACK_MS) throw freshnessError("備援策略資料已超過 24 小時");

  const labels = { fresh: "即時", delayed: "延遲", stale: "過期" };
  data.freshness = { ...freshness, fallback, label: `${fallback ? "備援／" : ""}${labels[freshness.state]}` };
  data.live = Boolean(data.live && freshness.state === "fresh");
  if (freshness.state !== "fresh") data.status = "degraded";
  if (freshness.state === "stale") disablePlans(data);
  return data;
}
