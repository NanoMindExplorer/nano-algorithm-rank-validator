/**
 * Optional Phoenix sidecar client.
 * Talks to a user-hosted local server that can wrap phoenix/run_pipeline.py
 * or return structured multi-action scores.
 *
 * Default endpoint: http://127.0.0.1:8787
 * API:
 *   GET  /health -> { ok, version, mode }
 *   POST /v1/score { tweet, context?, weights? } -> { phoenixScores, meta }
 *   POST /v1/score_batch { tweets: [...] } -> { results: [...] }
 */

(function (root) {
  "use strict";

  const DEFAULT_BASE = "http://127.0.0.1:8787";

  function normalizeBase(url) {
    if (!url) return DEFAULT_BASE;
    return String(url).replace(/\/+$/, "");
  }

  async function health(baseUrl, timeoutMs = 2500) {
    const base = normalizeBase(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/health`, {
        method: "GET",
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, base };
      const data = await res.json();
      return { ok: true, base, ...data };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, error: e.message || String(e), base };
    }
  }

  /**
   * Request sidecar scoring. Falls back is handled by caller.
   */
  async function scoreTweet(baseUrl, tweet, options = {}, timeoutMs = 8000) {
    const base = normalizeBase(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          tweet,
          context: {
            inNetwork: options.inNetwork,
            historyAffinity: options.historyAffinity,
            viewerId: options.viewerId,
          },
          weights: options.weights,
          params: options.params,
          profileId: options.profileId,
          history: options.history,
          mode: options.sidecarMode || options.mode,
        }),
      });
      clearTimeout(t);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Sidecar HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.phoenixScores && !data.scores) {
        throw new Error("Sidecar response missing phoenixScores");
      }
      return {
        phoenixScores: data.phoenixScores || data.scores,
        meta: data.meta || { mode: data.mode || "sidecar" },
        finalScore: data.finalScore,
        raw: data,
      };
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  async function scoreBatch(baseUrl, tweets, options = {}, timeoutMs = 20000) {
    const base = normalizeBase(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/score_batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ tweets, options }),
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`Sidecar batch HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  async function validateTweet(baseUrl, tweet, options = {}, timeoutMs = 10000) {
    const base = normalizeBase(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          tweet,
          context: {
            inNetwork: options.inNetwork,
            historyAffinity: options.historyAffinity,
            viewerId: options.viewerId,
          },
          profileId: options.profileId,
          weights: options.weights,
          params: options.params,
          history: options.history,
          mode: options.sidecarMode,
        }),
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`Sidecar validate HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  async function compareProfiles(baseUrl, tweet, options = {}, profiles, timeoutMs = 10000) {
    const base = normalizeBase(baseUrl);
    const res = await fetch(`${base}/v1/compare_profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tweet,
        context: {
          inNetwork: options.inNetwork,
          historyAffinity: options.historyAffinity,
        },
        profiles: profiles || undefined,
        mode: options.sidecarMode,
      }),
    });
    if (!res.ok) throw new Error(`Sidecar compare HTTP ${res.status}`);
    return res.json();
  }

  async function calibrate(baseUrl, history, timeoutMs = 8000) {
    const base = normalizeBase(baseUrl);
    const res = await fetch(`${base}/v1/calibrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
    });
    if (!res.ok) throw new Error(`Sidecar calibrate HTTP ${res.status}`);
    return res.json();
  }

  async function capabilities(baseUrl, timeoutMs = 3000) {
    const base = normalizeBase(baseUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/v1/capabilities`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  /**
   * Map sidecar phoenixScores into the shape expected by WeightedScorer.
   */
  function coercePhoenixScores(input) {
    if (!input || typeof input !== "object") return null;
    const pick = (...keys) => {
      for (const k of keys) {
        if (input[k] != null) return Number(input[k]);
      }
      return undefined;
    };
    return {
      favorite_score: pick("favorite_score", "favorite", "fav"),
      reply_score: pick("reply_score", "reply"),
      retweet_score: pick("retweet_score", "retweet", "repost_score", "repost"),
      photo_expand_score: pick("photo_expand_score", "photo_expand"),
      click_score: pick("click_score", "click"),
      profile_click_score: pick("profile_click_score", "profile_click"),
      vqv_score: pick("vqv_score", "vqv"),
      share_score: pick("share_score", "share"),
      share_via_dm_score: pick("share_via_dm_score", "share_via_dm"),
      share_via_copy_link_score: pick(
        "share_via_copy_link_score",
        "share_via_copy_link"
      ),
      dwell_score: pick("dwell_score", "dwell"),
      quote_score: pick("quote_score", "quote"),
      quoted_click_score: pick("quoted_click_score", "quoted_click"),
      quoted_vqv_score: pick("quoted_vqv_score", "quoted_vqv"),
      dwell_time: pick("dwell_time", "cont_dwell_time"),
      click_dwell_time: pick("click_dwell_time", "cont_click_dwell_time"),
      follow_author_score: pick("follow_author_score", "follow_author"),
      not_interested_score: pick("not_interested_score", "not_interested"),
      block_author_score: pick("block_author_score", "block_author"),
      mute_author_score: pick("mute_author_score", "mute_author"),
      report_score: pick("report_score", "report"),
      not_dwelled_score: pick("not_dwelled_score", "not_dwelled"),
      _meta: {
        mode: "sidecar",
        note: "Scores provided by user-hosted Phoenix sidecar",
        ...(input._meta || {}),
      },
    };
  }

  const NARVSidecar = {
    DEFAULT_BASE,
    health,
    scoreTweet,
    scoreBatch,
    validateTweet,
    compareProfiles,
    calibrate,
    capabilities,
    coercePhoenixScores,
    normalizeBase,
  };

  root.NARVSidecar = NARVSidecar;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVSidecar;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
