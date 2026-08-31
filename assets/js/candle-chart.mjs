function ema(values, period) {
  const factor = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index ? value * factor + result[index - 1] * (1 - factor) : value);
    return result;
  }, []);
}

function priceLabel(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 6 }).format(value);
}

function timeLabel(value, full = false) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat(undefined, full
    ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { month: "2-digit", day: "2-digit", hour: "2-digit" }).format(timestamp);
}

function planLevels(plan) {
  return [
    ["進場低", plan?.entryZone?.low],
    ["進場高", plan?.entryZone?.high],
    ["停損", plan?.stopLoss],
    ...(plan?.takeProfit || []).map((value, index) => [`止盈${index + 1}`, value])
  ].filter(([, value]) => value !== null && value !== "" && Number.isFinite(Number(value))).map(([label, value]) => [label, Number(value)]);
}

export function describeCandleChart(candles, plans = {}) {
  if (!Array.isArray(candles) || !candles.length) return "沒有可用的 K 線資料。";
  const first = candles[0];
  const latest = candles.at(-1);
  const planText = [["做多", plans.long], ["做空", plans.short]].map(([direction, plan]) => {
    const levels = planLevels(plan).map(([label, value]) => `${label} ${priceLabel(value)}`).join("、");
    return `${direction}：${levels || "無計畫價位"}`;
  }).join("；");
  return `可視時間 ${timeLabel(first[0], true)} 至 ${timeLabel(latest[0], true)}；最新 K 線開 ${priceLabel(Number(latest[1]))}、高 ${priceLabel(Number(latest[2]))}、低 ${priceLabel(Number(latest[3]))}、收 ${priceLabel(Number(latest[4]))}；${planText}。`;
}

export function renderCandleChart(canvas, candles, plans = {}, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  if (!canvas || !Array.isArray(candles) || candles.length < 2) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;

  const dpr = Math.max(1, Number(devicePixelRatio) || 1);
  const width = Math.max(240, Math.round(canvas.getBoundingClientRect?.().width || canvas.clientWidth || canvas.width / dpr || 640));
  const height = Math.max(200, Math.min(280, Math.round(width * 0.375)));
  if (canvas.style) canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padding = { top: 12, right: 72, bottom: 32, left: 12 };
  const candleValues = candles.flatMap((candle) => candle.slice(1, 5).map(Number));
  const candleMin = Math.min(...candleValues);
  const candleMax = Math.max(...candleValues);
  const candleRange = Math.max(candleMax - candleMin, Math.abs(candleMax) * 0.001, 0.000001);
  const min = candleMin - candleRange * 0.05;
  const max = candleMax + candleRange * 0.05;
  const range = max - min;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const y = (value) => padding.top + (max - value) / range * plotHeight;
  const xStep = plotWidth / candles.length;
  const bodyWidth = Math.max(2, xStep * 0.55);

  context.clearRect(0, 0, width, height);
  drawAxes(context, candles, min, max, y, width, height, padding);
  candles.forEach(([, open, high, low, close], index) => {
    const x = padding.left + xStep * index + xStep / 2;
    const top = Math.min(y(open), y(close));
    const bodyHeight = Math.max(1, Math.abs(y(open) - y(close)));
    context.beginPath();
    context.moveTo(x, y(high));
    context.lineTo(x, y(low));
    context.strokeStyle = close >= open ? "#0f766e" : "#be123c";
    context.stroke();
    context.fillStyle = close >= open ? "#14b8a6" : "#fb7185";
    context.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
  });

  const closes = candles.map((candle) => Number(candle[4]));
  drawIndicator(context, ema(closes, 20), y, xStep, padding, "#b45309", []);
  drawIndicator(context, ema(closes, 50), y, xStep, padding, "#6d28d9", [7, 3]);
  drawPlanLevels(context, plans.long, y, "#0f766e", width, padding, "多", [6, 3], min, max);
  drawPlanLevels(context, plans.short, y, "#be123c", width, padding, "空", [2, 3], min, max);
  return true;
}

function drawAxes(context, candles, min, max, y, width, height, padding) {
  context.font = "11px system-ui, sans-serif";
  context.lineWidth = 1;
  [max, (max + min) / 2, min].forEach((value) => {
    const position = y(value);
    context.beginPath();
    context.setLineDash([2, 4]);
    context.moveTo(padding.left, position);
    context.lineTo(width - padding.right, position);
    context.strokeStyle = "#d1d5db";
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#4b5563";
    context.textAlign = "left";
    context.fillText(priceLabel(value), width - padding.right + 6, position + 4);
  });
  [0, Math.floor((candles.length - 1) / 2), candles.length - 1].forEach((index, labelIndex) => {
    context.fillStyle = "#4b5563";
    context.textAlign = ["left", "center", "right"][labelIndex];
    const x = labelIndex === 0 ? padding.left : labelIndex === 1 ? (padding.left + width - padding.right) / 2 : width - padding.right;
    context.fillText(timeLabel(candles[index][0]), x, height - 9);
  });
}

function drawIndicator(context, values, y, xStep, padding, color, dash) {
  context.beginPath();
  context.setLineDash(dash);
  values.forEach((value, index) => {
    const x = padding.left + xStep * index + xStep / 2;
    if (!index) context.moveTo(x, y(value));
    else context.lineTo(x, y(value));
  });
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke();
  context.setLineDash([]);
}

function drawPlanLevels(context, plan, y, color, width, padding, prefix, dash, min, max) {
  planLevels(plan).filter(([, level]) => level >= min && level <= max).forEach(([label, level]) => {
    const position = y(level);
    context.beginPath();
    context.setLineDash(dash);
    context.moveTo(padding.left, position);
    context.lineTo(width - padding.right, position);
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = color;
    context.textAlign = "left";
    context.fillText(`${prefix}${label}`, padding.left + 3, position - 3);
  });
}
