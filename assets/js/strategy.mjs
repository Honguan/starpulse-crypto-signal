const MIN_HISTORY = 220;

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
  if (values.length <= period) {
    return 50;
  }

  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  if (!losses) {
    return 100;
  }
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
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
  const recent = values.slice(-15);
  const changes = recent.slice(1).map((value, index) => Math.abs(value / recent[index] - 1));
  return Math.max(0.002, changes.reduce((sum, value) => sum + value, 0) / changes.length);
}

function levelsFor(price, direction, recentVolatility) {
  const entryWidth = price * recentVolatility * 0.25;
  const risk = price * recentVolatility * 1.5;
  const longSide = direction === "做多";

  return longSide
    ? {
      entryZone: { low: round(price - entryWidth), high: round(price + entryWidth) },
      stopLoss: round(price - risk),
      takeProfit: [round(price + risk * 1.5), round(price + risk * 2.5)]
    }
    : {
      entryZone: { low: round(price - entryWidth), high: round(price + entryWidth) },
      stopLoss: round(price + risk),
      takeProfit: [round(price - risk * 1.5), round(price - risk * 2.5)]
    };
}

export function planStateFor(plan, price) {
  if (!plan?.entryZone || !Number.isFinite(Number(price)) || !["做多", "做空"].includes(plan.direction)) {
    return "觀望";
  }

  if (plan.direction === "做多") {
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
    return { direction: "觀望", planState: "資料不足", indicators: {}, entryZone: null, stopLoss: null, takeProfit: [] };
  }

  const closes4h = fourHourly(closes);
  const ema20 = ema(closes4h, 20).at(-1);
  const ema50 = ema(closes4h, 50).at(-1);
  const currentRsi = rsi(closes);
  const currentMacd = macd(closes);
  const last = currentMacd.histogram.length - 1;
  const bullish = ema20 > ema50 && price > ema50 && currentRsi >= 45 && currentRsi <= 60
    && currentMacd.line[last] > currentMacd.signal[last] && currentMacd.histogram[last] > currentMacd.histogram[last - 1];
  const bearish = ema20 < ema50 && price < ema50 && currentRsi >= 40 && currentRsi <= 55
    && currentMacd.line[last] < currentMacd.signal[last] && currentMacd.histogram[last] < currentMacd.histogram[last - 1];
  const direction = bullish ? "做多" : bearish ? "做空" : "觀望";
  const recentVolatility = volatility(closes);
  const levels = direction === "觀望" ? { entryZone: null, stopLoss: null, takeProfit: [] } : levelsFor(price, direction, recentVolatility);
  const plan = { direction, ...levels };

  return {
    ...plan,
    planState: direction === "觀望" ? "觀望" : planStateFor(plan, price),
    indicators: {
      ema20: round(ema20),
      ema50: round(ema50),
      rsi14: round(currentRsi, 2),
      macd: round(currentMacd.line[last]),
      macdSignal: round(currentMacd.signal[last]),
      volatility: round(recentVolatility * 100, 2)
    }
  };
}
