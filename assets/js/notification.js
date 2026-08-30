export function getStrongNotifications(data) {
  return data.signals.filter((signal) => ["強烈做多", "強烈做空"].includes(signal.direction));
}
