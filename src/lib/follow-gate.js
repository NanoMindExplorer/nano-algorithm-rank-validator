/**
 * Follow gate — tools require following @Deadmouse_jpeg on X.
 *
 * Verifies via X web API (session cookies on x.com) when possible.
 * Caches positive results briefly; negative/unknown always re-checkable.
 */

(function (root) {
  "use strict";

  const REQUIRED_HANDLE = "Deadmouse_jpeg";
  const PROFILE_URL = `https://x.com/${REQUIRED_HANDLE}`;
  const CACHE_KEY = "narvFollowGate";
  const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for positive only

  // Public X web client bearer (same as x.com frontend bundle)
  const X_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  function getCookie(name) {
    try {
      const m = document.cookie.match(
        new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
      );
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  function normalizeHandle(h) {
    return String(h || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  /**
   * Detect logged-in screen name from X page globals / DOM.
   * Owner @Deadmouse_jpeg cannot follow themselves — must unlock as self.
   */
  function detectLoggedInHandle() {
    try {
      // Legacy twttr / __INITIAL_STATE__ style
      const initial =
        window.__INITIAL_STATE__ ||
        window.__NEXT_DATA__ ||
        null;
      if (initial?.session?.user?.screen_name) {
        return normalizeHandle(initial.session.user.screen_name);
      }
    } catch {
      /* ignore */
    }

    try {
      // Account switcher / profile link in side nav
      const selectors = [
        '[data-testid="SideNav_AccountSwitcher_Button"] [dir="ltr"]',
        'a[data-testid="AppTabBar_Profile_Link"]',
        '[data-testid="UserAvatar-Container-unknown"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const href = el.getAttribute?.("href") || el.closest?.("a")?.getAttribute?.("href");
        if (href && /^\/[A-Za-z0-9_]+\/?$/.test(href.split("?")[0])) {
          return normalizeHandle(href.replace(/\//g, ""));
        }
        const text = (el.textContent || "").trim();
        if (text.startsWith("@")) return normalizeHandle(text);
      }

      // Profile nav: /i/user/... or /{handle}
      const profileLink = document.querySelector(
        'nav a[href^="/"][aria-label*="Profile"], a[data-testid="AppTabBar_Profile_Link"]'
      );
      if (profileLink) {
        const href = profileLink.getAttribute("href") || "";
        const m = href.match(/^\/([A-Za-z0-9_]+)\/?$/);
        if (m) return normalizeHandle(m[1]);
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  function isOwnerAccount(handle) {
    return normalizeHandle(handle) === normalizeHandle(REQUIRED_HANDLE);
  }

  async function readCache() {
    try {
      const data = await chrome.storage.local.get({ [CACHE_KEY]: null });
      return data[CACHE_KEY] || null;
    } catch {
      return null;
    }
  }

  async function writeCache(payload) {
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: payload });
    } catch {
      /* ignore */
    }
  }

  async function clearCache() {
    try {
      await chrome.storage.local.remove(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  /**
   * Primary: friendships/show.json as logged-in user.
   */
  async function checkViaApi() {
    const ct0 = getCookie("ct0");
    if (!ct0) {
      return {
        following: false,
        reason: "not_logged_in",
        message: "Login ke X dulu, lalu cek ulang.",
      };
    }

    // Prefer identity check first — owner cannot follow self
    try {
      if (await checkIfSelfViaVerify()) {
        return {
          following: true,
          reason: "owner",
          message: `Owner unlock — logged in as @${REQUIRED_HANDLE}`,
          isOwner: true,
          raw: { source: { screen_name: REQUIRED_HANDLE } },
        };
      }
    } catch {
      /* continue to friendship check */
    }

    const url =
      `https://x.com/i/api/1.1/friendships/show.json?` +
      `target_screen_name=${encodeURIComponent(REQUIRED_HANDLE)}`;

    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${X_BEARER}`,
        "x-csrf-token": ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        following: false,
        reason: "auth_failed",
        message: "Sesi X tidak valid. Refresh halaman atau login ulang.",
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Friendships API HTTP ${res.status}: ${text.slice(0, 120)}`);
    }

    const data = await res.json();
    const sourceName = data?.relationship?.source?.screen_name;
    if (sourceName && isOwnerAccount(sourceName)) {
      return {
        following: true,
        reason: "owner",
        message: `Owner unlock — logged in as @${REQUIRED_HANDLE}`,
        isOwner: true,
        raw: { source: data?.relationship?.source || null },
      };
    }

    const following = !!(
      data?.relationship?.source?.following ||
      data?.relationship?.target?.followed_by
    );

    return {
      following,
      reason: following ? "ok" : "not_following",
      message: following
        ? `Terhubung — following @${REQUIRED_HANDLE}`
        : `Follow @${REQUIRED_HANDLE} dulu untuk membuka tools.`,
      raw: {
        following,
        source: data?.relationship?.source || null,
      },
    };
  }

  /**
   * Fallback: open profile relationship via GraphQL UserByScreenName if available,
   * else inspect DOM if user is already on the required profile.
   */
  async function checkViaDomFallback() {
    const path = (location.pathname || "").replace(/\/$/, "");
    const onProfile =
      path.toLowerCase() === `/${REQUIRED_HANDLE.toLowerCase()}` ||
      path.toLowerCase() === `/${REQUIRED_HANDLE.toLowerCase()}/`;

    if (onProfile) {
      // Following button states on X
      const followingBtn =
        document.querySelector('[data-testid$="-unfollow"]') ||
        document.querySelector('[data-testid="placementTracking"] [data-testid$="-unfollow"]') ||
        [...document.querySelectorAll('[role="button"]')].find((el) =>
          /following|mengikuti/i.test(el.getAttribute("aria-label") || el.textContent || "")
        );
      const followBtn = [...document.querySelectorAll('[role="button"]')].find((el) => {
        const t = (el.getAttribute("aria-label") || el.textContent || "").trim();
        return /^follow |^ikuti /i.test(t) && !/following|mengikuti/i.test(t);
      });

      if (followingBtn) {
        return {
          following: true,
          reason: "ok_dom",
          message: `Following @${REQUIRED_HANDLE} (terdeteksi di profil)`,
        };
      }
      if (followBtn) {
        return {
          following: false,
          reason: "not_following",
          message: `Kamu belum follow @${REQUIRED_HANDLE}. Klik Follow di profil ini.`,
        };
      }
    }

    return {
      following: false,
      reason: "unknown",
      message: "Tidak bisa memverifikasi follow. Buka profil @Deadmouse_jpeg lalu cek ulang.",
    };
  }

  /**
   * Full check with cache for positive results.
   * @param {{ force?: boolean }} opts
   */
  async function ensureFollowing(opts = {}) {
    const force = !!opts.force;

    // Owner bypass: X does not allow following yourself
    const me = detectLoggedInHandle();
    if (me && isOwnerAccount(me)) {
      const ownerResult = {
        following: true,
        reason: "owner",
        message: `Owner unlock — logged in as @${REQUIRED_HANDLE}`,
        isOwner: true,
        requiredHandle: REQUIRED_HANDLE,
        profileUrl: PROFILE_URL,
        checkedAt: Date.now(),
      };
      await writeCache({
        following: true,
        checkedAt: ownerResult.checkedAt,
        message: ownerResult.message,
        isOwner: true,
      });
      return ownerResult;
    }

    if (!force) {
      const cached = await readCache();
      if (
        cached &&
        cached.following === true &&
        cached.checkedAt &&
        Date.now() - cached.checkedAt < CACHE_TTL_MS
      ) {
        return {
          following: true,
          reason: "cache",
          message: cached.message || `Following @${REQUIRED_HANDLE}`,
          fromCache: true,
          isOwner: !!cached.isOwner,
          requiredHandle: REQUIRED_HANDLE,
          profileUrl: PROFILE_URL,
        };
      }
    }

    let result;
    try {
      result = await checkViaApi();
      // API may also reveal source screen_name
      const sourceName =
        result?.raw?.source?.screen_name ||
        result?.raw?.source?.screenName ||
        null;
      if (sourceName && isOwnerAccount(sourceName)) {
        result = {
          following: true,
          reason: "owner",
          message: `Owner unlock — logged in as @${REQUIRED_HANDLE}`,
          isOwner: true,
        };
      }
    } catch (e) {
      try {
        result = await checkViaDomFallback();
        result.apiError = e.message || String(e);
      } catch (e2) {
        result = {
          following: false,
          reason: "error",
          message: e.message || String(e),
        };
      }
    }

    // If still locked, re-check owner via API verify_credentials style path
    if (!result.following) {
      try {
        const ownerFromApi = await checkIfSelfViaVerify();
        if (ownerFromApi) {
          result = {
            following: true,
            reason: "owner",
            message: `Owner unlock — logged in as @${REQUIRED_HANDLE}`,
            isOwner: true,
          };
        }
      } catch {
        /* ignore */
      }
    }

    result.requiredHandle = REQUIRED_HANDLE;
    result.profileUrl = PROFILE_URL;
    result.checkedAt = Date.now();

    if (result.following) {
      await writeCache({
        following: true,
        checkedAt: result.checkedAt,
        message: result.message,
        isOwner: !!result.isOwner,
      });
    } else {
      // Don't cache negatives long — user may follow immediately
      await writeCache({
        following: false,
        checkedAt: result.checkedAt,
        message: result.message,
      });
    }

    return result;
  }

  /**
   * Confirm session user is the required handle (account owner).
   */
  async function checkIfSelfViaVerify() {
    const ct0 = getCookie("ct0");
    if (!ct0) return false;

    const res = await fetch("https://x.com/i/api/1.1/account/verify_credentials.json", {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${X_BEARER}`,
        "x-csrf-token": ct0,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
      },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return isOwnerAccount(data?.screen_name);
  }

  /**
   * Guard helper: returns true if allowed, false if blocked.
   * onBlocked(result) optional callback.
   */
  async function requireFollow(onBlocked) {
    const status = await ensureFollowing({ force: false });
    if (status.following) return true;
    if (typeof onBlocked === "function") onBlocked(status);
    return false;
  }

  const NARVFollowGate = {
    REQUIRED_HANDLE,
    PROFILE_URL,
    ensureFollowing,
    requireFollow,
    clearCache,
    checkViaApi,
    detectLoggedInHandle,
    isOwnerAccount,
  };

  root.NARVFollowGate = NARVFollowGate;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVFollowGate;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
