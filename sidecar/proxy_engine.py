"""Proxy multi-action Phoenix-compatible scorer (no heavy deps)."""

from __future__ import annotations

import math
import re
from typing import Any, Dict, Optional

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


def proxy_phoenix_scores(
    tweet: Dict[str, Any], context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Lightweight multi-action head estimator compatible with NARV WeightedScorer."""
    context = context or {}
    text = (tweet.get("text") or "").strip()
    chars = len(text)
    words = len(text.split()) if text else 0
    has_video = bool(tweet.get("hasVideo") or tweet.get("has_video"))
    has_image = bool(
        tweet.get("hasImage") or tweet.get("has_image") or tweet.get("hasGif")
    )
    has_media = bool(tweet.get("hasMedia") or has_video or has_image)
    external = bool(tweet.get("hasExternalLink")) or bool(
        URL_RE.search(text) and not has_media
    )
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
    conversation = clamp01(
        question * 0.45 + cta * 0.35 + min(0.3, math.log10(replies + 1) / 4)
    )
    length_score = (
        1.0
        if 80 <= chars <= 220
        else (0.75 if 40 <= chars <= 280 else (0.35 if chars else 0.1))
    )
    structure = clamp01(
        length_score * 0.5 + (0.3 if "\n" in text else 0) + media_score * 0.2
    )

    substance = (
        -2.2
        if chars <= 0
        else (-1.4 if chars < 20 else (-0.55 if chars < 40 else length_score * 0.55))
    )
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

    scores: Dict[str, Any] = {
        "favorite_score": blend(clamp01(q * 0.85), min(1.0, like_rate * 8)),
        "reply_score": blend(
            clamp01(q * 0.45 + conversation * 0.55), min(1.0, reply_rate * 12)
        ),
        "retweet_score": blend(
            clamp01(q * 0.4 + media_score * 0.2), min(1.0, repost_rate * 15)
        ),
        "photo_expand_score": clamp01(q * 0.5 + 0.2)
        if has_image
        else clamp01(q * 0.05),
        "click_score": clamp01(
            q * 0.35 + structure * 0.2 + (0.15 if external else 0.05)
        ),
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
        "not_interested_score": clamp01(
            0.02 + spam * 0.35 + (0.04 if external else 0) + (1 - q) * 0.08
        ),
        "block_author_score": clamp01(0.01 + spam * 0.2),
        "mute_author_score": clamp01(0.015 + spam * 0.22),
        "report_score": clamp01(0.01 + spam * 0.35),
        "not_dwelled_score": clamp01((1 - q) * 0.4 + (0.15 if chars < 20 else 0)),
        "_meta": {
            "mode": "sidecar-proxy",
            "quality": q,
            "note": "Sidecar proxy multi-action heads",
        },
    }
    return scores
