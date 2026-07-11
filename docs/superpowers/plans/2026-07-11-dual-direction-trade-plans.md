# Dual-Direction Trade Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every selected coin with independent long and short plans using explicit entry, stop and profit rules.

**Architecture:** A pure strategy module produces two plans and a primary direction from hourly closes. The live updater persists both close history and 4h OHLC candles. One card renders both plans and lazily draws its chart only when its details are opened.

**Tech Stack:** Native ES modules, Node, GitHub Actions, CoinGecko Demo API, Binance WebSocket, canvas.

## Global Constraints

- Do not add libraries or automatic trading.
- A plan is executable only when all four strategy conditions pass.
- Keep static `signals.json` as a clearly labelled fallback.
- Use `COINGECKO_API_KEY` only in GitHub Actions.

---

### Task 1: Produce Independent Long And Short Plans

**Files:**
- Modify: `assets/js/strategy.mjs`
- Modify: `scripts/strategy-check.mjs`

**Interfaces:**
- `strategyFor(history, price)` returns `{ plans: { long, short }, primaryDirection, indicators }`.
- A plan is `{ direction, score, status, entryZone, stopLoss, takeProfit, conditions }`.
- `planStateFor(plan, price)` returns one plan's current state.

- [ ] **Step 1: Write failing dual-plan tests**

```js
const result = strategyFor(uptrendHistory, 148.1);
assert.equal(result.plans.long.status, "可執行");
assert.equal(result.plans.short.status, "等待條件");
assert.equal(result.primaryDirection, "做多");
assert(result.plans.long.stopLoss < result.plans.long.entryZone.low);
assert(result.plans.long.takeProfit[0] > result.plans.long.entryZone.high);
assert(result.plans.short.stopLoss > result.plans.short.entryZone.high);
```

- [ ] **Step 2: Verify red**

Run: `node scripts/strategy-check.mjs`

Expected: failure because `plans` is undefined.

- [ ] **Step 3: Implement the dual-plan calculator**

```js
function planFor(direction, values, indicators) {
  const conditions = direction === "做多" ? {
    trend: indicators.ema4h20 > indicators.ema4h50,
    position: indicators.price > indicators.ema1h20,
    rsi: indicators.rsi14 >= 45 && indicators.rsi14 <= 60,
    momentum: indicators.macd > indicators.macdSignal && indicators.histogramRising
  } : inverseConditions(indicators);
  const score = Object.values(conditions).reduce((sum, passed, index) => sum + (passed ? [40, 20, 20, 20][index] : 0), 0);
  return { direction, score, status: score === 100 ? "可執行" : "等待條件", ...levelsFromStructure(direction, values, indicators), conditions };
}
```

Use 1h EMA20 as entry center. Use the last twelve closes and `1.5 * average absolute hourly return` to choose the structural stop. Calculate target one and two at 1.5R and 2.5R.

- [ ] **Step 4: Verify green and commit**

Run: `node scripts/strategy-check.mjs`

Expected: `strategy check ok`.

```bash
git add assets/js/strategy.mjs scripts/strategy-check.mjs
git commit -m "feat: add dual-direction trade plans"
```

### Task 2: Persist OHLC And Publish The Plans Schema

**Files:**
- Modify: `scripts/live-signal-update.mjs`
- Modify: `scripts/update-live-signals.mjs`
- Modify: `scripts/live-update-check.mjs`

**Interfaces:**
- `state.candles[coinId]` is at most 60 `[timestamp, open, high, low, close]` 4h candles.
- `updateCandles(state, coins, now)` updates the active 4h candle from one market snapshot.
- Every live signal contains `plans`, `primaryDirection` and `candles`; legacy top-level levels mirror the primary plan.

- [ ] **Step 1: Write failing candle and schema tests**

```js
updateCandles(state, coins, Date.UTC(2026, 0, 1, 12, 10));
assert.deepEqual(state.candles.bitcoin.at(-1), [Date.UTC(2026, 0, 1, 12), 100, 100, 100, 100]);
updateCandles(state, [{ ...coins[0], current_price: 103 }], Date.UTC(2026, 0, 1, 12, 20));
assert.deepEqual(state.candles.bitcoin.at(-1), [Date.UTC(2026, 0, 1, 12), 100, 103, 100, 103]);
assert(payload.signals[0].plans.long);
assert(payload.signals[0].plans.short);
```

- [ ] **Step 2: Verify red**

Run: `node scripts/live-update-check.mjs`

Expected: failure because `updateCandles` is not exported.

- [ ] **Step 3: Implement candle storage and mapping**

```js
export function updateCandles(state, coins, now) {
  const bucket = Math.floor(now / (4 * HOUR)) * 4 * HOUR;
  state.candles ||= {};
  for (const coin of coins) {
    const price = Number(coin.current_price);
    const candles = state.candles[coin.id] ||= [];
    const candle = candles.at(-1);
    if (!candle || candle[0] !== bucket) candles.push([bucket, price, price, price, price]);
    else { candle[2] = Math.max(candle[2], price); candle[3] = Math.min(candle[3], price); candle[4] = price; }
    if (candles.length > 60) candles.splice(0, candles.length - 60);
  }
}
```

Fetch CoinGecko OHLC only when a coin has no candle series. Keep `history` unchanged for indicator calculations.

- [ ] **Step 4: Verify green and commit**

Run: `node scripts/live-update-check.mjs && node scripts/check.mjs`

Expected: both commands end in `ok`.

```bash
git add scripts/live-signal-update.mjs scripts/update-live-signals.mjs scripts/live-update-check.mjs
git commit -m "feat: publish dual plans with candles"
```

### Task 3: Render A Dual-Plan Card And Lazy K-Line Chart

**Files:**
- Modify: `index.html`
- Modify: `assets/js/signal-render.js`
- Modify: `assets/js/app.js`
- Modify: `assets/js/live-prices.js`
- Modify: `assets/css/style.css`
- Create: `assets/js/candle-chart.mjs`
- Modify: `scripts/live-price-check.mjs`
- Modify: `scripts/check.mjs`

**Interfaces:**
- `renderDashboard()` renders `#plan-list` from signals containing `plans`.
- `renderCandleChart(canvas, candles, plans)` returns `true` only after drawing supplied candle data.
- `applyTicker()` updates `[data-long-plan-state]` and `[data-short-plan-state]` independently.

- [ ] **Step 1: Write failing UI contracts**

```js
assert(render.includes("data-long-plan-state"));
assert(render.includes("data-short-plan-state"));
assert(render.includes("plan-grid"));
assert(app.includes("candle-chart.mjs"));
```

- [ ] **Step 2: Verify red**

Run: `node scripts/check.mjs && node --no-warnings scripts/live-price-check.mjs`

Expected: failure because the dual-plan selectors are absent.

- [ ] **Step 3: Implement card, chart and responsive layout**

```html
<section class="panel" aria-labelledby="plans-title">
  <div class="section-heading"><h2 id="plans-title">精選交易計畫</h2></div>
  <div id="plan-list" class="card-grid"></div>
</section>
```

```css
.plan-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 620px) { .plan-grid { grid-template-columns: 1fr; } }
```

Render `可執行` only from a plan's own status. Render unmet conditions for waiting plans. Attach a `toggle` listener to draw the canvas once when details open, and show `K 線資料不足` when fewer than two candles exist.

- [ ] **Step 4: Update Binance state handling**

```js
for (const direction of ["long", "short"]) {
  const plan = readPlan(card, direction);
  const state = card.querySelector(`[data-${direction}-plan-state]`);
  if (plan && state) state.textContent = planStateFor(plan, price);
}
```

Leave `資料不足` untouched when a plan has no numeric levels.

- [ ] **Step 5: Verify green and commit**

Run: `node scripts/check.mjs && node --no-warnings scripts/live-price-check.mjs`

Expected: both commands end in `ok`.

```bash
git add index.html assets/js/signal-render.js assets/js/app.js assets/js/live-prices.js assets/js/candle-chart.mjs assets/css/style.css scripts/live-price-check.mjs scripts/check.mjs
git commit -m "feat: render dual-direction trade cards"
```

### Task 4: Verify And Deploy

**Files:**
- Modify if required: `.github/workflows/update-signals.yml`
- Modify if required: `data/signals.json`

- [ ] **Step 1: Set the repository secret**

Set `COINGECKO_API_KEY` in GitHub repository secrets. Do not put the key in source files, workflow logs or browser requests.

- [ ] **Step 2: Run full verification**

```bash
node --check assets/js/app.js
node --check assets/js/signal-render.js
node --check assets/js/live-prices.js
node --check assets/js/candle-chart.mjs
node scripts/strategy-check.mjs
node scripts/live-update-check.mjs
node --no-warnings scripts/live-price-check.mjs
node scripts/check.mjs
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Push and verify deployment**

```bash
git push origin main
gh run list -R Honguan/starpulse-crypto-signal --workflow pages.yml --limit 1
```

Verify the public page returns HTTP 200, contains one dual-plan list, static data contains 100 signals, `live-data` exists after a successful update run, and 360px has no horizontal overflow.
