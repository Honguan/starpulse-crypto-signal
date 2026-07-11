const MIN_HISTORY = 220;
const LONG = "做多";
const SHORT = "做空";
const READY = "可執行";
const WAITING = "等待條件";

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function ema(values, period) {
  const factor = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index ? value * factor + result[index - 1] * (1 - factor) : value);
    return result;
  }, []);
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = ema(line, 9);
  const histogram = line.map((value, index) => value - signal[index]);
  return { line, signal, histogram };
}

function fourHourly(values) {
  return values.filter((_, index) => (index + 1) % 4 === 0);
}

function volatility(values) {
  const recent = values.slice(-13);
  const changes = recent.slice(1).map((value, index) => Math.abs(value / recent[index] - 1));
  return Math.max(0.002, changes.reduce((sum, value) => sum + value, 0) / changes.length);
}

function levelsFor(direction, indicators, values) {
  const center = indicators.ema1h20 || indicators.price;
  const recentVolatility = volatility(values);
  const entryWidth = center * recentVolatility * 0.25;
  const risk = center * recentVolatility * 1.5;
  const entryZone = { low: round(center - entryWidth), high: round(center + entryWidth) };
  const structureLow = Math.min(...values.slice(-12));
  const structureHigh = Math.max(...values.slice(-12));

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

function planFor(direction, indicators, values) {
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
  const levels = levelsFor(direction, indicators, values);
  const plan = { direction, score, status: score === 100 ? READY : WAITING, ...levels, conditions };
  return { ...plan, planState: planStateFor(plan, indicators.price) };
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

export function strategyFor(history, currentPrice) {
  const closes = history.map((item) => number(Array.isArray(item) ? item[1] : item)).filter((value) => value > 0);
  const price = number(currentPrice) || closes.at(-1);

  if (closes.length < MIN_HISTORY || !price) {
    const plans = { long: emptyPlan(LONG, "資料不足"), short: emptyPlan(SHORT, "資料不足") };
    return { plans, primaryDirection: "觀望", indicators: {}, direction: "觀望", planState: "資料不足", entryZone: null, stopLoss: null, takeProfit: [] };
  }

  const closes4h = fourHourly(closes);
  const ema4h20 = ema(closes4h, 20).at(-1);
  const ema4h50 = ema(closes4h, 50).at(-1);
  const ema1h20 = ema(closes, 20).at(-1);
  const currentRsi = rsi(closes);
  const currentMacd = macd(closes);
  const last = currentMacd.histogram.length - 1;
  const indicators = {
    price,
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
    long: planFor(LONG, indicators, closes),
    short: planFor(SHORT, indicators, closes)
  };
  const primary = plans.long.score >= plans.short.score ? plans.long : plans.short;
  const primaryDirection = primary.direction;

  return {
    plans,
    primaryDirection,
    indicators: Object.fromEntries(Object.entries(indicators).map(([key, value]) => [key, typeof value === "boolean" ? value : round(value, key === "rsi14" ? 2 : 6)])),
    direction: primaryDirection,
    planState: primary.planState,
    entryZone: primary.entryZone || null,
    stopLoss: primary.stopLoss || null,
    takeProfit: primary.takeProfit || []
  };
}
