import { describeCandleChart, renderCandleChart } from "./candle-chart.mjs";
import { loadCandles } from "./candle-data.mjs";
import { formatLocalTimestamp } from "./data-freshness.mjs";

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

const COIN_ID = /^[a-z0-9][a-z0-9._~-]{0,127}$/i;
const LIVE_PAIR = /^[A-Z0-9]+USDT$/;
const PLAN_DIRECTIONS = new Set(["做多", "做空", "觀望"]);
const PLAN_STATUSES = new Set(["可執行", "等待條件", "資料不足"]);
let chartObservers = [];

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  Object.entries(options.dataset || {}).forEach(([key, value]) => {
    node.dataset[key] = String(value);
  });
  Object.entries(options.attributes || {}).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  node.append(...children);
  return node;
}

function safeDataValue(value, pattern) {
  const text = String(value || "");
  return pattern.test(text) ? text : "";
}

export function renderDashboard(data, options = "") {
  chartObservers.forEach((observer) => observer.disconnect());
  chartObservers = [];
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
  bindCandleCharts(visibleSignals, data.updatedAt);
}

function renderStatus(data) {
  const status = {
    status: data.status === "normal" ? "正常" : "異常",
    freshness: data.freshness?.label || "未知",
    websocket: "連線中…",
    updatedAt: formatLocalTimestamp(data.updatedAt),
    condition: data.market.condition,
    riskLevel: data.market.riskLevel,
    btcDirection: data.market.btcDirection,
    ethDirection: data.market.ethDirection,
    source: data.strategySource || (data.live ? "即時策略資料" : "備援快照")
  };

  document.querySelector("#status").replaceChildren(...Object.entries(status).map(([key, value]) => element("div", { className: "status-item" }, [
    element("span", { className: "label", text: statusLabels[key] }),
    element("span", { className: "value", text: value, dataset: { statusValue: key } })
  ])));
}

function renderMarket(market) {
  document.querySelector("#market").replaceChildren(element("div", { className: "market-grid" }, [
    marketItem("市場狀態", market.condition),
    marketItem("市場風險", market.riskLevel),
    element("div", { className: "market-card market-summary" }, [
      element("span", { className: "label", text: "摘要" }),
      element("strong", { text: market.summary })
    ])
  ]));
}

function marketItem(label, value) {
  return element("div", { className: "market-card" }, [
    element("span", { className: "label", text: label }),
    element("strong", { text: value })
  ]);
}

function renderCards(selector, signals, favoriteCoinIds = new Set()) {
  const root = document.querySelector(selector);
  root.replaceChildren(...(signals.length
    ? signals.map((signal) => renderCard(signal, favoriteCoinIds))
    : [element("p", { className: "empty", text: "目前沒有符合條件的訊號。" })]));
}

function renderCard(signal, favoriteCoinIds) {
  const isFavorite = favoriteCoinIds.has(signal.coinId);
  const strategy = signal.strategy || {};
  const plans = signal.plans || {};
  const primary = signal.primaryDirection === "做空" ? plans.short : plans.long;
  const conditionScore = Math.max(plans.long?.score || 0, plans.short?.score || 0);
  const coinId = safeDataValue(signal.coinId, COIN_ID);
  const livePair = safeDataValue(signal.liveInstrument?.symbol, LIVE_PAIR);
  const reasons = element("ol", { className: "reason-list" }, [
    `做多方案：${plans.long?.status || "資料不足"}（${plans.long?.score || 0}%）`,
    `做空方案：${plans.short?.status || "資料不足"}（${plans.short?.score || 0}%）`,
    `1h RSI14：${strategy.indicators?.rsi14 ?? "-"}`
  ].map((reason) => element("li", { text: reason })));
  const warnings = element("ul", { className: "warnings" }, [
    element("li", { text: strategy.planState === "資料不足" ? "歷史資料不足，暫不提供進出場計畫。" : "僅供市場分析，不構成投資建議。" }),
    element("li", { text: "請等待價格接近進場區，不要追價。" }),
    element("li", { text: "若價格先觸及停損區，訊號失效。" }),
    element("li", { text: "資料延遲或 API 異常時請勿依賴訊號。" })
  ]);
  const chartDetails = element("details", { className: "chart-details", dataset: { chartDetails: "", coinId } }, [
    element("summary", { text: "K 線圖" }),
    element("ul", { className: "chart-legend", attributes: { "aria-label": "K 線圖例" } }, [
      ["ema20", "EMA20（實線）"], ["ema50", "EMA50（虛線）"], ["long", "做多計畫（長虛線）"], ["short", "做空計畫（點線）"]
    ].map(([className, text]) => element("li", {}, [
      element("span", { className: `chart-line ${className}`, attributes: { "aria-hidden": "true" } }),
      document.createTextNode(text)
    ]))),
    element("canvas", { className: "candle-chart", attributes: { "aria-label": `${signal.symbol} K 線圖；下方提供完整文字摘要。`, role: "img" } }),
    element("p", { className: "chart-empty", text: "展開後載入 K 線；歷史不足時不繪製。" }),
    element("p", { className: "chart-summary", text: "K 線文字摘要將在資料載入後顯示。", attributes: { "aria-live": "polite" } })
  ]);

  return element("article", {
    className: "card",
    dataset: { coinId, livePair, snapshotPrice: Number.isFinite(signal.price) ? signal.price : "" }
  }, [
    element("div", { className: "card-head" }, [
      element("div", {}, [
        element("h3", { className: "symbol", text: signal.symbol }),
        element("span", { className: "asset" }, [
          element("span", { text: `${signal.name}／${signal.coinId}` }),
          element("span", { text: signal.price, dataset: { livePrice: "" } }),
          element("span", { text: `${signal.change24h}%`, dataset: { liveChange: "" } })
        ])
      ]),
      element("button", {
        className: `favorite-toggle${isFavorite ? " active" : ""}`,
        text: "★",
        dataset: { coinId },
        attributes: { type: "button", "aria-label": `切換 ${signal.name} 最愛` }
      }),
      element("span", { className: "label", text: signal.liveMode === "websocket" && livePair ? `${livePair} 即時` : "快照模式" }),
      element("span", { className: `badge ${directionClass[signal.primaryDirection] || "watch"}`, text: signal.primaryDirection || "觀望" })
    ]),
    element("div", { className: "card-body" }, [
      element("div", { className: "metrics" }, [
        metric("條件", `${conditionScore}%`),
        metric("RSI", strategy.indicators?.rsi14 ?? "-"),
        metric("主要狀態", strategy.planState || "資料延遲", "planState"),
        metric("主要 RR", primary?.riskReward ? `${primary.riskReward}:1` : "-", "planRr")
      ]),
      element("div", { className: "plan-grid" }, [renderPlan("long", plans.long), renderPlan("short", plans.short)]),
      reasons,
      warnings,
      chartDetails,
      element("details", {}, [element("summary", { text: "為什麼" }), renderDetails(signal)])
    ])
  ]);
}

function bindCandleCharts(signals, version) {
  document.querySelectorAll("[data-chart-details]").forEach((details) => {
    details.addEventListener("toggle", async () => {
      if (!details.open || details.dataset.chartReady) return;
      const signal = signals.find((item) => item.coinId === details.dataset.coinId);
      details.dataset.chartReady = "loading";
      const empty = details.querySelector(".chart-empty");
      const summary = details.querySelector(".chart-summary");
      try {
        const candles = signal?.hasCandles ? await loadCandles(signal.coinId, version) : [];
        const canvas = details.querySelector("canvas");
        const plans = signal?.plans || {};
        const rendered = renderCandleChart(canvas, candles, plans);
        if (rendered && empty) empty.hidden = true;
        if (rendered && summary) summary.textContent = describeCandleChart(candles, plans);
        if (rendered && typeof globalThis.ResizeObserver === "function") {
          const observer = new globalThis.ResizeObserver(() => renderCandleChart(canvas, candles, plans));
          observer.observe(canvas);
          chartObservers.push(observer);
        }
        details.dataset.chartReady = "true";
      } catch {
        if (empty) empty.textContent = "K 線資料載入失敗。";
        delete details.dataset.chartReady;
      }
    });
  });
}

function renderPlan(key, plan = {}) {
  const isLong = key === "long";
  const entry = plan.entryZone ? `${plan.entryZone.low} - ${plan.entryZone.high}` : "-";
  const takeProfit = plan.takeProfit?.length ? plan.takeProfit.join(" / ") : "-";
  const prefix = isLong ? "long" : "short";
  const planDirection = PLAN_DIRECTIONS.has(plan.direction) ? plan.direction : isLong ? "做多" : "做空";
  const planStatus = PLAN_STATUSES.has(plan.status) ? plan.status : "資料不足";
  const conditionLabels = { trend: "4h 趨勢", position: "1h 位置", rsi: "RSI14", momentum: "MACD" };
  const conditions = Object.entries(plan.conditions || {}).map(([name, passed]) => element("span", {
    className: `condition ${passed ? "passed" : "failed"}`,
    text: `${conditionLabels[name] || name}：${passed ? "符合" : "不足"}`
  }));

  return element("section", {
    className: `plan-box ${prefix}-plan`,
    dataset: {
      plan: prefix,
      planDirection,
      planStatus,
      entryLow: Number.isFinite(plan.entryZone?.low) ? plan.entryZone.low : "",
      entryHigh: Number.isFinite(plan.entryZone?.high) ? plan.entryZone.high : "",
      stopLoss: Number.isFinite(plan.stopLoss) ? plan.stopLoss : "",
      takeProfit: Number.isFinite(plan.takeProfit?.[0]) ? plan.takeProfit[0] : ""
    }
  }, [
    element("div", { className: "plan-head" }, [
      element("h4", { text: isLong ? "做多方案" : "做空方案" }),
      element("span", { className: "plan-state", text: plan.planState || plan.status || "資料不足", dataset: { [`${prefix}PlanState`]: "" } })
    ]),
    element("div", { className: "plan-meta" }, [
      element("span", { text: `條件分數 ${plan.score ?? 0}%` }),
      element("span", { text: `進場 ${entry}` }),
      element("span", { text: `停損 ${plan.stopLoss ?? "-"}` }),
      element("span", { text: `止盈 ${takeProfit}` })
    ]),
    element("div", { className: "conditions", text: conditions.length ? undefined : "資料不足" }, conditions)
  ]);
}

function metric(label, value, marker) {
  const dataset = marker ? { [marker]: "" } : {};
  return element("div", { className: "metric" }, [
    element("span", { className: "label", text: label }),
    element("strong", { text: value, dataset })
  ]);
}

function renderDetails(signal) {
  const indicators = signal.strategy?.indicators || {};
  const details = [
    { label: "4h EMA20／EMA50", value: `${indicators.ema4h20 ?? "-"}／${indicators.ema4h50 ?? "-"}`, calculationMode: "4h close EMA(20,50)" },
    { label: "1h EMA20", value: indicators.ema1h20 ?? "-", calculationMode: "1h close EMA(20)" },
    { label: "1h RSI14", value: indicators.rsi14 ?? "-", calculationMode: "1h close RSI(14)" },
    { label: "1h MACD", value: `${indicators.macd ?? "-"}／${indicators.macdSignal ?? "-"}`, calculationMode: "1h close MACD(12,26,9)" }
  ].map((detail) => element("p", {}, [
    element("strong", { text: detail.label }),
    document.createTextNode(`：${detail.value}`),
    element("br"),
    element("span", { className: "label", text: `${signal.sourceMode}／${detail.calculationMode}` })
  ]));
  return element("div", { className: "analysis" }, details);
}
