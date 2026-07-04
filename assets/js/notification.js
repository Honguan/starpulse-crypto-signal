export function getStrongNotifications(data) {
  return data.signals.filter((signal) =>
    ["強烈做多", "強烈做空"].includes(signal.direction) ||
    signal.winRate > 65 ||
    signal.rr > 2 ||
    signal.ev > 0
  );
}
