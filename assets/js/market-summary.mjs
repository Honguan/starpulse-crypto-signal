function percentage(count, total) {
  return total ? Math.round(count / total * 1000) / 10 : 0;
}

export function marketFor(signals) {
  const total = signals.length;
  const long = signals.filter((signal) => signal.primaryDirection === "做多" && signal.plans?.long?.status === "可執行").length;
  const short = signals.filter((signal) => signal.primaryDirection === "做空" && signal.plans?.short?.status === "可執行").length;
  const highRisk = signals.filter((signal) => signal.riskLevel === "高").length;
  const mediumRisk = signals.filter((signal) => signal.riskLevel === "中").length;
  const metrics = {
    total,
    long,
    short,
    neutral: total - long - short,
    highRisk,
    mediumRisk,
    lowRisk: total - highRisk - mediumRisk
  };
  for (const key of ["long", "short", "neutral", "highRisk", "mediumRisk", "lowRisk"]) {
    metrics[`${key}Pct`] = percentage(metrics[key], total);
  }

  const condition = total && (long - short) * 10 >= total ? "偏多" : total && (short - long) * 10 >= total ? "偏空" : "震盪";
  const riskLevel = metrics.highRiskPct >= 30
    ? "高"
    : metrics.highRiskPct < 10 && metrics.highRiskPct + metrics.mediumRiskPct < 30 ? "低" : "中";
  return { condition, riskLevel, metrics };
}
