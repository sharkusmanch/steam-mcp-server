# Steam API Coverage

This document details which Steam Web API endpoints are implemented in this MCP server and which are not yet covered.

## Implemented APIs

### ISteamUser
| Method | Tool | Notes |
|--------|------|-------|
| GetPlayerSummaries | `get_player_summary` | Profile info, avatar, status |
| GetFriendList | `get_friends_list` | Friends with relationship info |
| ResolveVanityURL | `resolve_vanity_url` | Convert vanity URL to Steam ID |
| GetPlayerBans | `get_player_bans` | VAC/game/trade bans |
| GetUserGroupList | `get_user_groups` | Steam groups membership |

### IPlayerService
| Method | Tool | Notes |
|--------|------|-------|
| GetOwnedGames | `get_owned_games` | With pagination, sorting |
| GetRecentlyPlayedGames | `get_recently_played` | Last 2 weeks |
| GetSteamLevel | `get_steam_level` | Account level |
| GetBadges | `get_badges` | Badges, XP, level progression |
| GetCommunityBadgeProgress | `get_badge_progress` | Trading card progress |
| IsPlayingSharedGame | `is_playing_shared_game` | Family Sharing detection |

### ISteamUserStats
| Method | Tool | Notes |
|--------|------|-------|
| GetPlayerAchievements | `get_achievements`, `get_perfect_games`, `get_achievement_summary` | Player achievements |
| GetUserStatsForGame | `get_game_stats` | Player statistics |
| GetGlobalAchievementPercentagesForApp | `get_global_achievement_percentages` | Global unlock rates |
| GetNumberOfCurrentPlayers | `get_player_count` | Live player count |
| GetSchemaForGame | `get_game_schema` | Achievement/stat definitions |
| GetGlobalStatsForGame | `get_global_game_stats` | Global aggregated stats |

### ISteamNews
| Method | Tool | Notes |
|--------|------|-------|
| GetNewsForApp | `get_game_news` | News and patch notes |

### ISteamApps
| Method | Tool | Notes |
|--------|------|-------|
| GetAppList | `search_apps` | Search Steam catalog |
| GetServersAtAddress | `get_servers_at_address` | Game servers at IP |
| UpToDateCheck | `check_app_update` | Version update check |

### IEconItems (Game-Specific)
| Method | Tool | Notes |
|--------|------|-------|
| GetPlayerItems (440) | `get_tf2_inventory` | Team Fortress 2 |
| GetPlayerItems (730) | `get_csgo_inventory` | CS2/CSGO |
| GetPlayerItems (570) | `get_dota2_inventory` | Dota 2 |

### Steam Community (Unofficial)
| Endpoint | Tool | Notes |
|----------|------|-------|
| /inventory/{steamid}/{appid}/{contextid} | `get_inventory` | Public inventory for any game |

### Steam Store API
| Endpoint | Tool | Notes |
|----------|------|-------|
| /api/appdetails | `get_game_details` | Game info, price, requirements |

---

## Not Yet Implemented

### IStoreService
| Method | Description | Difficulty |
|--------|-------------|------------|
| GetAppList | Featured/sale items | Medium |
| GetWishlistCount | Number of wishlists for app | Medium |

### IWishlistService
| Method | Description | Difficulty |
|--------|-------------|------------|
| GetWishlist | User's wishlist | Medium |
| GetWishlistSortedFiltered | Sorted/filtered wishlist | Medium |

### IEconService
| Method | Description | Difficulty |
|--------|-------------|------------|
| GetTradeHistory | Trade history | Medium |
| GetTradeOffers | Active trade offers | Medium |
| GetTradeOffersSummary | Pending trade counts | Easy |

### IEconMarketService
| Method | Description | Difficulty |
|--------|-------------|------------|
| GetPopular | Popular market items | Medium |
| GetAssetPrices | Item prices | Medium |

---

## Requires Publisher/Special Access

These APIs require Steamworks publisher access or special authorization:

| Interface | Method | Notes |
|-----------|--------|-------|
| IEconService | GetInventoryItemsWithDescriptions | Publisher key required |
| IPublishedFileService | * | Workshop management |
| ICheatReportingService | * | Anti-cheat |
| IGameNotificationsService | * | Push notifications |
| ISteamLeaderboards | * | Leaderboard management |
| ISteamMicroTxn | * | In-app purchases |
| ISteamEconomy | * | Economy management |
| IWorkshopService | * | Workshop admin |

---

## Game-Specific APIs

These APIs are available for specific games:

### Dota 2 (570)
| Interface | Methods |
|-----------|---------|
| IDOTA2Match_570 | GetMatchHistory, GetMatchDetails, GetLiveLeagueGames |
| IDOTA2Fantasy_570 | GetFantasyPlayerStats, GetProPlayerList |
| IEconDOTA2_570 | GetHeroes, GetItemIconPath, GetRarities |

### CS2/CSGO (730)
| Interface | Methods |
|-----------|---------|
| ICSGOPlayers_730 | GetNextMatchSharingCode |
| ICSGOServers_730 | GetGameServersStatus |

### Team Fortress 2 (440)
| Interface | Methods |
|-----------|---------|
| ITFItems_440 | GetGoldenWrenches |
| ITFPromos_440 | GetItemID |

---

## Priority Recommendations

### High Priority (User-focused, easy to implement)
All high-priority APIs have been implemented:
- ~~`GetBadges`~~ ✅ `get_badges`
- ~~`GetNewsForApp`~~ ✅ `get_game_news`
- ~~`GetPlayerBans`~~ ✅ `get_player_bans`
- ~~`GetNumberOfCurrentPlayers`~~ ✅ `get_player_count`
- ~~`GetSchemaForGame`~~ ✅ `get_game_schema`

### Medium Priority (Useful additions)
1. `GetWishlist` - Wishlist management
2. `GetTradeOffers` - Trading functionality
3. `GetMatchHistory` (Dota 2) - Match history
4. `GetAppList` - Search for games

### Low Priority (Niche use cases)
1. Game server queries
2. Workshop/UGC management
3. Market price lookups
