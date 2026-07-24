/**
 * Phoenix Proxy — client-side engagement probability estimator.
 *
 * Production Phoenix (phoenix/recsys_model.py) is a Grok-based transformer:
 *   input: user hashes + engagement history + candidate post/author hashes
 *   output: logits → sigmoid → P(action) for each ACTIONS[] index
 *   key design: candidate isolation attention mask
 *
 * We CANNOT run the multi-GB JAX model in a Chrome extension.
 * This module produces calibrated proxy probabilities in [0,1] from
 * observable tweet features + live engagement, structured exactly like
 * PhoenixScores in home-mixer/models/candidate.rs.
 *
 * Every output is labeled proxy — not production inference.
 */

(function (root) {
  "use strict";

  function clamp01(x) {
    if (Number.isNaN(x) || x == null) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function sigmoid(x) {
    if (x > 20) return 1;
    if (x < -20) return 0;
    return 1 / (1 + Math.exp(-x));
  }

  function logit(p) {
    const e = 1e-6;
    const c = Math.max(e, Math.min(1 - e, p));
    return Math.log(c / (1 - c));
  }

  /**
   * Blend feature-based prior with observed engagement rates.
   * Live rates dominate when sample size (views) is large.
   */
  function blend(prior, observed, views, priorWeight = 80) {
    const v = Math.max(0, views || 0);
    const w = v / (v + priorWeight);
    return clamp01(prior * (1 - w) + observed * w);
  }

  /**
   * Estimate full PhoenixScores-like object from features.
   * @param {object} features - from NARVFeatures.extractFeatures
   * @param {object} params - DEFAULT_PARAMS + user overrides
   * @param {object} context - viewer context { inNetwork, historyAffinity }
   */
  function predictPhoenixScores(features, params = {}, context = {}) {
    const p = { ...((root.NARVWeights && root.NARVWeights.DEFAULT_PARAMS) || {}), ...params };
    const temp = Number(p.proxyTemperature) || 1;
    const base = Number(p.proxyBaseEngagement) || 0.08;
    const inNetwork = context.inNetwork !== false; // default assume in-network for own validation
    const affinity = clamp01(context.historyAffinity != null ? context.historyAffinity : 0.55);

    const f = features;
    const views = f.views || 0;

    // Shared latent quality logit (calibrated so empty/short posts stay weak)
    const substance =
      f.chars <= 0
        ? -2.2
        : f.chars < 20
          ? -1.4
          : f.chars < 40
            ? -0.55
            : f.lengthScore * 0.55;

    let quality =
      -1.55 +
      base * 1.5 +
      substance +
      f.mediaScore * 0.85 +
      f.structureScore * 0.65 +
      f.conversationScore * 1.25 +
      f.authorStrength * 0.55 +
      f.freshness * 0.45 +
      affinity * 0.7 +
      (f.isPremium ? 0.28 : 0) +
      (inNetwork ? 0.18 : -0.2) +
      (f.hasExternalLink ? -0.55 : 0) +
      (f.spamScore ? -1.6 : 0) +
      (f.shouty ? -0.55 : 0) +
      (f.isReply ? -0.2 : 0) + // standalone posts preferred as candidates
      (f.isRetweet ? -0.15 : 0) +
      (f.words < 3 ? -0.9 : 0);

    // Observed engagement lifts quality
    if (views > 20) {
      quality += Math.min(1.5, Math.log10(views + 1) / 3);
      quality += Math.min(1.2, f.engRate * 25);
    }

    quality /= temp;

    const q = sigmoid(quality);

    // Per-action heads (mirrors multi-action prediction)
    const favorite_prior = clamp01(q * 0.85 + f.likeRate * 2);
    const reply_prior = clamp01(
      q * 0.45 + f.conversationScore * 0.55 + (f.questionScore ? 0.12 : 0)
    );
    const retweet_prior = clamp01(q * 0.4 + f.mediaScore * 0.2 + f.repostRate * 3);
    const quote_prior = clamp01(q * 0.25 + f.conversationScore * 0.2 + (f.isQuote ? 0.05 : 0));
    const click_prior = clamp01(
      q * 0.35 + f.structureScore * 0.2 + (f.hasExternalLink ? 0.15 : 0.05)
    );
    const profile_click_prior = clamp01(
      q * 0.2 + f.authorStrength * 0.35 + (f.isPremium ? 0.1 : 0)
    );
    const photo_expand_prior = f.hasImage ? clamp01(q * 0.5 + 0.2) : clamp01(q * 0.05);
    const vqv_prior = f.hasVideo
      ? clamp01(q * 0.55 + 0.25 + (f.videoDurationMs > (p.minVideoDurationMs || 5000) ? 0.1 : -0.15))
      : 0.02;
    const share_prior = clamp01(q * 0.25 + f.mediaScore * 0.15);
    const share_dm_prior = clamp01(share_prior * 0.7);
    const share_copy_prior = clamp01(share_prior * 0.85);
    const dwell_prior = clamp01(
      q * 0.4 + f.lengthScore * 0.25 + f.structureScore * 0.2 + f.mediaScore * 0.15
    );
    const quoted_click_prior = f.isQuote ? clamp01(q * 0.4) : clamp01(q * 0.08);
    const quoted_vqv_prior = f.isQuote && f.hasVideo ? clamp01(q * 0.35) : 0.02;
    const follow_prior = clamp01(
      q * 0.15 + f.authorStrength * 0.2 + f.conversationScore * 0.15 + (inNetwork ? 0.02 : 0.12)
    );

    // Continuous-ish dwell (normalized 0–1 like continuous action head)
    const dwell_time = clamp01(dwell_prior * 0.7 + f.lengthScore * 0.2 + (f.hasVideo ? 0.15 : 0));
    const click_dwell_time = clamp01(click_prior * 0.6 + dwell_time * 0.3);

    // Negative heads
    let negBase =
      0.02 +
      f.spamScore * 0.35 +
      f.shouty * 0.12 +
      (f.hasExternalLink ? 0.04 : 0) +
      (f.hashtags > 5 ? 0.08 : 0) +
      (1 - f.freshness) * 0.03 -
      f.authorStrength * 0.02;
    negBase = clamp01(negBase);

    const not_interested = clamp01(negBase * 1.2 + (1 - q) * 0.08);
    const block_author = clamp01(negBase * 0.45);
    const mute_author = clamp01(negBase * 0.55);
    const report = clamp01(negBase * 0.4 + f.spamScore * 0.2);
    const not_dwelled = clamp01((1 - dwell_prior) * 0.5 + (f.chars < 20 ? 0.15 : 0));

    // Blend with observed rates when available
    const favorite_score = blend(favorite_prior, Math.min(1, f.likeRate * 8), views);
    const reply_score = blend(reply_prior, Math.min(1, f.replyRate * 12), views);
    const retweet_score = blend(retweet_prior, Math.min(1, f.repostRate * 15), views);
    const quote_score = blend(
      quote_prior,
      Math.min(1, (f.quotes / Math.max(views, 1)) * 20),
      views
    );

    return {
      favorite_score,
      reply_score,
      retweet_score,
      photo_expand_score: photo_expand_prior,
      click_score: click_prior,
      profile_click_score: profile_click_prior,
      vqv_score: vqv_prior,
      share_score: share_prior,
      share_via_dm_score: share_dm_prior,
      share_via_copy_link_score: share_copy_prior,
      dwell_score: dwell_prior,
      quote_score,
      quoted_click_score: quoted_click_prior,
      quoted_vqv_score: quoted_vqv_prior,
      dwell_time,
      click_dwell_time,
      follow_author_score: follow_prior,
      not_interested_score: not_interested,
      block_author_score: block_author,
      mute_author_score: mute_author,
      report_score: report,
      not_dwelled_score: not_dwelled,
      // meta
      _meta: {
        qualityLogit: quality,
        qualityProb: q,
        mode: "phoenix_proxy_v1",
        inNetwork,
        affinity,
        note: "Proxy estimates — production Phoenix transformer not available in-browser",
      },
    };
  }

  /**
   * Map PhoenixScores to the weight-key flat structure used by scorers.
   */
  function scoresToWeightMap(phoenixScores) {
    const s = phoenixScores;
    return {
      favorite: s.favorite_score,
      reply: s.reply_score,
      retweet: s.retweet_score,
      photo_expand: s.photo_expand_score,
      click: s.click_score,
      profile_click: s.profile_click_score,
      vqv: s.vqv_score,
      share: s.share_score,
      share_via_dm: s.share_via_dm_score,
      share_via_copy_link: s.share_via_copy_link_score,
      dwell: s.dwell_score,
      quote: s.quote_score,
      quoted_click: s.quoted_click_score,
      quoted_vqv: s.quoted_vqv_score,
      cont_dwell_time: s.dwell_time,
      cont_click_dwell_time: s.click_dwell_time,
      follow_author: s.follow_author_score,
      not_interested: s.not_interested_score,
      block_author: s.block_author_score,
      mute_author: s.mute_author_score,
      report: s.report_score,
      not_dwelled: s.not_dwelled_score,
    };
  }

  const NARVPhoenix = {
    predictPhoenixScores,
    scoresToWeightMap,
    clamp01,
    sigmoid,
  };

  root.NARVPhoenix = NARVPhoenix;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVPhoenix;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
