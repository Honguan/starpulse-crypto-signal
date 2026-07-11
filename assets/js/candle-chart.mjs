function levelValues(plans) {
  return Object.values(plans || {}).flatMap((plan) => [
    plan?.entryZone?.low,
    plan?.entryZone?.high,
    plan?.stopLoss,
    ...(plan?.takeProfit || [])
  ]).filter((value) => Number.isFinite(Number(value))).map(Number);
}

function ema(values, period) {
  const factor = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index ? value * factor + result[index - 1] * (1 - factor) : value);
    return result;
  }, []);
}

export function renderCandleChart(canvas, candles, plans = {}) {
  if (!canvas || !Array.isArray(candles) || candles.length < 2) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;

  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 12, right: 12, bottom: 18, left: 12 };
  const values = candles.flatMap((candle) => candle.slice(1, 5).map(Number)).concat(levelValues(plans));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, max * 0.001, 0.000001);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const y = (value) => padding.top + (max - value) / range * plotHeight;
  const xStep = plotWidth / candles.length;
  const bodyWidth = Math.max(2, xStep * 0.55);

  context.clearRect(0, 0, width, height);
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

  drawIndicator(context, ema(candles.map((candle) => Number(candle[4])), 20), y, xStep, padding, "#f59f00");
  drawIndicator(context, ema(candles.map((candle) => Number(candle[4])), 50), y, xStep, padding, "#7c3aed");
  drawPlanLevels(context, plans.long, y, "#0f766e", width, padding);
  drawPlanLevels(context, plans.short, y, "#be123c", width, padding);
  return true;
}

function drawIndicator(context, values, y, xStep, padding, color) {
  context.beginPath();
  values.forEach((value, index) => {
    const x = padding.left + xStep * index + xStep / 2;
    if (!index) context.moveTo(x, y(value));
    else context.lineTo(x, y(value));
  });
  context.strokeStyle = color;
  context.globalAlpha = 0.8;
  context.stroke();
  context.globalAlpha = 1;
}

function drawPlanLevels(context, plan, y, color, width, padding) {
  if (!plan) return;
  const levels = [plan.entryZone?.low, plan.entryZone?.high, plan.stopLoss, ...(plan.takeProfit || [])]
    .filter((value) => Number.isFinite(Number(value))).map(Number);
  levels.forEach((level) => {
    context.beginPath();
    context.setLineDash([4, 4]);
    context.moveTo(padding.left, y(level));
    context.lineTo(width - padding.right, y(level));
    context.strokeStyle = color;
    context.globalAlpha = 0.45;
    context.stroke();
    context.globalAlpha = 1;
    context.setLineDash([]);
  });
}
