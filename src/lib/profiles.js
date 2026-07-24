/**
 * A/B weight profiles for different creator / ranking goals.
 * Each profile overlays DEFAULT_WEIGHTS with intentional emphasis.
 */

(function (root) {
  "use strict";

  const PROFILES = {
    balanced: {
      id: "balanced",
      name: "Balanced (default)",
      description: "Research-calibrated hierarchy: conversation first, then share/media.",
      weights: {},
      params: {},
    },
    conversation: {
      id: "conversation",
      name: "Conversation",
      description: "Maximize reply / quote / follow signals — best for threads & questions.",
      weights: {
        reply: 18.0,
        quote: 4.0,
        follow_author: 5.5,
        dwell: 0.8,
        cont_dwell_time: 0.5,
        favorite: 0.7,
        retweet: 0.8,
        share: 2.5,
      },
      params: {
        proxyBaseEngagement: 0.09,
      },
    },
    media: {
      id: "media",
      name: "Media / Video",
      description: "Boost VQV, photo expand, dwell, and share — for image/video posts.",
      weights: {
        vqv: 3.5,
        photo_expand: 2.0,
        quoted_vqv: 1.5,
        dwell: 1.2,
        cont_dwell_time: 0.8,
        share: 3.0,
        reply: 8.0,
        favorite: 1.2,
      },
      params: {
        minVideoDurationMs: 5000,
      },
    },
    news: {
      id: "news",
      name: "News / Links",
      description: "Click, profile, share-via-copy; softer external-link penalty via affinity.",
      weights: {
        click: 2.5,
        profile_click: 2.0,
        share_via_copy_link: 2.5,
        share: 2.5,
        quote: 3.0,
        reply: 10.0,
        favorite: 1.0,
        dwell: 0.9,
      },
      params: {
        proxyBaseEngagement: 0.07,
      },
    },
    viral: {
      id: "viral",
      name: "Amplification",
      description: "Repost + share + quote heavy — optimize for reach cascades.",
      weights: {
        retweet: 4.0,
        share: 4.5,
        share_via_dm: 2.5,
        share_via_copy_link: 2.0,
        quote: 4.0,
        favorite: 1.5,
        reply: 10.0,
        follow_author: 3.0,
      },
      params: {},
    },
    demo_pipeline: {
      id: "demo_pipeline",
      name: "OSS demo (run_pipeline.py)",
      description: "Toy weights from phoenix/run_pipeline.py — for research comparison only.",
      weights: {
        favorite: 1.0,
        reply: 0.5,
        retweet: 0.3,
        photo_expand: 0,
        click: 0,
        profile_click: 0,
        vqv: 0,
        share: 0,
        share_via_dm: 0,
        share_via_copy_link: 0,
        dwell: 0.2,
        quote: 0,
        quoted_click: 0,
        quoted_vqv: 0,
        cont_dwell_time: 0,
        cont_click_dwell_time: 0,
        follow_author: 0,
        not_interested: 0,
        block_author: 0,
        mute_author: 0,
        report: 0,
        not_dwelled: 0,
      },
      params: {},
    },
  };

  function listProfiles() {
    return Object.values(PROFILES);
  }

  function getProfile(id) {
    return PROFILES[id] || PROFILES.balanced;
  }

  /**
   * Resolve active weights/params from profile id + optional overrides.
   */
  function resolve(profileId, overrides = {}) {
    const defaults = root.NARVWeights.cloneDefaults();
    const profile = getProfile(profileId || "balanced");
    const weights = {
      ...defaults.weights,
      ...(profile.weights || {}),
      ...(overrides.weights || {}),
    };
    const params = {
      ...defaults.params,
      ...(profile.params || {}),
      ...(overrides.params || {}),
    };
    return {
      profileId: profile.id,
      profileName: profile.name,
      weights,
      params,
    };
  }

  const NARVProfiles = {
    PROFILES,
    listProfiles,
    getProfile,
    resolve,
  };

  root.NARVProfiles = NARVProfiles;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVProfiles;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
