import { renderCandleChart } from "./candle-chart.mjs";

const directionClass = {
  "強烈做多": "strong-long",
  "做多": "long",
  "做空": "short",
  "強烈做空": "strong-short",
  "觀望": "watch"
};

const statusLabels = {
  status: "資料狀態",
  freshness: "策略資料",
  websocket: "即時價格",
  updatedAt: "最後更新",
  condition: "目前市場",
  riskLevel: "市場風險",
  btcDirection: "BTC 方向",
  ethDirection: "ETH 方向",
  source: "資料來源"
};

export function renderDashboard(data, options = "") {
  renderStatus(data);
  renderMarket(data.market);

  const settings = typeof options === "string" ? { symbolFilter: options } : options;
  const favoriteCoinIds = settings.favoriteCoinIds || new Set();
  const symbolFilter = settings.symbolFilter || "";
  const normalizedFilter = symbolFilter.trim().toUpperCase();
  const signals = data.signals.filter((signal) => {
    const matchesSymbol = !normalizedFilter || [signal.symbol, signal.coinId, signal.name, signal.liveInstrument?.symbol].some((value) => String(value || "").toUpperCase().includes(normalizedFilter));
    const matchesFavorite = !settings.favoriteOnly || favoriteCoinIds.has(signal.coinId);
    return matchesSymbol && matchesFavorite;
  });
  const byPlanScore = (a, b) => {
    const aScore = Math.max(a.plans?.long?.score || 0, a.plans?.short?.score || 0);
    const bScore = Math.max(b.plans?.long?.score || 0, b.plans?.short?.score || 0);
    return bScore - aScore || a.marketCapRank - b.marketCapRank;
  };

  const rankedSignals = signals.sort(byPlanScore);
  const visibleSignals = settings.symbolFilter || settings.favoriteOnly ? rankedSignals : rankedSignals.slice(0, 5);
  renderCards("#plan-list", visibleSignals, favoriteCoinIds);
  bindCandleCharts(visibleSignals);
}

function renderStatus(data) {
  const status = {
    status: data.status === "normal" ? "正常" : "異常",
    freshness: data.freshness?.label || "未知",
    websocket: "連線中…",
    updatedAt: data.updatedAt,
    condition: data.market.condition,
    riskLevel: data.market.riskLevel,
    btcDirection: data.market.btcDirection,
    ethDirection: data.market.ethDirection,
    source: data.strategySource || (data.live ? "即時策略資料" : "備援快照")
  };

  document.querySelector("#status").innerHTML = Object.entries(status)
    .map(([key, value]) => `
      <div class="status-item">
        <span class="label">${statusLabels[key]}</span>
        <span class="value" data-status-value="${key}">${value}</span>
      </div>
    `)
    .join("");
}

function renderMarket(market) {
  document.querySelector("#market").innerHTML = `
    <div class="market-grid">
      ${marketItem("市場狀態", market.condition)}
      ${marketItem("市場風險", market.riskLevel)}
      <div class="market-card market-summary">
        <span class="label">摘要</span>
        <strong>${market.summary}</strong>
      </div>
    </div>
  `;
}

function marketItem(label, value) {
  return `
    <div class="market-card">
      <span class="label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderCards(selector, signals, favoriteCoinIds = new Set()) {
  const root = document.querySelector(selector);
  root.innerHTML = signals.length
    ? signals.map((signal) => renderCard(signal, favoriteCoinIds)).join("")
    : '<p class="empty">目前沒有符合條件的訊號。</p>';
}

function renderCard(signal, favoriteCoinIds) {
  const isFavorite = favoriteCoinIds.has(signal.coinId);
  const strategy = signal.strategy || {};
  const plans = signal.plans || {};
  const primary = signal.primaryDirection === "做空" ? plans.short : plans.long;
  const conditionScore = Math.max(plans.long?.score || 0, plans.short?.score || 0);
  return `
    <article class="card" data-coin-id="${signal.coinId}" data-live-pair="${signal.liveInstrument?.symbol || ""}" data-snapshot-price="${signal.price}">
      <div class="card-head">
        <div>
          <h3 class="symbol">${signal.symbol}</h3>
          <span class="asset">
            <span>${signal.name}／${signal.coinId}</span>
            <span data-live-price>${signal.price}</span>
            <span data-live-change>${signal.change24h}%</span>
          </span>
        </div>
        <button class="favorite-toggle ${isFavorite ? "active" : ""}" type="button" data-coin-id="${signal.coinId}" aria-label="切換 ${signal.name} 最愛">★</button>
        <span class="label">${signal.liveMode === "websocket" ? `${signal.liveInstrument.symbol} 即時` : "快照模式"}</span>
        <span class="badge ${directionClass[signal.primaryDirection] || "watch"}">${signal.primaryDirection || signal.direction || "觀望"}</span>
      </div>
      <div class="card-body">
        <div class="metrics">
          ${metric("條件", `${conditionScore}%`)}
          ${metric("RSI", strategy.indicators?.rsi14 ?? "-")}
          ${metric("主要狀態", `<span data-plan-state>${strategy.planState || "資料延遲"}</span>`)}
          ${metric("主要 RR", `<span data-plan-rr>${primary?.riskReward ? `${primary.riskReward}:1` : "-"}</span>`)}
        </div>

        <div class="plan-grid">
          ${renderPlan("long", plans.long)}
          ${renderPlan("short", plans.short)}
        </div>

        <ol class="reason-list">
          ${signal.reasons.slice(0, 3).map((reason) => `<li>${reason}</li>`).join("")}
        </ol>

        <ul class="warnings">
          ${signal.warnings.map((warning) => `<li>${warning}</li>`).join("")}
          <li>請等待價格接近進場區，不要追價。</li>
          <li>若價格先觸及停損區，訊號失效。</li>
          <li>資料延遲或 API 異常時請勿依賴訊號。</li>
        </ul>

        <details class="chart-details" data-chart-details data-coin-id="${signal.coinId}">
          <summary>K 線圖</summary>
          <canvas class="candle-chart" width="640" height="240" aria-label="${signal.symbol} K 線圖"></canvas>
          <p class="chart-empty">展開後載入 K 線；歷史不足時不繪製。</p>
        </details>

        <details>
          <summary>為什麼</summary>
          ${renderDetails(signal)}
        </details>
      </div>
    </article>
  `;
}

function bindCandleCharts(signals) {
  document.querySelectorAll("[data-chart-details]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open || details.dataset.chartReady) return;
      const signal = signals.find((item) => item.coinId === details.dataset.coinId);
      const rendered = renderCandleChart(details.querySelector("canvas"), signal?.candles || [], signal?.plans || {});
      const empty = details.querySelector(".chart-empty");
      if (rendered && empty) empty.hidden = true;
      details.dataset.chartReady = "true";
    });
  });
}

function renderPlan(key, plan = {}) {
  const isLong = key === "long";
  const entry = plan.entryZone ? `${plan.entryZone.low} - ${plan.entryZone.high}` : "-";
  const takeProfit = plan.takeProfit?.length ? plan.takeProfit.join(" / ") : "-";
  const prefix = isLong ? "long" : "short";
  const conditionLabels = { trend: "4h 趨勢", position: "1h 位置", rsi: "RSI14", momentum: "MACD" };
  const conditions = Object.entries(plan.conditions || {})
    .map(([name, passed]) => `<span class="condition ${passed ? "passed" : "failed"}">${conditionLabels[name] || name}：${passed ? "符合" : "不足"}</span>`)
    .join("");

  return `
    <section class="plan-box ${prefix}-plan" data-plan="${prefix}" data-plan-direction="${plan.direction || (isLong ? "做多" : "做空")}" data-plan-status="${plan.status || "資料不足"}" data-entry-low="${plan.entryZone?.low ?? ""}" data-entry-high="${plan.entryZone?.high ?? ""}" data-stop-loss="${plan.stopLoss ?? ""}" data-take-profit="${plan.takeProfit?.[0] ?? ""}">
      <div class="plan-head">
        <h4>${isLong ? "做多方案" : "做空方案"}</h4>
        <span class="plan-state" data-${prefix}-plan-state>${plan.planState || plan.status || "資料不足"}</span>
      </div>
      <div class="plan-meta">
        <span>條件分數 ${plan.score ?? 0}%</span>
        <span>進場 ${entry}</span>
        <span>停損 ${plan.stopLoss ?? "-"}</span>
        <span>止盈 ${takeProfit}</span>
      </div>
      <div class="conditions">${conditions || "資料不足"}</div>
    </section>
  `;
}

function metric(label, value) {
  return `
    <div class="metric">
      <span class="label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderDetails(signal) {
  return `<div class="analysis">
    ${(signal.details || []).map((detail) => `<p><strong>${detail.label}</strong>：${detail.value}<br><span class="label">${detail.sourceMode}／${detail.calculationMode}</span></p>`).join("") || "沒有可用的計算明細。"}
  </div>`;
}
