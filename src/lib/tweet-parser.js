/**
 * Parse tweet data from x.com / twitter.com DOM.
 * Selectors are resilient but X UI changes frequently — multiple fallbacks.
 */

(function (root) {
  "use strict";

  function parseCount(text) {
    if (text == null || text === "") return 0;
    const s = String(text).trim().replace(/,/g, "").toLowerCase();
    if (!s || s === "like" || s === "reply" || s === "repost" || s === "views") return 0;
    const m = s.match(/^([\d.]+)\s*([kmb])?/);
    if (!m) {
      const n = parseInt(s.replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    }
    let n = parseFloat(m[1]);
    const u = m[2];
    if (u === "k") n *= 1e3;
    else if (u === "m") n *= 1e6;
    else if (u === "b") n *= 1e9;
    return Math.round(n);
  }

  function getStatusIdFromHref(href) {
    if (!href) return null;
    const m = String(href).match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function findArticle(el) {
    if (!el) return null;
    return el.closest('article[data-testid="tweet"]') || el.closest("article") || null;
  }

  function textContent(el) {
    return el ? (el.innerText || el.textContent || "").trim() : "";
  }

  /**
   * Extract tweet from an article element.
   */
  function parseTweetArticle(article) {
    if (!article) return null;

    // Tweet ID from status links
    let tweetId = null;
    let authorHandle = null;
    const timeA = article.querySelector('a[href*="/status/"] time')?.parentElement;
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const a of statusLinks) {
      const id = getStatusIdFromHref(a.getAttribute("href"));
      if (id) {
        tweetId = id;
        const hm = (a.getAttribute("href") || "").match(/\/([^/]+)\/status\//);
        if (hm) authorHandle = hm[1];
        break;
      }
    }

    // User name / handle
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    let authorName = "";
    if (userNameEl) {
      const spans = userNameEl.querySelectorAll("span");
      const texts = [...spans].map((s) => s.textContent || "").filter(Boolean);
      authorName = texts[0] || "";
      const handleSpan = texts.find((t) => t.startsWith("@"));
      if (handleSpan) authorHandle = handleSpan.replace("@", "");
      // also try links
      const profileLink = userNameEl.querySelector('a[href^="/"]');
      if (profileLink && !authorHandle) {
        const p = profileLink.getAttribute("href") || "";
        const m = p.match(/^\/([^/?#]+)/);
        if (m && !["home", "explore", "search", "i", "settings"].includes(m[1])) {
          authorHandle = m[1];
        }
      }
    }

    // Verified
    const authorVerified = !!(
      article.querySelector('[data-testid="icon-verified"]') ||
      userNameEl?.querySelector('svg[aria-label*="Verified"]') ||
      userNameEl?.querySelector('[aria-label*="Verified"]')
    );

    // Text
    const textEl =
      article.querySelector('[data-testid="tweetText"]') ||
      article.querySelector('[data-testid="tweetText"] span');
    const text = textContent(
      article.querySelector('[data-testid="tweetText"]')
    );

    // Media
    const hasPhoto = !!article.querySelector('[data-testid="tweetPhoto"]');
    const hasVideo = !!(
      article.querySelector('[data-testid="videoPlayer"]') ||
      article.querySelector("video") ||
      article.querySelector('[data-testid="videoComponent"]')
    );
    const hasGif = !!article.querySelector('[data-testid="tweetPhoto"] video, [aria-label*="GIF"]');
    const hasCard = !!article.querySelector('[data-testid="card.wrapper"], [data-testid="card.layoutLarge.media"]');
    const hasPoll = !!article.querySelector('[data-testid="cardPoll"], [role="group"][aria-label*="Poll"]');

    // External link cards often present
    let hasExternalLink = false;
    if (hasCard) {
      const cardHref = article.querySelector(
        '[data-testid="card.wrapper"] a[href*="http"], [data-testid="card.layoutLarge.media"] a'
      );
      if (cardHref) hasExternalLink = true;
    }
    if (/https?:\/\//i.test(text) && !hasPhoto && !hasVideo) {
      // bare URL in text — may be external
      hasExternalLink = hasExternalLink || /https?:\/\/(?!x\.com|twitter\.com|t\.co)/i.test(text);
    }

    // Social context — reply / retweet
    const socialContext = textContent(
      article.querySelector('[data-testid="socialContext"]')
    );
    const isRetweet =
      /reposted|retweeted/i.test(socialContext) ||
      !!article.querySelector('[data-testid="socialContext"]');
    // More precise: only if social context says reposted
    const isRepost = /reposted|retweeted/i.test(socialContext);

    const replyContext = article.querySelector(
      'div[role="link"] a[href*="/status/"], [data-testid="tweet"] a[href*="/status/"]'
    );
    // Reply indicator in text "Replying to"
    const isReply =
      /replying to/i.test(article.innerText?.slice(0, 200) || "") ||
      !!article.querySelector('[data-testid="tweet"] [href*="/status/"]') &&
        article.querySelectorAll('[data-testid="tweetText"]').length > 1;

    // Simpler reply check
    const replyTo = /Replying to/i.test(
      textContent(article.querySelector('[data-testid="tweet"]')) ||
        article.innerText?.slice(0, 120) ||
        ""
    );

    // Quote tweet
    const isQuote = !!article.querySelector(
      '[data-testid="quoteTweet"], div[role="link"][tabindex="0"] [data-testid="tweetText"]'
    );

    // Metrics
    const replyCount = parseCount(
      article.querySelector('[data-testid="reply"]')?.getAttribute("aria-label") ||
        textContent(article.querySelector('[data-testid="reply"] span'))
    );
    const repostCount = parseCount(
      article
        .querySelector('[data-testid="retweet"]')
        ?.getAttribute("aria-label") ||
        textContent(article.querySelector('[data-testid="retweet"] span'))
    );
    const likeCount = parseCount(
      article.querySelector('[data-testid="like"]')?.getAttribute("aria-label") ||
        article
          .querySelector('[data-testid="unlike"]')
          ?.getAttribute("aria-label") ||
        textContent(article.querySelector('[data-testid="like"] span')) ||
        textContent(article.querySelector('[data-testid="unlike"] span'))
    );

    // Views — analytics link
    let viewCount = 0;
    const analytics = article.querySelector('a[href*="/analytics"]');
    if (analytics) {
      viewCount = parseCount(
        analytics.getAttribute("aria-label") || textContent(analytics)
      );
    }
    // fallback: aria group
    if (!viewCount) {
      const viewEl = article.querySelector('[href$="/analytics"] span, a[aria-label*="view" i]');
      viewCount = parseCount(textContent(viewEl) || viewEl?.getAttribute?.("aria-label"));
    }

    // Bookmarks if visible
    const bookmarkCount = parseCount(
      article
        .querySelector('[data-testid="bookmark"]')
        ?.getAttribute("aria-label") ||
        article
          .querySelector('[data-testid="removeBookmark"]')
          ?.getAttribute("aria-label")
    );

    // Age from snowflake
    let ageHours = null;
    if (tweetId && root.NARVSnowflake) {
      ageHours = root.NARVSnowflake.tweetAgeHours(tweetId);
    }
    // also try time element datetime
    const timeEl = article.querySelector("time");
    let createdAt = timeEl?.getAttribute("datetime") || null;

    const url = tweetId
      ? `https://x.com/${authorHandle || "i"}/status/${tweetId}`
      : null;

    return {
      tweetId,
      authorId: authorHandle, // screen name proxy; numeric id not always in DOM
      authorHandle,
      authorName,
      authorVerified,
      authorPremium: authorVerified,
      authorFollowers: 0, // not on timeline cards without profile hydration
      text,
      url,
      hasMedia: hasPhoto || hasVideo || hasGif,
      hasImage: hasPhoto || hasGif,
      hasVideo,
      hasGif,
      hasPoll,
      hasExternalLink,
      isReply: replyTo || false,
      isQuote,
      isRetweet: isRepost,
      isThread: false,
      likeCount,
      replyCount,
      repostCount,
      quoteCount: 0,
      viewCount,
      bookmarkCount,
      ageHours,
      createdAt,
      socialContext,
      source: "dom",
    };
  }

  /**
   * Parse from status page URL + main article.
   */
  function parseStatusPage() {
    const m = location.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const article =
      document.querySelector('article[data-testid="tweet"]') ||
      document.querySelector("article");
    const tweet = parseTweetArticle(article);
    if (tweet) {
      tweet.authorHandle = tweet.authorHandle || m[1];
      tweet.tweetId = tweet.tweetId || m[2];
      tweet.url = `https://x.com/${m[1]}/status/${m[2]}`;
      if (root.NARVSnowflake && !tweet.ageHours) {
        tweet.ageHours = root.NARVSnowflake.tweetAgeHours(tweet.tweetId);
      }
    }
    return tweet;
  }

  /**
   * All visible tweet articles on timeline.
   */
  function parseVisibleTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const out = [];
    const seen = new Set();
    for (const a of articles) {
      const t = parseTweetArticle(a);
      if (t && t.tweetId && !seen.has(t.tweetId)) {
        seen.add(t.tweetId);
        out.push({ tweet: t, element: a });
      }
    }
    return out;
  }

  const NARVParser = {
    parseCount,
    getStatusIdFromHref,
    findArticle,
    parseTweetArticle,
    parseStatusPage,
    parseVisibleTweets,
  };

  root.NARVParser = NARVParser;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVParser;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
