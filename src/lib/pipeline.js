/**
 * End-to-end validation pipeline orchestrator.
 * Mirrors For You stages from xai-org/x-algorithm README:
 *
 *   Query Hydration → Sources → Hydration → Filters →
 *   Phoenix Scorer → Weighted Scorer → Author Diversity → OON → Selection
 */

(function (root) {
  "use strict";

  const PIPELINE_STAGES = [
    {
      id: "query_hydration",
      name: "Query Hydration",
      description: "Viewer context, engagement history, following list",
    },
    {
      id: "candidate_sourcing",
      name: "Candidate Sourcing",
      description: "Thunder (in-network) + Phoenix Retrieval (OON)",
    },
    {
      id: "candidate_hydration",
      name: "Candidate Hydration",
      description: "Core data, author, media, engagement counts",
    },
    {
      id: "pre_scoring_filters",
      name: "Pre-Scoring Filters",
      description: "Age, self, dupes, social graph, muted keywords, seen",
    },
    {
      id: "phoenix_scorer",
      name: "Phoenix Scorer",
      description: "Grok transformer multi-action P(engagement) predictions",
    },
    {
      id: "weighted_scorer",
      name: "Weighted Scorer",
      description: "Σ weight_i × P(action_i) + negative offset",
    },
    {
      id: "author_diversity",
      name: "Author Diversity",
      description: "Exponential decay for repeated authors",
    },
    {
      id: "oon_scorer",
      name: "OON Scorer",
      description: "Out-of-network weight factor",
    },
    {
      id: "selection",
      name: "Selection",
      description: "Sort by final score, top-K",
    },
    {
      id: "post_selection",
      name: "Post-Selection Filters",
      description: "VF visibility + conversation dedup",
    },
  ];

  /**
   * Resolve weights/params from profile + overrides.
   */
  function resolveConfig(options = {}) {
    const defaults = root.NARVWeights.cloneDefaults();
    let weights = { ...defaults.weights, ...(options.weights || {}) };
    let params = { ...defaults.params, ...(options.params || {}) };
    let profileId = options.profileId || "balanced";
    let profileName = options.profileName || "Balanced (default)";

    if (root.NARVProfiles && options.profileId) {
      const resolved = root.NARVProfiles.resolve(options.profileId, {
        weights: options.weights,
        params: options.params,
      });
      weights = resolved.weights;
      params = resolved.params;
      profileId = resolved.profileId;
      profileName = resolved.profileName;
    } else if (root.NARVProfiles && !options.weights) {
      const resolved = root.NARVProfiles.resolve(profileId, {
        params: options.params,
      });
      weights = resolved.weights;
      params = { ...resolved.params, ...(options.params || {}) };
      profileName = resolved.profileName;
    }

    return { weights, params, profileId, profileName };
  }

  /**
   * Validate a single tweet against the full algorithm pipeline.
   * options.phoenixScores — optional precomputed heads (sidecar)
   * options.scorerMode — "proxy" | "sidecar"
   */
  function validateTweet(tweet, options = {}) {
    const { weights, params, profileId, profileName } = resolveConfig(options);
    const context = {
      inNetwork: options.inNetwork != null ? options.inNetwork : true,
      viewerId: options.viewerId || null,
      historyAffinity:
        options.historyAffinity != null ? options.historyAffinity : 0.55,
      blockedAuthorIds: options.blockedAuthorIds || [],
      mutedAuthorIds: options.mutedAuthorIds || [],
      mutedKeywords: options.mutedKeywords || [],
      topicIds: options.topicIds || [],
      isEligibleNewUser: !!options.isEligibleNewUser,
      canViewSubscription: options.canViewSubscription !== false,
      videoOnlyFeed: !!options.videoOnlyFeed,
    };

    const stages = [];
    const t0 = performance.now();

    // Stage: candidate hydration (features)
    const features = root.NARVFeatures.extractFeatures(tweet);
    stages.push({
      id: "candidate_hydration",
      status: "ok",
      ms: 0,
      summary: `Extracted ${Object.keys(features).length} feature fields`,
    });

    // Stage: pre + post filters
    const filterReport = root.NARVFilters.runFilters(
      tweet,
      features,
      params,
      context
    );
    stages.push({
      id: "pre_scoring_filters",
      status: filterReport.passed ? "ok" : "fail",
      summary: filterReport.summary,
      filterReport,
    });

    // Stage: Phoenix heads (proxy or sidecar-provided)
    let phoenixScores;
    let scorerMode = options.scorerMode || "proxy";
    if (options.phoenixScores) {
      phoenixScores = root.NARVSidecar
        ? root.NARVSidecar.coercePhoenixScores(options.phoenixScores) ||
          options.phoenixScores
        : options.phoenixScores;
      scorerMode = options.scorerMode || "sidecar";
      stages.push({
        id: "phoenix_scorer",
        status: "sidecar",
        summary: "Multi-action scores from Phoenix sidecar",
        phoenixScores,
      });
    } else {
      phoenixScores = root.NARVPhoenix.predictPhoenixScores(
        features,
        params,
        context
      );
      stages.push({
        id: "phoenix_scorer",
        status: "proxy",
        summary: `Quality P≈${((phoenixScores._meta?.qualityProb || 0) * 100).toFixed(1)}% (proxy)`,
        phoenixScores,
      });
    }

    // Stage: Weighted scorer
    const candidate = {
      ...tweet,
      features,
      hasVideo: features.hasVideo,
      isQuote: features.isQuote,
      videoDurationMs: features.videoDurationMs,
      inNetwork: context.inNetwork,
      authorPremium: features.isPremium,
      authorVerified: features.isVerified,
    };

    const weighted = root.NARVWeightedScorer.computeWeightedScore(
      phoenixScores,
      weights,
      candidate,
      params
    );
    stages.push({
      id: "weighted_scorer",
      status: "ok",
      summary: `Raw=${weighted.raw.toFixed(4)} → offset=${weighted.offset.toFixed(4)} → norm=${weighted.normalized.toFixed(4)}`,
      weighted,
    });

    // Stage: diversity + OON + premium
    const ranking = root.NARVRanking.rankSingle(
      candidate,
      weighted,
      params,
      context
    );
    stages.push({
      id: "author_diversity",
      status: "ok",
      summary: `×${ranking.diversity.multiplier.toFixed(3)} (author pos ${ranking.diversity.authorPosition})`,
    });
    stages.push({
      id: "oon_scorer",
      status: "ok",
      summary: context.inNetwork
        ? "In-network — OON factor 1.0"
        : `OON factor ×${ranking.oonFactor}`,
    });
    stages.push({
      id: "selection",
      status: "ok",
      summary: `Final score ${ranking.finalScore.toFixed(4)} · Grade ${ranking.grade.letter}`,
    });

    const insights = root.NARVFeatures.buildInsights(features, ranking);

    // Signal health breakdown for UI
    const positiveTop = weighted.rankedContributions
      .filter((c) => c.contribution > 0)
      .slice(0, 6);
    const negativeTop = weighted.rankedContributions
      .filter((c) => c.contribution < 0)
      .slice(0, 4);

    const elapsed = performance.now() - t0;
    const isProxy = scorerMode !== "sidecar";

    return {
      version: "1.2.0",
      algorithm: isProxy
        ? "xai-org/x-algorithm (client proxy)"
        : "xai-org/x-algorithm (sidecar + WeightedScorer)",
      scorerMode,
      profileId,
      profileName,
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round(elapsed * 100) / 100,
      tweet: {
        tweetId: tweet.tweetId,
        authorId: tweet.authorId,
        authorHandle: tweet.authorHandle,
        text: (tweet.text || "").slice(0, 500),
        url: tweet.url,
      },
      context: {
        inNetwork: context.inNetwork,
        historyAffinity: context.historyAffinity,
      },
      features,
      filterReport,
      phoenixScores,
      weighted,
      ranking,
      insights,
      positiveTop,
      negativeTop,
      stages,
      grade: ranking.grade,
      finalScore: ranking.finalScore,
      displayScore: Math.round(Math.min(100, ranking.finalScore * 100)),
      pipelineStages: PIPELINE_STAGES,
      disclaimer: isProxy
        ? "Phoenix P(action) values are client-side proxies. Production uses a Grok-based transformer with user engagement history. Exact production weight magnitudes are not public."
        : "Phoenix heads came from your local sidecar; WeightedScorer / diversity / OON still run in-extension using configured weights.",
    };
  }

  /**
   * Async path: try sidecar when enabled, else local proxy.
   */
  async function validateTweetAsync(tweet, options = {}) {
    if (
      options.useSidecar &&
      root.NARVSidecar &&
      options.sidecarUrl
    ) {
      try {
        const remote = await root.NARVSidecar.scoreTweet(
          options.sidecarUrl,
          tweet,
          options
        );
        return validateTweet(tweet, {
          ...options,
          phoenixScores: remote.phoenixScores,
          scorerMode: "sidecar",
        });
      } catch (e) {
        const report = validateTweet(tweet, {
          ...options,
          scorerMode: "proxy",
        });
        report.sidecarError = e.message || String(e);
        report.stages = report.stages || [];
        report.stages.unshift({
          id: "sidecar_fallback",
          status: "fail",
          summary: `Sidecar failed — fell back to proxy: ${report.sidecarError}`,
        });
        return report;
      }
    }
    return validateTweet(tweet, options);
  }

  /**
   * Score free-text draft (compose box) without live engagement.
   */
  function validateDraft(text, meta = {}, options = {}) {
    const tweet = {
      tweetId: meta.tweetId || null,
      authorId: meta.authorId || "draft",
      authorHandle: meta.authorHandle || "you",
      text: text || "",
      hasMedia: !!meta.hasMedia,
      hasImage: !!meta.hasImage,
      hasVideo: !!meta.hasVideo,
      hasGif: !!meta.hasGif,
      hasPoll: !!meta.hasPoll,
      hasExternalLink: /https?:\/\//i.test(text || ""),
      isReply: !!meta.isReply,
      isQuote: !!meta.isQuote,
      isThread: !!meta.isThread,
      threadLength: meta.threadLength || 1,
      authorFollowers: meta.authorFollowers || 0,
      authorVerified: !!meta.authorVerified,
      authorPremium: !!meta.authorPremium,
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
      quoteCount: 0,
      viewCount: 0,
      videoDurationMs: meta.videoDurationMs || null,
      ageHours: 0.01,
    };
    return validateTweet(tweet, { ...options, inNetwork: true });
  }

  async function validateDraftAsync(text, meta = {}, options = {}) {
    const tweet = {
      tweetId: meta.tweetId || null,
      authorId: meta.authorId || "draft",
      authorHandle: meta.authorHandle || "you",
      text: text || "",
      hasMedia: !!meta.hasMedia,
      hasImage: !!meta.hasImage,
      hasVideo: !!meta.hasVideo,
      hasGif: !!meta.hasGif,
      hasPoll: !!meta.hasPoll,
      hasExternalLink: /https?:\/\//i.test(text || ""),
      isReply: !!meta.isReply,
      isQuote: !!meta.isQuote,
      isThread: !!meta.isThread,
      threadLength: meta.threadLength || 1,
      authorFollowers: meta.authorFollowers || 0,
      authorVerified: !!meta.authorVerified,
      authorPremium: !!meta.authorPremium,
      likeCount: 0,
      replyCount: 0,
      repostCount: 0,
      quoteCount: 0,
      viewCount: 0,
      videoDurationMs: meta.videoDurationMs || null,
      ageHours: 0.01,
    };
    return validateTweetAsync(tweet, { ...options, inNetwork: true });
  }

  const NARVPipeline = {
    PIPELINE_STAGES,
    resolveConfig,
    validateTweet,
    validateTweetAsync,
    validateDraft,
    validateDraftAsync,
  };

  root.NARVPipeline = NARVPipeline;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVPipeline;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
