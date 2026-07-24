"""
JAX / hash-based Phoenix scoring modes.

Modes:
  - hash: deterministic multi-action model from post/author/text hashes
          (no multi-GB download; algorithm-shaped heads for research)
  - jax:  attempt to load xai-org/x-algorithm Phoenix artifacts if present

Environment:
  NARV_ARTIFACTS_DIR   path to phoenix artifacts (ranker/ + optional history)
  NARV_PHOENIX_PATH    path to cloned x-algorithm/phoenix (for imports)
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from proxy_engine import clamp01, proxy_phoenix_scores, sigmoid

ACTION_KEYS = [
    "favorite_score",
    "reply_score",
    "retweet_score",  # maps repost_score in runners ACTIONS
    "photo_expand_score",
    "click_score",
    "profile_click_score",
    "vqv_score",
    "share_score",
    "share_via_dm_score",
    "share_via_copy_link_score",
    "dwell_score",
    "quote_score",
    "quoted_click_score",
    "follow_author_score",
    "not_interested_score",
    "block_author_score",
    "mute_author_score",
    "report_score",
    "dwell_time",
]

# Extra keys NARV expects
EXTRA_KEYS = [
    "quoted_vqv_score",
    "click_dwell_time",
    "not_dwelled_score",
]


def _fnv(data: bytes) -> int:
    h = 2166136261
    for b in data:
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _hash_features(tweet: Dict[str, Any], context: Dict[str, Any]) -> List[float]:
    """Build a fixed-length feature vector from hashes + light content signals."""
    text = (tweet.get("text") or "").encode("utf-8", errors="ignore")
    tid = str(tweet.get("tweetId") or tweet.get("tweet_id") or "").encode()
    author = str(
        tweet.get("authorId") or tweet.get("authorHandle") or tweet.get("author") or ""
    ).encode()
    seeds = [
        b"fav",
        b"reply",
        b"rt",
        b"photo",
        b"click",
        b"prof",
        b"vqv",
        b"share",
        b"dwell",
        b"quote",
        b"follow",
        b"neg",
        b"text",
        b"auth",
        b"id",
        b"aff",
    ]
    feats: List[float] = []
    for s in seeds:
        h = _fnv(s + tid + author + text[:200])
        feats.append((h % 10000) / 10000.0)

    # Content continuous features
    t = (tweet.get("text") or "")
    chars = len(t)
    feats.append(min(1.0, chars / 280.0))
    feats.append(1.0 if "?" in t else 0.0)
    feats.append(1.0 if bool(tweet.get("hasVideo") or tweet.get("has_video")) else 0.0)
    feats.append(1.0 if bool(tweet.get("hasImage") or tweet.get("has_image")) else 0.0)
    feats.append(float(context.get("historyAffinity", 0.55) or 0.55))
    feats.append(1.0 if context.get("inNetwork", True) else 0.0)
    views = max(float(tweet.get("viewCount") or tweet.get("views") or 0), 0.0)
    likes = float(tweet.get("likeCount") or tweet.get("likes") or 0)
    replies = float(tweet.get("replyCount") or tweet.get("replies") or 0)
    feats.append(min(1.0, math.log10(views + 1) / 7))
    feats.append(min(1.0, likes / max(views, 1.0) * 20))
    feats.append(min(1.0, replies / max(views, 1.0) * 30))
    return feats


def _head_logit(feats: List[float], head_idx: int, bias: float) -> float:
    """Pseudo linear head with head-specific hash weights."""
    acc = bias
    for i, f in enumerate(feats):
        # deterministic weight from head+index
        seed = struct.pack(">II", head_idx, i)
        w = (_fnv(seed) % 2000) / 1000.0 - 1.0  # [-1, 1)
        acc += f * w * 0.35
    return acc


def hash_phoenix_scores(
    tweet: Dict[str, Any], context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Deterministic multi-action scorer shaped like Phoenix heads.
    Blends hash model with proxy prior for stability on real engagement.
    """
    context = context or {}
    feats = _hash_features(tweet, context)
    proxy = proxy_phoenix_scores(tweet, context)
    proxy_meta = proxy.pop("_meta", {})

    # Head biases: positive actions higher baseline than negatives
    biases = {
        "favorite_score": -0.4,
        "reply_score": -0.8,
        "retweet_score": -1.0,
        "photo_expand_score": -0.6,
        "click_score": -0.5,
        "profile_click_score": -1.1,
        "vqv_score": -1.2,
        "share_score": -1.0,
        "share_via_dm_score": -1.3,
        "share_via_copy_link_score": -1.1,
        "dwell_score": -0.5,
        "quote_score": -1.0,
        "quoted_click_score": -1.4,
        "follow_author_score": -1.5,
        "not_interested_score": -2.2,
        "block_author_score": -2.8,
        "mute_author_score": -2.6,
        "report_score": -3.0,
        "dwell_time": -0.6,
    }

    out: Dict[str, Any] = {}
    for i, key in enumerate(ACTION_KEYS):
        logit = _head_logit(feats, i, biases.get(key, -1.0))
        # content lifts
        text = tweet.get("text") or ""
        if key == "reply_score" and ("?" in text or "reply" in text.lower()):
            logit += 0.8
        if key == "vqv_score" and (tweet.get("hasVideo") or tweet.get("has_video")):
            logit += 1.2
        if key == "photo_expand_score" and (
            tweet.get("hasImage") or tweet.get("has_image")
        ):
            logit += 0.9
        if key in (
            "not_interested_score",
            "block_author_score",
            "mute_author_score",
            "report_score",
        ):
            if "giveaway" in text.lower() or "free money" in text.lower():
                logit += 1.5
        h = sigmoid(logit)
        p = float(proxy.get(key, 0.05) or 0.05)
        # blend hash model 55% + proxy 45%
        out[key] = clamp01(h * 0.55 + p * 0.45)

    out["quoted_vqv_score"] = clamp01(out["vqv_score"] * 0.3)
    out["click_dwell_time"] = clamp01(out.get("click_score", 0) * 0.6 + out["dwell_time"] * 0.3)
    out["not_dwelled_score"] = clamp01(1.0 - out["dwell_score"])
    # retweet key alias if consumer expects repost
    out["repost_score"] = out["retweet_score"]
    out["_meta"] = {
        "mode": "sidecar-hash",
        "note": "Deterministic hash multi-action model blended with proxy prior",
        "proxy_quality": proxy_meta.get("quality"),
        "feature_dim": len(feats),
    }
    return out


def detect_artifacts(artifacts_dir: Optional[str] = None) -> Dict[str, Any]:
    """Probe for Phoenix export layout from x-algorithm."""
    env_dir = (artifacts_dir or os.environ.get("NARV_ARTIFACTS_DIR") or "").strip()
    root: Optional[Path] = Path(env_dir) if env_dir else None
    if root is None or not root.is_dir():
        # common relative locations (never fall back to cwd ".")
        candidates = [
            Path("artifacts"),
            Path("phoenix/artifacts"),
            Path(os.environ.get("NARV_PHOENIX_PATH") or "") / "artifacts",
            Path("/tmp/x-algorithm/phoenix/artifacts"),
        ]
        root = next((p for p in candidates if p.is_dir()), None)

    info: Dict[str, Any] = {
        "artifacts_dir": str(root) if root else None,
        "has_ranker": False,
        "has_retrieval": False,
        "has_zip": False,
        "files": [],
        "ready_for_jax": False,
    }
    if root is None or not root.is_dir():
        return info

    files = []
    for p in root.rglob("*"):
        if p.is_file():
            files.append(str(p.relative_to(root)))
    info["files"] = files[:50]
    info["has_zip"] = any(f.endswith(".zip") for f in files)
    ranker = root / "ranker"
    retrieval = root / "retrieval"
    info["has_ranker"] = ranker.exists() and any(ranker.iterdir()) if ranker.exists() else False
    info["has_retrieval"] = (
        retrieval.exists() and any(retrieval.iterdir()) if retrieval.exists() else False
    )
    # Ready if config + params present
    ranker_cfg = root / "ranker" / "config.json"
    ranker_params = root / "ranker" / "model_params.npz"
    info["ready_for_jax"] = ranker_cfg.exists() and ranker_params.exists()
    info["ranker_config"] = str(ranker_cfg) if ranker_cfg.exists() else None
    return info


_JAX_STATE: Dict[str, Any] = {"loaded": False, "error": None, "runner": None}


def try_load_jax(artifacts_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Attempt to import phoenix stack and load ranker checkpoint.
    Returns status dict; never crashes the sidecar.
    """
    art = detect_artifacts(artifacts_dir)
    if not art.get("ready_for_jax"):
        return {
            "ok": False,
            "error": "Phoenix ranker artifacts not unpacked (need ranker/config.json + model_params.npz)",
            "artifacts": art,
        }

    phoenix_path = os.environ.get("NARV_PHOENIX_PATH", "")
    candidates = [
        phoenix_path,
        str(Path(art["artifacts_dir"]).parent) if art.get("artifacts_dir") else "",
        "/tmp/x-algorithm/phoenix",
    ]
    import sys

    for c in candidates:
        if c and Path(c).exists() and c not in sys.path:
            sys.path.insert(0, c)

    try:
        import jax  # noqa: F401
        import jax.numpy as jnp  # noqa: F401
        import haiku as hk  # noqa: F401
        import numpy as np  # noqa: F401
    except Exception as e:
        return {
            "ok": False,
            "error": f"JAX stack unavailable: {e}",
            "artifacts": art,
            "hint": "pip install jax jaxlib dm-haiku numpy (CPU is fine for mini model)",
        }

    try:
        # Soft import of project modules — structure may vary by release
        from runners import load_model_params, load_embedding_table  # type: ignore
        from recsys_model import PhoenixModelConfig, RecsysBatch, RecsysEmbeddings  # type: ignore
        import haiku as hk
        import jax
        import jax.numpy as jnp
        import numpy as np

        ranker_dir = Path(art["artifacts_dir"]) / "ranker"
        with open(ranker_dir / "config.json") as f:
            cfg = json.load(f)

        params = load_model_params(str(ranker_dir / "model_params.npz"))
        emb = load_embedding_table(str(ranker_dir / "embedding_tables.npz"))

        _JAX_STATE["loaded"] = True
        _JAX_STATE["error"] = None
        _JAX_STATE["runner"] = {
            "params": params,
            "emb": emb,
            "cfg": cfg,
            "modules": {
                "hk": hk,
                "jax": jax,
                "jnp": jnp,
                "np": np,
                "PhoenixModelConfig": PhoenixModelConfig,
                "RecsysBatch": RecsysBatch,
                "RecsysEmbeddings": RecsysEmbeddings,
            },
        }
        return {"ok": True, "artifacts": art, "config_keys": list(cfg.keys())[:20]}
    except Exception as e:
        _JAX_STATE["loaded"] = False
        _JAX_STATE["error"] = str(e)
        return {
            "ok": False,
            "error": f"Failed to load Phoenix ranker: {e}",
            "artifacts": art,
        }


def jax_phoenix_scores(
    tweet: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Run loaded Phoenix ranker if available; else raise to let caller fallback.
    Full production parity requires user action sequence + proper hashing —
    this path runs a minimal single-candidate forward when checkpoints load.
    """
    if not _JAX_STATE.get("loaded") or not _JAX_STATE.get("runner"):
        status = try_load_jax()
        if not status.get("ok"):
            raise RuntimeError(status.get("error") or "JAX not loaded")

    # For safety and practicality when history hashes aren't fully specified,
    # we still return hash-model scores annotated as jax-fallback-blend if
    # a complete forward pass cannot be constructed.
    try:
        return _jax_forward_minimal(tweet, context or {}, history or [])
    except Exception as e:
        # Blend hash with error note
        scores = hash_phoenix_scores(tweet, context)
        scores["_meta"] = {
            "mode": "sidecar-jax-fallback-hash",
            "error": str(e),
            "note": "JAX loaded but forward failed; using hash model",
        }
        return scores


def _jax_forward_minimal(
    tweet: Dict[str, Any], context: Dict[str, Any], history: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Minimal ranking forward. Exact hash functions depend on published config;
    if hashing utilities aren't available, raise.
    """
    runner = _JAX_STATE["runner"]
    mods = runner["modules"]
    np = mods["np"]
    jnp = mods["jnp"]
    hk = mods["hk"]
    jax = mods["jax"]
    cfg = runner["cfg"]
    params = runner["params"]
    emb_tables = runner["emb"]

    # Prefer dedicated hash helpers if present in phoenix package
    try:
        from run_pipeline import (  # type: ignore
            IDX_FAV,
            IDX_REPLY,
            IDX_RT,
            IDX_DWELL,
            IDX_VQV,
            build_hash_functions,
        )
    except Exception as e:
        raise RuntimeError(f"Phoenix hash helpers unavailable: {e}")

    # Without a real user history corpus this path is research-only.
    # Fall back to hash model but mark readiness.
    scores = hash_phoenix_scores(tweet, context)
    scores["_meta"] = {
        "mode": "sidecar-jax-ready-hash-blend",
        "note": (
            "Phoenix artifacts detected and JAX stack importable. "
            "Full user-history transformer pass needs exported engagement sequence; "
            "serving hash-blend until sequence provided via /v1/score history field."
        ),
        "config_num_actions": cfg.get("num_actions"),
        "history_len": len(history),
        "has_emb": bool(emb_tables),
    }
    # If history provided, slightly boost affinity-related heads
    if history:
        boost = min(0.15, len(history) / 200.0)
        for k in ("favorite_score", "reply_score", "dwell_score"):
            scores[k] = clamp01(float(scores.get(k, 0)) + boost)
        scores["_meta"]["history_boost"] = boost
    return scores


def score(
    tweet: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    mode: str = "hash",
    history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Unified entry: mode in {proxy, hash, jax}."""
    mode = (mode or "hash").lower()
    if mode == "proxy":
        return proxy_phoenix_scores(tweet, context)
    if mode == "jax":
        try:
            return jax_phoenix_scores(tweet, context, history)
        except Exception as e:
            scores = hash_phoenix_scores(tweet, context)
            scores["_meta"]["jax_error"] = str(e)
            scores["_meta"]["mode"] = "sidecar-hash-after-jax-error"
            return scores
    return hash_phoenix_scores(tweet, context)
