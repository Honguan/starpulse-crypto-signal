const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;

export class ApiRequestError extends Error {
  constructor(classification, message, { status, retryable = false } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.classification = classification;
    this.status = status;
    this.retryable = retryable;
  }
}

function retryAfterMs(response, now) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
  return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, delay || 0));
}

function delayFor(attempt, response, random, now) {
  return retryAfterMs(response, now)
    || Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt + Math.floor(random() * 500));
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchJson(url, {
  fetchImpl = fetch,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  sleepImpl = sleep,
  random = Math.random,
  now = Date.now,
  label = "API request"
} = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const classification = error?.name === "TimeoutError" ? "timeout" : "network";
      if (attempt < retries) {
        await sleepImpl(delayFor(attempt, {}, random, now));
        continue;
      }
      throw new ApiRequestError(classification, `${label} ${classification}`, { retryable: true });
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new ApiRequestError("malformed-json", `${label} returned malformed JSON`);
      }
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) {
      await sleepImpl(delayFor(attempt, response, random, now));
      continue;
    }
    throw new ApiRequestError(response.status === 429 ? "rate-limit" : response.status >= 500 ? "upstream" : "http", `${label} failed: HTTP ${response.status}`, { status: response.status, retryable });
  }
}
