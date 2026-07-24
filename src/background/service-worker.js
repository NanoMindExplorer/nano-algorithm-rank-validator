/**
 * Background service worker — settings defaults + action click helpers.
 */

const DEFAULTS = {
  weights: {
    favorite: 1.0,
    reply: 13.5,
    retweet: 1.0,
    photo_expand: 0.4,
    click: 0.5,
    profile_click: 1.2,
    vqv: 0.8,
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
    not_interested: -8.0,
    block_author: -24.0,
    mute_author: -16.0,
    report: -30.0,
    not_dwelled: -0.5,
  },
  params: {
    authorDiversityDecay: 0.6,
    authorDiversityFloor: 0.25,
    oonWeightFactor: 0.75,
    topicOonWeightFactor: 0.9,
    newUserOonWeightFactor: 1.0,
    minVideoDurationMs: 5000,
    maxPostAgeHours: 48,
    negativeScoresOffset: 0.01,
    premiumInNetworkMultiplier: 4.0,
    premiumOonMultiplier: 2.0,
    proxyTemperature: 1.0,
    proxyBaseEngagement: 0.08,
  },
  inNetworkDefault: true,
  historyAffinity: 0.55,
  mutedKeywords: "",
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set(DEFAULTS);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "NARV_GET_DEFAULTS") {
    sendResponse({ defaults: DEFAULTS });
    return true;
  }
});
