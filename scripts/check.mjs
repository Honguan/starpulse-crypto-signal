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
const generator = fs.existsSync("scripts/generate_signals.mjs")
  ? read("scripts/generate_signals.mjs")
  : "";
const workflow = fs.existsSync(".github/workflows/update-signals.yml")
  ? read(".github/workflows/update-signals.yml")
  : "";
const data = JSON.parse(read("data/signals.json"));

assert(index.includes('id="add-favorite"'), "favorite add button exists");
assert(index.includes('data-mode="favorites"'), "favorites mode button exists");
assert(app.includes("localStorage"), "favorites persist in localStorage");
assert(app.includes("normalizeSymbol"), "symbols normalize before filtering/favorites");
assert(render.includes("favoriteSymbols"), "renderer receives favorite symbols");
assert(render.includes("favoriteOnly"), "renderer supports favorite-only mode");
assert(render.includes("favorite-toggle"), "cards expose favorite toggle buttons");
assert(render.includes("data-symbol"), "cards expose data-symbol for live prices");
assert(render.includes("data-live-price"), "cards expose live price selector");
assert(render.includes("data-live-change"), "cards expose live change selector");
assert(app.includes("live-prices.js"), "app imports live price module");
assert(app.includes("startLivePrices"), "app starts live price updates");
assert(livePrices.includes("!miniTicker@arr"), "Binance mini ticker stream is used");
assert(livePrices.includes("WebSocket"), "live prices use WebSocket");
assert(livePrices.includes("OFFLINE"), "live prices expose offline state");
assert(livePrices.includes("setTimeout"), "live prices schedule reconnects");
assert(generator.includes("api.coingecko.com/api/v3/coins/markets"), "CoinGecko markets endpoint is used");
assert(generator.includes("per_page=250"), "generator requests 250 coins per page");
assert(generator.includes("TOP_500_PAGES = [1, 2]"), "generator requests two pages for top 500");
assert(workflow.includes("schedule:"), "update workflow has schedule");
assert(workflow.includes("scripts/generate_signals.mjs"), "workflow runs generator");
assert(data.signals.length >= 10 && data.signals.length <= 500, "signals count is within expected range");
assert(css.includes("@media (max-width: 430px)"), "small phone breakpoint exists");
assert(css.includes("overflow-wrap: anywhere"), "long mobile text can wrap");
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "mobile metrics use two compact columns");
assert(css.includes("min-width: 0"), "mobile flex/grid children can shrink");
assert(css.includes("price-up"), "price-up flash style exists");
assert(css.includes("price-down"), "price-down flash style exists");

console.log("check ok");
