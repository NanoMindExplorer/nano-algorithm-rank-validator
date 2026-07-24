"""Python port of NARV WeightedScorer + RankingScorer (structure from x-algorithm)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

DEFAULT_WEIGHTS: Dict[str, float] = {
    "favorite": 1.0,
    "reply": 13.5,
    "retweet": 1.0,
    "photo_expand": 0.4,
    "click": 0.5,
    "profile_click": 1.2,
    "vqv": 0.8,
    "share": 2.0,
    "share_via_dm": 1.5,
    "share_via_copy_link": 1.0,
    "dwell": 0.5,
    "quote": 2.5,
    "quoted_click": 0.6,
    "quoted_vqv": 0.5,
    "cont_dwell_time": 0.3,
    "cont_click_dwell_time": 0.2,
    "follow_author": 4.0,
    "not_interested": -8.0,
    "block_author": -24.0,
    "mute_author": -16.0,
    "report": -30.0,
    "not_dwelled": -0.5,
}

DEFAULT_PARAMS: Dict[str, float] = {
    "authorDiversityDecay": 0.6,
    "authorDiversityFloor": 0.25,
    "oonWeightFactor": 0.75,
    "minVideoDurationMs": 5000,
    "negativeScoresOffset": 0.01,
    "premiumInNetworkMultiplier": 4.0,
    "premiumOonMultiplier": 2.0,
}

# Map phoenix score keys → weight keys
SCORE_MAP = {
    "favorite": "favorite_score",
    "reply": "reply_score",
    "retweet": "retweet_score",
    "photo_expand": "photo_expand_score",
    "click": "click_score",
    "profile_click": "profile_click_score",
    "vqv": "vqv_score",
    "share": "share_score",
    "share_via_dm": "share_via_dm_score",
    "share_via_copy_link": "share_via_copy_link_score",
    "dwell": "dwell_score",
    "quote": "quote_score",
    "quoted_click": "quoted_click_score",
    "quoted_vqv": "quoted_vqv_score",
    "cont_dwell_time": "dwell_time",
    "cont_click_dwell_time": "click_dwell_time",
    "follow_author": "follow_author_score",
    "not_interested": "not_interested_score",
    "block_author": "block_author_score",
    "mute_author": "mute_author_score",
    "report": "report_score",
    "not_dwelled": "not_dwelled_score",
}


def _get(scores: Dict[str, Any], key: str) -> float:
    v = scores.get(key)
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def weight_sums(weights: Dict[str, float]) -> Tuple[float, float, float]:
    pos_keys = [
        "favorite",
        "reply",
        "retweet",
        "photo_expand",
        "click",
        "profile_click",
        "vqv",
        "share",
        "share_via_dm",
        "share_via_copy_link",
        "dwell",
        "quote",
        "quoted_click",
        "quoted_vqv",
        "follow_author",
    ]
    neg_keys = [
        "not_interested",
        "block_author",
        "mute_author",
        "report",
        "not_dwelled",
    ]
    positive = sum(float(weights.get(k, 0) or 0) for k in pos_keys)
    neg_raw = sum(float(weights.get(k, 0) or 0) for k in neg_keys)
    negative = abs(neg_raw) if neg_raw < 0 else abs(neg_raw)
    return positive, negative, positive + negative


def normalize_score(raw: float, weights: Dict[str, float]) -> float:
    positive, _, _ = weight_sums(weights)
    if positive <= 0:
        return max(0.0, raw)
    expected_high = max(0.5, positive * 0.22)
    x = raw / expected_high
    if x <= 0:
        return 0.0
    mapped = x / (1 + 0.3 * x)
    return max(0.0, min(1.15, mapped))


def offset_score(combined: float, weights: Dict[str, float], params: Dict[str, float]) -> float:
    positive, negative, total = weight_sums(weights)
    offset = float(params.get("negativeScoresOffset", 0.01))
    if total == 0:
        return max(0.0, combined)
    if combined < 0:
        return ((combined + negative) / total) * offset
    return combined + offset


def compute_weighted(
    phoenix_scores: Dict[str, Any],
    tweet: Optional[Dict[str, Any]] = None,
    weights: Optional[Dict[str, float]] = None,
    params: Optional[Dict[str, float]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    tweet = tweet or {}
    context = context or {}
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    p = {**DEFAULT_PARAMS, **(params or {})}

    has_video = bool(tweet.get("hasVideo") or tweet.get("has_video"))
    min_ms = float(p.get("minVideoDurationMs", 5000))
    duration = tweet.get("videoDurationMs") or tweet.get("video_duration_ms")
    if has_video:
        if duration is None:
            vqv_w = float(w.get("vqv", 0)) * 0.5
        elif float(duration) > min_ms:
            vqv_w = float(w.get("vqv", 0))
        else:
            vqv_w = 0.0
    else:
        vqv_w = 0.0

    contributions: Dict[str, Dict[str, float]] = {}
    combined = 0.0
    for wk, sk in SCORE_MAP.items():
        weight = vqv_w if wk == "vqv" else float(w.get(wk, 0) or 0)
        if wk == "quoted_vqv" and not (
            tweet.get("isQuote") or tweet.get("is_quote")
        ):
            weight = 0.0
        prob = _get(phoenix_scores, sk)
        contrib = prob * weight
        contributions[wk] = {
            "probability": prob,
            "weight": weight,
            "contribution": contrib,
        }
        combined += contrib

    off = offset_score(combined, w, p)
    norm = normalize_score(off, w)

    # OON + soft premium (mirror ranking-scorer.js)
    score = norm
    in_network = context.get("inNetwork", tweet.get("inNetwork", True))
    if in_network is False:
        score *= float(p.get("oonWeightFactor", 0.75))
    premium = bool(
        tweet.get("authorPremium")
        or tweet.get("authorVerified")
        or tweet.get("author_verified")
    )
    if premium:
        mult = float(
            p.get("premiumInNetworkMultiplier", 4.0)
            if in_network is not False
            else p.get("premiumOonMultiplier", 2.0)
        )
        soft = 1 + (mult - 1) * 0.08
        score = min(1.12, score * soft)

    ranked = sorted(
        ({"key": k, **v} for k, v in contributions.items()),
        key=lambda x: abs(x["contribution"]),
        reverse=True,
    )

    grade = grade_score(score)
    return {
        "raw": combined,
        "offset": off,
        "normalized": norm,
        "finalScore": score,
        "grade": grade,
        "contributions": contributions,
        "rankedContributions": ranked,
        "vqvWeightApplied": vqv_w,
    }


def grade_score(score: float) -> Dict[str, str]:
    if score >= 0.85:
        return {"letter": "A+", "label": "Excellent reach potential", "color": "#00ba7c"}
    if score >= 0.7:
        return {"letter": "A", "label": "Strong For You candidate", "color": "#00ba7c"}
    if score >= 0.55:
        return {"letter": "B", "label": "Solid — good distribution chance", "color": "#1d9bf0"}
    if score >= 0.4:
        return {"letter": "C", "label": "Average — optimize replies & media", "color": "#ffd400"}
    if score >= 0.25:
        return {"letter": "D", "label": "Weak — risk of low OON reach", "color": "#ff7a00"}
    return {"letter": "F", "label": "Poor — filter risk or negative signals", "color": "#f4212e"}


def diversity_multiplier(decay: float, floor: float, position: int) -> float:
    return (1 - floor) * (decay**position) + floor


def apply_author_diversity(
    items: List[Dict[str, Any]],
    scores: List[float],
    params: Optional[Dict[str, float]] = None,
) -> List[float]:
    p = {**DEFAULT_PARAMS, **(params or {})}
    decay = float(p.get("authorDiversityDecay", 0.6))
    floor = float(p.get("authorDiversityFloor", 0.25))
    indexed = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
    adjusted = [0.0] * len(scores)
    counts: Dict[str, int] = {}
    for idx, s in indexed:
        author = str(items[idx].get("authorId") or items[idx].get("authorHandle") or "unknown")
        pos = counts.get(author, 0)
        counts[author] = pos + 1
        adjusted[idx] = s * diversity_multiplier(decay, floor, pos)
    return adjusted
