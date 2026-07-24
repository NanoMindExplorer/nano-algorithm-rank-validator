/**
 * Affinity calibration from engagement history.
 *
 * Production Phoenix uses the full user action sequence as transformer input.
 * Here we derive a scalar historyAffinity + optional topic/author bias scores
 * from an imported JSON history (or lightweight local samples).
 *
 * Expected import formats (flexible):
 * 1) Phoenix-style sequence:
 *    { "history": [ { "post_id", "author_id", "actions": { "1": 1, "4": 1 } }, ... ] }
 * 2) Simple NARV format:
 *    { "engagements": [ { "text", "liked", "replied", "reposted", "author", "topics" } ] }
 * 3) Flat array of engagement objects
 */

(function (root) {
  "use strict";

  // Align with phoenix/run_pipeline.py action indices when present
  const ACTION_IDX = {
    fav: 1,
    reply: 4,
    quote: 5,
    rt: 6,
    dwell: 11,
    vqv: 13,
  };

  function clamp01(x) {
    return Math.max(0, Math.min(1, Number(x) || 0));
  }

  function normalizeImport(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.history)) return raw.history;
    if (Array.isArray(raw.engagements)) return raw.engagements;
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.sequence)) return raw.sequence;
    return [];
  }

  function itemSignals(item) {
    const actions = item.actions || item.action || {};
    let liked = !!(item.liked || item.favorite || item.fav);
    let replied = !!(item.replied || item.reply);
    let reposted = !!(item.reposted || item.retweeted || item.rt);
    let quoted = !!(item.quoted || item.quote);
    let dwelled = !!(item.dwelled || item.dwell);
    let vqv = !!(item.vqv || item.video_view);
    let notInterested = !!(item.not_interested || item.notInterested);
    let blocked = !!(item.blocked || item.block);
    let muted = !!(item.muted || item.mute);
    let reported = !!(item.reported || item.report);

    // Phoenix multi-hot action map: keys may be string indices
    if (actions && typeof actions === "object") {
      const get = (idx) => Number(actions[idx] || actions[String(idx)] || 0) > 0;
      if (get(ACTION_IDX.fav)) liked = true;
      if (get(ACTION_IDX.reply)) replied = true;
      if (get(ACTION_IDX.quote)) quoted = true;
      if (get(ACTION_IDX.rt)) reposted = true;
      if (get(ACTION_IDX.dwell)) dwelled = true;
      if (get(ACTION_IDX.vqv)) vqv = true;
      // negative indices if ever present in extended exports
      if (Number(actions.not_interested || 0) > 0) notInterested = true;
    }

    const text = item.text || item.tweet_text || item.content || "";
    const author = String(
      item.author || item.author_id || item.authorId || item.author_handle || ""
    );
    const topics = item.topics || item.topic_ids || item.topicIds || [];

    return {
      liked,
      replied,
      reposted,
      quoted,
      dwelled,
      vqv,
      notInterested,
      blocked,
      muted,
      reported,
      text,
      author,
      topics: Array.isArray(topics) ? topics.map(String) : [],
      hasMedia: !!(item.has_media || item.hasMedia || item.media),
      hasVideo: !!(item.has_video || item.hasVideo || item.video),
    };
  }

  /**
   * Compute affinity summary from engagement history.
   * @returns {{ historyAffinity, positiveRate, negativeRate, topAuthors, mediaPreference, conversationPreference, sampleSize, notes }}
   */
  function calibrate(rawHistory) {
    const items = normalizeImport(rawHistory).map(itemSignals);
    const n = items.length;
    if (!n) {
      return {
        historyAffinity: 0.55,
        positiveRate: 0,
        negativeRate: 0,
        topAuthors: [],
        mediaPreference: 0.5,
        conversationPreference: 0.5,
        sampleSize: 0,
        notes: ["Empty history — using default affinity 0.55"],
      };
    }

    let pos = 0;
    let neg = 0;
    let media = 0;
    let convo = 0;
    const authorScores = new Map();

    for (const it of items) {
      const strength =
        (it.liked ? 1 : 0) +
        (it.replied ? 2.5 : 0) +
        (it.reposted ? 2 : 0) +
        (it.quoted ? 2 : 0) +
        (it.dwelled ? 0.8 : 0) +
        (it.vqv ? 1.2 : 0);
      const penalty =
        (it.notInterested ? 2 : 0) +
        (it.blocked ? 4 : 0) +
        (it.muted ? 3 : 0) +
        (it.reported ? 5 : 0);

      if (strength > 0) pos += 1;
      if (penalty > 0) neg += 1;
      if (it.hasMedia || it.hasVideo) media += strength > 0 ? 1 : 0.3;
      if (it.replied || it.quoted || /\?/.test(it.text)) convo += strength > 0 ? 1 : 0.2;

      if (it.author) {
        const prev = authorScores.get(it.author) || 0;
        authorScores.set(it.author, prev + strength - penalty * 0.5);
      }
    }

    const positiveRate = pos / n;
    const negativeRate = neg / n;
    // Map engagement richness → affinity used by Phoenix proxy
    // High positive + low negative → higher affinity (model "knows" what you like)
    let historyAffinity = 0.35 + positiveRate * 0.5 - negativeRate * 0.25;
    historyAffinity = clamp01(historyAffinity);

    // Depth bonus if many high-intent actions
    const deep = items.filter((it) => it.replied || it.reposted || it.quoted).length / n;
    historyAffinity = clamp01(historyAffinity + deep * 0.12);

    const topAuthors = [...authorScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([author, score]) => ({ author, score: Number(score.toFixed(2)) }));

    const mediaPreference = clamp01(media / Math.max(1, pos || n * 0.5));
    const conversationPreference = clamp01(convo / Math.max(1, pos || n * 0.5));

    const notes = [
      `Calibrated from ${n} history items`,
      `Positive eng. rate ${(positiveRate * 100).toFixed(0)}% · negative ${(negativeRate * 100).toFixed(0)}%`,
      `Media preference ${(mediaPreference * 100).toFixed(0)}% · conversation ${(conversationPreference * 100).toFixed(0)}%`,
    ];

    return {
      historyAffinity,
      positiveRate,
      negativeRate,
      topAuthors,
      mediaPreference,
      conversationPreference,
      sampleSize: n,
      notes,
      calibratedAt: new Date().toISOString(),
    };
  }

  /**
   * Suggest profile id from calibration preferences.
   */
  function suggestProfile(calibration) {
    if (!calibration || !calibration.sampleSize) return "balanced";
    if (calibration.conversationPreference >= 0.55 && calibration.mediaPreference < 0.45) {
      return "conversation";
    }
    if (calibration.mediaPreference >= 0.55) return "media";
    if (calibration.positiveRate > 0.6 && calibration.conversationPreference < 0.4) {
      return "viral";
    }
    return "balanced";
  }

  /**
   * Light auto-sample from currently liked-looking cards is not reliable;
   * instead collect texts the user marks via UI into storage shape.
   */
  function mergeSamples(existing, newItems) {
    const a = normalizeImport(existing);
    const b = normalizeImport(newItems);
    return { engagements: [...a, ...b].slice(-500) };
  }

  const NARVAffinity = {
    ACTION_IDX,
    normalizeImport,
    calibrate,
    suggestProfile,
    mergeSamples,
  };

  root.NARVAffinity = NARVAffinity;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVAffinity;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
