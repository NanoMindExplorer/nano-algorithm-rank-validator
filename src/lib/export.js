/**
 * Export validation / timeline scan results as CSV or JSON.
 */

(function (root) {
  "use strict";

  function csvEscape(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function reportToRow(report, rank = "") {
    const f = report.features || {};
    const t = report.tweet || {};
    return {
      rank,
      tweet_id: t.tweetId || "",
      author: t.authorHandle || "",
      url: t.url || "",
      grade: report.grade?.letter || "",
      final_score: report.finalScore != null ? Number(report.finalScore).toFixed(6) : "",
      weighted_raw: report.weighted?.raw != null ? Number(report.weighted.raw).toFixed(6) : "",
      weighted_norm: report.weighted?.normalized != null ? Number(report.weighted.normalized).toFixed(6) : "",
      filter_pass: report.filterReport?.passed ? "yes" : "no",
      filter_summary: report.filterReport?.summary || "",
      likes: f.likes ?? "",
      replies: f.replies ?? "",
      reposts: f.reposts ?? "",
      views: f.views ?? "",
      has_media: f.hasMedia ? "yes" : "no",
      has_video: f.hasVideo ? "yes" : "no",
      has_external_link: f.hasExternalLink ? "yes" : "no",
      conversation_score: f.conversationScore != null ? f.conversationScore.toFixed(3) : "",
      media_score: f.mediaScore != null ? f.mediaScore.toFixed(3) : "",
      p_favorite: report.phoenixScores?.favorite_score?.toFixed?.(4) ?? "",
      p_reply: report.phoenixScores?.reply_score?.toFixed?.(4) ?? "",
      p_retweet: report.phoenixScores?.retweet_score?.toFixed?.(4) ?? "",
      p_dwell: report.phoenixScores?.dwell_score?.toFixed?.(4) ?? "",
      p_report: report.phoenixScores?.report_score?.toFixed?.(4) ?? "",
      in_network: report.context?.inNetwork ? "yes" : "no",
      profile: report.profileId || report.profileName || "",
      scorer: report.scorerMode || "proxy",
      text: (t.text || "").replace(/\s+/g, " ").slice(0, 280),
      scored_at: report.timestamp || new Date().toISOString(),
    };
  }

  function rowsToCsv(rows) {
    if (!rows.length) return "";
    const keys = Object.keys(rows[0]);
    const lines = [keys.join(",")];
    for (const row of rows) {
      lines.push(keys.map((k) => csvEscape(row[k])).join(","));
    }
    return lines.join("\n");
  }

  function scanToCsv(rankedItems) {
    const rows = rankedItems.map((item, i) =>
      reportToRow(item.report, item.rank || i + 1)
    );
    return rowsToCsv(rows);
  }

  function scanToJson(rankedItems, meta = {}) {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: "1.1.0",
        count: rankedItems.length,
        meta,
        items: rankedItems.map((item, i) => ({
          rank: item.rank || i + 1,
          finalScore: item.finalScore,
          grade: item.grade,
          tweet: item.tweet,
          report: item.report,
        })),
      },
      null,
      2
    );
  }

  function downloadText(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadCsv(filename, rankedItems) {
    downloadText(filename, scanToCsv(rankedItems), "text/csv;charset=utf-8");
  }

  function downloadJson(filename, rankedItems, meta) {
    downloadText(
      filename,
      scanToJson(rankedItems, meta),
      "application/json;charset=utf-8"
    );
  }

  function downloadReportJson(filename, report) {
    downloadText(filename, JSON.stringify(report, null, 2), "application/json");
  }

  const NARVExport = {
    reportToRow,
    rowsToCsv,
    scanToCsv,
    scanToJson,
    downloadText,
    downloadCsv,
    downloadJson,
    downloadReportJson,
  };

  root.NARVExport = NARVExport;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = NARVExport;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
