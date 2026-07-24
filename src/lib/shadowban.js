/**
 * Shadowban / visibility restriction checker for X (Twitter).
 *
 * Research-backed checks (public knowledge, web client session):
 * 1. Profile status — exists, suspended, protected, limited labels
 * 2. Search Suggestion Ban — typeahead does not surface the handle
 * 3. Search Ban — recent posts on profile missing from from:user search
 * 4. Ghost / reply visibility — heuristic via conversation search (best-effort)
 * 5. Behavioral risk score — local heuristics from public metrics / bio / rate
 *
 * Not official X API product names. Results are probabilistic visibility signals.
 */

(function (root) {
  "use strict";

  const X_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const SEVERITY = {
    clear: { level: 0, label: "Clear", color: "#00ba7c" },
    low: { level: 1, label: "Low risk", color: "#1d9bf0" },
    medium: { level: 2, label: "Possible restriction", color: "#ffd400" },
    high: { level: 3, label: "Likely restricted", color: "#ff7a00" },
    critical: { level: 4, label: "Severe / account issue", color: "#f4212e" },
  };

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
      .replace(/^@+/, "")
      .replace(/https?:\/\/(x|twitter)\.com\//i, "")
      .split(/[/?#]/)[0]
      .replace(/[^A-Za-z0-9_]/g, "");
  }

  function authHeaders() {
    const ct0 = getCookie("ct0");
    if (!ct0) return null;
    return {
      accept: "application/json, text/javascript, */*; q=0.01",
      authorization: `Bearer ${X_BEARER}`,
      "x-csrf-token": ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
    };
  }

  async function xFetch(url) {
    const headers = authHeaders();
    if (!headers) {
      const err = new Error("not_logged_in");
      err.code = "not_logged_in";
      throw err;
    }
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers,
    });
    return res;
  }

  /**
   * Resolve currently viewed profile handle from URL or logged-in user.
   */
  function resolveTargetHandle(explicit) {
    if (explicit) return normalizeHandle(explicit);
    const path = (location.pathname || "").replace(/\/$/, "");
    const m = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
    const reserved = new Set([
      "home",
      "explore",
      "search",
      "settings",
      "i",
      "messages",
      "notifications",
      "compose",
      "login",
      "signup",
      "tos",
      "privacy",
    ]);
    if (m && !reserved.has(m[1].toLowerCase())) return normalizeHandle(m[1]);
    if (root.NARVFollowGate?.detectLoggedInHandle) {
      return normalizeHandle(root.NARVFollowGate.detectLoggedInHandle());
    }
    return "";
  }

  async function fetchUserShow(screenName) {
    const url =
      `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(screenName)}` +
      `&include_entities=true`;
    const res = await xFetch(url);
    if (res.status === 404) {
      return { ok: false, reason: "not_found", user: null };
    }
    if (res.status === 403) {
      // suspended or blocked often 403
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        reason: /suspend/i.test(text) ? "suspended" : "forbidden",
        user: null,
        detail: text.slice(0, 200),
      };
    }
    if (!res.ok) {
      throw new Error(`users/show HTTP ${res.status}`);
    }
    const user = await res.json();
    return { ok: true, reason: "ok", user };
  }

  /**
   * Search suggestion ban: typeahead should include exact handle when queried.
   */
  async function checkSearchSuggestionBan(screenName) {
    const q = screenName;
    const url =
      `https://x.com/i/api/1.1/search/typeahead.json?` +
      `q=${encodeURIComponent(q)}&src=search_box&result_type=users&count=20`;
    const res = await xFetch(url);
    if (!res.ok) {
      return {
        id: "search_suggestion_ban",
        status: "unknown",
        title: "Search Suggestion Ban",
        detail: `Typeahead API HTTP ${res.status}`,
        severity: "low",
      };
    }
    const data = await res.json();
    const users = data.users || data.user || [];
    const list = Array.isArray(users) ? users : [];
    const hit = list.some(
      (u) => normalizeHandle(u.screen_name) === normalizeHandle(screenName)
    );
    // Also accept if any result is the same user id later
    return {
      id: "search_suggestion_ban",
      status: hit ? "clear" : "flagged",
      title: "Search Suggestion Ban",
      detail: hit
        ? `@${screenName} muncul di saran pencarian (typeahead).`
        : `@${screenName} TIDAK muncul di saran pencarian saat query handle — indikasi Search Suggestion Ban.`,
      severity: hit ? "clear" : "high",
      evidence: {
        query: q,
        resultCount: list.length,
        handles: list.slice(0, 8).map((u) => u.screen_name),
      },
    };
  }

  /**
   * Fetch recent status IDs from user timeline (profile activity).
   */
  async function fetchUserTimelineIds(screenName, count = 8) {
    const url =
      `https://x.com/i/api/1.1/statuses/user_timeline.json?` +
      `screen_name=${encodeURIComponent(screenName)}` +
      `&count=${count}&include_rts=1&exclude_replies=0&tweet_mode=extended`;
    const res = await xFetch(url);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, ids: [], statuses: [], http: res.status };
    }
    if (!res.ok) {
      return { ok: false, ids: [], statuses: [], http: res.status };
    }
    const statuses = await res.json();
    const arr = Array.isArray(statuses) ? statuses : [];
    return {
      ok: true,
      ids: arr.map((s) => String(s.id_str || s.id)).filter(Boolean),
      statuses: arr,
      http: 200,
    };
  }

  /**
   * Search ban: recent tweet IDs should appear when searching from:user
   */
  async function checkSearchBan(screenName, timelineIds) {
    if (!timelineIds.length) {
      return {
        id: "search_ban",
        status: "unknown",
        title: "Search Ban",
        detail:
          "Tidak ada tweet terbaru di timeline untuk diuji, atau timeline tidak bisa diakses. Posting dulu lalu cek ulang.",
        severity: "low",
      };
    }

    // Prefer latest original (non-RT) if possible — handled by caller order
    const sampleIds = timelineIds.slice(0, 5);
    const q = `from:${screenName}`;
    // Adaptive search (classic web)
    const url =
      `https://x.com/i/api/2/search/adaptive.json?` +
      `q=${encodeURIComponent(q)}` +
      `&count=20&query_source=typed_query&pc=1&spelling_corrections=1` +
      `&tweet_mode=extended`;

    let foundIds = new Set();
    let http = 0;
    let method = "adaptive";

    try {
      const res = await xFetch(url);
      http = res.status;
      if (res.ok) {
        const data = await res.json();
        const tweets = data?.globalObjects?.tweets || {};
        Object.keys(tweets).forEach((id) => foundIds.add(String(id)));
        // Also walk instructions if present
        const instr =
          data?.timeline?.instructions ||
          data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
          [];
        // no-op if empty
        void instr;
      }
    } catch {
      /* try fallback */
    }

    // Fallback: GraphQL-less simple search via 1.1 if adaptive empty/fail
    if (!foundIds.size) {
      try {
        const url2 =
          `https://x.com/i/api/1.1/search/tweets.json?` +
          `q=${encodeURIComponent(q)}&count=20&result_type=recent&tweet_mode=extended`;
        const res2 = await xFetch(url2);
        http = res2.status;
        method = "search_tweets";
        if (res2.ok) {
          const data2 = await res2.json();
          const statuses = data2.statuses || [];
          statuses.forEach((s) => foundIds.add(String(s.id_str || s.id)));
        }
      } catch {
        /* ignore */
      }
    }

    if (http === 401 || http === 403) {
      return {
        id: "search_ban",
        status: "unknown",
        title: "Search Ban",
        detail: `Search API menolak sesi (HTTP ${http}). Login ulang / refresh x.com.`,
        severity: "low",
      };
    }

    const hits = sampleIds.filter((id) => foundIds.has(String(id)));
    const ratio = hits.length / sampleIds.length;

    let status = "clear";
    let severity = "clear";
    let detail = "";

    if (ratio >= 0.4) {
      status = "clear";
      severity = "clear";
      detail = `${hits.length}/${sampleIds.length} tweet terbaru muncul di pencarian \`from:${screenName}\`. Search ban tidak terdeteksi.`;
    } else if (ratio > 0) {
      status = "partial";
      severity = "medium";
      detail = `Hanya ${hits.length}/${sampleIds.length} tweet terbaru muncul di search. Bisa partial filter / quality filter / delay indexing.`;
    } else if (foundIds.size === 0) {
      status = "flagged";
      severity = "high";
      detail = `Tidak ada tweet dari @${screenName} di hasil search \`from:${screenName}\` padahal timeline punya ${sampleIds.length} post — indikasi kuat Search Ban.`;
    } else {
      status = "flagged";
      severity = "high";
      detail = `Search mengembalikan tweet lain dari user, tapi 0/${sampleIds.length} ID terbaru cocok — indikasi Search Ban / indexing block.`;
    }

    return {
      id: "search_ban",
      status,
      title: "Search Ban",
      detail,
      severity,
      evidence: {
        method,
        http,
        sampleIds,
        hits,
        searchResultCount: foundIds.size,
        ratio,
      },
    };
  }

  /**
   * Ghost ban heuristic: search for replies by user (from:user filter:replies)
   * If user has reply tweets on timeline but zero in search → possible ghost/reply hide.
   */
  async function checkGhostReplyHeuristic(screenName, statuses) {
    const replyStatuses = (statuses || []).filter(
      (s) => s.in_reply_to_status_id_str || s.in_reply_to_status_id
    );
    if (!replyStatuses.length) {
      return {
        id: "ghost_ban",
        status: "unknown",
        title: "Ghost Ban (reply visibility)",
        detail:
          "Tidak ada reply terbaru di timeline untuk diuji. Ghost ban paling akurat diuji manual (lihat tips).",
        severity: "clear",
      };
    }

    const q = `from:${screenName} filter:replies`;
    let found = 0;
    try {
      const url =
        `https://x.com/i/api/1.1/search/tweets.json?` +
        `q=${encodeURIComponent(q)}&count=20&result_type=recent&tweet_mode=extended`;
      const res = await xFetch(url);
      if (res.ok) {
        const data = await res.json();
        found = (data.statuses || []).length;
      } else {
        return {
          id: "ghost_ban",
          status: "unknown",
          title: "Ghost Ban (reply visibility)",
          detail: `Tidak bisa query reply search (HTTP ${res.status}).`,
          severity: "low",
        };
      }
    } catch (e) {
      return {
        id: "ghost_ban",
        status: "unknown",
        title: "Ghost Ban (reply visibility)",
        detail: e.message || String(e),
        severity: "low",
      };
    }

    const replyIds = replyStatuses
      .map((s) => String(s.id_str || s.id))
      .slice(0, 5);

    // Secondary: search each reply id as keyword (weak)
    let idHits = 0;
    for (const id of replyIds.slice(0, 2)) {
      try {
        const url =
          `https://x.com/i/api/1.1/search/tweets.json?` +
          `q=${encodeURIComponent(id)}&count=5&result_type=recent`;
        const res = await xFetch(url);
        if (res.ok) {
          const data = await res.json();
          const statuses = data.statuses || [];
          if (statuses.some((s) => String(s.id_str || s.id) === id)) idHits++;
        }
      } catch {
        /* ignore */
      }
    }

    if (found === 0 && replyStatuses.length >= 2) {
      return {
        id: "ghost_ban",
        status: "flagged",
        title: "Ghost Ban (reply visibility)",
        detail: `Ada ${replyStatuses.length} reply di timeline, tetapi search \`from:${screenName} filter:replies\` kosong — indikasi ghost ban / reply hide (uji manual disarankan).`,
        severity: "high",
        evidence: { replyCount: replyStatuses.length, searchFound: found, idHits },
      };
    }

    if (found > 0) {
      return {
        id: "ghost_ban",
        status: "clear",
        title: "Ghost Ban (reply visibility)",
        detail: `Reply user muncul di search filter:replies (${found} hasil). Ghost ban tidak terdeteksi secara otomatis.`,
        severity: "clear",
        evidence: { replyCount: replyStatuses.length, searchFound: found, idHits },
      };
    }

    return {
      id: "ghost_ban",
      status: "unknown",
      title: "Ghost Ban (reply visibility)",
      detail:
        "Hasil ambigu. Lakukan uji manual: reply thread orang lain dari akun secondary / incognito follower vs non-follower.",
      severity: "low",
      evidence: { replyCount: replyStatuses.length, searchFound: found, idHits },
    };
  }

  /**
   * Account health labels from user object.
   */
  function checkAccountFlags(user) {
    const checks = [];
    if (!user) {
      return [
        {
          id: "profile",
          status: "flagged",
          title: "Profile",
          detail: "Profil tidak ditemukan atau tidak bisa dibaca.",
          severity: "critical",
        },
      ];
    }

    checks.push({
      id: "profile",
      status: "clear",
      title: "Profile accessible",
      detail: `@${user.screen_name} aktif · ${user.followers_count ?? "?"} followers · ${user.statuses_count ?? "?"} posts`,
      severity: "clear",
      evidence: {
        id: user.id_str || user.id,
        protected: !!user.protected,
        verified: !!(user.verified || user.is_blue_verified),
        followers: user.followers_count,
        following: user.friends_count,
        statuses: user.statuses_count,
      },
    });

    if (user.protected) {
      checks.push({
        id: "protected",
        status: "info",
        title: "Protected account",
        detail:
          "Akun protected — search publik terbatas (bukan shadowban, tapi visibilitas OON rendah).",
        severity: "medium",
      });
    }

    // Withheld / limited
    if (user.withheld_in_countries && user.withheld_in_countries.length) {
      checks.push({
        id: "withheld",
        status: "flagged",
        title: "Geo withheld",
        detail: `Konten ditahan di negara: ${user.withheld_in_countries.join(", ")}`,
        severity: "high",
      });
    }

    return checks;
  }

  /**
   * Behavioral risk heuristics (not a ban, but elevates shadowban risk).
   */
  function behavioralRisk(user, statuses) {
    const risks = [];
    const tips = [];
    if (!user) {
      return {
        id: "behavior_risk",
        status: "unknown",
        title: "Behavioral risk",
        detail: "User object missing",
        severity: "low",
        risks,
        tips,
      };
    }

    const followers = Number(user.followers_count || 0);
    const following = Number(user.friends_count || 0);
    const ratio = following > 0 ? followers / following : followers;

    if (following > 2000 && ratio < 0.15) {
      risks.push("Following jauh lebih banyak dari followers (pola follow-spam risk)");
    }

    const recent = statuses || [];
    if (recent.length >= 3) {
      const texts = recent.map((s) => (s.full_text || s.text || "").toLowerCase());
      const linkHeavy = texts.filter((t) => /https?:\/\//.test(t)).length;
      if (linkHeavy / texts.length >= 0.7) {
        risks.push("Mayoritas post terakhir berisi link eksternal");
      }
      const spammy = texts.filter((t) =>
        /(giveaway|free money|guaranteed|dm for|airdrop|double your)/i.test(t)
      ).length;
      if (spammy > 0) {
        risks.push("Pola bahasa promo/spam terdeteksi di post terbaru");
      }
      // Burst: if multiple tweets within minutes
      const times = recent
        .map((s) => Date.parse(s.created_at || 0))
        .filter((n) => n > 0)
        .sort((a, b) => b - a);
      if (times.length >= 4) {
        const windowMs = times[0] - times[3];
        if (windowMs < 10 * 60 * 1000) {
          risks.push("Burst posting (≥4 post dalam ~10 menit) — risk rate-limit/filter");
        }
      }
    }

    if (user.default_profile_image) {
      risks.push("Masih memakai avatar default");
    }

    const severity =
      risks.length >= 3 ? "medium" : risks.length >= 1 ? "low" : "clear";

    return {
      id: "behavior_risk",
      status: risks.length ? "warn" : "clear",
      title: "Behavioral risk (pre-ban signals)",
      detail: risks.length
        ? `${risks.length} sinyal perilaku berisiko terdeteksi (bukan ban, tapi bisa memicu filter).`
        : "Tidak ada pola perilaku mencurigakan yang jelas dari sampel publik.",
      severity,
      risks,
      tips: risks.length
        ? [
            "Perlambat frekuensi post & follow/unfollow.",
            "Kurangi link eksternal di post utama (taruh di reply).",
            "Hindari copy-paste / mass engagement automation.",
          ]
        : [],
    };
  }

  function overallFromChecks(checks) {
    let max = 0;
    let worst = SEVERITY.clear;
    for (const c of checks) {
      const sev = SEVERITY[c.severity] || SEVERITY.low;
      if (sev.level > max) {
        max = sev.level;
        worst = sev;
      }
    }
    // Special: if search ban or suggestion ban flagged → high
    const flaggedBan = checks.some(
      (c) =>
        (c.id === "search_ban" || c.id === "search_suggestion_ban" || c.id === "ghost_ban") &&
        c.status === "flagged"
    );
    if (flaggedBan && max < SEVERITY.high.level) {
      worst = SEVERITY.high;
      max = worst.level;
    }
    return { ...worst, score: max };
  }

  /**
   * Recovery / remediation tips (research + community best practice).
   */
  function recoveryGuide(checks) {
    const flagged = checks.filter(
      (c) => c.status === "flagged" || c.severity === "high" || c.severity === "critical"
    );
    const ids = new Set(flagged.map((c) => c.id));

    const general = [
      {
        title: "Cooldown cooling period (48–72 jam)",
        body: "Stop automation, mass like/RT/follow, dan posting beruntun. Biarkan akun “dingin” 2–3 hari dengan aktivitas normal ringan.",
      },
      {
        title: "Hapus / unpublish konten berisiko",
        body: "Hapus post yang di-report, spam, media sensitif, atau thread yang memicu quality filter. Jangan repost konten yang sama segera.",
      },
      {
        title: "Rapikan graf follow",
        body: "Hindari follow/unfollow massal. Unfollow bot/spam perlahan. Jangan beli followers.",
      },
      {
        title: "Konten orisinal & engagement alami",
        body: "Post teks/media orisinal, balas manusiawi, kurangi link di body (taruh di reply pertama). Variasikan jam posting.",
      },
      {
        title: "Cek pengaturan & keamanan",
        body: "Pastikan tidak locked tanpa sengaja, lengkapi bio/avatar/header, aktifkan 2FA, cabut aplikasi pihak ketiga mencurigakan (Settings → Security → Apps).",
      },
      {
        title: "Ajukan banding jika ada notifikasi",
        body: "Jika ada email/in-app about locked/limited, ikuti alur appeal resmi X. Jangan buat akun baru massal (bisa memperparah).",
      },
    ];

    const specific = [];
    if (ids.has("search_suggestion_ban") || ids.has("search_ban")) {
      specific.push({
        title: "Khusus Search / Suggestion Ban",
        body: "Cool-down 72 jam + hentikan hashtag stuffing & reply spam. Setelah itu post 3–5 konten orisinal tanpa link, interaksi pelan dengan mutual. Cek ulang search `from:username` tiap hari.",
      });
    }
    if (ids.has("ghost_ban")) {
      specific.push({
        title: "Khusus Ghost Ban / Reply hide",
        body: "Uji dari akun lain: reply di thread populer. Jika hanya follower yang melihat, hentikan reply massal 3–7 hari. Balas hanya thread relevan, hindari reply identik di banyak post.",
      });
    }
    if (ids.has("behavior_risk")) {
      specific.push({
        title: "Khusus pola perilaku berisiko",
        body: "Turunkan rasio following, ganti avatar default, kurangi link/promo. Jangan pakai auto-DM / engagement pods.",
      });
    }
    if (ids.has("protected")) {
      specific.push({
        title: "Akun protected",
        body: "Ini bukan shadowban. Untuk reach publik, buka proteksi atau terima bahwa OON/search terbatas.",
      });
    }

    const manualTests = [
      {
        title: "Uji Search manual",
        body: "Logout / incognito → search `from:yourhandle` dan cuplikan teks tweet terbaru (tanpa quality filter off/on). Bandingkan dengan profil.",
      },
      {
        title: "Uji Reply manual",
        body: "Dari akun non-follower: buka thread yang kamu reply. Jika reply hilang / di balik “Show more replies”, indikasi deboost/ghost.",
      },
      {
        title: "Uji Suggestion manual",
        body: "Di kotak search, ketik handle kamu. Jika tidak muncul di People, indikasi suggestion ban.",
      },
    ];

    return { general, specific, manualTests };
  }

  /**
   * Main entry: full shadowban report for a handle.
   */
  async function checkShadowban(handleOrUrl) {
    const screenName = resolveTargetHandle(handleOrUrl);
    const started = Date.now();

    if (!screenName) {
      return {
        ok: false,
        error: "Masukkan @username atau buka profil user di x.com.",
        handle: "",
        checks: [],
        overall: SEVERITY.low,
      };
    }

    if (!authHeaders()) {
      return {
        ok: false,
        error: "Login ke x.com di tab ini dulu. Shadowban check memakai sesi X kamu.",
        handle: screenName,
        checks: [],
        overall: SEVERITY.low,
      };
    }

    const checks = [];

    // 1) Profile
    let userBundle;
    try {
      userBundle = await fetchUserShow(screenName);
    } catch (e) {
      return {
        ok: false,
        error: e.code === "not_logged_in" ? "Login ke x.com dulu." : e.message || String(e),
        handle: screenName,
        checks: [],
        overall: SEVERITY.low,
      };
    }

    if (!userBundle.ok || !userBundle.user) {
      checks.push({
        id: "profile",
        status: "flagged",
        title: "Profile",
        detail:
          userBundle.reason === "suspended"
            ? "Akun kemungkinan suspended / dibatasi (bukan sekadar shadowban)."
            : userBundle.reason === "not_found"
              ? "Username tidak ditemukan."
              : `Profil tidak bisa dibaca (${userBundle.reason}).`,
        severity: userBundle.reason === "not_found" ? "critical" : "critical",
      });
      const overall = overallFromChecks(checks);
      return {
        ok: true,
        handle: screenName,
        user: null,
        checks,
        overall,
        recovery: recoveryGuide(checks),
        elapsedMs: Date.now() - started,
        disclaimer: DISCLAIMER,
      };
    }

    checks.push(...checkAccountFlags(userBundle.user));

    // 2) Timeline sample
    const timeline = await fetchUserTimelineIds(screenName, 10);

    // 3) Suggestion ban
    try {
      checks.push(await checkSearchSuggestionBan(screenName));
    } catch (e) {
      checks.push({
        id: "search_suggestion_ban",
        status: "unknown",
        title: "Search Suggestion Ban",
        detail: e.message || String(e),
        severity: "low",
      });
    }

    // 4) Search ban
    try {
      checks.push(await checkSearchBan(screenName, timeline.ids || []));
    } catch (e) {
      checks.push({
        id: "search_ban",
        status: "unknown",
        title: "Search Ban",
        detail: e.message || String(e),
        severity: "low",
      });
    }

    // 5) Ghost heuristic
    try {
      checks.push(
        await checkGhostReplyHeuristic(screenName, timeline.statuses || [])
      );
    } catch (e) {
      checks.push({
        id: "ghost_ban",
        status: "unknown",
        title: "Ghost Ban",
        detail: e.message || String(e),
        severity: "low",
      });
    }

    // 6) Behavior
    checks.push(behavioralRisk(userBundle.user, timeline.statuses || []));

    const overall = overallFromChecks(checks);
    const recovery = recoveryGuide(checks);

    return {
      ok: true,
      handle: screenName,
      user: {
        name: userBundle.user.name,
        screen_name: userBundle.user.screen_name,
        followers: userBundle.user.followers_count,
        following: userBundle.user.friends_count,
        statuses: userBundle.user.statuses_count,
        protected: !!userBundle.user.protected,
        verified: !!(userBundle.user.verified || userBundle.user.is_blue_verified),
        created_at: userBundle.user.created_at,
        description: userBundle.user.description,
      },
      timelineSample: (timeline.ids || []).length,
      checks,
      overall,
      recovery,
      elapsedMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    };
  }

  const DISCLAIMER =
    "Shadowban bukan istilah resmi produk X. Hasil adalah sinyal visibilitas (search/suggestion/reply) berbasis API web + heuristik. Ghost ban & reply deboost paling akurat dikonfirmasi manual dengan akun non-follower. Bukan jaminan status moderasi internal X.";

  const NARVShadowban = {
    checkShadowban,
    resolveTargetHandle,
    recoveryGuide,
    SEVERITY,
    DISCLAIMER,
  };

  root.NARVShadowban = NARVShadowban;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVShadowban;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
