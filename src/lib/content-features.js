/**
 * Content feature extraction for Phoenix proxy scoring.
 *
 * Production Phoenix uses hash-based embeddings + user engagement history
 * (no hand-engineered features). In-browser we cannot run the Grok transformer,
 * so we extract observable features from tweet text/DOM to estimate
 * engagement probabilities — clearly labeled as proxy estimates.
 */

(function (root) {
  "use strict";

  const QUESTION_RE = /\?|^(who|what|when|where|why|how|do you|have you|should|would|could)\b/im;
  const CTA_RE =
    /\b(reply|comment|rt|repost|quote|share|follow|like if|thoughts|agree|disagree|tell me|drop|your take)\b/i;
  const SPAM_RE =
    /\b(free money|guaranteed|click here|limited time|act now|crypto giveaway|dm me for|double your)\b/i;
  const URL_RE = /https?:\/\/[^\s]+|t\.co\/\w+/gi;
  const HASHTAG_RE = /#[\w\u00C0-\u024F]+/g;
  const MENTION_RE = /@\w+/g;
  const EMOJI_RE =
    /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu;
  const ALL_CAPS_WORD_RE = /\b[A-Z]{4,}\b/g;

  function safeText(t) {
    return (t || "").trim();
  }

  /**
   * Extract structured features from a tweet candidate object.
   * @param {object} tweet - parsed tweet
   */
  function extractFeatures(tweet) {
    const text = safeText(tweet.text);
    const chars = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const urls = text.match(URL_RE) || [];
    const hashtags = text.match(HASHTAG_RE) || [];
    const mentions = text.match(MENTION_RE) || [];
    const emojis = text.match(EMOJI_RE) || [];
    const capsWords = text.match(ALL_CAPS_WORD_RE) || [];

    const hasMedia = !!(tweet.hasMedia || tweet.hasImage || tweet.hasVideo || tweet.hasGif);
    const hasVideo = !!(tweet.hasVideo);
    const hasImage = !!(tweet.hasImage || tweet.hasGif);
    const hasPoll = !!tweet.hasPoll;
    const isReply = !!tweet.isReply;
    const isQuote = !!tweet.isQuote;
    const isRetweet = !!tweet.isRetweet;
    const isThread = !!tweet.isThread || (tweet.threadLength && tweet.threadLength > 1);

    const lines = text.split(/\n/).filter((l) => l.trim().length);
    const hasLineBreaks = lines.length >= 2;

    // Engagement velocity proxies from live counts when available
    const likes = Number(tweet.likeCount || 0);
    const replies = Number(tweet.replyCount || 0);
    const reposts = Number(tweet.repostCount || 0);
    const quotes = Number(tweet.quoteCount || 0);
    const views = Number(tweet.viewCount || 0);
    const bookmarks = Number(tweet.bookmarkCount || 0);

    const followers = Number(tweet.authorFollowers || 0);
    const ageHours =
      tweet.ageHours != null
        ? tweet.ageHours
        : root.NARVSnowflake
          ? root.NARVSnowflake.tweetAgeHours(tweet.tweetId)
          : null;

    // Engagement rates (guard against zero views/followers)
    const viewBase = Math.max(views, 1);
    const likeRate = likes / viewBase;
    const replyRate = replies / viewBase;
    const repostRate = reposts / viewBase;
    const engTotal = likes + replies * 3 + reposts * 2 + quotes * 2 + bookmarks;
    const engRate = engTotal / viewBase;

    // Freshness decay: AgeFilter drops old posts; Phoenix also sees creation_ts
    let freshness = 1;
    if (ageHours != null) {
      if (ageHours < 1) freshness = 1.0;
      else if (ageHours < 6) freshness = 0.95;
      else if (ageHours < 24) freshness = 0.8;
      else if (ageHours < 48) freshness = 0.55;
      else freshness = 0.25;
    }

    // Author authority proxy (log followers)
    const authorStrength =
      followers > 0 ? Math.min(1, Math.log10(followers + 1) / 7) : 0.25;

    // Verified / Premium boost (empirical, not hand-feature in Phoenix but affects distribution)
    const isVerified = !!tweet.authorVerified;
    const isPremium = !!tweet.authorPremium || isVerified;

    // Content quality scores 0–1
    const questionScore = QUESTION_RE.test(text) ? 1 : 0;
    const ctaScore = CTA_RE.test(text) ? 1 : 0;
    const spamScore = SPAM_RE.test(text) ? 1 : 0;
    const capRatio = words.length ? capsWords.length / words.length : 0;
    const shouty = capRatio > 0.35 ? 1 : 0;

    // Optimal length band for dwell (~80–220 chars often reads well)
    let lengthScore = 0.5;
    if (chars >= 40 && chars <= 280) {
      if (chars >= 80 && chars <= 220) lengthScore = 1.0;
      else lengthScore = 0.75;
    } else if (chars > 280) {
      lengthScore = 0.65; // long-form / article-like
    } else if (chars > 0) {
      lengthScore = 0.35;
    }

    // External link penalty (well-known distribution penalty on X)
    const externalLink = urls.some(
      (u) => !/t\.co|x\.com|twitter\.com|pic\.twitter/i.test(u)
    );
    // t.co is always present for media; count raw URLs in text
    const hasExternalLink = externalLink || (tweet.hasExternalLink === true);

    // Readability: short paragraphs, line breaks help dwell
    const structureScore = Math.min(
      1,
      (hasLineBreaks ? 0.4 : 0) +
        (emojis.length > 0 && emojis.length <= 6 ? 0.2 : 0) +
        (hashtags.length > 0 && hashtags.length <= 3 ? 0.15 : 0) +
        (mentions.length <= 3 ? 0.15 : 0) +
        lengthScore * 0.3
    );

    // Media richness
    const mediaScore = hasVideo ? 1.0 : hasImage ? 0.7 : hasPoll ? 0.5 : 0.15;

    // Conversation potential
    const conversationScore = Math.min(
      1,
      questionScore * 0.45 +
        ctaScore * 0.35 +
        (isThread ? 0.25 : 0) +
        (hasPoll ? 0.3 : 0) +
        (replies > 0 ? Math.min(0.3, Math.log10(replies + 1) / 4) : 0)
    );

    return {
      chars,
      words: words.length,
      urls: urls.length,
      hashtags: hashtags.length,
      mentions: mentions.length,
      emojis: emojis.length,
      hasMedia,
      hasVideo,
      hasImage,
      hasPoll,
      isReply,
      isQuote,
      isRetweet,
      isThread,
      threadLength: tweet.threadLength || (isThread ? 2 : 1),
      hasLineBreaks,
      hasExternalLink,
      likes,
      replies,
      reposts,
      quotes,
      views,
      bookmarks,
      followers,
      ageHours,
      likeRate,
      replyRate,
      repostRate,
      engRate,
      engTotal,
      freshness,
      authorStrength,
      isVerified,
      isPremium,
      questionScore,
      ctaScore,
      spamScore,
      shouty,
      lengthScore,
      structureScore,
      mediaScore,
      conversationScore,
      videoDurationMs: tweet.videoDurationMs || null,
      textPreview: text.slice(0, 280),
    };
  }

  /**
   * Human-readable insights / recommendations from features.
   */
  function buildInsights(features, scores) {
    const tips = [];
    const risks = [];
    const strengths = [];

    if (features.conversationScore >= 0.55) {
      strengths.push("Strong conversation cues (question/CTA) → boosts P(reply)");
    } else if (!features.isReply) {
      tips.push("Add a genuine question or CTA to lift reply_score (highest weight)");
    }

    if (features.hasVideo) {
      strengths.push("Video present → enables VQV weight when duration > min threshold");
    } else if (features.hasImage) {
      strengths.push("Image/GIF → photo_expand & dwell signals");
    } else {
      tips.push("Media (esp. video >5s) unlocks photo_expand / VQV weighted terms");
    }

    if (features.hasExternalLink) {
      risks.push("External links often suppress OON distribution — put link in first reply");
    }

    if (features.spamScore > 0 || features.shouty) {
      risks.push("Spam/shouty patterns raise P(not_interested / report / mute)");
    }

    if (features.ageHours != null && features.ageHours > 24) {
      risks.push(`Post age ${features.ageHours.toFixed(1)}h — AgeFilter & freshness decay apply`);
    }

    if (features.isThread) {
      strengths.push("Thread format tends to raise dwell + reply chain engagement");
    }

    if (features.isPremium) {
      strengths.push("Premium/Verified author — empirical in-network & OON reach multipliers");
    }

    if (features.lengthScore < 0.5 && features.chars > 0) {
      tips.push("Very short posts can hurt dwell; aim ~80–220 chars for text posts");
    }

    if (features.hashtags > 3) {
      tips.push("Too many hashtags can look spammy — keep ≤3");
    }

    if (scores && scores.finalScore != null) {
      if (scores.finalScore >= 0.55) {
        strengths.push("High composite rank score for For You candidacy");
      } else if (scores.finalScore < 0.25) {
        tips.push("Low composite score — prioritize reply triggers & reduce negative risk");
      }
    }

    return { tips, risks, strengths };
  }

  const NARVFeatures = {
    extractFeatures,
    buildInsights,
  };

  root.NARVFeatures = NARVFeatures;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVFeatures;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
