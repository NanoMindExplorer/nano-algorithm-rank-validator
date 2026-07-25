/**
 * Mass unfollow toolkit for X (logged-in web session).
 *
 * Features:
 *  - Detect accounts you follow who do NOT follow back
 *  - Configurable delay (ms) between each unfollow (+ optional jitter)
 *  - Whitelist (handles never unfollowed)
 *  - Optional skip: verified / blue / protected / high-follower
 *  - Preview (dry-run), pause / resume / stop
 *  - Session cap + daily soft cap for account safety
 *
 * Uses X web API (ct0 + bearer) — same pattern as follow-gate / shadowban.
 * Aggressive automation can trigger rate limits or visibility filters.
 */

(function (root) {
  "use strict";

  const X_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const STORAGE_KEY = "narvMassUnfollow";
  const DEFAULTS = {
    delayMs: 45000, // 45s between unfollows (safe default)
    jitterMs: 10000, // +0..jitter random
    sessionMax: 40, // max unfollows per run
    dailyMax: 120, // soft daily cap stored locally
    onlyNonFollowers: true,
    skipVerified: true,
    skipProtected: false,
    skipMinFollowers: 0, // skip if target followers >= this (0 = off)
    whitelist: [], // lowercased handles without @
  };

  /** @type {null | { running:boolean, paused:boolean, stop:boolean, stats:object }} */
  let job = null;

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

  function authHeaders(extra = {}) {
    const ct0 = getCookie("ct0");
    if (!ct0) return null;
    return {
      accept: "application/json, text/javascript, */*; q=0.01",
      authorization: `Bearer ${X_BEARER}`,
      "x-csrf-token": ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      ...extra,
    };
  }

  function normalizeHandle(h) {
    return String(h || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
  }

  function sleep(ms, shouldAbort) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (shouldAbort && shouldAbort()) {
          reject(new Error("aborted"));
          return;
        }
        if (job && job.paused) {
          setTimeout(tick, 250);
          return;
        }
        const left = ms - (Date.now() - start);
        if (left <= 0) resolve();
        else setTimeout(tick, Math.min(250, left));
      };
      tick();
    });
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.sync.get({ [STORAGE_KEY]: null });
      const s = data[STORAGE_KEY] || {};
      return {
        ...DEFAULTS,
        ...s,
        whitelist: Array.isArray(s.whitelist)
          ? s.whitelist.map(normalizeHandle).filter(Boolean)
          : [...DEFAULTS.whitelist],
      };
    } catch {
      return { ...DEFAULTS, whitelist: [] };
    }
  }

  async function saveSettings(partial) {
    const cur = await loadSettings();
    const next = {
      ...cur,
      ...partial,
      whitelist: (partial.whitelist != null ? partial.whitelist : cur.whitelist)
        .map(normalizeHandle)
        .filter(Boolean),
    };
    // clamp
    next.delayMs = Math.max(5000, Math.min(600000, Number(next.delayMs) || DEFAULTS.delayMs));
    next.jitterMs = Math.max(0, Math.min(120000, Number(next.jitterMs) || 0));
    next.sessionMax = Math.max(1, Math.min(500, Number(next.sessionMax) || 40));
    next.dailyMax = Math.max(1, Math.min(2000, Number(next.dailyMax) || 120));
    next.skipMinFollowers = Math.max(0, Number(next.skipMinFollowers) || 0);
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    return next;
  }

  async function loadDailyStats() {
    const key = "narvUnfollowDaily";
    const day = new Date().toISOString().slice(0, 10);
    try {
      const data = await chrome.storage.local.get({ [key]: null });
      const s = data[key];
      if (!s || s.day !== day) return { day, count: 0 };
      return s;
    } catch {
      return { day, count: 0 };
    }
  }

  async function bumpDaily(n = 1) {
    const key = "narvUnfollowDaily";
    const s = await loadDailyStats();
    s.count = (s.count || 0) + n;
    await chrome.storage.local.set({ [key]: s });
    return s;
  }

  async function xGet(url) {
    const headers = authHeaders();
    if (!headers) {
      const e = new Error("not_logged_in");
      e.code = "not_logged_in";
      throw e;
    }
    const res = await fetch(url, { method: "GET", credentials: "include", headers });
    return res;
  }

  async function xPostForm(url, params) {
    const headers = authHeaders({
      "content-type": "application/x-www-form-urlencoded",
    });
    if (!headers) {
      const e = new Error("not_logged_in");
      e.code = "not_logged_in";
      throw e;
    }
    const body = new URLSearchParams(params).toString();
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      body,
    });
    return res;
  }

  async function getMe() {
    const res = await xGet(
      "https://x.com/i/api/1.1/account/verify_credentials.json?skip_status=true"
    );
    if (!res.ok) throw new Error(`verify_credentials HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Paginate friends/ids or followers/ids
   */
  async function fetchAllIds(kind, screenName) {
    // kind: friends | followers
    const ids = [];
    let cursor = "-1";
    let pages = 0;
    const maxPages = 40; // safety ~200k ids theoretically; stop early for UX

    while (cursor !== "0" && pages < maxPages) {
      const url =
        `https://x.com/i/api/1.1/${kind}/ids.json?` +
        `screen_name=${encodeURIComponent(screenName)}` +
        `&count=5000&stringify_ids=true&cursor=${encodeURIComponent(cursor)}`;
      const res = await xGet(url);
      if (res.status === 429) {
        throw new Error("rate_limited_ids");
      }
      if (!res.ok) {
        throw new Error(`${kind}/ids HTTP ${res.status}`);
      }
      const data = await res.json();
      const chunk = (data.ids || []).map(String);
      ids.push(...chunk);
      cursor = String(data.next_cursor_str ?? data.next_cursor ?? "0");
      pages++;
      if (!chunk.length) break;
      // gentle pause between pages
      await sleep(400 + Math.random() * 400);
    }
    return ids;
  }

  /**
   * Lookup users in batches of 100
   */
  async function lookupUsers(ids) {
    const out = [];
    let attempted = 0;
    let failed = 0;
    let lastStatus = null;
    let lastError = null;

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const url =
        `https://x.com/i/api/1.1/users/lookup.json?` +
        `user_id=${encodeURIComponent(batch.join(","))}` +
        `&include_entities=false`;
      attempted++;
      try {
        const res = await xGet(url);
        if (res.status === 429) throw new Error("rate_limited_lookup");
        if (!res.ok) {
          // partial failure — record and continue (other batches may still work)
          failed++;
          lastStatus = res.status;
          await sleep(1000);
          continue;
        }
        const users = await res.json();
        if (Array.isArray(users)) out.push(...users);
      } catch (e) {
        if (e.message === "rate_limited_lookup") throw e;
        failed++;
        lastError = e.message || String(e);
      }
      await sleep(300 + Math.random() * 400);
    }

    // If literally every batch failed, don't silently return an empty list —
    // that previously showed up as "0 candidates found" with no explanation.
    // Surface it as a real error so it's clear the lookup API is the problem.
    if (attempted > 0 && failed === attempted) {
      const err = new Error(
        `users/lookup.json gagal untuk semua ${attempted} batch ` +
          `(HTTP ${lastStatus ?? "?"}${lastError ? " — " + lastError : ""}). ` +
          `Endpoint mungkin berubah/diblokir X — cek tab Network di DevTools.`
      );
      err.code = "lookup_failed_all";
      throw err;
    }

    return out;
  }

  function userToRow(u) {
    return {
      id: String(u.id_str || u.id),
      screen_name: u.screen_name,
      name: u.name || u.screen_name,
      followers_count: u.followers_count ?? 0,
      friends_count: u.friends_count ?? 0,
      protected: !!u.protected,
      verified: !!(u.verified || u.is_blue_verified || u.ext_is_blue_verified),
      description: (u.description || "").slice(0, 160),
      profile_image_url_https: u.profile_image_url_https || "",
    };
  }

  /**
   * Build candidate list: following who don't follow back, minus whitelist/skips.
   */
  async function analyzeFollowing(options = {}) {
    const settings = { ...(await loadSettings()), ...options };
    const me = await getMe();
    const myHandle = normalizeHandle(me.screen_name);

    const [followingIds, followerIds] = await Promise.all([
      fetchAllIds("friends", me.screen_name),
      fetchAllIds("followers", me.screen_name),
    ]);

    const followerSet = new Set(followerIds.map(String));
    const whitelist = new Set(settings.whitelist.map(normalizeHandle));

    let targetIds = followingIds.map(String);
    if (settings.onlyNonFollowers) {
      targetIds = targetIds.filter((id) => !followerSet.has(id));
    }

    // Lookup for handles + skip rules
    const users = await lookupUsers(targetIds);
    const byId = new Map(users.map((u) => [String(u.id_str || u.id), u]));

    const candidates = [];
    const skipped = [];

    for (const id of targetIds) {
      const u = byId.get(id);
      if (!u) {
        skipped.push({ id, reason: "lookup_failed" });
        continue;
      }
      const handle = normalizeHandle(u.screen_name);
      if (handle === myHandle) {
        skipped.push({ id, handle, reason: "self" });
        continue;
      }
      if (whitelist.has(handle)) {
        skipped.push({ id, handle, reason: "whitelist" });
        continue;
      }
      if (settings.skipVerified && (u.verified || u.is_blue_verified)) {
        skipped.push({ id, handle, reason: "verified" });
        continue;
      }
      if (settings.skipProtected && u.protected) {
        skipped.push({ id, handle, reason: "protected" });
        continue;
      }
      if (
        settings.skipMinFollowers > 0 &&
        (u.followers_count || 0) >= settings.skipMinFollowers
      ) {
        skipped.push({ id, handle, reason: "high_followers" });
        continue;
      }
      candidates.push({
        ...userToRow(u),
        followsYou: followerSet.has(id),
      });
    }

    // Sort: fewer followers first (usually safer / less "important")
    candidates.sort((a, b) => a.followers_count - b.followers_count);

    const lookupFailedCount = skipped.filter((s) => s.reason === "lookup_failed").length;
    const warnings = [];
    if (lookupFailedCount > 0 && targetIds.length > 0) {
      const pct = Math.round((lookupFailedCount / targetIds.length) * 100);
      warnings.push(
        `${lookupFailedCount} akun (${pct}%) gagal di-lookup (users/lookup.json) dan ` +
          `tidak muncul di kandidat — kemungkinan rate limit sementara, bukan berarti kamu ` +
          `sudah follow-back semua orang. Coba scan ulang beberapa menit lagi.`
      );
    }

    return {
      me: {
        id: String(me.id_str || me.id),
        screen_name: me.screen_name,
        following: followingIds.length,
        followers: followerIds.length,
      },
      settings,
      followingCount: followingIds.length,
      followerCount: followerIds.length,
      nonFollowerCount: followingIds.filter((id) => !followerSet.has(String(id)))
        .length,
      candidates,
      skipped,
      warnings,
      analyzedAt: new Date().toISOString(),
    };
  }

  async function unfollowUser(userId) {
    const res = await xPostForm(
      "https://x.com/i/api/1.1/friendships/destroy.json",
      { user_id: String(userId) }
    );
    if (res.status === 429) {
      const err = new Error("rate_limited_unfollow");
      err.code = "rate_limited";
      throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`unfollow HTTP ${res.status}: ${text.slice(0, 120)}`);
      err.code = "http_" + res.status;
      throw err;
    }
    return res.json();
  }

  function getJob() {
    return job;
  }

  function stopJob() {
    if (job) {
      job.stop = true;
      job.paused = false;
      job.running = false;
    }
  }

  function pauseJob() {
    if (job && job.running) job.paused = true;
  }

  function resumeJob() {
    if (job) job.paused = false;
  }

  /**
   * Run mass unfollow on candidate list.
   * @param {Array} candidates rows with {id, screen_name}
   * @param {object} options delayMs, jitterMs, sessionMax, onProgress
   */
  async function runUnfollow(candidates, options = {}) {
    const settings = { ...(await loadSettings()), ...options };
    const daily = await loadDailyStats();
    const dailyLeft = Math.max(0, settings.dailyMax - (daily.count || 0));
    const sessionMax = Math.min(
      settings.sessionMax,
      dailyLeft,
      candidates.length
    );

    if (sessionMax <= 0) {
      return {
        ok: false,
        error:
          dailyLeft <= 0
            ? `Daily soft cap tercapai (${settings.dailyMax}/hari). Coba besok.`
            : "Tidak ada kandidat.",
        stats: null,
      };
    }

    const queue = candidates.slice(0, sessionMax);
    job = {
      running: true,
      paused: false,
      stop: false,
      stats: {
        total: queue.length,
        done: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        log: [],
        startedAt: Date.now(),
      },
    };

    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};

    for (let i = 0; i < queue.length; i++) {
      if (job.stop) {
        job.stats.log.push({ t: Date.now(), type: "stop", msg: "Dihentikan user" });
        break;
      }

      // pause loop handled in sleep
      const user = queue[i];
      const handle = normalizeHandle(user.screen_name);
      const whitelist = new Set(settings.whitelist.map(normalizeHandle));
      if (whitelist.has(handle)) {
        job.stats.skipped++;
        job.stats.done++;
        job.stats.log.push({
          t: Date.now(),
          type: "skip",
          handle,
          msg: "whitelist",
        });
        onProgress({ ...job.stats, current: user, phase: "skip" });
        continue;
      }

      try {
        onProgress({ ...job.stats, current: user, phase: "unfollowing" });
        await unfollowUser(user.id);
        job.stats.success++;
        await bumpDaily(1);
        job.stats.log.push({
          t: Date.now(),
          type: "ok",
          handle,
          msg: "unfollowed",
        });
      } catch (e) {
        job.stats.failed++;
        const msg = e.message || String(e);
        job.stats.errors.push({ handle, msg });
        job.stats.log.push({ t: Date.now(), type: "err", handle, msg });
        onProgress({ ...job.stats, current: user, phase: "error", error: msg });
        if (e.code === "rate_limited" || /429|rate_limited/i.test(msg)) {
          job.stats.log.push({
            t: Date.now(),
            type: "stop",
            msg: "Rate limited — stop otomatis",
          });
          break;
        }
      }

      job.stats.done++;
      onProgress({ ...job.stats, current: user, phase: "done_one" });

      // delay before next (except last)
      if (i < queue.length - 1 && !job.stop) {
        const delay =
          settings.delayMs + Math.floor(Math.random() * (settings.jitterMs || 0));
        onProgress({
          ...job.stats,
          current: user,
          phase: "waiting",
          waitMs: delay,
        });
        try {
          await sleep(delay, () => job && job.stop);
        } catch {
          break;
        }
      }
    }

    job.running = false;
    job.paused = false;
    const finalStats = { ...job.stats, finishedAt: Date.now() };
    onProgress({ ...finalStats, phase: "finished" });
    return { ok: true, stats: finalStats };
  }

  const SAFETY_NOTES = [
    "X membatasi unfollow massal — delay terlalu pendek = rate limit / risiko filter akun.",
    "Default aman: 30–60 detik/unfollow, ≤40 per sesi, ≤100–150 per hari.",
    "Whitelist selalu dihormati (mis. teman, brand, klien).",
    "Hentikan jika muncul error 429 atau gejala shadowban (pakai cek Shadowban NARV).",
    "Ini tool manajemen akun pribadi — bukan untuk spam / harass.",
  ];

  const NARVMassUnfollow = {
    DEFAULTS,
    STORAGE_KEY,
    SAFETY_NOTES,
    loadSettings,
    saveSettings,
    loadDailyStats,
    analyzeFollowing,
    runUnfollow,
    getJob,
    stopJob,
    pauseJob,
    resumeJob,
    normalizeHandle,
    unfollowUser,
  };

  root.NARVMassUnfollow = NARVMassUnfollow;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVMassUnfollow;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
