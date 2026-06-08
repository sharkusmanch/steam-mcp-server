const STEAM_API_BASE = "https://api.steampowered.com";

// Reliability tuning. STEAM_HTTP_TIMEOUT_MS can override the default per-request timeout.
const DEFAULT_TIMEOUT_MS = Number(process.env.STEAM_HTTP_TIMEOUT_MS) || 10000;
const DEFAULT_RETRIES = 2;
const MAX_BACKOFF_MS = 2000;
const MAX_RETRY_AFTER_MS = 5000;

// Typed errors. Messages are kept short and free of URLs/paths so that
// sanitizeErrorMessage() (in index.ts) does not collapse them to a generic string.
export class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class RateLimitError extends Error {
  retryAfterMs?: number;
  constructor(retryAfterMs?: number) {
    super("Rate limited by Steam");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class AuthError extends Error {
  constructor(message = "Steam authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UpstreamError extends Error {
  status?: number;
  constructor(status?: number, message = "Steam service error") {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with jitter, capped.
function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt + Math.random() * 100, MAX_BACKOFF_MS);
}

// Read Retry-After (seconds) defensively — test mocks have no headers object.
function parseRetryAfter(response: Response): number | undefined {
  const ra = response.headers?.get?.("retry-after");
  if (!ra) return undefined;
  const secs = Number(ra);
  if (!Number.isNaN(secs)) return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  return undefined;
}

// Map a non-ok HTTP status to a typed error.
function errorForStatus(response: Response): Error {
  const status = response.status;
  if (status === 401 || status === 403) return new AuthError();
  if (status === 404) return new NotFoundError();
  if (status === 429) return new RateLimitError(parseRetryAfter(response));
  return new UpstreamError(status);
}

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
  personaname?: string;
  avatar?: string;
  personastate?: number;
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
  // Steam-native cursor: present (with more_items) when more pages exist.
  last_assetid?: string;
  more_items?: number;
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
  game_name?: string;
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

export interface StoreSearchResult {
  appid: number;
  name: string;
  type: string;
  tiny_image?: string;
  price?: unknown;
  platforms?: unknown;
  metascore?: string;
  controller_support?: string;
}

// Raw row shape returned by the storefront search endpoint.
interface StoreSearchRow {
  id: number | string;
  name: string;
  type?: string;
  tiny_image?: string;
  price?: unknown;
  platforms?: unknown;
  metascore?: string;
  controller_support?: string;
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

// Wishlist types
export interface WishlistItem {
  appid: number;
  priority: number;
  date_added: number;
  name?: string;
}

// App info from ICommunityService
export interface AppInfo {
  appid: number;
  name: string;
}

// Trade types
export interface TradeOfferAsset {
  appid: number;
  contextid: string;
  assetid: string;
  classid: string;
  instanceid: string;
  amount: string;
  missing?: boolean;
}

export interface TradeOffer {
  tradeofferid: string;
  accountid_other: number;
  message: string;
  expiration_time: number;
  trade_offer_state: number;
  items_to_give?: TradeOfferAsset[];
  items_to_receive?: TradeOfferAsset[];
  is_our_offer: boolean;
  time_created: number;
  time_updated: number;
  from_real_time_trade: boolean;
  escrow_end_date?: number;
  confirmation_method?: number;
}

export interface TradeOffersResponse {
  trade_offers_sent?: TradeOffer[];
  trade_offers_received?: TradeOffer[];
  next_cursor?: number;
}

export interface TradeOffersSummary {
  pending_received_count: number;
  new_received_count: number;
  updated_received_count: number;
  historical_received_count: number;
  pending_sent_count: number;
  newly_accepted_sent_count: number;
  historical_sent_count: number;
  escrow_received_count: number;
  escrow_sent_count: number;
}

export interface TradeHistoryTrade {
  tradeid: string;
  steamid_other: string;
  time_init: number;
  status: number;
  assets_given?: TradeOfferAsset[];
  assets_received?: TradeOfferAsset[];
}

export interface TradeHistoryResponse {
  trades: TradeHistoryTrade[];
  more: boolean;
  total_trades?: number;
}

export class SteamClient {
  private apiKey: string;

  constructor(config: SteamClientConfig) {
    this.apiKey = config.apiKey;
  }

  // One fetch + JSON parse under a single AbortController timeout. The timer is
  // only cleared after the body is consumed, so a server that sends headers and
  // then stalls the body stream is aborted too (fetch() resolves on headers).
  // Returns the parsed body for ok responses; returns the Response (body unread)
  // for non-ok so the retry layer can classify it.
  private async attemptJson<T>(
    url: string,
    timeoutMs: number,
    init: RequestInit
  ): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        return { ok: false, response };
      }
      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new TimeoutError();
      }
      if (err instanceof SyntaxError) {
        throw new UpstreamError(undefined, "Steam returned a non-JSON response");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Fetch + parse JSON with bounded retry. Retries only on transient failures:
  // thrown timeout/network errors, HTTP 429, or 5xx. Never retries ok responses
  // or non-transient 4xx. The timeout covers the body read, not just headers.
  private async fetchJson<T>(
    url: string,
    opts: { timeoutMs?: number; retries?: number; init?: RequestInit } = {}
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.attemptJson<T>(url, timeoutMs, opts.init ?? {});
        if (result.ok) return result.data;
        const status = result.response.status;
        const retriable = status === 429 || status >= 500;
        if (retriable && attempt < retries) {
          await sleep(parseRetryAfter(result.response) ?? backoffMs(attempt));
          continue;
        }
        throw errorForStatus(result.response);
      } catch (err) {
        // Retry transient timeout/network errors; surface typed/non-transient errors.
        const transient = err instanceof TimeoutError || err instanceof TypeError;
        if (transient && attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
  }

  private async request<T>(
    iface: string,
    method: string,
    version: number,
    params: Record<string, string | number | boolean> = {},
    opts: { timeoutMs?: number; retries?: number } = {}
  ): Promise<T> {
    const url = new URL(`${STEAM_API_BASE}/${iface}/${method}/v${version}/`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("format", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    return this.fetchJson<T>(url.toString(), opts);
  }

  async getPlayerSummaries(steamIds: string[]): Promise<PlayerSummary[]> {
    const data = await this.request<{
      response: { players: PlayerSummary[] };
    }>("ISteamUser", "GetPlayerSummaries", 2, {
      steamids: steamIds.join(","),
    });
    return data.response.players;
  }

  async getFriendList(steamId: string, includePlayerInfo = false): Promise<Friend[]> {
    const data = await this.request<{
      friendslist: { friends: Friend[] };
    }>("ISteamUser", "GetFriendList", 1, {
      steamid: steamId,
      relationship: "friend",
    });
    const friends = data.friendslist?.friends ?? [];

    if (includePlayerInfo && friends.length > 0) {
      // GetPlayerSummaries supports up to 100 IDs at once
      const BATCH_SIZE = 100;
      const steamIds = friends.map((f) => f.steamid);
      const playerMap = new Map<string, PlayerSummary>();

      for (let i = 0; i < steamIds.length; i += BATCH_SIZE) {
        const batch = steamIds.slice(i, i + BATCH_SIZE);
        const summaries = await this.getPlayerSummaries(batch);
        for (const player of summaries) {
          playerMap.set(player.steamid, player);
        }
      }

      return friends.map((friend) => {
        const player = playerMap.get(friend.steamid);
        return {
          ...friend,
          personaname: player?.personaname,
          avatar: player?.avatar,
          personastate: player?.personastate,
        };
      });
    }

    return friends;
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
    const data = await this.fetchJson<
      Record<string, { success: boolean; data: Record<string, unknown> }>
    >(url);
    const appData = data[String(appId)];

    return appData?.success ? appData.data : null;
  }

  async getInventory(
    steamId: string,
    appId: number,
    contextId = 2,
    count = 75,
    startAssetid?: string
  ): Promise<InventoryResponse> {
    const url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=${count}${
      startAssetid ? `&start_assetid=${startAssetid}` : ""
    }`;
    try {
      return await this.fetchJson<InventoryResponse>(url);
    } catch (err) {
      // The inventory endpoint returns 403 (mapped to AuthError) for private inventories.
      if (err instanceof AuthError) {
        throw new Error("Inventory is private");
      }
      throw err;
    }
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

  async getBadges(steamId: string, includeGameNames = false): Promise<PlayerBadges> {
    const data = await this.request<{
      response: PlayerBadges;
    }>("IPlayerService", "GetBadges", 1, {
      steamid: steamId,
    });
    const result = data.response;

    if (includeGameNames && result.badges?.length > 0) {
      // Get unique app IDs from badges that have them
      const appIds = [...new Set(result.badges.filter((b) => b.appid).map((b) => b.appid!))] ;
      if (appIds.length > 0) {
        const nameMap = await this.getAppNames(appIds);
        result.badges = result.badges.map((badge) => ({
          ...badge,
          game_name: badge.appid ? nameMap.get(badge.appid) : undefined,
        }));
      }
    }

    return result;
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

  // Relevance-ranked app search via the storefront search endpoint. Takes no API
  // key and returns a small ranked list, so it replaces the multi-MB GetAppList
  // catalog scan. Only rows of type "app" are returned (bundle/sub rows carry a
  // package id, not an appid).
  async searchStore(
    term: string,
    cc = "us",
    l = "english"
  ): Promise<{ store_total: number; apps: StoreSearchResult[] }> {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      term
    )}&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(l)}`;
    // The store host throttles harder than the Web API, so retry less.
    const data = await this.fetchJson<{ total?: number; items?: StoreSearchRow[] }>(
      url,
      { retries: 1 }
    );
    const items = data.items ?? [];
    const apps = items
      .filter((item) => item.type === "app")
      .map((item) => ({
        appid: Number(item.id),
        name: String(item.name),
        type: item.type as string,
        tiny_image: item.tiny_image,
        price: item.price,
        platforms: item.platforms,
        controller_support: item.controller_support,
        metascore: item.metascore,
      }));
    // storesearch caps its list (~10) and reports a likewise-capped `total`; expose
    // it as store_total so the caller can signal that results are top-ranked, not exhaustive.
    return { store_total: data.total ?? apps.length, apps };
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

  // === App Info Methods ===

  async getAppNames(appIds: number[]): Promise<Map<number, string>> {
    // Use ICommunityService/GetApps to batch fetch app info
    const params: Record<string, string | number | boolean> = {};
    appIds.forEach((appId, i) => {
      params[`appids[${i}]`] = appId;
    });

    const data = await this.request<{
      response: { apps: Array<{ appid: number; name: string }> };
    }>("ICommunityService", "GetApps", 1, params);

    const nameMap = new Map<number, string>();
    for (const app of data.response?.apps ?? []) {
      nameMap.set(app.appid, app.name);
    }
    return nameMap;
  }

  // === Wishlist Methods ===

  async getWishlist(steamId: string, includeNames = false): Promise<WishlistItem[]> {
    const data = await this.request<{
      response: { items: Array<{ appid: number; priority: number; date_added: number }> };
    }>("IWishlistService", "GetWishlist", 1, {
      steamid: steamId,
    });
    const items = data.response?.items ?? [];

    if (includeNames && items.length > 0) {
      const appIds = items.map((item) => item.appid);
      const nameMap = await this.getAppNames(appIds);
      return items.map((item) => ({
        ...item,
        name: nameMap.get(item.appid),
      }));
    }

    return items;
  }

  async getWishlistItemCount(appId: number): Promise<number> {
    const data = await this.request<{
      response: { count: number };
    }>("IWishlistService", "GetWishlistItemCount", 1, {
      appid: appId,
    });
    return data.response?.count ?? 0;
  }

  // === Trade Methods ===

  async getTradeOffers(
    getSentOffers = true,
    getReceivedOffers = true,
    activeOnly = true
  ): Promise<TradeOffersResponse> {
    const data = await this.request<{
      response: TradeOffersResponse;
    }>("IEconService", "GetTradeOffers", 1, {
      get_sent_offers: getSentOffers,
      get_received_offers: getReceivedOffers,
      active_only: activeOnly,
      get_descriptions: true,
      time_historical_cutoff: Math.floor(Date.now() / 1000),
    });
    return data.response ?? {};
  }

  async getTradeOffersSummary(): Promise<TradeOffersSummary> {
    const data = await this.request<{
      response: TradeOffersSummary;
    }>("IEconService", "GetTradeOffersSummary", 1, {
      time_last_visit: Math.floor(Date.now() / 1000) - 86400, // Last 24 hours
    });
    return data.response ?? {
      pending_received_count: 0,
      new_received_count: 0,
      updated_received_count: 0,
      historical_received_count: 0,
      pending_sent_count: 0,
      newly_accepted_sent_count: 0,
      historical_sent_count: 0,
      escrow_received_count: 0,
      escrow_sent_count: 0,
    };
  }

  async getTradeHistory(
    maxTrades = 30,
    includeFailed = false,
    includeTotal = true
  ): Promise<TradeHistoryResponse> {
    const data = await this.request<{
      response: TradeHistoryResponse;
    }>("IEconService", "GetTradeHistory", 1, {
      max_trades: maxTrades,
      get_descriptions: true,
      include_failed: includeFailed,
      include_total: includeTotal,
    });
    return data.response ?? { trades: [], more: false };
  }

  async getTradeOffer(tradeOfferId: string): Promise<TradeOffer | null> {
    const data = await this.request<{
      response: { offer: TradeOffer };
    }>("IEconService", "GetTradeOffer", 1, {
      tradeofferid: tradeOfferId,
    });
    return data.response?.offer ?? null;
  }
}
