/**
 * In-page side panel UI for validation reports.
 */

(function (root) {
  "use strict";

  let panelEl = null;
  let bodyEl = null;
  let lastReport = null;
  let lastScan = null;
  let settings = null;
  let followUnlocked = false;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadSettings() {
    const defaults = root.NARVWeights.cloneDefaults();
    try {
      const stored = await chrome.storage.sync.get({
        weights: defaults.weights,
        params: defaults.params,
        profileId: "balanced",
        inNetworkDefault: true,
        historyAffinity: 0.55,
        mutedKeywords: "",
        useSidecar: false,
        sidecarUrl: "http://127.0.0.1:8787",
        sidecarMode: "hash",
        affinityCalibration: null,
        autoSampleEnabled: false,
        showSampleButtons: true,
      });
      const profileId = stored.profileId || "balanced";
      let weights = { ...defaults.weights, ...(stored.weights || {}) };
      let params = { ...defaults.params, ...(stored.params || {}) };
      let profileName = "Balanced (default)";
      if (root.NARVProfiles) {
        const resolved = root.NARVProfiles.resolve(profileId, {
          // Only apply stored weight overrides if user customized beyond profile
          weights: stored.weightsCustom ? stored.weights : undefined,
          params: stored.params,
        });
        // If user has custom weights saved with profile, merge profile then custom
        if (stored.weights && Object.keys(stored.weights).length) {
          // Prefer explicit stored weights (options page saves full map)
          weights = { ...defaults.weights, ...resolved.weights, ...stored.weights };
        } else {
          weights = resolved.weights;
        }
        params = { ...resolved.params, ...(stored.params || {}) };
        profileName = resolved.profileName;
      }
      const cal = stored.affinityCalibration;
      const historyAffinity =
        cal && cal.historyAffinity != null
          ? cal.historyAffinity
          : stored.historyAffinity != null
            ? stored.historyAffinity
            : 0.55;
      settings = {
        weights,
        params,
        profileId,
        profileName,
        inNetworkDefault: stored.inNetworkDefault !== false,
        historyAffinity,
        mutedKeywords: String(stored.mutedKeywords || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        useSidecar: !!stored.useSidecar,
        sidecarUrl: stored.sidecarUrl || "http://127.0.0.1:8787",
        sidecarMode: stored.sidecarMode || "hash",
        affinityCalibration: cal,
        autoSampleEnabled: !!stored.autoSampleEnabled,
        showSampleButtons: stored.showSampleButtons !== false,
      };
    } catch {
      settings = {
        weights: defaults.weights,
        params: defaults.params,
        profileId: "balanced",
        profileName: "Balanced (default)",
        inNetworkDefault: true,
        historyAffinity: 0.55,
        mutedKeywords: [],
        useSidecar: false,
        sidecarUrl: "http://127.0.0.1:8787",
        sidecarMode: "hash",
        affinityCalibration: null,
        autoSampleEnabled: false,
        showSampleButtons: true,
      };
    }
    return settings;
  }

  function ensureRoot() {
    if (document.getElementById("narv-root")) return;

    const rootEl = document.createElement("div");
    rootEl.id = "narv-root";
    rootEl.innerHTML = `
      <button id="narv-fab" title="Nano Algorithm Rank Validator" type="button">NΔ</button>
      <aside id="narv-panel" aria-label="Nano Algorithm Rank Validator">
        <div class="narv-header">
          <div class="narv-header-title">
            <strong>Nano Algorithm Rank Validator</strong>
            <span>by @Deadmouse_jpeg · For You pipeline</span>
          </div>
          <div class="narv-header-actions">
            <button class="narv-icon-btn" id="narv-copy" title="Copy JSON report" type="button">⧉</button>
            <button class="narv-icon-btn" id="narv-close" title="Close" type="button">✕</button>
          </div>
        </div>
        <div class="narv-toolbar" id="narv-toolbar">
          <button class="narv-btn narv-btn-primary" id="narv-validate-active" type="button">Validate</button>
          <button class="narv-btn narv-btn-secondary" id="narv-validate-hover" type="button">Scan</button>
          <button class="narv-btn narv-btn-secondary" id="narv-compare" type="button">A/B profiles</button>
          <button class="narv-btn narv-btn-ghost" id="narv-draft" type="button">Draft</button>
          <button class="narv-btn narv-btn-ghost" id="narv-sample" type="button">Sample hist</button>
          <button class="narv-btn narv-btn-secondary" id="narv-shadowban" type="button">Shadowban</button>
          <button class="narv-btn narv-btn-ghost" id="narv-unfollow" type="button">Unfollow</button>
        </div>
        <div class="narv-tabs" id="narv-tabs">
          <button class="narv-tab active" data-tab="report" type="button">Report</button>
          <button class="narv-tab" data-tab="signals" type="button">19 Signals</button>
          <button class="narv-tab" data-tab="filters" type="button">Filters</button>
          <button class="narv-tab" data-tab="pipeline" type="button">Pipeline</button>
        </div>
        <div class="narv-body" id="narv-body">
          <div class="narv-empty">Memeriksa akses follow…</div>
        </div>
      </aside>
    `;
    document.documentElement.appendChild(rootEl);

    panelEl = rootEl.querySelector("#narv-panel");
    bodyEl = rootEl.querySelector("#narv-body");

    rootEl.querySelector("#narv-fab").addEventListener("click", () => openPanel());
    rootEl.querySelector("#narv-close").addEventListener("click", () => closePanel());
    rootEl.querySelector("#narv-copy").addEventListener("click", () => {
      if (!followUnlocked) return showLocked(null);
      copyReport();
    });
    rootEl
      .querySelector("#narv-validate-active")
      .addEventListener("click", () => withFollowGate(validateActive));
    rootEl
      .querySelector("#narv-validate-hover")
      .addEventListener("click", () => withFollowGate(scanTimeline));
    rootEl
      .querySelector("#narv-draft")
      .addEventListener("click", () => withFollowGate(scoreDraft));
    rootEl
      .querySelector("#narv-compare")
      .addEventListener("click", () => withFollowGate(compareProfiles));
    rootEl
      .querySelector("#narv-sample")
      .addEventListener("click", () => withFollowGate(sampleHistoryUI));
    rootEl
      .querySelector("#narv-shadowban")
      .addEventListener("click", () => withFollowGate(shadowbanUI));
    rootEl
      .querySelector("#narv-unfollow")
      .addEventListener("click", () => withFollowGate(massUnfollowUI));

    rootEl.querySelectorAll(".narv-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (!followUnlocked) return showLocked(null);
        rootEl.querySelectorAll(".narv-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        if (lastReport) renderReport(lastReport, tab.dataset.tab);
      });
    });
  }

  function setToolsEnabled(enabled) {
    followUnlocked = !!enabled;
    const toolbar = document.getElementById("narv-toolbar");
    const tabs = document.getElementById("narv-tabs");
    if (toolbar) toolbar.style.opacity = enabled ? "1" : "0.35";
    if (tabs) tabs.style.opacity = enabled ? "1" : "0.35";
    toolbar?.querySelectorAll("button").forEach((b) => {
      b.disabled = !enabled;
    });
  }

  function showLocked(status) {
    ensureRoot();
    const handle =
      (root.NARVFollowGate && root.NARVFollowGate.REQUIRED_HANDLE) || "Deadmouse_jpeg";
    const url =
      (root.NARVFollowGate && root.NARVFollowGate.PROFILE_URL) ||
      `https://x.com/${handle}`;
    const msg =
      (status && status.message) ||
      `Follow @${handle} di X untuk membuka Nano Algorithm Rank Validator.`;

    setToolsEnabled(false);
    bodyEl.innerHTML = `
      <div class="narv-lock">
        <div class="narv-lock-icon">🔒</div>
        <h2>Follow required</h2>
        <p>${esc(msg)}</p>
        <p class="narv-muted">Tools ini gratis, tapi wajib follow creator:</p>
        <a class="narv-btn narv-btn-primary narv-lock-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
          Follow @${esc(handle)}
        </a>
        <button class="narv-btn narv-btn-secondary" id="narv-recheck-follow" type="button" style="width:100%;margin-top:10px">
          Saya sudah follow — cek ulang
        </button>
        <p class="narv-muted" style="margin-top:12px;font-size:11px">
          Pastikan kamu login di x.com di tab ini. Setelah follow, klik cek ulang.
        </p>
      </div>
    `;
    bodyEl.querySelector("#narv-recheck-follow")?.addEventListener("click", async () => {
      bodyEl.innerHTML = `<div class="narv-empty">Memverifikasi follow…</div>`;
      const ok = await refreshFollowGate({ force: true });
      if (ok) {
        flash("Akses dibuka ✓");
        bodyEl.innerHTML = welcomeHtml();
      }
    });
  }

  function welcomeHtml(status) {
    const ownerNote =
      status && status.isOwner
        ? `<p class="narv-muted" style="margin-top:8px">Mode pemilik (@Deadmouse_jpeg) — tidak perlu follow diri sendiri.</p>`
        : "";
    return `
      <div class="narv-empty">
        <strong>Welcome.</strong> Tools terbuka.<br/><br/>
        · <b>Draft</b> — skor sebelum post<br/>
        · <b>Validate</b> — skor tweet aktif<br/>
        · <b>Scan</b> — ranking timeline
        ${ownerNote}
      </div>`;
  }

  async function refreshFollowGate(opts = {}) {
    if (!root.NARVFollowGate) {
      showLocked({
        message: "Follow gate module missing — reload extension.",
      });
      return false;
    }
    const status = await root.NARVFollowGate.ensureFollowing(opts);
    if (status.following) {
      setToolsEnabled(true);
      if (status.isOwner || status.reason === "owner") {
        // Soft notice once when owner unlocks
        if (bodyEl && /Memeriksa|Memverifikasi|Follow required|locked/i.test(bodyEl.innerText || "")) {
          bodyEl.innerHTML = welcomeHtml(status);
        }
      }
      return true;
    }
    showLocked(status);
    return false;
  }

  async function withFollowGate(fn) {
    openPanel();
    const ok = await refreshFollowGate({ force: false });
    if (!ok) return;
    return fn();
  }

  async function openPanel() {
    ensureRoot();
    panelEl.classList.add("narv-open");
    if (!followUnlocked) {
      bodyEl.innerHTML = `<div class="narv-empty">Memeriksa follow @Deadmouse_jpeg…</div>`;
      await refreshFollowGate({ force: false });
    }
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove("narv-open");
  }

  function copyReport() {
    if (!lastReport) return;
    const json = JSON.stringify(lastReport, null, 2);
    navigator.clipboard?.writeText(json).then(
      () => flash("Report copied"),
      () => {
        // Fallback download
        if (root.NARVExport) {
          root.NARVExport.downloadReportJson("narv-report.json", lastReport);
          flash("Downloaded report");
        } else flash("Copy failed");
      }
    );
  }

  function flash(msg) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#1d9bf0;color:#fff;padding:10px 14px;border-radius:999px;font:700 12px/1 sans-serif;";
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  async function getOptions() {
    await loadSettings();
    return {
      weights: settings.weights,
      params: settings.params,
      profileId: settings.profileId,
      profileName: settings.profileName,
      inNetwork: settings.inNetworkDefault,
      historyAffinity: settings.historyAffinity,
      mutedKeywords: settings.mutedKeywords,
      useSidecar: settings.useSidecar,
      sidecarUrl: settings.sidecarUrl,
      sidecarMode: settings.sidecarMode,
    };
  }

  async function compareProfiles() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    bodyEl.innerHTML = `<div class="narv-empty">Comparing profiles…</div>`;
    let tweet =
      root.NARVParser.parseStatusPage() ||
      (() => {
        const first = document.querySelector('article[data-testid="tweet"]');
        return first ? root.NARVParser.parseTweetArticle(first) : null;
      })();
    if (!tweet) {
      bodyEl.innerHTML = `<div class="narv-empty">No tweet found to compare.</div>`;
      return;
    }
    const opts = await getOptions();
    if (!root.NARVCompare) {
      bodyEl.innerHTML = `<div class="narv-empty">Compare module missing — reload extension.</div>`;
      return;
    }
    try {
      const result = await root.NARVCompare.compare(tweet, opts);
      bodyEl.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">A/B profile compare <span>${esc(result.mode)} · winner ${esc(result.winner || "?")}</span></div>
          <div class="narv-card-b">
            <div class="narv-tweet-preview" style="margin-bottom:10px">${esc((tweet.text || "").slice(0, 220))}</div>
            ${result.comparisons
              .map(
                (c) => `
              <div class="narv-filter-item">
                <div class="narv-dot pass" style="background:${esc(c.grade?.color || "#1d9bf0")}"></div>
                <div style="flex:1">
                  <div style="font-weight:700">#${c.rank} · ${esc(c.profileId)} · ${esc(c.grade?.letter || "")} · ${((c.finalScore || 0) * 100).toFixed(1)}</div>
                  <div class="narv-muted">raw ${(c.raw != null ? c.raw : c.report?.weighted?.raw || 0).toFixed?.(3) || c.raw}</div>
                </div>
              </div>`
              )
              .join("")}
            ${result.sidecarError ? `<p class="narv-muted">Sidecar error: ${esc(result.sidecarError)}</p>` : ""}
            <button class="narv-btn narv-btn-secondary" id="narv-export-compare" type="button" style="margin-top:10px">Export compare JSON</button>
          </div>
        </div>
        <p class="narv-disclaimer">Same Phoenix heads (proxy/sidecar), different WeightedScorer profiles — mirrors how creators might tune engagement objectives.</p>
      `;
      bodyEl.querySelector("#narv-export-compare")?.addEventListener("click", () => {
        if (root.NARVExport) {
          root.NARVExport.downloadText(
            `narv-compare-${tweet.tweetId || "draft"}.json`,
            JSON.stringify(result, null, 2),
            "application/json"
          );
          flash("Compare exported");
        }
      });
    } catch (e) {
      bodyEl.innerHTML = `<div class="narv-empty">Compare failed: ${esc(e.message || e)}</div>`;
    }
  }

  async function sampleHistoryUI() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    await loadSettings();
    const samples = root.NARVSampler
      ? await root.NARVSampler.loadSamples()
      : [];
    const onLikes = root.NARVSampler?.isLikesPage?.() || false;
    bodyEl.innerHTML = `
      <div class="narv-card">
        <div class="narv-card-h">Engagement history sampler <span>${samples.length} samples</span></div>
        <div class="narv-card-b">
          <p class="narv-muted" style="margin-top:0">
            Opt-in collector for affinity calibration. On your
            <strong>/likes</strong> page, bulk-import visible liked posts.
            Or use <strong>+HIST</strong> on any tweet.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <button class="narv-btn narv-btn-primary" id="narv-sample-visible" type="button">
              ${onLikes ? "Import visible likes" : "Sample visible as liked"}
            </button>
            <button class="narv-btn narv-btn-secondary" id="narv-sample-calibrate" type="button">Calibrate affinity</button>
            <button class="narv-btn narv-btn-secondary" id="narv-sample-export" type="button">Export history JSON</button>
            <button class="narv-btn narv-btn-ghost" id="narv-sample-clear" type="button">Clear</button>
          </div>
          <div class="narv-muted" id="narv-sample-status">
            ${onLikes ? "Likes page detected." : "Tip: open x.com/YOUR_HANDLE/likes for best import."}
            Affinity now: ${(settings?.historyAffinity ?? 0.55).toFixed(3)}
          </div>
          <div style="margin-top:10px;max-height:220px;overflow:auto">
            ${samples
              .slice(-15)
              .reverse()
              .map(
                (s) => `
              <div class="narv-filter-item">
                <div class="narv-dot pass"></div>
                <div>
                  <div style="font-weight:600">@${esc(s.author || "?")} · ${esc(s.source || "")}</div>
                  <div class="narv-muted">${esc((s.text || "").slice(0, 80))}</div>
                </div>
              </div>`
              )
              .join("") || '<div class="narv-muted">No samples yet.</div>'}
          </div>
        </div>
      </div>
    `;

    bodyEl.querySelector("#narv-sample-visible")?.addEventListener("click", async () => {
      const status = bodyEl.querySelector("#narv-sample-status");
      if (!root.NARVSampler) return;
      const r = await root.NARVSampler.sampleVisibleAsLiked(root.NARVParser);
      status.textContent = `Added ~${r.added} (scanned ${r.scanned}). Total ${r.total}.`;
      flash(`Sampled ${r.added}`);
    });
    bodyEl.querySelector("#narv-sample-calibrate")?.addEventListener("click", async () => {
      if (!root.NARVSampler || !root.NARVAffinity) return;
      const cal = await root.NARVSampler.calibrateAndStore(root.NARVAffinity, true);
      const status = bodyEl.querySelector("#narv-sample-status");
      if (cal) {
        status.textContent = `Calibrated affinity=${cal.historyAffinity.toFixed(3)} · suggested ${root.NARVAffinity.suggestProfile(cal)} · n=${cal.sampleSize}`;
        flash("Affinity updated");
        settings = null; // force reload
      } else {
        status.textContent = "Calibration failed — need samples first.";
      }
    });
    bodyEl.querySelector("#narv-sample-export")?.addEventListener("click", async () => {
      if (!root.NARVSampler || !root.NARVExport) return;
      const hist = await root.NARVSampler.exportHistoryObject();
      root.NARVExport.downloadText(
        `narv-history-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(hist, null, 2),
        "application/json"
      );
      flash("History exported");
    });
    bodyEl.querySelector("#narv-sample-clear")?.addEventListener("click", async () => {
      if (!root.NARVSampler) return;
      await root.NARVSampler.clearSamples();
      flash("Cleared");
      sampleHistoryUI();
    });
  }

  async function scoreTweet(tweet, opts) {
    if (root.NARVPipeline.validateTweetAsync) {
      return root.NARVPipeline.validateTweetAsync(tweet, opts);
    }
    return root.NARVPipeline.validateTweet(tweet, opts);
  }

  async function validateActive() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    await loadSettings();
    let tweet =
      root.NARVParser.parseStatusPage() ||
      (() => {
        const first = document.querySelector('article[data-testid="tweet"]');
        return first ? root.NARVParser.parseTweetArticle(first) : null;
      })();

    if (!tweet || !tweet.tweetId) {
      bodyEl.innerHTML = `<div class="narv-empty">No tweet found on this page.<br/>Open a status URL or timeline card.</div>`;
      return;
    }

    bodyEl.innerHTML = `<div class="narv-empty">Scoring…</div>`;
    const opts = await getOptions();
    const report = await scoreTweet(tweet, opts);
    lastReport = report;
    renderReport(report, "report");
  }

  async function validateTweetObject(tweet) {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    bodyEl.innerHTML = `<div class="narv-empty">Scoring…</div>`;
    const opts = await getOptions();
    const report = await scoreTweet(tweet, opts);
    lastReport = report;
    renderReport(report, "report");
    return report;
  }

  async function scanTimeline() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    const opts = await getOptions();
    const items = root.NARVParser.parseVisibleTweets();
    if (!items.length) {
      bodyEl.innerHTML = `<div class="narv-empty">No tweets visible in the timeline.</div>`;
      return;
    }

    bodyEl.innerHTML = `<div class="narv-empty">Scanning ${items.length} posts…</div>`;

    const ranked = [];
    for (let i = 0; i < items.length; i++) {
      const { tweet } = items[i];
      const report = await scoreTweet(tweet, opts);
      ranked.push({
        index: i,
        tweet,
        report,
        finalScore: report.finalScore,
        grade: report.grade,
      });
    }
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });
    lastScan = ranked;

    // Persist last scan summary (local only)
    try {
      await chrome.storage.local.set({
        lastScanAt: new Date().toISOString(),
        lastScanCount: ranked.length,
        lastScanPreview: ranked.slice(0, 20).map((r) => ({
          rank: r.rank,
          score: r.finalScore,
          grade: r.grade?.letter,
          author: r.tweet.authorHandle,
          id: r.tweet.tweetId,
          text: (r.tweet.text || "").slice(0, 120),
        })),
      });
    } catch {
      /* ignore */
    }

    const mode = opts.useSidecar ? "sidecar+proxy fallback" : "proxy";
    bodyEl.innerHTML = `
      <div class="narv-card">
        <div class="narv-card-h">Timeline scan <span>${ranked.length} posts · ${esc(mode)} · ${esc(opts.profileId || "balanced")}</span></div>
        <div class="narv-card-b">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button class="narv-btn narv-btn-secondary" id="narv-export-csv" type="button">Export CSV</button>
            <button class="narv-btn narv-btn-secondary" id="narv-export-json" type="button">Export JSON</button>
          </div>
          ${ranked
            .map(
              (r, i) => `
            <div class="narv-filter-item" style="cursor:pointer" data-scan-idx="${i}">
              <div class="narv-dot pass" style="background:${esc(r.grade.color)}"></div>
              <div style="flex:1">
                <div style="font-weight:700">#${i + 1} · ${esc(r.grade.letter)} · ${(r.finalScore * 100).toFixed(1)}</div>
                <div class="narv-muted">@${esc(r.tweet.authorHandle || "?")} · ${esc((r.tweet.text || "").slice(0, 90))}</div>
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <p class="narv-disclaimer">Click a row for full report. Export uses NARVExport (CSV/JSON).</p>
    `;

    bodyEl.querySelector("#narv-export-csv")?.addEventListener("click", () => {
      if (!root.NARVExport || !lastScan) return;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      root.NARVExport.downloadCsv(`narv-scan-${ts}.csv`, lastScan);
      flash("CSV exported");
    });
    bodyEl.querySelector("#narv-export-json")?.addEventListener("click", () => {
      if (!root.NARVExport || !lastScan) return;
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      root.NARVExport.downloadJson(`narv-scan-${ts}.json`, lastScan, {
        profileId: opts.profileId,
        useSidecar: opts.useSidecar,
      });
      flash("JSON exported");
    });

    bodyEl.querySelectorAll("[data-scan-idx]").forEach((row) => {
      row.addEventListener("click", () => {
        const idx = Number(row.getAttribute("data-scan-idx"));
        lastReport = ranked[idx].report;
        document
          .querySelectorAll("#narv-root .narv-tab")
          .forEach((t) => t.classList.toggle("active", t.dataset.tab === "report"));
        renderReport(lastReport, "report");
      });
    });
  }

  async function massUnfollowUI() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    if (!root.NARVMassUnfollow) {
      bodyEl.innerHTML = `<div class="narv-empty">Modul mass-unfollow tidak termuat — reload extension.</div>`;
      return;
    }

    const MU = root.NARVMassUnfollow;
    const settings = await MU.loadSettings();
    const daily = await MU.loadDailyStats();
    let analysis = null;
    let selected = new Map(); // id -> row

    const render = () => {
      const wl = (settings.whitelist || []).map((h) => "@" + h).join(", ");
      bodyEl.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">Mass Unfollow <span>non-followers · timer · whitelist</span></div>
          <div class="narv-card-b">
            <p class="narv-muted" style="margin-top:0">
              Unfollow massal dengan jeda manual per aksi. Deteksi yang <strong>tidak follow-back</strong>,
              hormati <strong>whitelist</strong>. Delay terlalu cepat berisiko rate-limit / filter akun.
            </p>
            <div class="narv-row-2">
              <div>
                <label class="narv-label">Delay per unfollow (detik)</label>
                <input id="mu-delay" class="narv-input" type="number" min="5" max="600" value="${Math.round((settings.delayMs || 45000) / 1000)}" />
              </div>
              <div>
                <label class="narv-label">Jitter acak (detik)</label>
                <input id="mu-jitter" class="narv-input" type="number" min="0" max="120" value="${Math.round((settings.jitterMs || 0) / 1000)}" />
              </div>
            </div>
            <div class="narv-row-2">
              <div>
                <label class="narv-label">Max per sesi</label>
                <input id="mu-session" class="narv-input" type="number" min="1" max="500" value="${settings.sessionMax || 40}" />
              </div>
              <div>
                <label class="narv-label">Soft cap harian</label>
                <input id="mu-daily" class="narv-input" type="number" min="1" max="2000" value="${settings.dailyMax || 120}" />
              </div>
            </div>
            <label class="narv-label"><input type="checkbox" id="mu-nonf" ${settings.onlyNonFollowers !== false ? "checked" : ""}/> Hanya yang tidak follow-back</label>
            <label class="narv-label"><input type="checkbox" id="mu-ver" ${settings.skipVerified !== false ? "checked" : ""}/> Skip verified / Premium blue</label>
            <label class="narv-label"><input type="checkbox" id="mu-prot" ${settings.skipProtected ? "checked" : ""}/> Skip protected accounts</label>
            <div>
              <label class="narv-label">Skip jika followers target ≥ (0 = off)</label>
              <input id="mu-minf" class="narv-input" type="number" min="0" value="${settings.skipMinFollowers || 0}" />
            </div>
            <div>
              <label class="narv-label">Whitelist (koma, tidak akan di-unfollow)</label>
              <textarea id="mu-wl" class="narv-input" rows="2" placeholder="@friend, @client, brand">${esc(wl)}</textarea>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
              <button class="narv-btn narv-btn-secondary" id="mu-save" type="button">Simpan settings</button>
              <button class="narv-btn narv-btn-primary" id="mu-scan" type="button">Scan following</button>
            </div>
            <p class="narv-muted" style="margin-top:8px">
              Hari ini: <strong>${daily.count || 0}</strong> / ${settings.dailyMax || 120} unfollow
            </p>
            <ul class="narv-list tips" style="margin-top:8px">
              ${(MU.SAFETY_NOTES || []).map((t) => `<li>${esc(t)}</li>`).join("")}
            </ul>
          </div>
        </div>
        <div id="mu-result"></div>
      `;

      bodyEl.querySelector("#mu-save")?.addEventListener("click", async () => {
        const next = readForm();
        Object.assign(settings, await MU.saveSettings(next));
        flash("Unfollow settings saved");
        render();
      });

      bodyEl.querySelector("#mu-scan")?.addEventListener("click", async () => {
        const box = bodyEl.querySelector("#mu-result");
        box.innerHTML = `<div class="narv-empty">Mengambil following + followers (bisa 1–3 menit)…</div>`;
        try {
          Object.assign(settings, await MU.saveSettings(readForm()));
          analysis = await MU.analyzeFollowing({
            ...settings,
            onProgress: (done, total) => {
              box.innerHTML = `<div class="narv-empty">Cek profil akun… ${done}/${total}</div>`;
            },
          });
          selected = new Map(analysis.candidates.map((c) => [c.id, c]));
          renderAnalysis(box);
        } catch (e) {
          const msg =
            e.code === "not_logged_in" || e.message === "not_logged_in"
              ? "Login ke x.com dulu."
              : e.message || String(e);
          box.innerHTML = `<div class="narv-empty" style="color:var(--narv-red)">${esc(msg)}</div>`;
        }
      });
    };

    const readForm = () => {
      const delaySec = Number(bodyEl.querySelector("#mu-delay")?.value || 45);
      const jitterSec = Number(bodyEl.querySelector("#mu-jitter")?.value || 10);
      const wlRaw = bodyEl.querySelector("#mu-wl")?.value || "";
      const whitelist = wlRaw
        .split(/[\s,]+/)
        .map((s) => MU.normalizeHandle(s))
        .filter(Boolean);
      return {
        delayMs: Math.round(delaySec * 1000),
        jitterMs: Math.round(jitterSec * 1000),
        sessionMax: Number(bodyEl.querySelector("#mu-session")?.value || 40),
        dailyMax: Number(bodyEl.querySelector("#mu-daily")?.value || 120),
        onlyNonFollowers: !!bodyEl.querySelector("#mu-nonf")?.checked,
        skipVerified: !!bodyEl.querySelector("#mu-ver")?.checked,
        skipProtected: !!bodyEl.querySelector("#mu-prot")?.checked,
        skipMinFollowers: Number(bodyEl.querySelector("#mu-minf")?.value || 0),
        whitelist,
      };
    };

    const renderAnalysis = (box) => {
      if (!analysis) return;
      const list = analysis.candidates || [];
      box.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">Hasil scan @${esc(analysis.me.screen_name)}
            <span>following ${analysis.followingCount} · followers ${analysis.followerCount} · non-FB ${analysis.nonFollowerCount}</span>
          </div>
          <div class="narv-card-b">
            <p class="narv-muted" style="margin-top:0">
              Kandidat setelah filter: <strong>${list.length}</strong>
              · di-skip: ${analysis.skipped?.length || 0}
            </p>
            ${
              analysis.warnings && analysis.warnings.length
                ? `<div class="narv-empty" style="color:var(--narv-yellow, #ffd400);border-color:var(--narv-yellow, #ffd400);margin-bottom:10px">
                    ${analysis.warnings.map((w) => `⚠ ${esc(w)}`).join("<br/>")}
                  </div>`
                : ""
            }
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
              <button class="narv-btn narv-btn-secondary" id="mu-all" type="button">Select all</button>
              <button class="narv-btn narv-btn-ghost" id="mu-none" type="button">Select none</button>
              <button class="narv-btn narv-btn-primary" id="mu-run" type="button">Mulai unfollow terpilih</button>
              <button class="narv-btn narv-btn-secondary" id="mu-pause" type="button" disabled>Pause</button>
              <button class="narv-btn narv-btn-ghost" id="mu-stop" type="button" disabled>Stop</button>
              <button class="narv-btn narv-btn-ghost" id="mu-export" type="button">Export kandidat JSON</button>
            </div>
            <div id="mu-progress" class="narv-muted" style="margin-bottom:8px"></div>
            <div id="mu-log" style="max-height:120px;overflow:auto;font-size:11px;margin-bottom:10px" class="narv-muted"></div>
            <div id="mu-list" style="max-height:280px;overflow:auto">
              ${list
                .map(
                  (c) => `
                <label class="narv-filter-item" style="cursor:pointer;align-items:flex-start">
                  <input type="checkbox" data-mu-id="${esc(c.id)}" ${selected.has(c.id) ? "checked" : ""} style="margin-top:3px"/>
                  <div style="flex:1">
                    <div style="font-weight:700">@${esc(c.screen_name)} ${c.verified ? "✓" : ""} ${c.protected ? "🔒" : ""}</div>
                    <div class="narv-muted">${esc(c.name)} · ${c.followers_count} followers · ${c.followsYou ? "follows you" : "no follow-back"}</div>
                  </div>
                </label>`
                )
                .join("") || '<div class="narv-muted">Tidak ada kandidat.</div>'}
            </div>
          </div>
        </div>
      `;

      const syncSelectedFromDom = () => {
        selected.clear();
        box.querySelectorAll("[data-mu-id]").forEach((el) => {
          if (el.checked) {
            const id = el.getAttribute("data-mu-id");
            const row = list.find((x) => x.id === id);
            if (row) selected.set(id, row);
          }
        });
      };

      box.querySelector("#mu-all")?.addEventListener("click", () => {
        box.querySelectorAll("[data-mu-id]").forEach((el) => (el.checked = true));
        selected = new Map(list.map((c) => [c.id, c]));
      });
      box.querySelector("#mu-none")?.addEventListener("click", () => {
        box.querySelectorAll("[data-mu-id]").forEach((el) => (el.checked = false));
        selected.clear();
      });
      box.querySelector("#mu-export")?.addEventListener("click", () => {
        if (root.NARVExport) {
          root.NARVExport.downloadText(
            `narv-unfollow-candidates-${Date.now()}.json`,
            JSON.stringify(analysis, null, 2),
            "application/json"
          );
          flash("Exported");
        }
      });

      const prog = box.querySelector("#mu-progress");
      const logEl = box.querySelector("#mu-log");
      const btnRun = box.querySelector("#mu-run");
      const btnPause = box.querySelector("#mu-pause");
      const btnStop = box.querySelector("#mu-stop");

      btnRun?.addEventListener("click", async () => {
        syncSelectedFromDom();
        const queue = [...selected.values()];
        if (!queue.length) {
          flash("Pilih minimal 1 akun");
          return;
        }
        Object.assign(settings, await MU.saveSettings(readForm()));
        btnRun.disabled = true;
        btnPause.disabled = false;
        btnStop.disabled = false;
        let waiting = false;
        const result = await MU.runUnfollow(queue, {
          ...settings,
          onProgress: (st) => {
            if (st.phase === "waiting") {
              waiting = true;
              prog.textContent = `Menunggu ${(st.waitMs / 1000).toFixed(0)}s… (${st.done}/${st.total}) sukses ${st.success} gagal ${st.failed}`;
            } else if (st.phase === "unfollowing") {
              prog.textContent = `Unfollow @${st.current?.screen_name || "?"}… (${st.done}/${st.total})`;
            } else if (st.phase === "finished" || st.phase === "done_one" || st.phase === "error") {
              prog.textContent = `Progress ${st.done}/${st.total} · OK ${st.success} · fail ${st.failed} · skip ${st.skipped}`;
            }
            if (st.log && st.log.length) {
              const last = st.log.slice(-8).reverse();
              logEl.innerHTML = last
                .map(
                  (l) =>
                    `<div>[${esc(l.type)}] ${esc(l.handle || "")} ${esc(l.msg || "")}</div>`
                )
                .join("");
            }
            if (st.phase === "finished") {
              btnRun.disabled = false;
              btnPause.disabled = true;
              btnStop.disabled = true;
              flash(`Selesai: ${st.success} unfollowed`);
            }
            void waiting;
          },
        });
        if (!result.ok) {
          prog.textContent = result.error || "Gagal";
          btnRun.disabled = false;
          btnPause.disabled = true;
          btnStop.disabled = true;
        }
      });

      btnPause?.addEventListener("click", () => {
        const j = MU.getJob();
        if (!j || !j.running) return;
        if (j.paused) {
          MU.resumeJob();
          btnPause.textContent = "Pause";
          flash("Resumed");
        } else {
          MU.pauseJob();
          btnPause.textContent = "Resume";
          flash("Paused");
        }
      });

      btnStop?.addEventListener("click", () => {
        MU.stopJob();
        flash("Stopping…");
      });
    };

    render();
  }

  async function shadowbanUI() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;

    const defaultHandle =
      (root.NARVShadowban && root.NARVShadowban.resolveTargetHandle()) ||
      "";

    bodyEl.innerHTML = `
      <div class="narv-card">
        <div class="narv-card-h">Shadowban / visibility check</div>
        <div class="narv-card-b">
          <p class="narv-muted" style="margin-top:0">
            Cek sinyal <strong>Search Suggestion Ban</strong>, <strong>Search Ban</strong>,
            <strong>Ghost/Reply hide</strong> (heuristik), flag profil, dan risiko perilaku.
            Wajib login di x.com. Hasil bukan status moderasi resmi X.
          </p>
          <label class="narv-label">Username (kosongkan = profil / akun aktif)</label>
          <input id="narv-sb-handle" class="narv-input" type="text" placeholder="@username" value="${esc(defaultHandle ? "@" + defaultHandle : "")}" />
          <button class="narv-btn narv-btn-primary" id="narv-sb-run" type="button" style="width:100%">Jalankan cek shadowban</button>
        </div>
      </div>
      <div id="narv-sb-result"></div>
    `;

    bodyEl.querySelector("#narv-sb-run")?.addEventListener("click", async () => {
      const raw = bodyEl.querySelector("#narv-sb-handle")?.value || "";
      const out = bodyEl.querySelector("#narv-sb-result");
      if (!root.NARVShadowban) {
        out.innerHTML = `<div class="narv-empty">Modul shadowban tidak termuat — reload extension.</div>`;
        return;
      }
      out.innerHTML = `<div class="narv-empty">Menjalankan cek (search / typeahead / timeline)…</div>`;
      try {
        const report = await root.NARVShadowban.checkShadowban(raw);
        renderShadowbanReport(out, report);
      } catch (e) {
        out.innerHTML = `<div class="narv-empty">Error: ${esc(e.message || e)}</div>`;
      }
    });
  }

  function renderShadowbanReport(container, report) {
    if (!report.ok) {
      container.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-b">
            <p style="color:var(--narv-red);font-weight:700">${esc(report.error || "Gagal")}</p>
          </div>
        </div>`;
      return;
    }

    const o = report.overall || {};
    const checks = report.checks || [];
    const rec = report.recovery || { general: [], specific: [], manualTests: [] };

    const statusDot = (c) => {
      if (c.status === "clear") return "pass";
      if (c.status === "flagged") return "fail";
      if (c.status === "warn" || c.status === "partial") return "soft";
      return "unk";
    };

    container.innerHTML = `
      <div class="narv-score-hero" style="--pct:${Math.max(5, 100 - (o.score || 0) * 22)};--ring-color:${esc(o.color || "#1d9bf0")}">
        <div class="narv-score-ring">
          <div class="narv-score-ring-inner">
            <div class="num" style="font-size:14px">${esc(o.label || "?")}</div>
          </div>
        </div>
        <div class="narv-score-meta">
          <h2>@${esc(report.handle)}</h2>
          <p>${report.user ? `${esc(report.user.name || "")} · ${report.user.followers ?? "?"} followers · ${report.timelineSample || 0} timeline samples` : "—"}</p>
          <div class="narv-badge-row">
            <span class="narv-badge ${o.level >= 3 ? "fail" : o.level >= 2 ? "warn" : "ok"}">${esc(o.label || "")}</span>
            <span class="narv-badge">${report.elapsedMs || 0} ms</span>
          </div>
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Hasil cek</div>
        <div class="narv-card-b">
          ${checks
            .map(
              (c) => `
            <div class="narv-filter-item">
              <div class="narv-dot ${statusDot(c)}"></div>
              <div>
                <div style="font-weight:700">${esc(c.title)} <span class="narv-muted">${esc(c.severity || "")} · ${esc(c.status || "")}</span></div>
                <div class="narv-muted">${esc(c.detail || "")}</div>
                ${
                  c.risks && c.risks.length
                    ? `<ul class="narv-list risks">${c.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
                    : ""
                }
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>

      ${
        rec.specific && rec.specific.length
          ? `<div class="narv-card">
        <div class="narv-card-h">Pemulihan khusus temuanmu</div>
        <div class="narv-card-b">
          ${rec.specific
            .map(
              (t) => `
            <div style="margin-bottom:10px">
              <div style="font-weight:700;font-size:12px">${esc(t.title)}</div>
              <div class="narv-muted">${esc(t.body)}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>`
          : ""
      }

      <div class="narv-card">
        <div class="narv-card-h">Cara menanggulangi / mengobati shadowban</div>
        <div class="narv-card-b">
          ${rec.general
            .map(
              (t, i) => `
            <div style="margin-bottom:10px">
              <div style="font-weight:700;font-size:12px">${i + 1}. ${esc(t.title)}</div>
              <div class="narv-muted">${esc(t.body)}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Uji manual (disarankan)</div>
        <div class="narv-card-b">
          ${rec.manualTests
            .map(
              (t) => `
            <div style="margin-bottom:10px">
              <div style="font-weight:700;font-size:12px">${esc(t.title)}</div>
              <div class="narv-muted">${esc(t.body)}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-b" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="narv-btn narv-btn-secondary" id="narv-sb-export" type="button">Export JSON</button>
        </div>
      </div>
      <p class="narv-disclaimer">${esc(report.disclaimer || "")}</p>
    `;

    container.querySelector("#narv-sb-export")?.addEventListener("click", () => {
      if (root.NARVExport) {
        root.NARVExport.downloadText(
          `narv-shadowban-${report.handle}-${Date.now()}.json`,
          JSON.stringify(report, null, 2),
          "application/json"
        );
        flash("Shadowban report exported");
      }
    });
  }

  async function scoreDraft() {
    openPanel();
    if (!(await refreshFollowGate({ force: false }))) return;
    const text =
      document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText ||
      document.querySelector('[role="textbox"][data-testid^="tweetTextarea"]')
        ?.innerText ||
      "";

    bodyEl.innerHTML = `
      <div class="narv-card">
        <div class="narv-card-h">Draft scorer</div>
        <div class="narv-card-b">
          <label class="narv-label">Draft text</label>
          <textarea id="narv-draft-text" class="narv-input" rows="6" placeholder="Paste or edit draft tweet…">${esc(text)}</textarea>
          <div class="narv-row-2">
            <div>
              <label class="narv-label">Media</label>
              <select id="narv-draft-media" class="narv-select">
                <option value="none">None</option>
                <option value="image">Image / GIF</option>
                <option value="video">Video (&gt;5s)</option>
                <option value="poll">Poll</option>
              </select>
            </div>
            <div>
              <label class="narv-label">Format</label>
              <select id="narv-draft-format" class="narv-select">
                <option value="single">Single post</option>
                <option value="thread">Thread</option>
                <option value="reply">Reply</option>
                <option value="quote">Quote</option>
              </select>
            </div>
          </div>
          <button class="narv-btn narv-btn-primary" id="narv-run-draft" type="button" style="width:100%">Score draft</button>
        </div>
      </div>
    `;

    bodyEl.querySelector("#narv-run-draft").addEventListener("click", async () => {
      const draftText = bodyEl.querySelector("#narv-draft-text").value;
      const media = bodyEl.querySelector("#narv-draft-media").value;
      const format = bodyEl.querySelector("#narv-draft-format").value;
      const opts = await getOptions();
      bodyEl.innerHTML = `<div class="narv-empty">Scoring draft…</div>`;
      const report = await (root.NARVPipeline.validateDraftAsync
        ? root.NARVPipeline.validateDraftAsync(
            draftText,
            {
              hasImage: media === "image",
              hasVideo: media === "video",
              hasMedia: media === "image" || media === "video",
              hasPoll: media === "poll",
              isThread: format === "thread",
              isReply: format === "reply",
              isQuote: format === "quote",
              videoDurationMs: media === "video" ? 12000 : null,
              threadLength: format === "thread" ? 5 : 1,
            },
            opts
          )
        : Promise.resolve(
            root.NARVPipeline.validateDraft(
              draftText,
              {
                hasImage: media === "image",
                hasVideo: media === "video",
                hasMedia: media === "image" || media === "video",
                hasPoll: media === "poll",
                isThread: format === "thread",
                isReply: format === "reply",
                isQuote: format === "quote",
                videoDurationMs: media === "video" ? 12000 : null,
                threadLength: format === "thread" ? 5 : 1,
              },
              opts
            )
          ));
      lastReport = report;
      document
        .querySelectorAll("#narv-root .narv-tab")
        .forEach((t) => t.classList.toggle("active", t.dataset.tab === "report"));
      renderReport(report, "report");
    });
  }

  function barRows(items, mode) {
    const maxAbs = Math.max(
      0.001,
      ...items.map((c) => Math.abs(c.contribution || c.probability || 0))
    );
    return items
      .map((c) => {
        const key = c.key || c.label;
        const val =
          mode === "contrib"
            ? c.contribution
            : c.probability != null
              ? c.probability
              : c.contribution;
        const pct = Math.min(100, (Math.abs(val) / maxAbs) * 100);
        const neg = val < 0;
        const hi = !neg && pct > 60;
        const label =
          (root.NARVWeights.WEIGHT_META[key] &&
            root.NARVWeights.WEIGHT_META[key].label) ||
          key;
        const display =
          mode === "contrib"
            ? (val >= 0 ? "+" : "") + val.toFixed(3)
            : (Number(val) * 100).toFixed(1) + "%";
        return `
          <div class="narv-bar-row">
            <div class="label" title="${esc(key)}">${esc(label)}</div>
            <div class="narv-bar-track"><div class="narv-bar-fill ${neg ? "neg" : hi ? "pos-hi" : ""}" style="width:${pct}%"></div></div>
            <div class="val">${esc(display)}</div>
          </div>`;
      })
      .join("");
  }

  function renderReport(report, tab = "report") {
    if (!bodyEl) return;
    const g = report.grade;
    const pct = Math.min(100, Math.round(report.finalScore * 100));

    if (tab === "signals") {
      const map = root.NARVPhoenix.scoresToWeightMap(report.phoenixScores);
      const items = Object.entries(map).map(([key, probability]) => ({
        key,
        probability,
        contribution: report.weighted.contributions[key]?.contribution || 0,
      }));
      items.sort((a, b) => b.probability - a.probability);
      bodyEl.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">Phoenix P(action) proxy <span>sigmoid heads</span></div>
          <div class="narv-card-b">${barRows(items, "prob")}</div>
        </div>
        <div class="narv-card">
          <div class="narv-card-h">Weighted contributions <span>w × P</span></div>
          <div class="narv-card-b">${barRows(report.weighted.rankedContributions, "contrib")}</div>
        </div>
        <p class="narv-disclaimer">${esc(report.disclaimer)}</p>
      `;
      return;
    }

    if (tab === "filters") {
      bodyEl.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">Filter pipeline <span>${esc(report.filterReport.summary)}</span></div>
          <div class="narv-card-b">
            ${report.filterReport.results
              .map((f) => {
                let cls = "unk";
                if (f.pass === true) cls = "pass";
                else if (f.pass === false && f.soft) cls = "soft";
                else if (f.pass === false) cls = "fail";
                return `
                  <div class="narv-filter-item">
                    <div class="narv-dot ${cls}"></div>
                    <div>
                      <div style="font-weight:700">${esc(f.id)} <span class="narv-muted">${esc(f.stage || "")}</span></div>
                      <div class="narv-muted">${esc(f.detail)}</div>
                    </div>
                  </div>`;
              })
              .join("")}
          </div>
        </div>
      `;
      return;
    }

    if (tab === "pipeline") {
      bodyEl.innerHTML = `
        <div class="narv-card">
          <div class="narv-card-h">For You stages <span>home-mixer</span></div>
          <div class="narv-card-b narv-pipeline">
            ${report.stages
              .map(
                (s, i) => `
              <div class="narv-pipe-step ${esc(s.status || "ok")}">
                <div class="idx">${i + 1}</div>
                <div>
                  <div class="name">${esc(s.id)}</div>
                  <div class="sum">${esc(s.summary || "")}</div>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </div>
        <div class="narv-card">
          <div class="narv-card-h">Score path</div>
          <div class="narv-card-b">
            <div class="narv-kv"><span class="k">Weighted raw</span><span class="v">${report.weighted.raw.toFixed(4)}</span></div>
            <div class="narv-kv"><span class="k">After offset</span><span class="v">${report.weighted.offset.toFixed(4)}</span></div>
            <div class="narv-kv"><span class="k">Normalized</span><span class="v">${report.weighted.normalized.toFixed(4)}</span></div>
            <div class="narv-kv"><span class="k">After diversity</span><span class="v">${report.ranking.afterDiversity.toFixed(4)}</span></div>
            <div class="narv-kv"><span class="k">After OON</span><span class="v">${report.ranking.afterOon.toFixed(4)}</span></div>
            <div class="narv-kv"><span class="k">Final score</span><span class="v">${report.finalScore.toFixed(4)}</span></div>
          </div>
        </div>
      `;
      return;
    }

    // report tab
    const f = report.features;
    bodyEl.innerHTML = `
      <div class="narv-score-hero" style="--pct:${pct};--ring-color:${esc(g.color)}">
        <div class="narv-score-ring">
          <div class="narv-score-ring-inner">
            <div class="num">${pct}</div>
            <div class="grade">${esc(g.letter)}</div>
          </div>
        </div>
        <div class="narv-score-meta">
          <h2>${esc(g.label)}</h2>
          <p>Final score <strong>${report.finalScore.toFixed(4)}</strong> · ${report.elapsedMs}ms</p>
          <div class="narv-badge-row">
            <span class="narv-badge ${report.scorerMode === "sidecar" ? "ok" : "proxy"}">${report.scorerMode === "sidecar" ? "Sidecar" : "Phoenix proxy"}</span>
            <span class="narv-badge">${esc(report.profileId || "balanced")}</span>
            <span class="narv-badge ${report.filterReport.passed ? "ok" : "fail"}">${report.filterReport.passed ? "Filters OK" : "Filter risk"}</span>
            <span class="narv-badge">${report.context.inNetwork ? "In-network" : "OON"}</span>
            ${f.hasVideo ? '<span class="narv-badge ok">Video</span>' : ""}
            ${f.hasImage ? '<span class="narv-badge">Image</span>' : ""}
            ${f.hasExternalLink ? '<span class="narv-badge warn">Ext link</span>' : ""}
            ${report.sidecarError ? '<span class="narv-badge warn">Sidecar fallback</span>' : ""}
          </div>
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Post <span>@${esc(report.tweet.authorHandle || "?")} · ${esc(report.tweet.tweetId || "draft")}</span></div>
        <div class="narv-card-b">
          <div class="narv-tweet-preview">${esc(report.tweet.text || "(no text)")}</div>
          <div class="narv-muted" style="margin-top:8px">
            ❤ ${f.likes} · 💬 ${f.replies} · 🔁 ${f.reposts} · 👁 ${f.views}
            ${f.ageHours != null ? ` · age ${f.ageHours.toFixed(1)}h` : ""}
          </div>
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Top positive drivers</div>
        <div class="narv-card-b">${barRows(report.positiveTop, "contrib")}</div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Negative / risk drivers</div>
        <div class="narv-card-b">
          ${
            report.negativeTop.length
              ? barRows(report.negativeTop, "contrib")
              : '<div class="narv-muted">No significant negative contributions</div>'
          }
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Insights</div>
        <div class="narv-card-b">
          ${
            report.insights.strengths.length
              ? `<ul class="narv-list strengths">${report.insights.strengths.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
              : ""
          }
          ${
            report.insights.risks.length
              ? `<ul class="narv-list risks">${report.insights.risks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
              : ""
          }
          ${
            report.insights.tips.length
              ? `<ul class="narv-list tips">${report.insights.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
              : ""
          }
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Content features</div>
        <div class="narv-card-b">
          <div class="narv-kv"><span class="k">Conversation score</span><span class="v">${(f.conversationScore * 100).toFixed(0)}%</span></div>
          <div class="narv-kv"><span class="k">Media score</span><span class="v">${(f.mediaScore * 100).toFixed(0)}%</span></div>
          <div class="narv-kv"><span class="k">Structure score</span><span class="v">${(f.structureScore * 100).toFixed(0)}%</span></div>
          <div class="narv-kv"><span class="k">Freshness</span><span class="v">${(f.freshness * 100).toFixed(0)}%</span></div>
          <div class="narv-kv"><span class="k">Author strength</span><span class="v">${(f.authorStrength * 100).toFixed(0)}%</span></div>
          <div class="narv-kv"><span class="k">Chars / words</span><span class="v">${f.chars} / ${f.words}</span></div>
        </div>
      </div>

      <div class="narv-card">
        <div class="narv-card-h">Export</div>
        <div class="narv-card-b" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="narv-btn narv-btn-secondary" id="narv-export-report" type="button">Download report JSON</button>
        </div>
      </div>

      <p class="narv-disclaimer">${esc(report.disclaimer)} Source: github.com/xai-org/x-algorithm</p>
    `;

    bodyEl.querySelector("#narv-export-report")?.addEventListener("click", () => {
      if (!root.NARVExport || !lastReport) return;
      const id = lastReport.tweet?.tweetId || "draft";
      root.NARVExport.downloadReportJson(`narv-report-${id}.json`, lastReport);
      flash("Report exported");
    });
  }

  function injectTweetButtons() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach((article) => {
      if (article.querySelector(".narv-tweet-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "narv-tweet-btn";
      btn.textContent = "NΔ RANK";
      btn.title = "Validate — requires follow @Deadmouse_jpeg";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tweet = root.NARVParser.parseTweetArticle(article);
        if (tweet) validateTweetObject(tweet);
      });
      article.style.position = article.style.position || "relative";
      article.appendChild(btn);
    });

    // Optional history sample buttons (also gated: only when unlocked)
    if (
      followUnlocked &&
      settings?.showSampleButtons !== false &&
      root.NARVSampler
    ) {
      root.NARVSampler.injectSampleButtons(root.NARVParser, () => {
        flash("Added to history");
      });
    }
  }

  const NARVPanel = {
    ensureRoot,
    openPanel,
    closePanel,
    validateActive,
    validateTweetObject,
    injectTweetButtons,
    loadSettings,
    compareProfiles,
    sampleHistoryUI,
    scanTimeline,
    shadowbanUI,
    massUnfollowUI,
    refreshFollowGate,
  };

  root.NARVPanel = NARVPanel;
})(typeof globalThis !== "undefined" ? globalThis : window);
