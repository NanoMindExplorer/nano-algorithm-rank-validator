#!/usr/bin/env python3
"""
NARV Phoenix Sidecar v1.2 — full local scoring service.

Endpoints:
  GET  /health
  GET  /v1/artifacts
  GET  /v1/profiles
  POST /v1/score
  POST /v1/score_batch
  POST /v1/validate          full WeightedScorer pipeline
  POST /v1/compare_profiles  A/B weight profiles
  POST /v1/calibrate         affinity from history JSON

Env:
  NARV_SIDECAR_HOST=127.0.0.1
  NARV_SIDECAR_PORT=8787
  NARV_PHOENIX_MODE=proxy|hash|jax
  NARV_ARTIFACTS_DIR=...
  NARV_PHOENIX_PATH=...
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

# Ensure sidecar dir on path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from jax_engine import detect_artifacts, score as engine_score, try_load_jax  # noqa: E402
from proxy_engine import proxy_phoenix_scores  # noqa: E402
from weighted_engine import (  # noqa: E402
    DEFAULT_PARAMS,
    DEFAULT_WEIGHTS,
    apply_author_diversity,
    compute_weighted,
)

HOST = os.environ.get("NARV_SIDECAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("NARV_SIDECAR_PORT", "8787"))
MODE = os.environ.get("NARV_PHOENIX_MODE", "hash")  # proxy | hash | jax
VERSION = "1.2.0"

PROFILES: Dict[str, Dict[str, Any]] = {
    "balanced": {"weights": {}, "params": {}},
    "conversation": {
        "weights": {
            "reply": 18.0,
            "quote": 4.0,
            "follow_author": 5.5,
            "dwell": 0.8,
            "favorite": 0.7,
            "retweet": 0.8,
        },
        "params": {},
    },
    "media": {
        "weights": {
            "vqv": 3.5,
            "photo_expand": 2.0,
            "dwell": 1.2,
            "share": 3.0,
            "reply": 8.0,
        },
        "params": {},
    },
    "news": {
        "weights": {
            "click": 2.5,
            "profile_click": 2.0,
            "share_via_copy_link": 2.5,
            "share": 2.5,
            "quote": 3.0,
            "reply": 10.0,
        },
        "params": {},
    },
    "viral": {
        "weights": {
            "retweet": 4.0,
            "share": 4.5,
            "quote": 4.0,
            "favorite": 1.5,
            "reply": 10.0,
        },
        "params": {},
    },
}


def merge_weights(profile_id: Optional[str], override: Optional[Dict] = None) -> Dict[str, float]:
    base = dict(DEFAULT_WEIGHTS)
    if profile_id and profile_id in PROFILES:
        base.update(PROFILES[profile_id].get("weights") or {})
    if override:
        base.update(override)
    return base


def merge_params(profile_id: Optional[str], override: Optional[Dict] = None) -> Dict[str, float]:
    base = dict(DEFAULT_PARAMS)
    if profile_id and profile_id in PROFILES:
        base.update(PROFILES[profile_id].get("params") or {})
    if override:
        base.update(override)
    return base


def strip_meta(scores: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any]]:
    s = dict(scores)
    meta = s.pop("_meta", {}) or {}
    return s, meta


def calibrate_affinity(raw: Any) -> Dict[str, Any]:
    """Minimal mirror of affinity.js calibrate()."""
    if raw is None:
        items = []
    elif isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = (
            raw.get("engagements")
            or raw.get("history")
            or raw.get("items")
            or raw.get("sequence")
            or []
        )
    else:
        items = []

    n = len(items)
    if n == 0:
        return {
            "historyAffinity": 0.55,
            "sampleSize": 0,
            "notes": ["Empty history"],
        }

    pos = neg = media = convo = 0
    for it in items:
        actions = it.get("actions") or {}
        liked = bool(it.get("liked") or it.get("favorite") or actions.get("1") or actions.get(1))
        replied = bool(it.get("replied") or it.get("reply") or actions.get("4") or actions.get(4))
        reposted = bool(it.get("reposted") or it.get("retweeted") or actions.get("6") or actions.get(6))
        bad = bool(
            it.get("not_interested")
            or it.get("blocked")
            or it.get("muted")
            or it.get("reported")
        )
        if liked or replied or reposted or it.get("dwelled"):
            pos += 1
        if bad:
            neg += 1
        if it.get("has_media") or it.get("hasMedia") or it.get("has_video") or it.get("hasVideo"):
            media += 1
        text = it.get("text") or ""
        if replied or "?" in text:
            convo += 1

    positive_rate = pos / n
    negative_rate = neg / n
    affinity = max(0.0, min(1.0, 0.35 + positive_rate * 0.5 - negative_rate * 0.25))
    deep = sum(
        1
        for it in items
        if it.get("replied") or it.get("reposted") or it.get("quoted")
    ) / n
    affinity = max(0.0, min(1.0, affinity + deep * 0.12))

    media_pref = media / max(1, pos or n)
    convo_pref = convo / max(1, pos or n)
    if convo_pref >= 0.55 and media_pref < 0.45:
        suggested = "conversation"
    elif media_pref >= 0.55:
        suggested = "media"
    elif positive_rate > 0.6 and convo_pref < 0.4:
        suggested = "viral"
    else:
        suggested = "balanced"

    return {
        "historyAffinity": affinity,
        "positiveRate": positive_rate,
        "negativeRate": negative_rate,
        "mediaPreference": media_pref,
        "conversationPreference": convo_pref,
        "sampleSize": n,
        "suggestedProfile": suggested,
        "notes": [f"Calibrated from {n} items", f"Suggested profile: {suggested}"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = f"NARVSidecar/{VERSION}"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            art = detect_artifacts()
            self._json(
                200,
                {
                    "ok": True,
                    "version": VERSION,
                    "mode": MODE,
                    "service": "narv-phoenix-sidecar",
                    "artifacts": art,
                    "jax_loaded": False,
                    "endpoints": [
                        "/health",
                        "/v1/artifacts",
                        "/v1/profiles",
                        "/v1/score",
                        "/v1/score_batch",
                        "/v1/validate",
                        "/v1/compare_profiles",
                        "/v1/calibrate",
                    ],
                },
            )
            return
        if path == "/v1/artifacts":
            self._json(
                200,
                {
                    "ok": True,
                    "mode": MODE,
                    "artifacts": detect_artifacts(),
                    "jax": try_load_jax() if MODE == "jax" else {"ok": False, "skipped": True},
                },
            )
            return
        if path == "/v1/profiles":
            self._json(
                200,
                {
                    "ok": True,
                    "profiles": [
                        {"id": k, "weights": v.get("weights"), "params": v.get("params")}
                        for k, v in PROFILES.items()
                    ],
                    "defaultWeights": DEFAULT_WEIGHTS,
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            data = self._read_json()
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return

        if path == "/v1/score":
            tweet = data.get("tweet") or {}
            context = data.get("context") or {}
            history = data.get("history") or context.get("history") or []
            mode = data.get("mode") or MODE
            phoenix = engine_score(tweet, context, mode=mode, history=history)
            scores, meta = strip_meta(phoenix)
            self._json(
                200,
                {
                    "ok": True,
                    "phoenixScores": scores,
                    "meta": meta,
                    "mode": meta.get("mode", mode),
                },
            )
            return

        if path == "/v1/score_batch":
            tweets = data.get("tweets") or []
            options = data.get("options") or {}
            context = options.get("context") or data.get("context") or {}
            mode = options.get("mode") or data.get("mode") or MODE
            results = []
            for tw in tweets:
                phoenix = engine_score(tw, context, mode=mode)
                scores, meta = strip_meta(phoenix)
                results.append(
                    {
                        "tweetId": tw.get("tweetId") or tw.get("tweet_id"),
                        "phoenixScores": scores,
                        "meta": meta,
                    }
                )
            self._json(200, {"ok": True, "results": results, "mode": mode})
            return

        if path == "/v1/validate":
            tweet = data.get("tweet") or {}
            context = data.get("context") or {}
            profile_id = data.get("profileId") or context.get("profileId")
            weights = merge_weights(profile_id, data.get("weights"))
            params = merge_params(profile_id, data.get("params"))
            mode = data.get("mode") or MODE
            history = data.get("history") or []
            phoenix = engine_score(tweet, context, mode=mode, history=history)
            scores, meta = strip_meta(phoenix)
            weighted = compute_weighted(scores, tweet, weights, params, context)
            self._json(
                200,
                {
                    "ok": True,
                    "phoenixScores": scores,
                    "meta": meta,
                    "weighted": weighted,
                    "finalScore": weighted["finalScore"],
                    "grade": weighted["grade"],
                    "profileId": profile_id or "balanced",
                    "mode": meta.get("mode", mode),
                },
            )
            return

        if path == "/v1/compare_profiles":
            tweet = data.get("tweet") or {}
            context = data.get("context") or {}
            profile_ids = data.get("profiles") or [
                "balanced",
                "conversation",
                "media",
                "news",
                "viral",
            ]
            mode = data.get("mode") or MODE
            phoenix = engine_score(tweet, context, mode=mode)
            scores, meta = strip_meta(phoenix)
            comparisons = []
            for pid in profile_ids:
                w = merge_weights(pid)
                p = merge_params(pid)
                weighted = compute_weighted(scores, tweet, w, p, context)
                comparisons.append(
                    {
                        "profileId": pid,
                        "finalScore": weighted["finalScore"],
                        "grade": weighted["grade"],
                        "raw": weighted["raw"],
                        "topDrivers": weighted["rankedContributions"][:5],
                    }
                )
            comparisons.sort(key=lambda x: x["finalScore"], reverse=True)
            for i, c in enumerate(comparisons):
                c["rank"] = i + 1
            self._json(
                200,
                {
                    "ok": True,
                    "phoenixScores": scores,
                    "meta": meta,
                    "comparisons": comparisons,
                    "winner": comparisons[0]["profileId"] if comparisons else None,
                },
            )
            return

        if path == "/v1/calibrate":
            history = data.get("history") or data.get("engagements") or data
            result = calibrate_affinity(history)
            self._json(200, {"ok": True, **result})
            return

        self._json(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[narv-sidecar] " + (fmt % args) + "\n")


def main() -> None:
    if MODE == "jax":
        status = try_load_jax()
        print(f"JAX init: {status.get('ok')} {status.get('error') or ''}", flush=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f"NARV Phoenix sidecar v{VERSION} on http://{HOST}:{PORT}  mode={MODE}",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
        httpd.server_close()


if __name__ == "__main__":
    main()
