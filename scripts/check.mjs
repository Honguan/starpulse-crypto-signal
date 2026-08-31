import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const index = read("index.html");
const app = read("assets/js/app.js");
const render = read("assets/js/signal-render.js");
const css = read("assets/css/style.css");
const livePrices = fs.existsSync("assets/js/live-prices.js")
  ? read("assets/js/live-prices.js")
  : "";
const strategy = fs.existsSync("assets/js/strategy.mjs")
  ? read("assets/js/strategy.mjs")
  : "";
const generator = fs.existsSync("scripts/generate_signals.mjs")
  ? read("scripts/generate_signals.mjs")
  : "";
const liveUpdater = fs.existsSync("scripts/update-live-signals.mjs")
  ? read("scripts/update-live-signals.mjs")
  : "";
const snapshotStore = read("assets/js/snapshot-store.mjs");
const apiRequest = read("scripts/api-request.mjs");
const healthCheck = read("scripts/health-check.mjs");
const healthWorkflow = read(".github/workflows/live-data-health.yml");
const workflowSecurityCheck = read("scripts/workflow-security-check.mjs");
const workflow = fs.existsSync(".github/workflows/update-signals.yml")
  ? read(".github/workflows/update-signals.yml")
  : "";
const data = JSON.parse(read("data/signals.json"));

assert(index.includes('id="add-favorite"'), "favorite add button exists");
assert(index.includes('data-mode="favorites"'), "favorites mode button exists");
assert(index.includes('id="plan-list"'), "dual plan list exists");
assert(app.includes("localStorage"), "favorites persist in localStorage");
assert(app.includes("normalizeSymbol"), "asset queries normalize before filtering/favorites");
assert(render.includes("favoriteCoinIds"), "renderer receives canonical favorite ids");
assert(render.includes("favoriteOnly"), "renderer supports favorite-only mode");
assert(render.includes("favorite-toggle"), "cards expose favorite toggle buttons");
assert(render.includes("coinId"), "cards expose canonical asset ids");
assert(render.includes("livePair"), "cards expose only verified live pairs");
assert(render.includes("livePrice"), "cards expose live price selector");
assert(render.includes("liveChange"), "cards expose live change selector");
assert(app.includes("live-prices.js"), "app imports live price module");
assert(app.includes("startLivePrices"), "app starts live price updates");
assert(app.includes("LIVE_DATA_URL"), "app reads live-data branch");
assert(app.includes("parseSignalPayload"), "app validates payload before replacement");
assert(app.includes("refreshLiveSignals().catch"), "interval refresh handles rejected promises");
assert(app.includes("loadLastKnownGood") && app.includes("saveLastKnownGood"), "app maintains a browser last-known-good snapshot");
assert(snapshotStore.includes("prepareSnapshot") && snapshotStore.includes("validateSignalPayload"), "stored snapshots reuse schema and maximum-age validation");
assert(apiRequest.includes("AbortSignal.timeout") && apiRequest.includes("retry-after"), "API requests have deadlines and rate-limit backoff");
assert(healthCheck.includes("freshnessFor") && healthCheck.includes("validateSignalPayload"), "health check verifies published data rather than workflow status");
assert(healthWorkflow.includes("schedule:") && healthWorkflow.includes("timeout-minutes: 5"), "freshness heartbeat is independently scheduled and bounded");
assert(healthWorkflow.includes("workflow-security-check.mjs") && workflowSecurityCheck.includes("every action must use a full SHA"), "workflow hardening is continuously checked");
assert(livePrices.includes("stream?streams=") && livePrices.includes("@miniTicker") && !livePrices.includes("!miniTicker@arr"), "Binance streams target only rendered pairs");
assert(livePrices.includes("cardsBySymbol") && !livePrices.includes('querySelector(`.card[data-live-pair='), "ticker handling uses the rendered-card map");
assert(livePrices.includes("WebSocket"), "live prices use WebSocket");
assert(livePrices.includes('data-status-value="websocket"'), "live prices expose a separate connection state");
assert(livePrices.includes("setTimeout"), "live prices schedule reconnects");
assert(livePrices.includes("data-plan-state"), "live prices update plan status");
assert(livePrices.includes("data-${direction}-plan-state"), "live prices update both plan statuses");
assert(strategy.includes("strategyFor"), "strategy calculates 1h/4h plans");
assert(render.includes("`${prefix}PlanState`"), "renderer exposes both plan statuses");
assert(render.includes("plan-grid"), "renderer exposes dual plan grid");
assert(render.includes("candle-chart.mjs"), "renderer imports candle chart module");
assert(!render.includes("innerHTML"), "renderer never parses market data as HTML");
assert(index.includes("Content-Security-Policy") && index.includes("default-src 'none'") && !index.includes("unsafe-inline"), "page has a restrictive CSP without inline scripts");
assert(generator.includes("api.coingecko.com/api/v3/coins/markets"), "CoinGecko markets endpoint is used");
assert(generator.includes("per_page=100"), "generator requests 100 coins per page");
assert(generator.includes("TOP_100_PAGES = [1]"), "generator requests one page for top 100");
assert(liveUpdater.includes("price-history.json"), "live updater persists price history");
assert(liveUpdater.includes("plans"), "live updater publishes dual plans");
assert(liveUpdater.includes("candles"), "live updater publishes candles");
assert(workflow.includes("schedule:"), "update workflow has schedule");
assert(workflow.includes("7,17,27,37,47,57"), "workflow runs every ten minutes off the hour");
assert(workflow.includes("live-data"), "workflow publishes live-data branch");
assert(workflow.includes("group: live-data-publisher") && workflow.includes("cancel-in-progress: false"), "live-data publication is serialized");
assert(workflow.includes("timeout-minutes: 15"), "live-data publication has a bounded runtime");
assert(workflow.includes("key: live-state-v2-${{ github.run_id }}") && workflow.includes("restore-keys: live-state-v2-") && workflow.includes("LIVE_STATE_FILE"), "internal price history uses bounded Actions cache storage");
assert(workflow.includes("git switch --orphan snapshot") && workflow.includes("--force-with-lease=\"refs/heads/live-data:$LIVE_DATA_EXPECTED_SHA\""), "live-data publishes one lease-protected snapshot commit");
assert(workflow.includes('test -z "$(git ls-files)"') && workflow.includes("git add data/signals.json") && !workflow.includes("git add data/signals.json data/price-history.json"), "public snapshot starts empty and excludes internal price history");
assert(data.signals.length >= 10 && data.signals.length <= 100, "signals count is within expected range");
assert.equal(data.schemaVersion, 1, "fallback data exposes signal schema version");
assert(data.signals.every((signal) => signal.plans?.long && signal.plans?.short), "signals expose long and short plans");
assert(data.signals.every((signal) => Array.isArray(signal.candles)), "signals expose candles");
assert(data.dataQuality?.status === "degraded" && data.dataQuality.missingHistoryCount === data.signals.length, "fallback publishes explicit data quality");
assert(data.signals.every((signal) => signal.coinId && signal.priceSource?.instrument === signal.coinId && signal.indicatorSource?.instrument === signal.coinId), "signals identify CoinGecko source instruments");
assert(data.signals.every((signal) => signal.liveMode === "snapshot-only" && signal.liveInstrument === null), "fallback signals are explicitly snapshot-only");
assert(data.signals.every((signal) => !("winRate" in signal) && !("ev" in signal) && !("rr" in signal)), "fallback data excludes unsupported performance metrics");
assert(data.signals.every((signal) => signal.sourceMode === "fallback" && signal.details.every((detail) => detail.sourceMode === "fallback" && detail.calculationMode)), "fallback details identify their source and calculation mode");
assert(data.signals.every((signal) => !("vegas" in signal) && !("tdSequential" in signal)), "fallback data excludes unimplemented named indicators");
assert(!("btcVegas" in data.market) && !("ethVegas" in data.market), "market summary excludes unimplemented Vegas labels");
assert(data.market.condition === "震盪" && data.signals.every((signal) => signal.primaryDirection === "觀望" && signal.direction === "觀望"), "fallback data does not claim an actionable setup");
assert(css.includes("@media (max-width: 430px)"), "small phone breakpoint exists");
assert(css.includes("overflow-wrap: anywhere"), "long mobile text can wrap");
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "mobile metrics use two compact columns");
assert(css.includes("min-width: 0"), "mobile flex/grid children can shrink");
assert(css.includes("price-up"), "price-up flash style exists");
assert(css.includes("price-down"), "price-down flash style exists");

console.log("check ok");
