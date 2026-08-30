const MIN_HISTORY = 220;
const LONG = "做多";
const SHORT = "做空";
const READY = "可執行";
const WAITING = "等待條件";
const HOUR = 60 * 60 * 1000;
const FOUR_HOURS = 4 * HOUR;
const MIN_4H_HISTORY = 50;

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function emaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = current;
  const factor = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * factor + current * (1 - factor);
    result[index] = current;
  }
  return result;
}

export function ema(values, period) {
  return emaSeries(values, period).filter((value) => value !== null);
}

export function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  return averageLoss ? 100 - 100 / (1 + averageGain / averageLoss) : 100;
}

export function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (values.length < slowPeriod + signalPeriod - 1) return null;
  const fast = emaSeries(values, fastPeriod);
  const slow = emaSeries(values, slowPeriod);
  const rawLine = values.slice(slowPeriod - 1).map((_, index) => {
    const sourceIndex = index + slowPeriod - 1;
    return fast[sourceIndex] - slow[sourceIndex];
  });
  const signal = ema(rawLine, signalPeriod);
  const line = rawLine.slice(signalPeriod - 1);
  return { line, signal, histogram: line.map((value, index) => value - signal[index]) };
}

function volatility(values) {
  const recent = values.slice(-13);
  const changes = recent.slice(1).map((value, index) => Math.abs(value / recent[index] - 1));
  return Math.max(0.002, changes.reduce((sum, value) => sum + value, 0) / changes.length);
}

function levelsFor(direction, indicators, values, candles4h) {
  const center = indicators.ema1h20 || indicators.price;
  const recentVolatility = volatility(values);
  const entryWidth = center * recentVolatility * 0.25;
  const risk = center * recentVolatility * 1.5;
  const entryZone = { low: round(center - entryWidth), high: round(center + entryWidth) };
  const structureLow = Math.min(...candles4h.slice(-3).map((candle) => candle[3]));
  const structureHigh = Math.max(...candles4h.slice(-3).map((candle) => candle[2]));

  return direction === LONG
    ? {
      entryZone,
      stopLoss: round(Math.min(structureLow, center - risk)),
      takeProfit: [round(center + (center - Math.min(structureLow, center - risk)) * 1.5), round(center + (center - Math.min(structureLow, center - risk)) * 2.5)]
    }
    : {
      entryZone,
      stopLoss: round(Math.max(structureHigh, center + risk)),
      takeProfit: [round(center - (Math.max(structureHigh, center + risk) - center) * 1.5), round(center - (Math.max(structureHigh, center + risk) - center) * 2.5)]
    };
}

function emptyPlan(direction, status = "資料不足") {
  return {
    direction,
    score: 0,
    status,
    planState: status,
    entryZone: null,
    stopLoss: null,
    takeProfit: [],
    conditions: { trend: false, position: false, rsi: false, momentum: false }
  };
}

function planFor(direction, indicators, values, candles4h, evaluationPrice) {
  const longSide = direction === LONG;
  const conditions = longSide
    ? {
      trend: indicators.ema4h20 > indicators.ema4h50,
      position: indicators.price > indicators.ema1h20,
      rsi: indicators.rsi14 >= 45 && indicators.rsi14 <= 60,
      momentum: indicators.macd > indicators.macdSignal && indicators.histogramRising
    }
    : {
      trend: indicators.ema4h20 < indicators.ema4h50,
      position: indicators.price < indicators.ema1h20,
      rsi: indicators.rsi14 >= 40 && indicators.rsi14 <= 55,
      momentum: indicators.macd < indicators.macdSignal && !indicators.histogramRising
    };
  const weights = [40, 20, 20, 20];
  const score = Object.values(conditions).reduce((sum, passed, index) => sum + (passed ? weights[index] : 0), 0);
  const levels = levelsFor(direction, indicators, values, candles4h);
  const plan = { direction, score, status: score === 100 ? READY : WAITING, ...levels, conditions };
  plan.planState = planStateFor(plan, evaluationPrice);
  return { ...plan, riskReward: riskRewardFor(plan) };
}

function hasContinuousTail(rows, interval, minimum, width) {
  if (!Array.isArray(rows) || rows.length < minimum) return false;
  return rows.slice(-minimum).every((row, index, tail) => {
    if (!Array.isArray(row) || row.length < width || row[0] % interval !== 0) return false;
    if (!row.slice(1, width).every((value) => Number.isFinite(Number(value)) && Number(value) > 0)) return false;
    return !index || row[0] - tail[index - 1][0] === interval;
  });
}

function emptyStrategy(status) {
  const plans = { long: emptyPlan(LONG, status), short: emptyPlan(SHORT, status) };
  return { plans, primaryDirection: "觀望", indicators: {}, direction: "觀望", planState: status, entryZone: null, stopLoss: null, takeProfit: [] };
}

export function planStateFor(plan, price) {
  if (plan?.status !== READY) return plan?.status || WAITING;
  if (!plan.entryZone || !Number.isFinite(Number(price))) return "資料不足";

  if (plan.direction === LONG) {
    if (price <= plan.stopLoss) return "停損失效";
    if (price >= plan.takeProfit[0]) return "已到止盈區";
  } else {
    if (price >= plan.stopLoss) return "停損失效";
    if (price <= plan.takeProfit[0]) return "已到止盈區";
  }

  return price >= plan.entryZone.low && price <= plan.entryZone.high ? "可進場" : "等待回踩";
}

export function riskRewardFor(plan, targetIndex = 1) {
  if (plan?.status !== READY || plan.planState === "停損失效" || !plan.entryZone || !plan.takeProfit?.[targetIndex]) return null;
  const entry = (Number(plan.entryZone.low) + Number(plan.entryZone.high)) / 2;
  const risk = plan.direction === LONG ? entry - Number(plan.stopLoss) : Number(plan.stopLoss) - entry;
  const reward = plan.direction === LONG ? Number(plan.takeProfit[targetIndex]) - entry : entry - Number(plan.takeProfit[targetIndex]);
  return risk > 0 && reward > 0 ? round(reward / risk, 2) : null;
}

export function actionableDirectionFor(plans) {
  const qualified = Object.values(plans).filter((plan) =>
    plan.score === 100
      && plan.status === READY
      && !["停損失效", "已到止盈區"].includes(plan.planState));
  return qualified.length === 1 ? qualified[0].direction : "觀望";
}

export function strategyFor(hourly, candles4h, currentPrice, now = Date.now()) {
  if (hourly.length < MIN_HISTORY || candles4h.length < MIN_4H_HISTORY) return emptyStrategy("資料不足");
  const expected1h = Math.floor(now / HOUR) * HOUR;
  const expected4h = Math.floor(now / FOUR_HOURS) * FOUR_HOURS;
  if (!hasContinuousTail(hourly, HOUR, MIN_HISTORY, 2)
      || !hasContinuousTail(candles4h, FOUR_HOURS, MIN_4H_HISTORY, 5)
      || hourly.at(-1)[0] !== expected1h
      || candles4h.at(-1)[0] !== expected4h) return emptyStrategy("資料不連續");

  const hourlyInput = hourly.slice(-MIN_HISTORY);
  const candles4hInput = candles4h.slice(-MIN_4H_HISTORY);
  const closes = hourlyInput.map((item) => number(item[1]));
  const closes4h = candles4hInput.map((item) => number(item[4]));
  const price = closes.at(-1);
  const evaluationPrice = number(currentPrice) || price;
  const ema4h20 = ema(closes4h, 20).at(-1);
  const ema4h50 = ema(closes4h, 50).at(-1);
  const ema1h20 = ema(closes, 20).at(-1);
  const currentRsi = rsi(closes);
  const currentMacd = macd(closes);
  if (currentRsi === null || !currentMacd) return emptyStrategy("資料不足");
  const last = currentMacd.histogram.length - 1;
  const indicators = {
    price,
    asOf1h: hourlyInput.at(-1)[0],
    asOf4h: candles4hInput.at(-1)[0],
    intervals: { indicators: HOUR, trend: FOUR_HOURS },
    ema4h20,
    ema4h50,
    ema1h20,
    rsi14: currentRsi,
    macd: currentMacd.line[last],
    macdSignal: currentMacd.signal[last],
    histogramRising: currentMacd.histogram[last] > currentMacd.histogram[last - 1],
    volatility: volatility(closes) * 100
  };
  const plans = {
    long: planFor(LONG, indicators, closes, candles4hInput, evaluationPrice),
    short: planFor(SHORT, indicators, closes, candles4hInput, evaluationPrice)
  };
  const primaryDirection = actionableDirectionFor(plans);
  const primary = primaryDirection === LONG ? plans.long : primaryDirection === SHORT ? plans.short : null;

  return {
    plans,
    primaryDirection,
    indicators: Object.fromEntries(Object.entries(indicators).map(([key, value]) => [key, typeof value === "number" ? round(value, key === "rsi14" ? 2 : 6) : value])),
    direction: primaryDirection,
    planState: primary?.planState || WAITING,
    entryZone: primary?.entryZone || null,
    stopLoss: primary?.stopLoss || null,
    takeProfit: primary?.takeProfit || []
  };
}
