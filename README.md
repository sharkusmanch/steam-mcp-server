# Steam MCP Server

An MCP (Model Context Protocol) server that provides tools for interacting with the Steam Web API.

## Setup

### 1. Get a Steam API Key

Obtain an API key from [Steam's developer portal](https://steamcommunity.com/dev/apikey).

### 2. Install Dependencies

```bash
npm install
```

### 3. Build

```bash
npm run build
```

### 4. Configure Your MCP Client

#### Claude Code

Add to your Claude Code settings file (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "steam": {
      "command": "node",
      "args": ["/path/to/steam-mcp-server/dist/index.js"],
      "env": {
        "STEAM_API_KEY": "your-api-key-here",
        "STEAM_ID": "your-64-bit-steam-id"
      }
    }
  }
}
```

Or use npx (no build required):

```json
{
  "mcpServers": {
    "steam": {
      "command": "npx",
      "args": ["-y", "@sharkusmanch/steam-mcp-server"],
      "env": {
        "STEAM_API_KEY": "your-api-key-here",
        "STEAM_ID": "your-64-bit-steam-id"
      }
    }
  }
}
```

#### Claude Desktop

Add to your Claude Desktop configuration:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "steam": {
      "command": "npx",
      "args": ["-y", "@sharkusmanch/steam-mcp-server"],
      "env": {
        "STEAM_API_KEY": "your-api-key-here",
        "STEAM_ID": "your-64-bit-steam-id"
      }
    }
  }
}
```

#### Cursor

Add to Cursor's MCP settings (`.cursor/mcp.json` in your project or global config):

```json
{
  "mcpServers": {
    "steam": {
      "command": "npx",
      "args": ["-y", "@sharkusmanch/steam-mcp-server"],
      "env": {
        "STEAM_API_KEY": "your-api-key-here",
        "STEAM_ID": "your-64-bit-steam-id"
      }
    }
  }
}
```

#### Windsurf

Add to Windsurf's MCP configuration (`~/.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "steam": {
      "command": "npx",
      "args": ["-y", "@sharkusmanch/steam-mcp-server"],
      "env": {
        "STEAM_API_KEY": "your-api-key-here",
        "STEAM_ID": "your-64-bit-steam-id"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STEAM_API_KEY` | Yes | Your Steam Web API key |
| `STEAM_ID` | No | Default Steam ID to use when not specified in tool calls |
| `STEAM_HTTP_TIMEOUT_MS` | No | Per-request timeout for Steam API calls in milliseconds (default `10000`) |

When `STEAM_ID` is set, you can call tools like `get_owned_games` without passing a Steam ID - it will use your default profile automatically.

## Reliability & Pagination

- Every Steam API request is bounded by a timeout (`STEAM_HTTP_TIMEOUT_MS`) and automatically retries transient failures (timeouts, HTTP 429, and 5xx) with exponential backoff. Non-retriable errors (401/403/404) fail fast with a clear, actionable message, and failures are returned with `isError: true`.
- List-returning tools accept `limit` and `offset` and return a consistent envelope with the pre-slice total and a `has_more` flag, e.g. `{ "total_games": 412, "returned": 50, "offset": 0, "has_more": true, "games": [...] }`. `get_inventory` additionally returns a `next_cursor` (Steam `start_assetid`) for deep paging.
- `search_apps` uses Steam's relevance-ranked storefront search (no full-catalog download), so it returns the top matches quickly and reliably.

## Available Tools

### Social & Profile
| Tool | Description |
|------|-------------|
| `get_player_summary` | Get player profile info (name, avatar, status, current game) |
| `get_friends_list` | Get a player's friends list |
| `get_steam_level` | Get player's Steam account level |
| `get_badges` | Get player's badges, XP, and level progression |
| `get_badge_progress` | Get trading card collection progress |
| `get_player_bans` | Check for VAC bans, game bans, or trade bans |
| `get_user_groups` | Get Steam groups a player belongs to |
| `resolve_vanity_url` | Convert vanity URL to 64-bit Steam ID |

### Game Library
| Tool | Description |
|------|-------------|
| `get_owned_games` | Get all games owned with playtime stats (supports pagination) |
| `get_recently_played` | Get games played in last 2 weeks |
| `get_game_details` | Get detailed game info (description, price, requirements) |
| `is_playing_shared_game` | Check if playing via Steam Family Sharing |
| `search_apps` | Search Steam catalog by game name |

### Achievements & Stats
| Tool | Description |
|------|-------------|
| `get_achievements` | Get player's achievements for a game |
| `get_game_stats` | Get player's statistics for a game |
| `get_global_achievement_percentages` | Get global achievement unlock rates |
| `get_global_game_stats` | Get global aggregated stats for a game |
| `get_perfect_games` | Get games where player has 100% achievements |
| `get_achievement_summary` | Get condensed achievement progress across games |
| `get_game_schema` | Get achievement/stat definitions for a game |

### Game Info
| Tool | Description |
|------|-------------|
| `get_game_news` | Get latest news and patch notes for a game |
| `get_player_count` | Get current number of players in a game |
| `get_servers_at_address` | Get game servers at a specific IP |
| `check_app_update` | Check if an app version is up to date |

### Inventory
| Tool | Description |
|------|-------------|
| `get_inventory` | Get inventory for any game (requires public profile) |
| `get_tf2_inventory` | Get Team Fortress 2 inventory |
| `get_csgo_inventory` | Get CS2/CSGO inventory |
| `get_dota2_inventory` | Get Dota 2 inventory |

## Finding Your Steam ID

Use `resolve_vanity_url` with your custom profile URL, or find your 64-bit Steam ID at [steamid.io](https://steamid.io/).

## License

MIT
