/**
 * Opt-in engagement auto-sampler for affinity calibration.
 *
 * Collects tweets from:
 *  - /likes pages (user's liked tweets)
 *  - Manual "sample" button on any tweet
 *  - Optional passive sampling of high-engagement cards user interacts with
 *
 * Stores up to MAX_SAMPLES in chrome.storage.local under engagementSamples.
 */

(function (root) {
  "use strict";

  const MAX_SAMPLES = 500;
  const STORAGE_KEY = "engagementSamples";
  const META_KEY = "engagementSampleMeta";

  function tweetToSample(tweet, flags = {}) {
    return {
      tweetId: tweet.tweetId || null,
      author: tweet.authorHandle || tweet.authorId || "",
      text: (tweet.text || "").slice(0, 400),
      liked: !!flags.liked,
      replied: !!flags.replied,
      reposted: !!flags.reposted,
      quoted: !!flags.quoted,
      dwelled: !!flags.dwelled,
      not_interested: !!flags.not_interested,
      has_media: !!(tweet.hasMedia || tweet.hasImage || tweet.hasVideo),
      has_video: !!tweet.hasVideo,
      has_image: !!tweet.hasImage,
      sampledAt: new Date().toISOString(),
      source: flags.source || "manual",
      url: tweet.url || null,
    };
  }

  async function loadSamples() {
    try {
      const data = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
      return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    } catch {
      return [];
    }
  }

  async function saveSamples(samples) {
    const trimmed = samples.slice(-MAX_SAMPLES);
    await chrome.storage.local.set({
      [STORAGE_KEY]: trimmed,
      [META_KEY]: {
        count: trimmed.length,
        updatedAt: new Date().toISOString(),
      },
    });
    return trimmed;
  }

  async function addSample(tweet, flags = {}) {
    const samples = await loadSamples();
    const sample = tweetToSample(tweet, flags);
    // de-dupe by tweetId + action signature
    const sig = `${sample.tweetId}|${sample.liked}|${sample.replied}|${sample.reposted}|${sample.source}`;
    const filtered = samples.filter((s) => {
      const ssig = `${s.tweetId}|${s.liked}|${s.replied}|${s.reposted}|${s.source}`;
      return ssig !== sig;
    });
    filtered.push(sample);
    return saveSamples(filtered);
  }

  async function addMany(tweets, flags = {}) {
    let samples = await loadSamples();
    const seen = new Set(samples.map((s) => s.tweetId).filter(Boolean));
    for (const t of tweets) {
      if (t.tweetId && seen.has(t.tweetId) && flags.liked) continue;
      const sample = tweetToSample(t, flags);
      samples.push(sample);
      if (t.tweetId) seen.add(t.tweetId);
    }
    return saveSamples(samples);
  }

  async function clearSamples() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: [],
      [META_KEY]: { count: 0, updatedAt: new Date().toISOString() },
    });
  }

  async function exportHistoryObject() {
    const engagements = await loadSamples();
    return {
      engagements,
      exportedAt: new Date().toISOString(),
      source: "narv-auto-sampler",
      version: "1.2.0",
    };
  }

  /**
   * Detect if current page is a likes timeline.
   */
  function isLikesPage() {
    const path = location.pathname || "";
    return /\/likes\/?$/.test(path) || path.includes("/likes");
  }

  /**
   * Sample all visible tweets as liked (for /likes pages).
   */
  async function sampleVisibleAsLiked(parser) {
    if (!parser) return { added: 0, total: 0 };
    const items = parser.parseVisibleTweets();
    const tweets = items.map((i) => i.tweet).filter((t) => t && t.tweetId);
    const before = (await loadSamples()).length;
    await addMany(tweets, { liked: true, source: isLikesPage() ? "likes_page" : "timeline_bulk" });
    const after = (await loadSamples()).length;
    return { added: Math.max(0, after - before), total: after, scanned: tweets.length };
  }

  /**
   * Calibrate from samples and optionally persist to sync settings.
   */
  async function calibrateAndStore(affinityLib, persistSync = true) {
    const history = await exportHistoryObject();
    if (!affinityLib) return null;
    const cal = affinityLib.calibrate(history);
    if (persistSync) {
      try {
        await chrome.storage.sync.set({
          affinityCalibration: cal,
          historyAffinity: cal.historyAffinity,
        });
      } catch {
        /* ignore */
      }
    }
    return cal;
  }

  /**
   * Inject small "Sample" control on tweets when auto-sample UI enabled.
   */
  function injectSampleButtons(parser, onSampled) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach((article) => {
      if (article.querySelector(".narv-sample-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "narv-sample-btn";
      btn.textContent = "+HIST";
      btn.title = "Add to NARV engagement history (liked sample)";
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tweet = parser.parseTweetArticle(article);
        if (!tweet) return;
        await addSample(tweet, { liked: true, source: "manual_button" });
        btn.textContent = "✓";
        btn.classList.add("done");
        if (onSampled) onSampled(tweet);
      });
      article.style.position = article.style.position || "relative";
      article.appendChild(btn);
    });
  }

  const NARVSampler = {
    MAX_SAMPLES,
    STORAGE_KEY,
    tweetToSample,
    loadSamples,
    saveSamples,
    addSample,
    addMany,
    clearSamples,
    exportHistoryObject,
    isLikesPage,
    sampleVisibleAsLiked,
    calibrateAndStore,
    injectSampleButtons,
  };

  root.NARVSampler = NARVSampler;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVSampler;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
