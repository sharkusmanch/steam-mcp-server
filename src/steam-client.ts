const STEAM_API_BASE = "https://api.steampowered.com";

export interface SteamClientConfig {
  apiKey: string;
}

export interface PlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number;
  communityvisibilitystate: number;
  profilestate?: number;
  lastlogoff?: number;
  realname?: string;
  primaryclanid?: string;
  timecreated?: number;
  gameid?: string;
  gameextrainfo?: string;
  loccountrycode?: string;
  locstatecode?: string;
  loccityid?: number;
}

export interface OwnedGame {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  img_icon_url?: string;
  has_community_visible_stats?: boolean;
}

export interface RecentGame {
  appid: number;
  name: string;
  playtime_2weeks: number;
  playtime_forever: number;
  img_icon_url: string;
}

export interface Friend {
  steamid: string;
  relationship: string;
  friend_since: number;
}

export interface Achievement {
  apiname: string;
  achieved: number;
  unlocktime: number;
  name?: string;
  description?: string;
}

export interface PlayerAchievements {
  steamID: string;
  gameName: string;
  achievements: Achievement[];
  success: boolean;
}

export interface GameStat {
  name: string;
  value: number;
}

export interface PlayerStats {
  steamID: string;
  gameName: string;
  stats: GameStat[];
  achievements?: Achievement[];
}

export interface GlobalAchievement {
  name: string;
  percent: number;
}

export interface InventoryAsset {
  appid: number;
  contextid: string;
  assetid: string;
  classid: string;
  instanceid: string;
  amount: string;
}

export interface InventoryDescription {
  appid: number;
  classid: string;
  instanceid: string;
  name: string;
  market_name?: string;
  market_hash_name?: string;
  type: string;
  tradable: number;
  marketable: number;
  commodity: number;
  icon_url?: string;
  tags?: Array<{
    category: string;
    internal_name: string;
    localized_category_name: string;
    localized_tag_name: string;
  }>;
}

export interface InventoryResponse {
  assets: InventoryAsset[];
  descriptions: InventoryDescription[];
  total_inventory_count: number;
  success: number;
}

export interface EconItem {
  id: string;
  defindex: number;
  level: number;
  quality: number;
  quantity: number;
  origin?: number;
  custom_name?: string;
  custom_desc?: string;
  equipped?: Array<{ class: number; slot: number }>;
}

export interface Badge {
  badgeid: number;
  level: number;
  completion_time: number;
  xp: number;
  scarcity: number;
  appid?: number;
  communityitemid?: string;
  border_color?: number;
}

export interface PlayerBadges {
  badges: Badge[];
  player_xp: number;
  player_level: number;
  player_xp_needed_to_level_up: number;
  player_xp_needed_current_level: number;
}

export interface PlayerBan {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
}

export interface NewsItem {
  gid: string;
  title: string;
  url: string;
  is_external_url: boolean;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
  feed_type: number;
  appid: number;
}

export interface GameSchema {
  gameName: string;
  gameVersion: string;
  availableGameStats: {
    achievements?: Array<{
      name: string;
      defaultvalue: number;
      displayName: string;
      hidden: number;
      description?: string;
      icon: string;
      icongray: string;
    }>;
    stats?: Array<{
      name: string;
      defaultvalue: number;
      displayName: string;
    }>;
  };
}

export interface UserGroup {
  gid: string;
}

export interface BadgeQuestProgress {
  questid: number;
  completed: boolean;
}

export interface SharedGameInfo {
  lender_steamid: string;
}

export interface GlobalStat {
  name: string;
  total: string;
}

export interface SteamApp {
  appid: number;
  name: string;
}

export interface GameServer {
  addr: string;
  gmsindex: number;
  steamid: string;
  appid: number;
  gamedir: string;
  region: number;
  secure: boolean;
  lan: boolean;
  gameport: number;
  specport: number;
}

export interface AppUpdateInfo {
  up_to_date: boolean;
  version_is_listable: boolean;
  required_version?: number;
  message?: string;
}

export class SteamClient {
  private apiKey: string;

  constructor(config: SteamClientConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    iface: string,
    method: string,
    version: number,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    const url = new URL(`${STEAM_API_BASE}/${iface}/${method}/v${version}/`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("format", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getPlayerSummaries(steamIds: string[]): Promise<PlayerSummary[]> {
    const data = await this.request<{
      response: { players: PlayerSummary[] };
    }>("ISteamUser", "GetPlayerSummaries", 2, {
      steamids: steamIds.join(","),
    });
    return data.response.players;
  }

  async getFriendList(steamId: string): Promise<Friend[]> {
    const data = await this.request<{
      friendslist: { friends: Friend[] };
    }>("ISteamUser", "GetFriendList", 1, {
      steamid: steamId,
      relationship: "friend",
    });
    return data.friendslist?.friends ?? [];
  }

  async resolveVanityUrl(vanityUrl: string): Promise<string | null> {
    const data = await this.request<{
      response: { success: number; steamid?: string };
    }>("ISteamUser", "ResolveVanityURL", 1, {
      vanityurl: vanityUrl,
    });
    return data.response.success === 1 ? data.response.steamid ?? null : null;
  }

  async getOwnedGames(
    steamId: string,
    includeAppInfo = true,
    includePlayedFreeGames = true
  ): Promise<OwnedGame[]> {
    const data = await this.request<{
      response: { game_count: number; games: OwnedGame[] };
    }>("IPlayerService", "GetOwnedGames", 1, {
      steamid: steamId,
      include_appinfo: includeAppInfo,
      include_played_free_games: includePlayedFreeGames,
    });
    return data.response.games ?? [];
  }

  async getRecentlyPlayedGames(steamId: string, count = 10): Promise<RecentGame[]> {
    const data = await this.request<{
      response: { total_count: number; games: RecentGame[] };
    }>("IPlayerService", "GetRecentlyPlayedGames", 1, {
      steamid: steamId,
      count,
    });
    return data.response.games ?? [];
  }

  async getSteamLevel(steamId: string): Promise<number> {
    const data = await this.request<{
      response: { player_level: number };
    }>("IPlayerService", "GetSteamLevel", 1, {
      steamid: steamId,
    });
    return data.response.player_level;
  }

  async getPlayerAchievements(
    steamId: string,
    appId: number
  ): Promise<PlayerAchievements> {
    const data = await this.request<{
      playerstats: PlayerAchievements;
    }>("ISteamUserStats", "GetPlayerAchievements", 1, {
      steamid: steamId,
      appid: appId,
    });
    return data.playerstats;
  }

  async getUserStatsForGame(steamId: string, appId: number): Promise<PlayerStats> {
    const data = await this.request<{
      playerstats: PlayerStats;
    }>("ISteamUserStats", "GetUserStatsForGame", 2, {
      steamid: steamId,
      appid: appId,
    });
    return data.playerstats;
  }

  async getGlobalAchievementPercentages(appId: number): Promise<GlobalAchievement[]> {
    const data = await this.request<{
      achievementpercentages: { achievements: GlobalAchievement[] };
    }>("ISteamUserStats", "GetGlobalAchievementPercentagesForApp", 2, {
      gameid: appId,
    });
    return data.achievementpercentages?.achievements ?? [];
  }

  async getAppDetails(appId: number): Promise<Record<string, unknown> | null> {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Steam Store API error: ${response.status}`);
    }

    const data = (await response.json()) as Record<
      string,
      { success: boolean; data: Record<string, unknown> }
    >;
    const appData = data[String(appId)];

    return appData?.success ? appData.data : null;
  }

  async getInventory(
    steamId: string,
    appId: number,
    contextId = 2,
    count = 75
  ): Promise<InventoryResponse> {
    const url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=${count}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Inventory is private");
      }
      throw new Error(`Steam inventory error: ${response.status}`);
    }

    return response.json() as Promise<InventoryResponse>;
  }

  async getTF2Items(steamId: string): Promise<EconItem[]> {
    const data = await this.request<{
      result: { status: number; items: EconItem[] };
    }>("IEconItems_440", "GetPlayerItems", 1, {
      steamid: steamId,
    });
    return data.result?.items ?? [];
  }

  async getCSGOItems(steamId: string): Promise<EconItem[]> {
    const data = await this.request<{
      result: { status: number; items: EconItem[] };
    }>("IEconItems_730", "GetPlayerItems", 1, {
      steamid: steamId,
    });
    return data.result?.items ?? [];
  }

  async getDota2Items(steamId: string): Promise<EconItem[]> {
    const data = await this.request<{
      result: { status: number; items: EconItem[] };
    }>("IEconItems_570", "GetPlayerItems", 1, {
      steamid: steamId,
    });
    return data.result?.items ?? [];
  }

  async getBadges(steamId: string): Promise<PlayerBadges> {
    const data = await this.request<{
      response: PlayerBadges;
    }>("IPlayerService", "GetBadges", 1, {
      steamid: steamId,
    });
    return data.response;
  }

  async getPlayerBans(steamIds: string[]): Promise<PlayerBan[]> {
    const data = await this.request<{
      players: PlayerBan[];
    }>("ISteamUser", "GetPlayerBans", 1, {
      steamids: steamIds.join(","),
    });
    return data.players ?? [];
  }

  async getNewsForApp(
    appId: number,
    count = 10,
    maxLength = 500
  ): Promise<NewsItem[]> {
    const data = await this.request<{
      appnews: { appid: number; newsitems: NewsItem[] };
    }>("ISteamNews", "GetNewsForApp", 2, {
      appid: appId,
      count,
      maxlength: maxLength,
    });
    return data.appnews?.newsitems ?? [];
  }

  async getNumberOfCurrentPlayers(appId: number): Promise<number> {
    const data = await this.request<{
      response: { player_count: number; result: number };
    }>("ISteamUserStats", "GetNumberOfCurrentPlayers", 1, {
      appid: appId,
    });
    return data.response.player_count;
  }

  async getSchemaForGame(appId: number): Promise<GameSchema | null> {
    const data = await this.request<{
      game: GameSchema;
    }>("ISteamUserStats", "GetSchemaForGame", 2, {
      appid: appId,
    });
    return data.game ?? null;
  }

  async getUserGroupList(steamId: string): Promise<UserGroup[]> {
    const data = await this.request<{
      response: { success: boolean; groups: UserGroup[] };
    }>("ISteamUser", "GetUserGroupList", 1, {
      steamid: steamId,
    });
    return data.response?.groups ?? [];
  }

  async getCommunityBadgeProgress(
    steamId: string,
    badgeId?: number
  ): Promise<BadgeQuestProgress[]> {
    const params: Record<string, string | number | boolean> = {
      steamid: steamId,
    };
    if (badgeId !== undefined) {
      params.badgeid = badgeId;
    }
    const data = await this.request<{
      response: { quests: BadgeQuestProgress[] };
    }>("IPlayerService", "GetCommunityBadgeProgress", 1, params);
    return data.response?.quests ?? [];
  }

  async isPlayingSharedGame(
    steamId: string,
    appIdPlaying: number
  ): Promise<SharedGameInfo | null> {
    const data = await this.request<{
      response: SharedGameInfo;
    }>("IPlayerService", "IsPlayingSharedGame", 1, {
      steamid: steamId,
      appid_playing: appIdPlaying,
    });
    return data.response?.lender_steamid ? data.response : null;
  }

  async getGlobalStatsForGame(
    appId: number,
    statNames: string[],
    startDate?: number,
    endDate?: number
  ): Promise<GlobalStat[]> {
    const params: Record<string, string | number | boolean> = {
      appid: appId,
      count: statNames.length,
    };
    statNames.forEach((name, i) => {
      params[`name[${i}]`] = name;
    });
    if (startDate) params.startdate = startDate;
    if (endDate) params.enddate = endDate;

    const data = await this.request<{
      response: { globalstats: Record<string, { total: string }> };
    }>("ISteamUserStats", "GetGlobalStatsForGame", 1, params);

    const stats: GlobalStat[] = [];
    if (data.response?.globalstats) {
      for (const [name, value] of Object.entries(data.response.globalstats)) {
        stats.push({ name, total: value.total });
      }
    }
    return stats;
  }

  async getAppList(): Promise<SteamApp[]> {
    const data = await this.request<{
      applist: { apps: SteamApp[] };
    }>("ISteamApps", "GetAppList", 2, {});
    return data.applist?.apps ?? [];
  }

  async getServersAtAddress(addr: string): Promise<GameServer[]> {
    const data = await this.request<{
      response: { success: boolean; servers: GameServer[] };
    }>("ISteamApps", "GetServersAtAddress", 1, {
      addr,
    });
    return data.response?.servers ?? [];
  }

  async upToDateCheck(appId: number, version: number): Promise<AppUpdateInfo> {
    const data = await this.request<{
      response: AppUpdateInfo;
    }>("ISteamApps", "UpToDateCheck", 1, {
      appid: appId,
      version,
    });
    return data.response;
  }
}
