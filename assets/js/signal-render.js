const directionClass = {
  "強烈做多": "strong-long",
  "做多": "long",
  "做空": "short",
  "強烈做空": "strong-short",
  "觀望": "watch"
};

const statusLabels = {
  status: "資料狀態",
  live: "LIVE 狀態",
  updatedAt: "最後更新",
  condition: "目前市場",
  riskLevel: "市場風險",
  btcDirection: "BTC 方向",
  ethDirection: "ETH 方向"
};

export function renderDashboard(data, options = "") {
  renderStatus(data);
  renderMarket(data.market);

  const settings = typeof options === "string" ? { symbolFilter: options } : options;
  const favoriteSymbols = settings.favoriteSymbols || new Set();
  const symbolFilter = settings.symbolFilter || "";
  const normalizedFilter = symbolFilter.trim().toUpperCase();
  const signals = data.signals.filter((signal) => {
    const matchesSymbol = !normalizedFilter || signal.symbol.includes(normalizedFilter);
    const matchesFavorite = !settings.favoriteOnly || favoriteSymbols.has(signal.symbol);
    return matchesSymbol && matchesFavorite;
  });
  const byRank = (a, b) =>
    b.confidence - a.confidence || b.ev - a.ev || b.rr - a.rr || b.winRate - a.winRate;

  renderCards("#long-list", signals
    .filter((signal) => ["強烈做多", "做多"].includes(signal.direction))
    .sort(byRank)
    .slice(0, 5), favoriteSymbols);

  renderCards("#short-list", signals
    .filter((signal) => ["強烈做空", "做空"].includes(signal.direction))
    .sort(byRank)
    .slice(0, 5), favoriteSymbols);

  renderCards("#watch-list", signals
    .filter((signal) => signal.direction === "觀望")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), favoriteSymbols);

  const highRiskSymbols = new Set((data.highRisk || []).map((item) => item.symbol));
  renderCards("#risk-list", signals
    .filter((signal) => signal.riskLevel === "高" || highRiskSymbols.has(signal.symbol)), favoriteSymbols);
}

function renderStatus(data) {
  const status = {
    status: data.status === "normal" ? "正常" : "異常",
    live: data.live ? "LIVE" : "OFFLINE",
    updatedAt: data.updatedAt,
    condition: data.market.condition,
    riskLevel: data.market.riskLevel,
    btcDirection: data.market.btcDirection,
    ethDirection: data.market.ethDirection
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
      ${marketItem("BTC Vegas", market.btcVegas)}
      ${marketItem("ETH Vegas", market.ethVegas)}
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

function renderCards(selector, signals, favoriteSymbols = new Set()) {
  const root = document.querySelector(selector);
  root.innerHTML = signals.length
    ? signals.map((signal) => renderCard(signal, favoriteSymbols)).join("")
    : '<p class="empty">目前沒有符合條件的訊號。</p>';
}

function renderCard(signal, favoriteSymbols) {
  const isFavorite = favoriteSymbols.has(signal.symbol);
  return `
    <article class="card" data-symbol="${signal.symbol}">
      <div class="card-head">
        <div>
          <h3 class="symbol">${signal.symbol}</h3>
          <span class="asset">
            <span>${signal.baseAsset}</span>
            <span data-live-price>${signal.price}</span>
            <span data-live-change>${signal.change24h}%</span>
          </span>
        </div>
        <button class="favorite-toggle ${isFavorite ? "active" : ""}" type="button" data-symbol="${signal.symbol}" aria-label="切換 ${signal.symbol} 最愛">★</button>
        <span class="badge ${directionClass[signal.direction] || "watch"}">${signal.direction}</span>
      </div>
      <div class="card-body">
        <div class="metrics">
          ${metric("信心", `${signal.confidence}%`)}
          ${metric("勝率", `${signal.winRate}%`)}
          ${metric("EV", `${signal.ev > 0 ? "+" : ""}${signal.ev}%`)}
          ${metric("RR", `${signal.rr}:1`)}
        </div>

        <div class="trade-box">
          <span>週期：${signal.timeframe}</span>
          <span>風險：${signal.riskLevel}</span>
          <span>進場：${signal.entryZone.low} - ${signal.entryZone.high}</span>
          <span>停損：${signal.stopLoss}</span>
          <span>止盈：${signal.takeProfit.join(" / ")}</span>
          <span>Vegas：${signal.vegas.text}</span>
          <span>九轉：${signal.tdSequential.riskText}</span>
          <span>更新：${signal.updatedAt}</span>
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

        <details>
          <summary>詳細分析</summary>
          ${renderDetails(signal)}
        </details>
      </div>
    </article>
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
  const scores = Object.entries(signal.detailScores)
    .map(([key, value]) => `<span>${key}：${value}</span>`)
    .join("");

  const analysis = Object.entries(signal.analysis)
    .map(([key, value]) => `<p><strong>${key}</strong>：${value}</p>`)
    .join("");

  return `
    <div class="detail-grid">${scores}</div>
    <div class="analysis">${analysis}</div>
  `;
}
