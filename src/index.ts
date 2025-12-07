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

// Security: Validate Steam ID format (17-digit numeric string for 64-bit Steam IDs)
const STEAM_ID_REGEX = /^[0-9]{17}$/;

function isValidSteamId(steamId: string): boolean {
  return STEAM_ID_REGEX.test(steamId);
}

function getSteamId(providedId?: string): string {
  const steamId = providedId || defaultSteamId;
  if (!steamId) {
    throw new Error("No Steam ID provided and STEAM_ID environment variable not set");
  }
  if (!isValidSteamId(steamId)) {
    throw new Error("Invalid Steam ID format. Must be a 17-digit numeric string.");
  }
  return steamId;
}

// Security: Validate vanity URL format (alphanumeric, underscores, hyphens only)
const VANITY_URL_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

function isValidVanityUrl(vanityUrl: string): boolean {
  return VANITY_URL_REGEX.test(vanityUrl);
}

// Security: Validate IP address format and block private/internal ranges
const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d{1,5})?$/;

function isPrivateIp(ip: string): boolean {
  const ipWithoutPort = ip.split(':')[0];
  const parts = ipWithoutPort.split('.').map(Number);

  if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
    return true; // Invalid IP, treat as blocked
  }

  // Block private ranges (RFC 1918) and special addresses
  const [a, b, c, d] = parts;

  // 10.0.0.0/8 - Private
  if (a === 10) return true;
  // 172.16.0.0/12 - Private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 - Loopback
  if (a === 127) return true;
  // 0.0.0.0/8 - Current network
  if (a === 0) return true;
  // 169.254.0.0/16 - Link-local
  if (a === 169 && b === 254) return true;
  // 224.0.0.0/4 - Multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 - Reserved
  if (a >= 240) return true;

  return false;
}

function isValidServerAddress(address: string): boolean {
  // Must match IP:port or just IP format
  if (!IPV4_REGEX.test(address)) {
    return false;
  }
  // Block private/internal IP ranges (SSRF protection)
  if (isPrivateIp(address)) {
    return false;
  }
  return true;
}

// Security: Sanitize error messages to avoid information disclosure
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Remove potentially sensitive information from error messages
    const message = error.message;
    // Filter out stack traces and internal paths
    if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      return "Network error: Unable to reach Steam API";
    }
    if (message.includes('401') || message.includes('403')) {
      return "Authorization error: Check API key or profile privacy settings";
    }
    if (message.includes('404')) {
      return "Not found: The requested resource does not exist";
    }
    if (message.includes('429')) {
      return "Rate limited: Too many requests. Please try again later";
    }
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return "Steam API temporarily unavailable. Please try again later";
    }
    // Return the message if it appears safe (no paths or sensitive data)
    if (!message.includes('/') && !message.includes('\\') && message.length < 200) {
      return message;
    }
    return "An error occurred while processing your request";
  }
  return "Unknown error";
}

const steamIdSchema = z
  .string()
  .regex(STEAM_ID_REGEX, "Must be a 17-digit Steam ID")
  .optional()
  .describe("64-bit Steam ID (optional if STEAM_ID env var is set)");

// Helper to convert persona state to readable string
function getPersonaState(state: number): string {
  const states: Record<number, string> = {
    0: "Offline",
    1: "Online",
    2: "Busy",
    3: "Away",
    4: "Snooze",
    5: "Looking to trade",
    6: "Looking to play",
  };
  return states[state] ?? "Unknown";
}

// Helper to convert 32-bit account ID to 64-bit Steam ID
const STEAM_ID_BASE = BigInt("76561197960265728");
function accountIdToSteamId(accountId: number): string {
  return (STEAM_ID_BASE + BigInt(accountId)).toString();
}

// Security: Cache for app list to prevent resource exhaustion
// Refreshes every 24 hours
interface AppListCache {
  apps: Array<{ appid: number; name: string }>;
  timestamp: number;
}
let appListCache: AppListCache | null = null;
const APP_LIST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

async function getCachedAppList(): Promise<Array<{ appid: number; name: string }>> {
  const now = Date.now();
  if (appListCache && (now - appListCache.timestamp) < APP_LIST_CACHE_TTL) {
    return appListCache.apps;
  }
  const apps = await steam.getAppList();
  appListCache = { apps, timestamp: now };
  return apps;
}

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
  "Get a player's Steam friends list with names and relationship info",
  {
    steam_id: steamIdSchema,
    include_info: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include friend names and online status (default: true)"),
  },
  async ({ steam_id, include_info }) => {
    try {
      const friends = await steam.getFriendList(getSteamId(steam_id), include_info);

      const formatted = friends.map((f) => ({
        steam_id: f.steamid,
        name: f.personaname,
        relationship: f.relationship,
        friend_since: new Date(f.friend_since * 1000).toISOString(),
        status: f.personastate !== undefined ? getPersonaState(f.personastate) : undefined,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { friend_count: formatted.length, friends: formatted },
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
            text: `Could not fetch friends list: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
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
      .min(1)
      .max(32)
      .describe("The vanity URL part (e.g., 'gaben' from steamcommunity.com/id/gaben)"),
  },
  async ({ vanity_url }) => {
    // Security: Validate vanity URL format
    if (!isValidVanityUrl(vanity_url)) {
      return {
        content: [{ type: "text", text: "Invalid vanity URL format. Use only letters, numbers, underscores, and hyphens (1-32 characters)." }],
      };
    }
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
            text: `Could not fetch achievements: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch stats: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch inventory: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch TF2 inventory: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch CS2 inventory: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch Dota 2 inventory: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

// === Badge & Profile Tools ===

server.tool(
  "get_badges",
  "Get a player's Steam badges with game names, XP, and level progression",
  {
    steam_id: steamIdSchema,
    include_game_names: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include game names for game badges (default: true)"),
  },
  async ({ steam_id, include_game_names }) => {
    try {
      const badges = await steam.getBadges(getSteamId(steam_id), include_game_names);

      const formattedBadges = badges.badges.map((b) => ({
        badge_id: b.badgeid,
        level: b.level,
        xp: b.xp,
        scarcity: b.scarcity,
        completed: new Date(b.completion_time * 1000).toISOString(),
        app_id: b.appid,
        game_name: b.game_name,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                player_level: badges.player_level,
                player_xp: badges.player_xp,
                xp_needed_to_level_up: badges.player_xp_needed_to_level_up,
                badge_count: formattedBadges.length,
                badges: formattedBadges,
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
            text: `Could not fetch badges: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch player count: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch game schema: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch groups: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch badge progress: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not check shared game: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not fetch global stats: ${sanitizeErrorMessage(error)}`,
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
    query: z.string().min(1).max(100).describe("Search query to match against app names"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(25)
      .describe("Max results to return (default 25, max 100)"),
  },
  async ({ query, limit }) => {
    try {
      // Security: Use cached app list to prevent repeated large API calls
      const allApps = await getCachedAppList();
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
            text: `Could not search apps: ${sanitizeErrorMessage(error)}`,
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
    address: z.string().describe("IP address or IP:port to query (public IPs only)"),
  },
  async ({ address }) => {
    // Security: Validate IP address format and block private/internal ranges (SSRF protection)
    if (!isValidServerAddress(address)) {
      return {
        content: [
          {
            type: "text",
            text: "Invalid address format. Must be a public IPv4 address (e.g., '203.0.113.1' or '203.0.113.1:27015'). Private and internal IP ranges are not allowed.",
          },
        ],
      };
    }
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
            text: `Could not fetch servers: ${sanitizeErrorMessage(error)}`,
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
            text: `Could not check update: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

// === Wishlist Tools ===

server.tool(
  "get_wishlist",
  "Get a player's Steam wishlist with game names, priorities, and dates added",
  {
    steam_id: steamIdSchema,
    include_names: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include game names (default: true)"),
  },
  async ({ steam_id, include_names }) => {
    try {
      const wishlist = await steam.getWishlist(getSteamId(steam_id), include_names);

      // Sort by priority (lower priority number = higher on wishlist)
      const sorted = [...wishlist].sort((a, b) => a.priority - b.priority);

      const formatted = sorted.map((item) => ({
        appid: item.appid,
        name: item.name,
        priority: item.priority,
        date_added: new Date(item.date_added * 1000).toISOString(),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { wishlist_count: formatted.length, items: formatted },
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
            text: `Could not fetch wishlist: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_wishlist_item_count",
  "Get the number of users who have a specific game on their wishlist",
  {
    app_id: z.number().describe("Steam application ID"),
  },
  async ({ app_id }) => {
    try {
      const count = await steam.getWishlistItemCount(app_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ app_id, wishlist_count: count }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch wishlist count: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

// === Trade Tools ===

// Trade offer state mapping
const TRADE_OFFER_STATES: Record<number, string> = {
  1: "Invalid",
  2: "Active",
  3: "Accepted",
  4: "Countered",
  5: "Expired",
  6: "Canceled",
  7: "Declined",
  8: "InvalidItems",
  9: "CreatedNeedsConfirmation",
  10: "CanceledBySecondFactor",
  11: "InEscrow",
};

server.tool(
  "get_trade_offers",
  "Get active trade offers with partner names. Requires API key with trade permissions.",
  {
    get_sent: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include sent trade offers"),
    get_received: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include received trade offers"),
    active_only: z
      .boolean()
      .optional()
      .default(true)
      .describe("Only return active (pending) offers"),
    include_partner_names: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include partner names (default: true)"),
  },
  async ({ get_sent, get_received, active_only, include_partner_names }) => {
    try {
      const offers = await steam.getTradeOffers(get_sent, get_received, active_only);
      const allOffers = [
        ...(offers.trade_offers_sent ?? []),
        ...(offers.trade_offers_received ?? []),
      ];

      // Build partner name map if needed
      let partnerNames = new Map<number, string>();
      if (include_partner_names && allOffers.length > 0) {
        const accountIds = [...new Set(allOffers.map((o) => o.accountid_other))];
        const steamIds = accountIds.map(accountIdToSteamId);
        const summaries = await steam.getPlayerSummaries(steamIds);
        for (const player of summaries) {
          // Convert back to account ID for lookup
          const accountId = Number(BigInt(player.steamid) - STEAM_ID_BASE);
          partnerNames.set(accountId, player.personaname);
        }
      }

      const formatOffer = (offer: {
        tradeofferid: string;
        accountid_other: number;
        message: string;
        trade_offer_state: number;
        items_to_give?: unknown[];
        items_to_receive?: unknown[];
        is_our_offer: boolean;
        time_created: number;
        expiration_time: number;
      }) => ({
        offer_id: offer.tradeofferid,
        partner_name: partnerNames.get(offer.accountid_other),
        partner_steam_id: accountIdToSteamId(offer.accountid_other),
        message: offer.message || "(no message)",
        state: TRADE_OFFER_STATES[offer.trade_offer_state] || "Unknown",
        items_to_give: offer.items_to_give?.length ?? 0,
        items_to_receive: offer.items_to_receive?.length ?? 0,
        is_our_offer: offer.is_our_offer,
        created: new Date(offer.time_created * 1000).toISOString(),
        expires: new Date(offer.expiration_time * 1000).toISOString(),
      });

      const sent = (offers.trade_offers_sent ?? []).map(formatOffer);
      const received = (offers.trade_offers_received ?? []).map(formatOffer);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sent_count: sent.length,
                received_count: received.length,
                sent_offers: sent,
                received_offers: received,
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
            text: `Could not fetch trade offers: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_trade_offers_summary",
  "Get a summary of pending trade offers (counts only). Requires API key with trade permissions.",
  {},
  async () => {
    try {
      const summary = await steam.getTradeOffersSummary();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                pending_received: summary.pending_received_count,
                new_received: summary.new_received_count,
                updated_received: summary.updated_received_count,
                pending_sent: summary.pending_sent_count,
                escrow_received: summary.escrow_received_count,
                escrow_sent: summary.escrow_sent_count,
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
            text: `Could not fetch trade summary: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_trade_history",
  "Get completed trade history. Requires API key with trade permissions.",
  {
    max_trades: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(30)
      .describe("Maximum number of trades to return (default 30, max 100)"),
    include_failed: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include failed/rolled-back trades"),
  },
  async ({ max_trades, include_failed }) => {
    try {
      const history = await steam.getTradeHistory(max_trades, include_failed, true);

      const trades = history.trades.map((trade) => ({
        trade_id: trade.tradeid,
        partner_steam_id: trade.steamid_other,
        time: new Date(trade.time_init * 1000).toISOString(),
        status: trade.status,
        items_given: trade.assets_given?.length ?? 0,
        items_received: trade.assets_received?.length ?? 0,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total_trades: history.total_trades,
                returned: trades.length,
                has_more: history.more,
                trades,
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
            text: `Could not fetch trade history: ${sanitizeErrorMessage(error)}`,
          },
        ],
      };
    }
  }
);

server.tool(
  "get_trade_offer",
  "Get details of a specific trade offer by ID. Requires API key with trade permissions.",
  {
    trade_offer_id: z.string().describe("The trade offer ID to look up"),
  },
  async ({ trade_offer_id }) => {
    try {
      const offer = await steam.getTradeOffer(trade_offer_id);

      if (!offer) {
        return {
          content: [{ type: "text", text: "Trade offer not found" }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                offer_id: offer.tradeofferid,
                partner_account_id: offer.accountid_other,
                message: offer.message || "(no message)",
                state: TRADE_OFFER_STATES[offer.trade_offer_state] || "Unknown",
                items_to_give: offer.items_to_give ?? [],
                items_to_receive: offer.items_to_receive ?? [],
                is_our_offer: offer.is_our_offer,
                created: new Date(offer.time_created * 1000).toISOString(),
                updated: new Date(offer.time_updated * 1000).toISOString(),
                expires: new Date(offer.expiration_time * 1000).toISOString(),
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
            text: `Could not fetch trade offer: ${sanitizeErrorMessage(error)}`,
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
