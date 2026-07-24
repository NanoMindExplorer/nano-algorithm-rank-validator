/**
 * Pre-scoring & post-selection filters
 * Ported from home-mixer/filters/* structure in xai-org/x-algorithm.
 *
 * Client-side we can only approximate filters that need server graph data
 * (blocked users, muted keywords, previously seen). Those are marked partial.
 */

(function (root) {
  "use strict";

  /**
   * Run all applicable filters on a single tweet candidate for validation.
   * Returns pass/fail + reasons.
   */
  function runFilters(tweet, features, params = {}, context = {}) {
    const results = [];
    const maxAgeH =
      params.maxPostAgeHours != null ? params.maxPostAgeHours : 48;

    // AgeFilter
    {
      const age = features.ageHours;
      let pass = true;
      let detail = "Age unknown — cannot verify";
      if (age != null) {
        pass = age <= maxAgeH;
        detail = pass
          ? `Age ${age.toFixed(2)}h ≤ ${maxAgeH}h threshold`
          : `Age ${age.toFixed(2)}h > ${maxAgeH}h — would be dropped by AgeFilter`;
      }
      results.push({
        id: "AgeFilter",
        stage: "pre_scoring",
        pass: age == null ? null : pass,
        detail,
        source: "home-mixer/filters/age_filter.rs",
      });
    }

    // SelfTweetFilter
    {
      const viewerId = context.viewerId;
      let pass = true;
      let detail = "Viewer id unknown — skip";
      if (viewerId && tweet.authorId) {
        pass = String(viewerId) !== String(tweet.authorId);
        detail = pass
          ? "Author ≠ viewer"
          : "Self-post — removed by SelfTweetFilter from For You";
      }
      results.push({
        id: "SelfTweetFilter",
        stage: "pre_scoring",
        pass: viewerId ? pass : null,
        detail,
        source: "home-mixer/filters/self_tweet_filter.rs",
      });
    }

    // DropDuplicatesFilter (single tweet always unique; batch uses this)
    results.push({
      id: "DropDuplicatesFilter",
      stage: "pre_scoring",
      pass: true,
      detail: "Single-candidate validation (unique tweet id)",
      source: "home-mixer/filters/drop_duplicates_filter.rs",
    });

    // CoreDataHydrationFilter
    {
      const hasCore = !!(tweet.tweetId && (tweet.text != null || tweet.hasMedia));
      results.push({
        id: "CoreDataHydrationFilter",
        stage: "pre_scoring",
        pass: hasCore,
        detail: hasCore
          ? "Core fields present (id, text/media)"
          : "Missing core post metadata",
        source: "home-mixer/filters/core_data_hydration_filter.rs",
      });
    }

    // AuthorSocialgraphFilter (blocked/muted) — partial
    {
      const blocked = context.blockedAuthorIds || [];
      const muted = context.mutedAuthorIds || [];
      const aid = String(tweet.authorId || "");
      const isBlocked = blocked.map(String).includes(aid);
      const isMuted = muted.map(String).includes(aid);
      results.push({
        id: "AuthorSocialgraphFilter",
        stage: "pre_scoring",
        pass: !isBlocked && !isMuted,
        detail:
          isBlocked || isMuted
            ? "Author blocked/muted by viewer"
            : "No block/mute signals in local context (partial check)",
        partial: true,
        source: "home-mixer/filters/author_socialgraph_filter.rs",
      });
    }

    // MutedKeywordFilter — partial
    {
      const keywords = (context.mutedKeywords || []).map((k) =>
        String(k).toLowerCase()
      );
      const text = (tweet.text || "").toLowerCase();
      const hit = keywords.find((k) => k && text.includes(k));
      results.push({
        id: "MutedKeywordFilter",
        stage: "pre_scoring",
        pass: !hit,
        detail: hit
          ? `Contains muted keyword: "${hit}"`
          : keywords.length
            ? "No muted keywords matched"
            : "No muted keywords configured (partial)",
        partial: !keywords.length,
        source: "home-mixer/filters/muted_keyword_filter.rs",
      });
    }

    // PreviouslySeen / Served — cannot know without server
    results.push({
      id: "PreviouslySeenPostsFilter",
      stage: "pre_scoring",
      pass: null,
      detail: "Requires impression bloom filter / served history (server-only)",
      partial: true,
      source: "home-mixer/filters/previously_seen_posts_filter.rs",
    });

    // IneligibleSubscriptionFilter
    {
      const subOnly = !!tweet.subscriptionOnly;
      const canView = context.canViewSubscription !== false;
      results.push({
        id: "IneligibleSubscriptionFilter",
        stage: "pre_scoring",
        pass: !subOnly || canView,
        detail: subOnly
          ? canView
            ? "Subscription content accessible"
            : "Paywalled content inaccessible"
          : "Not subscription-gated",
        source: "home-mixer/filters/ineligible_subscription_filter.rs",
      });
    }

    // VFFilter (visibility: spam/violence/gore) — client heuristics only
    {
      const spam = features.spamScore > 0;
      results.push({
        id: "VFFilter",
        stage: "post_selection",
        pass: !spam,
        detail: spam
          ? "Spam-like language — elevated VF / safety risk"
          : "No client-side spam/violence signals detected (full VF is server-side)",
        partial: true,
        source: "home-mixer/filters/vf_filter.rs + grox safety plans",
      });
    }

    // DedupConversationFilter
    results.push({
      id: "DedupConversationFilter",
      stage: "post_selection",
      pass: true,
      detail: "Single tweet validation — conversation dedup N/A",
      source: "home-mixer/filters/dedup_conversation_filter.rs",
    });

    // VideoFilter (optional surface)
    if (context.videoOnlyFeed) {
      results.push({
        id: "VideoFilter",
        stage: "pre_scoring",
        pass: !!features.hasVideo,
        detail: features.hasVideo
          ? "Has video"
          : "No video — dropped on video-only surface",
        source: "home-mixer/filters/video_filter.rs",
      });
    }

    // Content structure soft checks (not hard filters, but validation flags)
    results.push({
      id: "ExternalLinkSoftSignal",
      stage: "validation",
      pass: !features.hasExternalLink,
      detail: features.hasExternalLink
        ? "External link present — historically hurts OON reach"
        : "No external link in post body",
      soft: true,
    });

    const hardFails = results.filter((r) => r.pass === false && !r.soft);
    const softFails = results.filter((r) => r.pass === false && r.soft);
    const unknown = results.filter((r) => r.pass === null);

    return {
      results,
      passed: hardFails.length === 0,
      hardFails,
      softFails,
      unknown,
      summary: hardFails.length
        ? `FAIL — ${hardFails.length} hard filter(s)`
        : softFails.length
          ? `PASS with ${softFails.length} soft warning(s)`
          : "PASS — no hard filter failures",
    };
  }

  const NARVFilters = { runFilters };

  root.NARVFilters = NARVFilters;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVFilters;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
