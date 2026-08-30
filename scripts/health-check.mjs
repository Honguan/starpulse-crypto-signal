import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { freshnessFor } from "../assets/js/data-freshness.mjs";
import { validateSignalPayload } from "../assets/js/signal-schema.mjs";
import { fetchJson } from "./api-request.mjs";

const LIVE_DATA_URL = "https://raw.githubusercontent.com/Honguan/starpulse-crypto-signal/live-data/data/signals.json";

export function assertFreshPayload(payload, now = Date.now()) {
  validateSignalPayload(payload);
  const freshness = freshnessFor(payload.updatedAt, now);
  if (freshness.state !== "fresh") {
    const error = new Error(`live data is ${freshness.state} (${Math.floor(freshness.age / 60_000)} minutes old)`);
    error.state = freshness.state;
    throw error;
  }
  return freshness;
}

export async function checkLiveData(now = Date.now(), fetchImpl = fetch) {
  const payload = await fetchJson(`${LIVE_DATA_URL}?t=${now}`, { fetchImpl, label: "live-data heartbeat" });
  return assertFreshPayload(payload, now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const freshness = await checkLiveData();
    const message = `Live data healthy: ${Math.floor(freshness.age / 60_000)} minutes old.`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live signal freshness\n\n${message}\n`);
  } catch (error) {
    const message = `Live data freshness failed: ${error.message}`;
    console.error(`::error title=Live signal freshness::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Live signal freshness\n\n❌ ${message}\n`);
    process.exitCode = 1;
  }
}
