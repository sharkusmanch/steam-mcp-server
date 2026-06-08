## v0.5.0 (2026-06-08)

### Breaking Changes

Adding pagination changed several tool response shapes. Consumers that indexed the old shapes should update:

- `get_trade_offers`: the separate `sent_offers` / `received_offers` arrays are replaced by a single paginated `offers` array (each offer carries a `direction: "sent" | "received"`). `sent_count` / `received_count` are retained.
- `get_recently_played`: returns `{ count, games }` instead of a bare array.
- `get_game_news`: returns `{ count, items }` instead of a bare array.
- `get_achievements`: returns a paginated envelope (`{ steamID, gameName, success, achievement_count, returned, offset, has_more, achievements }`) instead of the raw playerstats object; the `achievements` array is now a single page.
- `get_global_game_stats`: returns `{ count, stats }` instead of a bare array.
- `get_achievement_summary`: returns `{ game_count, returned, offset, has_more, summaries }` instead of a bare array.
- `get_inventory`: paginates via the Steam-native `next_cursor` (`start_assetid`) only; the per-page `count` default is 50 (max 500) and the response includes `has_more` / `next_cursor`.
- `search_apps`: backed by Steam's storefront search; returns top-ranked matches only (`{ query, returned, offset, has_more, note, apps }`), not an exhaustive catalog count.

### Features

- **Reliability**: every Steam API request now has a configurable timeout (`STEAM_HTTP_TIMEOUT_MS`, default 10s) plus bounded retry with exponential backoff on transient failures (timeouts, HTTP 429, 5xx). Honors `Retry-After` on 429.
- **Typed errors**: client throws `TimeoutError`/`RateLimitError`/`AuthError`/`NotFoundError`/`UpstreamError`, mapped to clear, actionable messages; all tool handlers now return failures with `isError: true`.
- **`search_apps` rewrite**: replaced the multi-MB full-catalog (`GetAppList`) scan with Steam's relevance-ranked storefront search. Fast and reliable; supports `offset`/`limit`. Result rows are filtered to apps and gain `tiny_image`/`price`/`platforms`/`metascore`/`controller_support`.
- **App-wide pagination**: consistent `limit`/`offset` and a `{ total, returned, offset, has_more, ... }` envelope added to list tools (friends, wishlist, badges, user groups, trade offers/history, achievements, achievement summary, perfect games, inventories, servers). `get_inventory` exposes a Steam-native `next_cursor` (`start_assetid`).
- **Input validation**: tightened zod constraints (positive int app IDs, bounded counts, capped array inputs) across tools.

### Bug Fixes

- Guard JSON parsing so non-JSON Steam responses surface a clear `UpstreamError` instead of an opaque `SyntaxError`.
- Removed the in-memory app-list cache (lost on every restart) and the deprecated `GetAppList` code path.

### Other Changes

- vitest now only runs TypeScript sources (no more duplicate runs from `dist/`); added tests for the timeout/retry/typed-error layer and `searchStore`.


## v0.4.0 (2025-12-07)

### Features

- add wishlist and trade API endpoints
- add batch app name fetching to wishlist endpoint
- add friend names and status to get_friends_list
- add game names to get_badges endpoint
- add partner names to get_trade_offers endpoint
- add partner names to get_trade_history endpoint

### Bug Fixes

- add fallback value to getTradeOffersSummary for consistency

### Other Changes

- Update src/steam-client.ts
- Merge pull request #9 from sharkusmanch/claude/api-endpoint-wishlist-01APrNMhtzQGSkAobbXGt4HB


## v0.3.0 (2025-12-05)

### Bug Fixes

- make release workflow manually triggered
- update dependency zod to v4

### Other Changes

- Merge pull request #6 from sharkusmanch/renovate/node-24.x
- Merge pull request #8 from sharkusmanch/renovate/zod-4.x


# Changelog

## v0.2.0 (2025-12-05)

### Features

- add automated version bumping workflow

### Other Changes

- Initial commit
- Initial commit: Steam MCP server with 26 tools
- Security hardening: Add input validation and error sanitization
- Merge pull request #1 from sharkusmanch/claude/security-audit-017wmCbiHswR2tPUgyvNZ4kE
- Add renovate.json
- Merge pull request #2 from sharkusmanch/renovate/configure
- Merge pull request #4 from sharkusmanch/renovate/actions-setup-node-6.x
- Merge pull request #3 from sharkusmanch/renovate/actions-checkout-6.x


