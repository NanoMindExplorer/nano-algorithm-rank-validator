#!/usr/bin/env python3
"""
NARV Phoenix Sidecar — optional local scoring server for the Chrome extension.

Default mode: *proxy-compatible* multi-action scores (no multi-GB model required).
If you export Phoenix checkpoints from xai-org/x-algorithm, set NARV_PHOENIX_MODE=jax
and point NARV_ARTIFACTS_DIR at the artifacts folder (advanced / optional).

API:
  GET  /health
  POST /v1/score        { "tweet": {...}, "context": {...} }
  POST /v1/score_batch  { "tweets": [...], "options": {...} }

Run:
  python3 sidecar/server.py
  # listens on http://127.0.0.1:8787

CORS is open for extension pages talking to localhost.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse

HOST = os.environ.get("NARV_SIDECAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("NARV_SIDECAR_PORT", "8787"))
MODE = os.environ.get("NARV_PHOENIX_MODE", "proxy")  # proxy | jax
VERSION = "1.1.0"

QUESTION_RE = re.compile(
    r"\?|^(who|what|when|where|why|how|do you|have you|should|would|could)\b",
    re.I | re.M,
)
CTA_RE = re.compile(
    r"\b(reply|comment|rt|repost|quote|share|follow|thoughts|agree|tell me|your take)\b",
    re.I,
)
SPAM_RE = re.compile(
    r"\b(free money|guaranteed|click here|limited time|act now|crypto giveaway|dm me for)\b",
    re.I,
)
URL_RE = re.compile(r"https?://[^\s]+", re.I)


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def sigmoid(x: float) -> float:
    if x > 20:
        return 1.0
    if x < -20:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


def proxy_phoenix_scores(tweet: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
    """Lightweight multi-action head estimator compatible with NARV WeightedScorer."""
    context = context or {}
    text = (tweet.get("text") or "").strip()
    chars = len(text)
    words = len(text.split()) if text else 0
    has_video = bool(tweet.get("hasVideo") or tweet.get("has_video"))
    has_image = bool(tweet.get("hasImage") or tweet.get("has_image") or tweet.get("hasGif"))
    has_media = bool(tweet.get("hasMedia") or has_video or has_image)
    external = bool(tweet.get("hasExternalLink")) or bool(URL_RE.search(text) and not has_media)
    spam = 1.0 if SPAM_RE.search(text) else 0.0
    question = 1.0 if QUESTION_RE.search(text) else 0.0
    cta = 1.0 if CTA_RE.search(text) else 0.0
    in_network = context.get("inNetwork", True)
    affinity = float(context.get("historyAffinity", 0.55) or 0.55)

    likes = float(tweet.get("likeCount") or tweet.get("likes") or 0)
    replies = float(tweet.get("replyCount") or tweet.get("replies") or 0)
    reposts = float(tweet.get("repostCount") or tweet.get("reposts") or 0)
    views = max(float(tweet.get("viewCount") or tweet.get("views") or 0), 1.0)

    media_score = 1.0 if has_video else (0.7 if has_image else 0.15)
    conversation = clamp01(question * 0.45 + cta * 0.35 + min(0.3, math.log10(replies + 1) / 4))
    length_score = 1.0 if 80 <= chars <= 220 else (0.75 if 40 <= chars <= 280 else (0.35 if chars else 0.1))
    structure = clamp01(length_score * 0.5 + (0.3 if "\n" in text else 0) + media_score * 0.2)

    substance = -2.2 if chars <= 0 else (-1.4 if chars < 20 else (-0.55 if chars < 40 else length_score * 0.55))
    quality = (
        -1.55
        + substance
        + media_score * 0.85
        + structure * 0.65
        + conversation * 1.25
        + affinity * 0.7
        + (0.18 if in_network else -0.2)
        + (-0.55 if external else 0.0)
        + (-1.6 if spam else 0.0)
        + (-0.9 if words < 3 else 0.0)
        + min(1.2, (likes + replies * 3 + reposts * 2) / views * 25)
    )
    q = sigmoid(quality)

    like_rate = likes / views
    reply_rate = replies / views
    repost_rate = reposts / views

    def blend(prior: float, observed: float) -> float:
        w = min(1.0, views / (views + 80.0))
        return clamp01(prior * (1 - w) + observed * w)

    scores = {
        "favorite_score": blend(clamp01(q * 0.85), min(1.0, like_rate * 8)),
        "reply_score": blend(clamp01(q * 0.45 + conversation * 0.55), min(1.0, reply_rate * 12)),
        "retweet_score": blend(clamp01(q * 0.4 + media_score * 0.2), min(1.0, repost_rate * 15)),
        "photo_expand_score": clamp01(q * 0.5 + 0.2) if has_image else clamp01(q * 0.05),
        "click_score": clamp01(q * 0.35 + structure * 0.2 + (0.15 if external else 0.05)),
        "profile_click_score": clamp01(q * 0.2 + 0.1),
        "vqv_score": clamp01(q * 0.55 + 0.25) if has_video else 0.02,
        "share_score": clamp01(q * 0.25 + media_score * 0.15),
        "share_via_dm_score": clamp01(q * 0.18),
        "share_via_copy_link_score": clamp01(q * 0.22),
        "dwell_score": clamp01(q * 0.4 + length_score * 0.25 + structure * 0.2),
        "quote_score": clamp01(q * 0.25 + conversation * 0.2),
        "quoted_click_score": clamp01(q * 0.08),
        "quoted_vqv_score": 0.02,
        "dwell_time": clamp01(q * 0.35 + length_score * 0.25),
        "click_dwell_time": clamp01(q * 0.25),
        "follow_author_score": clamp01(q * 0.15 + conversation * 0.15),
        "not_interested_score": clamp01(0.02 + spam * 0.35 + (0.04 if external else 0) + (1 - q) * 0.08),
        "block_author_score": clamp01(0.01 + spam * 0.2),
        "mute_author_score": clamp01(0.015 + spam * 0.22),
        "report_score": clamp01(0.01 + spam * 0.35),
        "not_dwelled_score": clamp01((1 - q) * 0.4 + (0.15 if chars < 20 else 0)),
    }
    scores["_meta"] = {
        "mode": "sidecar-proxy",
        "quality": q,
        "note": "Sidecar proxy heads (set NARV_PHOENIX_MODE=jax for real Phoenix when artifacts available)",
    }
    return scores


def try_jax_score(tweet: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Optional hook — returns None unless user wires real Phoenix artifacts."""
    if MODE != "jax":
        return None
    # Placeholder: real integration would load phoenix/run_pipeline artifacts.
    # We intentionally fall back so the sidecar always works out of the box.
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = f"NARVSidecar/{VERSION}"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
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
            self._json(
                200,
                {
                    "ok": True,
                    "version": VERSION,
                    "mode": MODE,
                    "service": "narv-phoenix-sidecar",
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "invalid json"})
            return

        if path == "/v1/score":
            tweet = data.get("tweet") or {}
            context = data.get("context") or {}
            jax_scores = try_jax_score(tweet, context)
            phoenix = jax_scores or proxy_phoenix_scores(tweet, context)
            # strip private meta key from numeric map for consumers that iterate values
            meta = phoenix.pop("_meta", {"mode": MODE})
            self._json(
                200,
                {
                    "ok": True,
                    "phoenixScores": phoenix,
                    "meta": meta,
                    "mode": meta.get("mode", MODE),
                },
            )
            return

        if path == "/v1/score_batch":
            tweets = data.get("tweets") or []
            options = data.get("options") or {}
            context = options.get("context") or data.get("context") or {}
            results = []
            for tw in tweets:
                phoenix = proxy_phoenix_scores(tw, context)
                meta = phoenix.pop("_meta", {})
                results.append({"tweetId": tw.get("tweetId"), "phoenixScores": phoenix, "meta": meta})
            self._json(200, {"ok": True, "results": results, "mode": MODE})
            return

        self._json(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[narv-sidecar] " + (fmt % args) + "\n")


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"NARV Phoenix sidecar listening on http://{HOST}:{PORT}  mode={MODE}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
        httpd.server_close()


if __name__ == "__main__":
    main()
