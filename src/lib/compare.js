/**
 * A/B profile comparison — score one tweet under multiple weight profiles.
 */

(function (root) {
  "use strict";

  const DEFAULT_PROFILES = [
    "balanced",
    "conversation",
    "media",
    "news",
    "viral",
  ];

  /**
   * Compare profiles locally (extension pipeline).
   */
  function compareLocal(tweet, baseOptions = {}, profileIds = DEFAULT_PROFILES) {
    if (!root.NARVPipeline) throw new Error("NARVPipeline missing");
    const results = [];
    for (const profileId of profileIds) {
      const report = root.NARVPipeline.validateTweet(tweet, {
        ...baseOptions,
        profileId,
        // don't force full weight override — let resolveConfig use profile
        weights: baseOptions.lockWeights ? baseOptions.weights : undefined,
      });
      results.push({
        profileId,
        profileName: report.profileName,
        finalScore: report.finalScore,
        grade: report.grade,
        raw: report.weighted?.raw,
        normalized: report.weighted?.normalized,
        positiveTop: report.positiveTop?.slice(0, 3) || [],
        report,
      });
    }
    results.sort((a, b) => b.finalScore - a.finalScore);
    results.forEach((r, i) => {
      r.rank = i + 1;
    });
    return {
      tweet: {
        tweetId: tweet.tweetId,
        authorHandle: tweet.authorHandle,
        text: (tweet.text || "").slice(0, 200),
      },
      comparisons: results,
      winner: results[0]?.profileId || null,
      generatedAt: new Date().toISOString(),
      mode: "local",
    };
  }

  /**
   * Compare via sidecar /v1/compare_profiles when available.
   */
  async function compareRemote(tweet, baseOptions = {}, profileIds = DEFAULT_PROFILES) {
    const base = (baseOptions.sidecarUrl || "http://127.0.0.1:8787").replace(
      /\/+$/,
      ""
    );
    const res = await fetch(`${base}/v1/compare_profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tweet,
        context: {
          inNetwork: baseOptions.inNetwork,
          historyAffinity: baseOptions.historyAffinity,
        },
        profiles: profileIds,
        mode: baseOptions.sidecarMode || undefined,
      }),
    });
    if (!res.ok) throw new Error(`Sidecar compare HTTP ${res.status}`);
    const data = await res.json();
    return {
      tweet: {
        tweetId: tweet.tweetId,
        authorHandle: tweet.authorHandle,
        text: (tweet.text || "").slice(0, 200),
      },
      comparisons: (data.comparisons || []).map((c) => ({
        ...c,
        grade: c.grade,
      })),
      winner: data.winner,
      phoenixScores: data.phoenixScores,
      meta: data.meta,
      generatedAt: new Date().toISOString(),
      mode: "sidecar",
    };
  }

  async function compare(tweet, baseOptions = {}, profileIds = DEFAULT_PROFILES) {
    if (baseOptions.useSidecar && baseOptions.sidecarUrl) {
      try {
        return await compareRemote(tweet, baseOptions, profileIds);
      } catch (e) {
        const local = compareLocal(tweet, baseOptions, profileIds);
        local.sidecarError = e.message || String(e);
        local.mode = "local-fallback";
        return local;
      }
    }
    return compareLocal(tweet, baseOptions, profileIds);
  }

  const NARVCompare = {
    DEFAULT_PROFILES,
    compareLocal,
    compareRemote,
    compare,
  };

  root.NARVCompare = NARVCompare;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVCompare;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
