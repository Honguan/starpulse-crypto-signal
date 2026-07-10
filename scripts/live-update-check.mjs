import assert from "node:assert/strict";
import { buildLivePayload } from "./update-live-signals.mjs";
import { fetchMarkets, updateHistory } from "./live-signal-update.mjs";

const coins = [
  { id: "bitcoin", symbol: "btc", current_price: 100, market_cap_rank: 1 },
  { id: "ethereum", symbol: "eth", current_price: 50, market_cap_rank: 2 }
];

let requests = 0;
const markets = await fetchMarkets(async () => {
  requests += 1;
  return { ok: true, json: async () => coins };
});
assert.equal(requests, 1);
assert.equal(markets.length, 2);

const state = { history: { bitcoin: [[Date.UTC(2026, 0, 1, 10), 99]] } };
updateHistory(state, coins, Date.UTC(2026, 0, 1, 10, 30));
assert.deepEqual(state.history.bitcoin, [[Date.UTC(2026, 0, 1, 10), 100]]);
assert.deepEqual(state.history.ethereum, [[Date.UTC(2026, 0, 1, 10), 50]]);

updateHistory(state, [{ ...coins[0], current_price: 101 }], Date.UTC(2026, 0, 1, 11, 10));
assert.deepEqual(state.history.bitcoin.at(-1), [Date.UTC(2026, 0, 1, 11), 101]);

const payload = buildLivePayload(coins, state, Date.UTC(2026, 0, 1, 11, 10));
assert.equal(payload.signals.length, 2);
assert.equal(payload.signals[0].coinId, "bitcoin");
assert.equal(payload.signals[0].strategy.planState, "資料不足");

console.log("live update check ok");
