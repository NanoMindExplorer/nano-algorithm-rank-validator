# Research Notes — X For You Algorithm & NARV

> **Pengguna akhir:** panduan pemakaian ada di [README](https://github.com/NanoMindExplorer/nano-algorithm-rank-validator#readme).


Deep research summary for **Nano Algorithm Rank Validator**, based on
[xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) (Apache-2.0, May 2026 update).

## 1. System architecture

The For You feed is orchestrated by **Home Mixer** (`home-mixer/`) using the
**Candidate Pipeline** framework (`candidate-pipeline/`).

```
Request → Query Hydration → Candidate Sources → Hydration → Pre-Filters
       → Phoenix Scorer → Weighted Scorer → Author Diversity → OON Scorer
       → Top-K Selection → Post-Selection Filters → Response
```

### Sources

| Source | Role |
|--------|------|
| **Thunder** | In-memory recent posts from accounts you follow (in-network) |
| **Phoenix Retrieval** | Two-tower ANN similarity over global corpus (out-of-network) |
| Ads / WTF / Prompts / Topics / MoE | Additional surfaces blended later |

### Phoenix ML (`phoenix/`)

1. **Retrieval (two-tower)**  
   User tower encodes engagement history → embedding.  
   Candidate tower encodes posts → embeddings.  
   Top-K via dot product.

2. **Ranking (Grok-based transformer)**  
   - Input: user hashes + history (posts, authors, actions, product surface) + candidates  
   - **Candidate isolation attention**: candidates attend to user+history only, not each other  
   - Output: logits `[batch, candidates, num_actions]` → sigmoid → P(action)

Ported from Grok-1 architecture; production is larger than the published mini checkpoint (~256-dim, few layers).

## 2. Multi-action prediction targets

From `phoenix/runners.py` ACTIONS and `home-mixer` scorers:

### Positive

| Key | Meaning |
|-----|---------|
| favorite | Like |
| reply | Reply |
| retweet / repost | Repost |
| quote | Quote post |
| click | Post click |
| profile_click | Profile click |
| photo_expand | Expand image |
| vqv | Video quality view |
| share / share_via_dm / share_via_copy_link | Share channels |
| dwell / dwell_time | Read / time spent |
| follow_author | Follow |

### Negative

| Key | Meaning |
|-----|---------|
| not_interested | “Not interested” |
| block_author | Block |
| mute_author | Mute |
| report | Report |
| not_dwelled | Failed to dwell |

## 3. Weighted scoring formula

From `home-mixer/scorers/weighted_scorer.rs` and `ranking_scorer.rs`:

```
combined = Σ weight_i × P_i
final    = offset_score(combined)
```

- Positive weights boost; negative weights suppress.
- **VQV weight** is 0 unless video duration &gt; `MIN_VIDEO_DURATION_MS`.
- **offset_score**: if combined &lt; 0, remap using negative/total weight sums × `NEGATIVE_SCORES_OFFSET`; else add offset.
- Production weight **magnitudes are not in the OSS tree** (private `params` / feature switches).  
  Demo script `phoenix/run_pipeline.py` uses: fav=1.0, reply=0.5, rt=0.3, dwell=0.2 (toy demo only).

NARV defaults use research-calibrated hierarchy (conversation/reply heavily weighted) and are fully user-editable.

## 4. Author diversity

`author_diversity_scorer.rs` / `RankingScorer::apply_author_diversity`:

```
multiplier(position) = (1 - floor) * decay^position + floor
score' = score * multiplier
```

Authors sorted by current weighted score; repeated authors in one response get exponentially attenuated scores.

## 5. OON (out-of-network) scorer

```
if !in_network: score *= OON_WEIGHT_FACTOR
```

Special cases: topic feeds, eligible new users (`NEW_USER_OON_WEIGHT_FACTOR`).

## 6. Filters (hard drops)

### Pre-scoring

- DropDuplicatesFilter  
- CoreDataHydrationFilter  
- AgeFilter (tweet snowflake timestamp)  
- SelfTweetFilter  
- RetweetDeduplicationFilter  
- IneligibleSubscriptionFilter  
- PreviouslySeenPostsFilter / PreviouslyServedPostsFilter  
- MutedKeywordFilter  
- AuthorSocialgraphFilter (block/mute)  
- Topic / video / new-user topic filters  

### Post-selection

- VFFilter (deleted / spam / violence / gore — plus Grox safety)  
- DedupConversationFilter  

## 7. Grox content understanding

`grox/` provides spam, safety/PTOS, reply ranking, multimodal embeddings, “banger” screens — used for annotations and visibility, not the core weighted engagement sum.

## 8. What cannot run in a Chrome extension

| Component | Why |
|-----------|-----|
| Full Phoenix transformer + embedding tables | Multi-GB JAX/Haiku, needs user action sequences + hash tables |
| Production weight constants | Private params module |
| Thunder / Kafka / gRPC home-mixer | Server infrastructure |
| Impression bloom / served history | Server-side user state |
| Real VF / brand safety models | Private models + label stores |

## 9. What NARV implements faithfully

1. Full **WeightedScorer** structure (all action keys + VQV gating + offset).  
2. **Author diversity** and **OON** math.  
3. **Filter checklist** aligned to open-source filter names/stages.  
4. **PhoenixScores-shaped** multi-head probability object.  
5. **Snowflake age** for AgeFilter.  
6. Content/engagement **proxy heads** that fill P(action) when the transformer is unavailable — clearly labeled **proxy**.  
7. Configurable weights/params matching OSS param names.  
8. Timeline batch ranking for comparative validation.

## 10. Design principles from the OSS README

1. No hand-engineered relevance features in production — transformer learns from sequences.  
2. Candidate isolation → cacheable, order-independent scores.  
3. Hash-based embeddings for users/items/authors.  
4. Multi-action prediction instead of a single relevance logit.  
5. Composable pipeline traits (Source, Hydrator, Filter, Scorer, Selector, SideEffect).

## 11. Practical creator implications (from structure + empirical literature)

- **Replies / conversation** dominate distribution when reply weight is high.  
- **Negative feedback** (report/block/mute) can zero out reach.  
- **Video &gt; min duration** unlocks VQV term.  
- **External links** and spam patterns hurt via lower engagement + safety.  
- **Freshness** matters (AgeFilter + time features in model).  
- **Author diversity** means one author cannot flood a single feed response.  
- **OON** posts need stronger predicted engagement to compete with in-network.

## 12. References

- https://github.com/xai-org/x-algorithm  
- `home-mixer/scorers/{weighted_scorer,ranking_scorer,phoenix_scorer,author_diversity_scorer,oon_scorer,vm_ranker}.rs`  
- `phoenix/{README.md,recsys_model.py,runners.py,run_pipeline.py}`  
- `home-mixer/filters/*`  
- Historical: https://github.com/twitter/the-algorithm (2023)
