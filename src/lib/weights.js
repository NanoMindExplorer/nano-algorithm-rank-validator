/**
 * Nano Algorithm Rank Validator — Scoring Weights
 *
 * Derived from xai-org/x-algorithm:
 *   - home-mixer/scorers/weighted_scorer.rs
 *   - home-mixer/scorers/ranking_scorer.rs
 *   - phoenix/run_pipeline.py (demo weights)
 *   - phoenix/runners.py ACTIONS list
 *
 * Production numeric weights live in a private params module and are NOT
 * shipped with the open-source release. Defaults below combine:
 *   1) Demo pipeline weights from phoenix/run_pipeline.py
 *   2) Empirical 2023–2026 engagement hierarchy
 *   3) Relative magnitudes consistent with RankingScorer formula structure
 *
 * Users can override every weight from the Options page.
 */

(function (root) {
  "use strict";

  /** All Phoenix multi-action prediction targets (from runners.py ACTIONS + continuous). */
  const ACTION_KEYS = [
    "favorite",
    "reply",
    "retweet",
    "photo_expand",
    "click",
    "profile_click",
    "vqv",
    "share",
    "share_via_dm",
    "share_via_copy_link",
    "dwell",
    "quote",
    "quoted_click",
    "quoted_vqv",
    "cont_dwell_time",
    "cont_click_dwell_time",
    "follow_author",
    "not_interested",
    "block_author",
    "mute_author",
    "report",
    "not_dwelled",
  ];

  /**
   * Default weights used by WeightedScorer / RankingScorer.
   * Positive → boost reach; negative → suppress (block/mute/report/not_interested).
   *
   * Demo baseline (run_pipeline.py): fav=1.0, reply=0.5, rt=0.3, dwell=0.2
   * Extended with hierarchy: replies/conversation > reposts > likes > passive.
   */
  const DEFAULT_WEIGHTS = {
    // Positive engagement
    favorite: 1.0,
    reply: 13.5, // historically highest; conversation drives distribution
    retweet: 1.0,
    photo_expand: 0.4,
    click: 0.5,
    profile_click: 1.2,
    vqv: 0.8, // video quality view (gated by MIN_VIDEO_DURATION_MS)
    share: 2.0,
    share_via_dm: 1.5,
    share_via_copy_link: 1.0,
    dwell: 0.5,
    quote: 2.5,
    quoted_click: 0.6,
    quoted_vqv: 0.5,
    cont_dwell_time: 0.3,
    cont_click_dwell_time: 0.2,
    follow_author: 4.0,

    // Negative feedback (negative weights push score down)
    not_interested: -8.0,
    block_author: -24.0,
    mute_author: -16.0,
    report: -30.0,
    not_dwelled: -0.5,
  };

  /** Pipeline constants from open-source scorers / filters. */
  const DEFAULT_PARAMS = {
    // AuthorDiversityScorer: multiplier = (1 - floor) * decay^position + floor
    authorDiversityDecay: 0.6,
    authorDiversityFloor: 0.25,

    // OONScorer: out-of-network score *= factor
    oonWeightFactor: 0.75,
    topicOonWeightFactor: 0.9,
    newUserOonWeightFactor: 1.0,
    newUserMinFollowing: 5,
    newUserAgeThresholdSecs: 7 * 24 * 3600,

    // VQV eligibility (weighted_scorer.rs / candidates_util)
    minVideoDurationMs: 5000,

    // AgeFilter — posts older than this are dropped pre-score
    maxPostAgeHours: 48,

    // RankingScorer offset for negative combined scores
    negativeScoresOffset: 0.01,

    // Premium reach multipliers (empirical, not in open-source params)
    premiumInNetworkMultiplier: 4.0,
    premiumOonMultiplier: 2.0,

    // Phoenix proxy temperature / calibration
    proxyTemperature: 1.0,
    proxyBaseEngagement: 0.08,
  };

  const WEIGHT_META = {
    favorite: { label: "Favorite / Like", group: "positive", code: "FAVORITE_WEIGHT" },
    reply: { label: "Reply", group: "positive", code: "REPLY_WEIGHT" },
    retweet: { label: "Repost / Retweet", group: "positive", code: "RETWEET_WEIGHT" },
    photo_expand: { label: "Photo Expand", group: "positive", code: "PHOTO_EXPAND_WEIGHT" },
    click: { label: "Post Click", group: "positive", code: "CLICK_WEIGHT" },
    profile_click: { label: "Profile Click", group: "positive", code: "PROFILE_CLICK_WEIGHT" },
    vqv: { label: "Video Quality View", group: "positive", code: "VQV_WEIGHT" },
    share: { label: "Share", group: "positive", code: "SHARE_WEIGHT" },
    share_via_dm: { label: "Share via DM", group: "positive", code: "SHARE_VIA_DM_WEIGHT" },
    share_via_copy_link: {
      label: "Share via Copy Link",
      group: "positive",
      code: "SHARE_VIA_COPY_LINK_WEIGHT",
    },
    dwell: { label: "Dwell (binary)", group: "positive", code: "DWELL_WEIGHT" },
    quote: { label: "Quote", group: "positive", code: "QUOTE_WEIGHT" },
    quoted_click: { label: "Quoted Click", group: "positive", code: "QUOTED_CLICK_WEIGHT" },
    quoted_vqv: { label: "Quoted VQV", group: "positive", code: "QUOTED_VQV_WEIGHT" },
    cont_dwell_time: {
      label: "Continuous Dwell Time",
      group: "positive",
      code: "CONT_DWELL_TIME_WEIGHT",
    },
    cont_click_dwell_time: {
      label: "Click Dwell Time",
      group: "positive",
      code: "CONT_CLICK_DWELL_TIME_WEIGHT",
    },
    follow_author: { label: "Follow Author", group: "positive", code: "FOLLOW_AUTHOR_WEIGHT" },
    not_interested: {
      label: "Not Interested",
      group: "negative",
      code: "NOT_INTERESTED_WEIGHT",
    },
    block_author: { label: "Block Author", group: "negative", code: "BLOCK_AUTHOR_WEIGHT" },
    mute_author: { label: "Mute Author", group: "negative", code: "MUTE_AUTHOR_WEIGHT" },
    report: { label: "Report", group: "negative", code: "REPORT_WEIGHT" },
    not_dwelled: { label: "Not Dwelled", group: "negative", code: "NOT_DWELLED_WEIGHT" },
  };

  function cloneDefaults() {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      params: { ...DEFAULT_PARAMS },
    };
  }

  /**
   * Compute positive / negative / total weight sums (RankingScorer::from_params).
   */
  function weightSums(weights) {
    const w = weights || DEFAULT_WEIGHTS;
    const positiveKeys = [
      "favorite",
      "reply",
      "retweet",
      "photo_expand",
      "click",
      "profile_click",
      "vqv",
      "share",
      "share_via_dm",
      "share_via_copy_link",
      "dwell",
      "quote",
      "quoted_click",
      "quoted_vqv",
      "follow_author",
    ];
    const negativeKeys = [
      "not_interested",
      "block_author",
      "mute_author",
      "report",
      "not_dwelled",
    ];

    let positiveSum = 0;
    for (const k of positiveKeys) positiveSum += Number(w[k] || 0);

    // RankingScorer stores negative_sum as -(sum of negative weights)
    // when weights themselves are negative numbers, we treat them as signed.
    let negRaw = 0;
    for (const k of negativeKeys) negRaw += Number(w[k] || 0);

    // If user stores negative weights as negative numbers:
    const negativeSum =
      negRaw < 0 ? -negRaw : Math.abs(negRaw); // magnitude of negative contribution capacity
    const signedNegativeSum = negRaw < 0 ? negRaw : -Math.abs(negRaw);

    return {
      positiveSum,
      negativeSum: Math.abs(signedNegativeSum),
      signedNegativeSum,
      totalSum: positiveSum + Math.abs(signedNegativeSum),
    };
  }

  // Expose globally for content scripts (non-module injection order)
  const NARVWeights = {
    ACTION_KEYS,
    DEFAULT_WEIGHTS,
    DEFAULT_PARAMS,
    WEIGHT_META,
    cloneDefaults,
    weightSums,
  };

  root.NARVWeights = NARVWeights;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVWeights;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
