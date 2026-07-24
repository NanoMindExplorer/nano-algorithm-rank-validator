/**
 * WeightedScorer — port of home-mixer/scorers/weighted_scorer.rs
 * and RankingScorer::compute_weighted_score from ranking_scorer.rs
 *
 * Final Score = Σ (weight_i × P(action_i))  + offset handling for negatives
 */

(function (root) {
  "use strict";

  function apply(score, weight) {
    const s = score == null ? 0 : Number(score);
    return s * Number(weight || 0);
  }

  function vqvWeightEligibility(candidate, weights, params) {
    const minMs = params.minVideoDurationMs != null ? params.minVideoDurationMs : 5000;
    const hasVideo = !!(candidate.hasVideo || (candidate.features && candidate.features.hasVideo));
    const duration =
      candidate.videoDurationMs != null
        ? candidate.videoDurationMs
        : candidate.features && candidate.features.videoDurationMs;

    if (hasVideo && (duration == null || duration > minMs)) {
      // If duration unknown but video present, still apply (optimistic client-side)
      if (duration == null || duration > minMs) return weights.vqv;
    }
    if (hasVideo && duration != null && duration > minMs) return weights.vqv;
    if (hasVideo && duration == null) return weights.vqv * 0.5; // partial credit
    return 0;
  }

  function quotedVqvWeight(candidate, weights, params) {
    if (!candidate.isQuote && !(candidate.features && candidate.features.isQuote)) return 0;
    const minMs = params.minVideoDurationMs != null ? params.minVideoDurationMs : 5000;
    const qDur = candidate.quotedVideoDurationMs;
    const enableCheck = params.enableQuotedVqvDurationCheck !== false;
    if (!enableCheck) return weights.quoted_vqv || 0;
    if (qDur == null) return (weights.quoted_vqv || 0) * 0.5;
    return qDur > minMs ? weights.quoted_vqv || 0 : 0;
  }

  /**
   * Port of RankingScorer::offset_score
   */
  function offsetScore(combinedScore, weights, params) {
    const sums = root.NARVWeights.weightSums(weights);
    const offset =
      params.negativeScoresOffset != null ? params.negativeScoresOffset : 0.01;

    if (sums.totalSum === 0) {
      return Math.max(0, combinedScore);
    }
    if (combinedScore < 0) {
      // (combined + negative_sum) / total_sum * NEGATIVE_SCORES_OFFSET
      return ((combinedScore + sums.negativeSum) / sums.totalSum) * offset;
    }
    return combinedScore + offset;
  }

  /**
   * Optional light normalization so UI scores are comparable.
   * Production uses util::score_normalizer::normalize_score (private).
   *
   * We map combined weighted sum into a ~0–1 display score using an
   * expected-high anchor (positive weight mass × typical high P≈0.22).
   * Soft clamp keeps excellent posts near 1.0 without hard saturation.
   */
  function normalizeScore(raw, weights) {
    const sums = root.NARVWeights.weightSums(weights);
    if (sums.positiveSum <= 0) return Math.max(0, raw);
    // Strong conversational posts often reach ~15–25% of positive mass
    const expectedHigh = Math.max(0.5, sums.positiveSum * 0.22);
    const x = Number(raw) / expectedHigh;
    // Smooth map: 0→0, 1→~0.76, 1.5→~0.91 (gentle ceiling)
    const mapped = x <= 0 ? 0 : x / (1 + 0.3 * x);
    return Math.max(0, Math.min(1.15, mapped));
  }

  /**
   * Compute weighted score from phoenix proxy scores + weights.
   * @returns {{ raw, offset, normalized, contributions }}
   */
  function computeWeightedScore(phoenixScores, weights, candidate = {}, params = {}) {
    const w = weights || root.NARVWeights.DEFAULT_WEIGHTS;
    const map = root.NARVPhoenix.scoresToWeightMap(phoenixScores);
    const vqvW = vqvWeightEligibility(candidate, w, params);
    const qVqvW = quotedVqvWeight(candidate, w, params);

    const contributions = {};

    function add(key, score, weight) {
      const value = apply(score, weight);
      contributions[key] = {
        probability: score == null ? 0 : Number(score),
        weight: Number(weight || 0),
        contribution: value,
      };
      return value;
    }

    let combined = 0;
    combined += add("favorite", map.favorite, w.favorite);
    combined += add("reply", map.reply, w.reply);
    combined += add("retweet", map.retweet, w.retweet);
    combined += add("photo_expand", map.photo_expand, w.photo_expand);
    combined += add("click", map.click, w.click);
    combined += add("profile_click", map.profile_click, w.profile_click);
    combined += add("vqv", map.vqv, vqvW);
    combined += add("share", map.share, w.share);
    combined += add("share_via_dm", map.share_via_dm, w.share_via_dm);
    combined += add("share_via_copy_link", map.share_via_copy_link, w.share_via_copy_link);
    combined += add("dwell", map.dwell, w.dwell);
    combined += add("quote", map.quote, w.quote);
    combined += add("quoted_click", map.quoted_click, w.quoted_click);
    combined += add("quoted_vqv", map.quoted_vqv, qVqvW);
    combined += add("cont_dwell_time", map.cont_dwell_time, w.cont_dwell_time);
    combined += add("cont_click_dwell_time", map.cont_click_dwell_time, w.cont_click_dwell_time);
    combined += add("follow_author", map.follow_author, w.follow_author);
    combined += add("not_interested", map.not_interested, w.not_interested);
    combined += add("block_author", map.block_author, w.block_author);
    combined += add("mute_author", map.mute_author, w.mute_author);
    combined += add("report", map.report, w.report);
    combined += add("not_dwelled", map.not_dwelled, w.not_dwelled);

    const offset = offsetScore(combined, w, params);
    const normalized = normalizeScore(offset, w);

    // Sort contributions by absolute impact
    const rankedContributions = Object.entries(contributions)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      raw: combined,
      offset,
      normalized,
      contributions,
      rankedContributions,
      vqvWeightApplied: vqvW,
      quotedVqvWeightApplied: qVqvW,
    };
  }

  const NARVWeightedScorer = {
    apply,
    computeWeightedScore,
    normalizeScore,
    offsetScore,
    vqvWeightEligibility,
  };

  root.NARVWeightedScorer = NARVWeightedScorer;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVWeightedScorer;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
