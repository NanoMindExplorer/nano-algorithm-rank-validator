/**
 * Twitter/X Snowflake ID utilities.
 * Tweet IDs encode creation time: (id >> 22) + TWITTER_EPOCH_MS
 * Used by AgeFilter (home-mixer/filters/age_filter.rs).
 */

(function (root) {
  "use strict";

  const TWITTER_EPOCH_MS = 1288834974657n;

  function parseTweetId(id) {
    if (id == null || id === "") return null;
    try {
      return BigInt(String(id).replace(/\D/g, ""));
    } catch {
      return null;
    }
  }

  function tweetIdToTimestampMs(id) {
    const bid = parseTweetId(id);
    if (bid == null || bid <= 0n) return null;
    return Number((bid >> 22n) + TWITTER_EPOCH_MS);
  }

  function tweetAgeMs(id, nowMs = Date.now()) {
    const ts = tweetIdToTimestampMs(id);
    if (ts == null) return null;
    return Math.max(0, nowMs - ts);
  }

  function tweetAgeHours(id, nowMs = Date.now()) {
    const ms = tweetAgeMs(id, nowMs);
    return ms == null ? null : ms / (1000 * 60 * 60);
  }

  function formatAge(id, nowMs = Date.now()) {
    const ms = tweetAgeMs(id, nowMs);
    if (ms == null) return "unknown";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  const NARVSnowflake = {
    TWITTER_EPOCH_MS: Number(TWITTER_EPOCH_MS),
    parseTweetId,
    tweetIdToTimestampMs,
    tweetAgeMs,
    tweetAgeHours,
    formatAge,
  };

  root.NARVSnowflake = NARVSnowflake;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVSnowflake;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
