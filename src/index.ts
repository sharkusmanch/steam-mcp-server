#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SteamClient } from "./steam-client.js";

const apiKey = process.env.STEAM_API_KEY;
const defaultSteamId = process.env.STEAM_ID;

if (!apiKey) {
  console.error("Error: STEAM_API_KEY environment variable is required");
  process.exit(1);
}

const steam = new SteamClient({ apiKey });

function getSteamId(providedId?: string): string {
  const steamId = providedId || defaultSteamId;
  if (!steamId) {
    throw new Error("No Steam ID provided and STEAM_ID environment variable not set");
  }
  return steamId;
}

const steamIdSchema = z
  .string()
  .optional()
  .describe("64-bit Steam ID (optional if STEAM_ID env var is set)");

// Helper for parallel processing with concurrency limit
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R | null>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      if (result !== null) results.push(result);
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove settled promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const settled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

const server = new McpServer({
  name: "steam-mcp-server",
  version: "1.0.0",
});

// === Social Tools ===

server.tool(
  "get_player_summary",
  "Get Steam player profile information including name, avatar, status, and current game",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    const players = await steam.getPlayerSummaries([getSteamId(steam_id)]);
    if (players.length === 0) {
      return { content: [{ type: "text", text: "Player not found" }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(players[0], null, 2) }],
    };
  }
);

server.tool(
  "get_friends_list",
  "Get a player's Steam friends list with relationship info",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    const friends = await steam.getFriendList(getSteamId(steam_id));
    return {
      content: [{ type: "text", text: JSON.stringify(friends, null, 2) }],
    };
  }
);

server.tool(
  "get_steam_level",
  "Get a player's Steam account level",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    const level = await steam.getSteamLevel(getSteamId(steam_id));
    return {
      content: [{ type: "text", text: JSON.stringify({ steam_level: level }) }],
    };
  }
);

server.tool(
  "resolve_vanity_url",
  "Convert a Steam vanity URL (custom profile name) to a 64-bit Steam ID",
  {
    vanity_url: z
      .string()
      .describe("The vanity URL part (e.g., 'gaben' from steamcommunity.com/id/gaben)"),
  },
  async ({ vanity_url }) => {
    const steamId = await steam.resolveVanityUrl(vanity_url);
    if (!steamId) {
      return { content: [{ type: "text", text: "Vanity URL not found" }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ steam_id: steamId }) }],
    };
  }
);

// === Library Tools ===

server.tool(
  "get_owned_games",
  "Get games owned by a player with playtime statistics. Use limit/offset for pagination.",
  {
    steam_id: steamIdSchema,
    include_free_games: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include free-to-play games"),
    limit: z
      .number()
      .optional()
      .describe("Max games to return (default: all)"),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe("Number of games to skip for pagination"),
    sort_by: z
      .enum(["playtime", "name", "recent"])
      .optional()
      .default("playtime")
      .describe("Sort order: playtime (desc), name (asc), or recent (by 2-week playtime)"),
  },
  async ({ steam_id, include_free_games, limit, offset, sort_by }) => {
    let games = await steam.getOwnedGames(getSteamId(steam_id), true, include_free_games);

    // Sort
    if (sort_by === "name") {
      games.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    } else if (sort_by === "recent") {
      games.sort((a, b) => (b.playtime_2weeks ?? 0) - (a.playtime_2weeks ?? 0));
    } else {
      games.sort((a, b) => b.playtime_forever - a.playtime_forever);
    }

    const total = games.length;

    // Paginate
    if (offset > 0) games = games.slice(offset);
    if (limit) games = games.slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { total_games: total, returned: games.length, offset, games },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_recently_played",
  "Get games played by a user in the last two weeks",
  {
    steam_id: steamIdSchema,
    count: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of games to return"),
  },
  async ({ steam_id, count }) => {
    const games = await steam.getRecentlyPlayedGames(getSteamId(steam_id), count);
    return {
      content: [{ type: "text", text: JSON.stringify(games, null, 2) }],
    };
  }
);

server.tool(
  "get_game_details",
  "Get detailed information about a Steam game including description, price, and requirements",
  {
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ app_id }) => {
    const details = await steam.getAppDetails(app_id);
    if (!details) {
      return { content: [{ type: "text", text: "Game not found" }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    };
  }
);

// === Achievement & Stats Tools ===

server.tool(
  "get_achievements",
  "Get a player's achievements for a specific game",
  {
    steam_id: steamIdSchema,
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ steam_id, app_id }) => {
    try {
      const achievements = await steam.getPlayerAchievements(getSteamId(steam_id), app_id);
      return {
        content: [{ type: "text", text: JSON.stringify(achievements, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch achievements: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_game_stats",
  "Get a player's statistics for a specific game",
  {
    steam_id: steamIdSchema,
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ steam_id, app_id }) => {
    try {
      const stats = await steam.getUserStatsForGame(getSteamId(steam_id), app_id);
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch stats: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_global_achievement_percentages",
  "Get global achievement unlock percentages for a game",
  {
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ app_id }) => {
    const achievements = await steam.getGlobalAchievementPercentages(app_id);
    return {
      content: [{ type: "text", text: JSON.stringify(achievements, null, 2) }],
    };
  }
);

server.tool(
  "get_perfect_games",
  "Get games where the player has unlocked ALL achievements (100% completion)",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    const id = getSteamId(steam_id);
    const games = await steam.getOwnedGames(id, true, true);

    // Filter to games that have achievements AND have been played
    const gamesWithAchievements = games.filter(
      (g) => g.has_community_visible_stats && g.playtime_forever > 0
    );

    // Process in parallel with concurrency limit of 10
    const perfectGames = await parallelMap(
      gamesWithAchievements,
      async (game) => {
        try {
          const achievements = await steam.getPlayerAchievements(id, game.appid);
          if (achievements.success && achievements.achievements?.length > 0) {
            const total = achievements.achievements.length;
            const unlocked = achievements.achievements.filter((a) => a.achieved === 1).length;
            if (unlocked === total) {
              return {
                appid: game.appid,
                name: game.name ?? achievements.gameName,
                achievement_count: total,
                playtime_hours: Math.round((game.playtime_forever / 60) * 10) / 10,
              };
            }
          }
        } catch {
          // Game may not have achievements or profile is private
        }
        return null;
      },
      10
    );

    // Sort by achievement count descending
    perfectGames.sort((a, b) => b.achievement_count - a.achievement_count);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { perfect_game_count: perfectGames.length, games: perfectGames },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_achievement_summary",
  "Get a summary of achievement progress across all games or specific games",
  {
    steam_id: steamIdSchema,
    app_ids: z
      .array(z.number())
      .optional()
      .describe("Specific app IDs to check (if omitted, checks recently played games)"),
  },
  async ({ steam_id, app_ids }) => {
    const id = getSteamId(steam_id);

    let gamesToCheck: Array<{ appid: number; name?: string }>;

    if (app_ids && app_ids.length > 0) {
      gamesToCheck = app_ids.map((appid) => ({ appid }));
    } else {
      // Default to recently played
      const recent = await steam.getRecentlyPlayedGames(id, 10);
      gamesToCheck = recent;
    }

    // Process in parallel with concurrency limit of 10
    const summaries = await parallelMap(
      gamesToCheck,
      async (game) => {
        try {
          const achievements = await steam.getPlayerAchievements(id, game.appid);
          if (achievements.success && achievements.achievements?.length > 0) {
            const total = achievements.achievements.length;
            const unlocked = achievements.achievements.filter((a) => a.achieved === 1).length;
            return {
              appid: game.appid,
              name: game.name ?? achievements.gameName,
              unlocked,
              total,
              percent: Math.round((unlocked / total) * 100),
            };
          }
        } catch {
          // Skip games without achievements
        }
        return null;
      },
      10
    );

    return {
      content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
    };
  }
);

// === Inventory Tools ===

server.tool(
  "get_inventory",
  "Get a player's inventory for any game (requires public profile)",
  {
    steam_id: steamIdSchema,
    app_id: z.number().describe("Steam application ID (e.g., 753 for Steam, 730 for CS2)"),
    context_id: z
      .number()
      .optional()
      .default(2)
      .describe("Context ID (usually 2 for most games, 6 for Steam community items)"),
    count: z
      .number()
      .optional()
      .default(75)
      .describe("Max items to return (default 75, max 5000)"),
  },
  async ({ steam_id, app_id, context_id, count }) => {
    try {
      const inventory = await steam.getInventory(
        getSteamId(steam_id),
        app_id,
        context_id,
        Math.min(count, 5000)
      );

      // Merge assets with descriptions for easier consumption
      const items = inventory.assets.map((asset) => {
        const desc = inventory.descriptions.find(
          (d) => d.classid === asset.classid && d.instanceid === asset.instanceid
        );
        return {
          assetid: asset.assetid,
          amount: asset.amount,
          name: desc?.name,
          type: desc?.type,
          tradable: desc?.tradable === 1,
          marketable: desc?.marketable === 1,
          tags: desc?.tags?.map((t) => t.localized_tag_name),
        };
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { total: inventory.total_inventory_count, returned: items.length, items },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch inventory: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_tf2_inventory",
  "Get a player's Team Fortress 2 inventory (via official API)",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    try {
      const items = await steam.getTF2Items(getSteamId(steam_id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ item_count: items.length, items }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch TF2 inventory: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_csgo_inventory",
  "Get a player's CS2/CSGO inventory (via official API)",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    try {
      const items = await steam.getCSGOItems(getSteamId(steam_id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ item_count: items.length, items }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch CS2 inventory: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_dota2_inventory",
  "Get a player's Dota 2 inventory (via official API)",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    try {
      const items = await steam.getDota2Items(getSteamId(steam_id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ item_count: items.length, items }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch Dota 2 inventory: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// === Badge & Profile Tools ===

server.tool(
  "get_badges",
  "Get a player's Steam badges, XP, and level progression",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    try {
      const badges = await steam.getBadges(getSteamId(steam_id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                player_level: badges.player_level,
                player_xp: badges.player_xp,
                xp_needed_to_level_up: badges.player_xp_needed_to_level_up,
                badge_count: badges.badges.length,
                badges: badges.badges,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch badges: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_player_bans",
  "Check if a player has VAC bans, game bans, or trade bans",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    const bans = await steam.getPlayerBans([getSteamId(steam_id)]);
    if (bans.length === 0) {
      return { content: [{ type: "text", text: "Player not found" }] };
    }
    const ban = bans[0];
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              steam_id: ban.SteamId,
              vac_banned: ban.VACBanned,
              vac_ban_count: ban.NumberOfVACBans,
              game_ban_count: ban.NumberOfGameBans,
              days_since_last_ban: ban.DaysSinceLastBan,
              community_banned: ban.CommunityBanned,
              economy_ban: ban.EconomyBan,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// === Game Info Tools ===

server.tool(
  "get_game_news",
  "Get latest news and patch notes for a game",
  {
    app_id: z.number().describe("Steam application ID"),
    count: z
      .number()
      .optional()
      .default(5)
      .describe("Number of news items to return (default 5)"),
    max_length: z
      .number()
      .optional()
      .default(1000)
      .describe("Max length of content (default 1000, 0 for full content)"),
  },
  async ({ app_id, count, max_length }) => {
    const news = await steam.getNewsForApp(app_id, count, max_length);
    const formatted = news.map((item) => ({
      title: item.title,
      author: item.author,
      date: new Date(item.date * 1000).toISOString(),
      url: item.url,
      content: item.contents,
      feed: item.feedlabel,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
    };
  }
);

server.tool(
  "get_player_count",
  "Get the current number of players in a game",
  {
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ app_id }) => {
    try {
      const count = await steam.getNumberOfCurrentPlayers(app_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ app_id, current_players: count }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch player count: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_game_schema",
  "Get the achievement and stat schema for a game (names, descriptions, icons)",
  {
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ app_id }) => {
    try {
      const schema = await steam.getSchemaForGame(app_id);
      if (!schema) {
        return { content: [{ type: "text", text: "Game schema not found" }] };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                game_name: schema.gameName,
                game_version: schema.gameVersion,
                achievement_count:
                  schema.availableGameStats.achievements?.length ?? 0,
                stat_count: schema.availableGameStats.stats?.length ?? 0,
                achievements: schema.availableGameStats.achievements,
                stats: schema.availableGameStats.stats,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch game schema: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// === Additional Profile Tools ===

server.tool(
  "get_user_groups",
  "Get the Steam groups a player is a member of",
  {
    steam_id: steamIdSchema,
  },
  async ({ steam_id }) => {
    try {
      const groups = await steam.getUserGroupList(getSteamId(steam_id));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ group_count: groups.length, groups }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch groups: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_badge_progress",
  "Get progress on community badge crafting (trading cards)",
  {
    steam_id: steamIdSchema,
    badge_id: z
      .number()
      .optional()
      .describe("Specific badge ID to check (omit for all badges)"),
  },
  async ({ steam_id, badge_id }) => {
    try {
      const progress = await steam.getCommunityBadgeProgress(
        getSteamId(steam_id),
        badge_id
      );
      return {
        content: [{ type: "text", text: JSON.stringify(progress, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch badge progress: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "is_playing_shared_game",
  "Check if a player is currently playing a game via Steam Family Sharing",
  {
    steam_id: steamIdSchema,
    app_id: z.number().describe("App ID of the game being played"),
  },
  async ({ steam_id, app_id }) => {
    try {
      const info = await steam.isPlayingSharedGame(getSteamId(steam_id), app_id);
      if (info) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { is_shared: true, lender_steam_id: info.lender_steamid },
                null,
                2
              ),
            },
          ],
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ is_shared: false }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not check shared game: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// === Global Stats Tools ===

server.tool(
  "get_global_game_stats",
  "Get global aggregated stats for a game (requires knowing stat names from schema)",
  {
    app_id: z.number().describe("Steam application ID"),
    stat_names: z
      .array(z.string())
      .describe("Array of stat names to retrieve (get from get_game_schema)"),
  },
  async ({ app_id, stat_names }) => {
    try {
      const stats = await steam.getGlobalStatsForGame(app_id, stat_names);
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch global stats: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// === App Discovery Tools ===

server.tool(
  "search_apps",
  "Search for Steam apps by name (searches the full Steam catalog)",
  {
    query: z.string().describe("Search query to match against app names"),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe("Max results to return (default 25)"),
  },
  async ({ query, limit }) => {
    try {
      const allApps = await steam.getAppList();
      const queryLower = query.toLowerCase();
      const matches = allApps
        .filter((app) => app.name.toLowerCase().includes(queryLower))
        .slice(0, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { total_matches: matches.length, apps: matches },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not search apps: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_servers_at_address",
  "Get game servers running at a specific IP address",
  {
    address: z.string().describe("IP address or IP:port to query"),
  },
  async ({ address }) => {
    try {
      const servers = await steam.getServersAtAddress(address);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { server_count: servers.length, servers },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch servers: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "check_app_update",
  "Check if a specific version of an app is up to date",
  {
    app_id: z.number().describe("Steam application ID"),
    version: z.number().describe("Current version number to check"),
  },
  async ({ app_id, version }) => {
    try {
      const info = await steam.upToDateCheck(app_id, version);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                up_to_date: info.up_to_date,
                version_is_listable: info.version_is_listable,
                required_version: info.required_version,
                message: info.message,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not check update: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
