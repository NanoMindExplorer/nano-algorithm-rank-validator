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
        affinityCalibration: null,
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
        affinityCalibration: cal,
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
        affinityCalibration: null,
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
            <span>xai-org/x-algorithm · For You pipeline</span>
          </div>
          <div class="narv-header-actions">
            <button class="narv-icon-btn" id="narv-copy" title="Copy JSON report" type="button">⧉</button>
            <button class="narv-icon-btn" id="narv-close" title="Close" type="button">✕</button>
          </div>
        </div>
        <div class="narv-toolbar">
          <button class="narv-btn narv-btn-primary" id="narv-validate-active" type="button">Validate this page</button>
          <button class="narv-btn narv-btn-secondary" id="narv-validate-hover" type="button">Scan timeline</button>
          <button class="narv-btn narv-btn-ghost" id="narv-draft" type="button">Score draft</button>
        </div>
        <div class="narv-tabs">
          <button class="narv-tab active" data-tab="report" type="button">Report</button>
          <button class="narv-tab" data-tab="signals" type="button">19 Signals</button>
          <button class="narv-tab" data-tab="filters" type="button">Filters</button>
          <button class="narv-tab" data-tab="pipeline" type="button">Pipeline</button>
        </div>
        <div class="narv-body" id="narv-body">
          <div class="narv-empty">
            Open a tweet or click <strong>Validate this page</strong>.<br/><br/>
            Scores follow <code>WeightedScorer</code> + Phoenix multi-action structure from the open-source X algorithm.
          </div>
        </div>
      </aside>
    `;
    document.documentElement.appendChild(rootEl);

    panelEl = rootEl.querySelector("#narv-panel");
    bodyEl = rootEl.querySelector("#narv-body");

    rootEl.querySelector("#narv-fab").addEventListener("click", () => openPanel());
    rootEl.querySelector("#narv-close").addEventListener("click", () => closePanel());
    rootEl.querySelector("#narv-copy").addEventListener("click", () => copyReport());
    rootEl
      .querySelector("#narv-validate-active")
      .addEventListener("click", () => validateActive());
    rootEl
      .querySelector("#narv-validate-hover")
      .addEventListener("click", () => scanTimeline());
    rootEl.querySelector("#narv-draft").addEventListener("click", () => scoreDraft());

    rootEl.querySelectorAll(".narv-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        rootEl.querySelectorAll(".narv-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        if (lastReport) renderReport(lastReport, tab.dataset.tab);
      });
    });
  }

  function openPanel() {
    ensureRoot();
    panelEl.classList.add("narv-open");
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
    };
  }

  async function scoreTweet(tweet, opts) {
    if (root.NARVPipeline.validateTweetAsync) {
      return root.NARVPipeline.validateTweetAsync(tweet, opts);
    }
    return root.NARVPipeline.validateTweet(tweet, opts);
  }

  async function validateActive() {
    openPanel();
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
    bodyEl.innerHTML = `<div class="narv-empty">Scoring…</div>`;
    const opts = await getOptions();
    const report = await scoreTweet(tweet, opts);
    lastReport = report;
    renderReport(report, "report");
    return report;
  }

  async function scanTimeline() {
    openPanel();
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

  async function scoreDraft() {
    openPanel();
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
      btn.title = "Validate with Nano Algorithm Rank Validator";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tweet = root.NARVParser.parseTweetArticle(article);
        if (tweet) validateTweetObject(tweet);
      });
      article.style.position = article.style.position || "relative";
      article.appendChild(btn);
    });
  }

  const NARVPanel = {
    ensureRoot,
    openPanel,
    closePanel,
    validateActive,
    validateTweetObject,
    injectTweetButtons,
    loadSettings,
  };

  root.NARVPanel = NARVPanel;
})(typeof globalThis !== "undefined" ? globalThis : window);
