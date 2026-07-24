# Shadowban checker (dev notes)

Implemented in `src/lib/shadowban.js` (NARV v1.4).

## Research summary

Community tools (shadowban.yuzurisa, TweetHunter, BanChecker, etc.) typically probe:

| Signal | Method |
|--------|--------|
| Search Suggestion Ban | Typeahead / people search does not return handle |
| Search Ban | `from:user` search missing recent status IDs present on timeline |
| Ghost Ban | Replies invisible to non-followers (hard; needs second viewer) |
| Reply deboost | Replies behind “Show more replies” (manual) |
| Account flags | Suspended, protected, withheld |

NARV automates suggestion + search + reply-search heuristic + behavioral risks using the **logged-in web session** (same bearer + `ct0` pattern as follow-gate).

## API surfaces used

- `GET /i/api/1.1/users/show.json`
- `GET /i/api/1.1/statuses/user_timeline.json`
- `GET /i/api/1.1/search/typeahead.json`
- `GET /i/api/2/search/adaptive.json` and/or `1.1/search/tweets.json`
- `from:user filter:replies` for ghost heuristic

## UI

- Panel button **Shadowban**
- Popup **Shadowban check**
- Message type `NARV_SHADOWBAN`

## Honesty

Not an official X product signal. Results are visibility probes + heuristics. Always pair with manual tests described in README.
