import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareSnapshot } from "../assets/js/data-freshness.mjs";
import { loadLastKnownGood, saveLastKnownGood } from "../assets/js/snapshot-store.mjs";
import { assertFreshPayload } from "./health-check.mjs";

const now = Date.UTC(2026, 7, 30, 6);
const snapshot = (ageMinutes, updatedAt = new Date(now - ageMinutes * 60_000).toISOString()) => ({
  live: true,
  updatedAt,
  signals: [{
    primaryDirection: "做多",
    strategy: { planState: "可進場" },
    plans: { long: { status: "可執行", planState: "可進場" }, short: { status: "等待條件", planState: "等待條件" } }
  }]
});

const fresh = prepareSnapshot(snapshot(5), { now });
assert.equal(fresh.freshness.state, "fresh");
assert.equal(fresh.status, undefined);

const delayed = prepareSnapshot(snapshot(30), { now });
assert.equal(delayed.freshness.state, "delayed");
assert.equal(delayed.live, false);
assert.equal(delayed.status, "degraded");
assert.equal(prepareSnapshot(snapshot(19), { now }).freshness.state, "fresh");
assert.equal(prepareSnapshot(snapshot(20), { now }).freshness.state, "delayed");

const stale = prepareSnapshot(snapshot(120), { now });
assert.equal(stale.freshness.state, "stale");
assert.equal(stale.signals[0].plans.long.status, "資料過期");
assert.equal(stale.signals[0].primaryDirection, "觀望");

assert.throws(() => prepareSnapshot(snapshot(0, "2026-08-30 06:00:00"), { now }), /時間格式無效/);
assert.throws(() => prepareSnapshot({ signals: [] }, { now }), /時間格式無效/);
assert.equal(prepareSnapshot(snapshot(12 * 60), { fallback: true, now }).freshness.label, "備援／過期");
assert.throws(() => prepareSnapshot(snapshot(25 * 60), { fallback: true, now }), /超過 24 小時/);

const stored = new Map();
const storage = {
  getItem: (key) => stored.get(key) || null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
const payload = JSON.parse(fs.readFileSync("data/signals.json", "utf8"));
payload.updatedAt = new Date(now - 5 * 60_000).toISOString();
assert.equal(assertFreshPayload(payload, now).state, "fresh");
payload.updatedAt = new Date(now - 20 * 60_000).toISOString();
assert.throws(() => assertFreshPayload(payload, now), { state: "delayed" });
payload.updatedAt = new Date(now - 5 * 60_000).toISOString();
saveLastKnownGood(payload, storage, now);
const saved = [...stored.values()][0];
assert.equal(loadLastKnownGood(storage, now).freshness.label, "備援／即時");

const invalid = structuredClone(payload);
invalid.signals[0].hasCandles = "yes";
assert.throws(() => saveLastKnownGood(invalid, storage, now), { code: "schema" });
assert.equal([...stored.values()][0], saved);

payload.updatedAt = new Date(now - 25 * 60 * 60_000).toISOString();
stored.set([...stored.keys()][0], JSON.stringify(payload));
assert.throws(() => loadLastKnownGood(storage, now), /超過 24 小時/);
assert.equal(stored.size, 0);

console.log("freshness check ok");
