/**
 * RankingScorer + AuthorDiversityScorer + OONScorer
 * Ports of:
 *   home-mixer/scorers/ranking_scorer.rs
 *   home-mixer/scorers/author_diversity_scorer.rs
 *   home-mixer/scorers/oon_scorer.rs
 */

(function (root) {
  "use strict";

  /**
   * Author diversity multiplier for the N-th post by same author in ranked list.
   * multiplier = (1 - floor) * decay^position + floor
   */
  function diversityMultiplier(decay, floor, position) {
    return (1 - floor) * Math.pow(decay, position) + floor;
  }

  /**
   * Apply author diversity to a list of candidates sorted by weighted score.
   * Returns adjusted final scores aligned to input order.
   */
  function applyAuthorDiversity(candidates, weightedScores, params = {}) {
    const decay =
      params.authorDiversityDecay != null ? params.authorDiversityDecay : 0.6;
    const floor =
      params.authorDiversityFloor != null ? params.authorDiversityFloor : 0.25;

    const indexed = weightedScores.map((s, i) => ({ i, s }));
    indexed.sort((a, b) => b.s - a.s);

    const adjusted = new Array(candidates.length).fill(0);
    const authorCounts = new Map();
    const details = new Array(candidates.length);

    for (const { i, s } of indexed) {
      const authorId = String(
        candidates[i].authorId || candidates[i].author_id || "unknown"
      );
      const position = authorCounts.get(authorId) || 0;
      authorCounts.set(authorId, position + 1);
      const mult = diversityMultiplier(decay, floor, position);
      adjusted[i] = s * mult;
      details[i] = {
        authorId,
        authorPosition: position,
        multiplier: mult,
        before: s,
        after: adjusted[i],
      };
    }

    return { scores: adjusted, details };
  }

  /**
   * OON weight factor (out-of-network posts scaled down).
   */
  function effectiveOonWeight(params = {}, context = {}) {
    if (context.topicIds && context.topicIds.length) {
      return params.topicOonWeightFactor != null
        ? params.topicOonWeightFactor
        : 0.9;
    }
    if (context.isEligibleNewUser) {
      return params.newUserOonWeightFactor != null
        ? params.newUserOonWeightFactor
        : 1.0;
    }
    return params.oonWeightFactor != null ? params.oonWeightFactor : 0.75;
  }

  function applyOon(score, candidate, params, context) {
    const inNetwork =
      candidate.inNetwork != null
        ? candidate.inNetwork
        : context.inNetwork != null
          ? context.inNetwork
          : true;

    if (inNetwork === false) {
      return score * effectiveOonWeight(params, context);
    }
    return score;
  }

  /**
   * Premium reach multipliers (empirical, not open-source constants).
   */
  function applyPremium(score, candidate, params, context) {
    const premium =
      candidate.authorPremium ||
      candidate.authorVerified ||
      (candidate.features && candidate.features.isPremium);
    if (!premium) return score;

    const inNetwork =
      candidate.inNetwork != null
        ? candidate.inNetwork
        : context.inNetwork !== false;

    const mult = inNetwork
      ? params.premiumInNetworkMultiplier || 4
      : params.premiumOonMultiplier || 2;

    // Soft application: we blend rather than hard-multiply the whole score
    // so UI remains interpretable (full 4x would dominate normalized scale).
    const soft = 1 + (mult - 1) * 0.08;
    return Math.min(1.12, score * soft);
  }

  /**
   * Full ranking pass for a single candidate (validation use-case).
   */
  function rankSingle(candidate, weightedResult, params = {}, context = {}) {
    const weighted = weightedResult.normalized;
    const diversity = applyAuthorDiversity(
      [candidate],
      [weighted],
      params
    );
    let score = diversity.scores[0];
    const afterDiversity = score;
    score = applyOon(score, candidate, params, context);
    const afterOon = score;
    score = applyPremium(score, candidate, params, context);

    return {
      weightedScore: weighted,
      weightedRaw: weightedResult.offset,
      afterDiversity,
      afterOon,
      finalScore: score,
      diversity: diversity.details[0],
      oonFactor:
        candidate.inNetwork === false
          ? effectiveOonWeight(params, context)
          : 1.0,
      grade: gradeScore(score),
    };
  }

  /**
   * Rank a batch of candidates (feed simulation).
   */
  function rankBatch(candidates, weightedResults, params = {}, context = {}) {
    const weighted = weightedResults.map((w) => w.normalized);
    const diversity = applyAuthorDiversity(candidates, weighted, params);

    const ranked = candidates.map((c, i) => {
      let score = diversity.scores[i];
      score = applyOon(score, c, params, context);
      score = applyPremium(score, c, params, context);
      return {
        index: i,
        candidate: c,
        weightedScore: weighted[i],
        finalScore: score,
        diversity: diversity.details[i],
        grade: gradeScore(score),
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    ranked.forEach((r, rank) => {
      r.rank = rank + 1;
    });
    return ranked;
  }

  function gradeScore(score) {
    if (score >= 0.85) return { letter: "A+", label: "Excellent reach potential", color: "#00ba7c" };
    if (score >= 0.7) return { letter: "A", label: "Strong For You candidate", color: "#00ba7c" };
    if (score >= 0.55) return { letter: "B", label: "Solid — good distribution chance", color: "#1d9bf0" };
    if (score >= 0.4) return { letter: "C", label: "Average — optimize replies & media", color: "#ffd400" };
    if (score >= 0.25) return { letter: "D", label: "Weak — risk of low OON reach", color: "#ff7a00" };
    return { letter: "F", label: "Poor — filter risk or negative signals", color: "#f4212e" };
  }

  const NARVRanking = {
    diversityMultiplier,
    applyAuthorDiversity,
    effectiveOonWeight,
    applyOon,
    applyPremium,
    rankSingle,
    rankBatch,
    gradeScore,
  };

  root.NARVRanking = NARVRanking;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVRanking;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
