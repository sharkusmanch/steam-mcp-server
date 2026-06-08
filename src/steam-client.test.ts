import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SteamClient,
  TimeoutError,
  RateLimitError,
  AuthError,
  NotFoundError,
  UpstreamError,
} from "./steam-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("SteamClient", () => {
  let client: SteamClient;

  beforeEach(() => {
    client = new SteamClient({ apiKey: "test_api_key" });
    mockFetch.mockReset();
  });

  describe("getAppNames", () => {
    it("should batch fetch app names and return a map", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            apps: [
              { appid: 440, name: "Team Fortress 2" },
              { appid: 730, name: "Counter-Strike 2" },
            ],
          },
        }),
      });

      const result = await client.getAppNames([440, 730]);

      expect(result.get(440)).toBe("Team Fortress 2");
      expect(result.get(730)).toBe("Counter-Strike 2");
      expect(result.size).toBe(2);
    });

    it("should return empty map for empty array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: { apps: [] },
        }),
      });

      const result = await client.getAppNames([]);
      expect(result.size).toBe(0);
    });
  });

  describe("getWishlist", () => {
    it("should return wishlist without names when includeNames is false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            items: [
              { appid: 123, priority: 1, date_added: 1700000000 },
              { appid: 456, priority: 2, date_added: 1700000001 },
            ],
          },
        }),
      });

      const result = await client.getWishlist("76561198000000000", false);

      expect(result).toHaveLength(2);
      expect(result[0].appid).toBe(123);
      expect(result[0].name).toBeUndefined();
    });

    it("should return wishlist with names when includeNames is true", async () => {
      // First call: getWishlist
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            items: [
              { appid: 440, priority: 1, date_added: 1700000000 },
            ],
          },
        }),
      });

      // Second call: getAppNames
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            apps: [{ appid: 440, name: "Team Fortress 2" }],
          },
        }),
      });

      const result = await client.getWishlist("76561198000000000", true);

      expect(result).toHaveLength(1);
      expect(result[0].appid).toBe(440);
      expect(result[0].name).toBe("Team Fortress 2");
    });
  });

  describe("getFriendList", () => {
    it("should return friends without player info when includePlayerInfo is false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          friendslist: {
            friends: [
              { steamid: "76561198000000001", relationship: "friend", friend_since: 1600000000 },
            ],
          },
        }),
      });

      const result = await client.getFriendList("76561198000000000", false);

      expect(result).toHaveLength(1);
      expect(result[0].steamid).toBe("76561198000000001");
      expect(result[0].personaname).toBeUndefined();
    });

    it("should return friends with player info when includePlayerInfo is true", async () => {
      // First call: getFriendList
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          friendslist: {
            friends: [
              { steamid: "76561198000000001", relationship: "friend", friend_since: 1600000000 },
            ],
          },
        }),
      });

      // Second call: getPlayerSummaries
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            players: [
              {
                steamid: "76561198000000001",
                personaname: "TestPlayer",
                avatar: "https://example.com/avatar.jpg",
                personastate: 1,
              },
            ],
          },
        }),
      });

      const result = await client.getFriendList("76561198000000000", true);

      expect(result).toHaveLength(1);
      expect(result[0].steamid).toBe("76561198000000001");
      expect(result[0].personaname).toBe("TestPlayer");
      expect(result[0].personastate).toBe(1);
    });

    it("should batch player summaries in groups of 100", async () => {
      // Create 150 friends
      const friends = Array.from({ length: 150 }, (_, i) => ({
        steamid: `7656119800000000${i.toString().padStart(2, "0")}`,
        relationship: "friend",
        friend_since: 1600000000,
      }));

      // First call: getFriendList
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ friendslist: { friends } }),
      });

      // Second call: first batch of 100
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            players: friends.slice(0, 100).map((f) => ({
              steamid: f.steamid,
              personaname: `Player${f.steamid}`,
            })),
          },
        }),
      });

      // Third call: second batch of 50
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            players: friends.slice(100).map((f) => ({
              steamid: f.steamid,
              personaname: `Player${f.steamid}`,
            })),
          },
        }),
      });

      const result = await client.getFriendList("76561198000000000", true);

      expect(result).toHaveLength(150);
      // Verify all have names
      expect(result.every((f) => f.personaname)).toBe(true);
      // Should have made 3 fetch calls total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("getBadges", () => {
    it("should return badges without game names when includeGameNames is false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            badges: [
              { badgeid: 1, level: 1, completion_time: 1600000000, xp: 100, scarcity: 1000, appid: 440 },
            ],
            player_xp: 1000,
            player_level: 10,
            player_xp_needed_to_level_up: 100,
            player_xp_needed_current_level: 0,
          },
        }),
      });

      const result = await client.getBadges("76561198000000000", false);

      expect(result.badges).toHaveLength(1);
      expect(result.badges[0].appid).toBe(440);
      expect(result.badges[0].game_name).toBeUndefined();
    });

    it("should return badges with game names when includeGameNames is true", async () => {
      // First call: getBadges
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            badges: [
              { badgeid: 1, level: 1, completion_time: 1600000000, xp: 100, scarcity: 1000, appid: 440 },
            ],
            player_xp: 1000,
            player_level: 10,
            player_xp_needed_to_level_up: 100,
            player_xp_needed_current_level: 0,
          },
        }),
      });

      // Second call: getAppNames
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            apps: [{ appid: 440, name: "Team Fortress 2" }],
          },
        }),
      });

      const result = await client.getBadges("76561198000000000", true);

      expect(result.badges).toHaveLength(1);
      expect(result.badges[0].appid).toBe(440);
      expect(result.badges[0].game_name).toBe("Team Fortress 2");
    });

    it("should not fetch names for badges without appid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            badges: [
              { badgeid: 1, level: 1, completion_time: 1600000000, xp: 100, scarcity: 1000 }, // No appid
            ],
            player_xp: 1000,
            player_level: 10,
            player_xp_needed_to_level_up: 100,
            player_xp_needed_current_level: 0,
          },
        }),
      });

      const result = await client.getBadges("76561198000000000", true);

      expect(result.badges).toHaveLength(1);
      expect(result.badges[0].game_name).toBeUndefined();
      // Only 1 fetch call (no getAppNames needed)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("request reliability (timeout + retry + typed errors)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on a 500 then resolves the success payload", async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ response: { players: [{ steamid: "1", personaname: "X" }] } }),
        });

      const p = client.getPlayerSummaries(["76561198000000000"]);
      await vi.runAllTimersAsync();
      const players = await p;

      expect(players).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry on a 404 and throws NotFoundError", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

      await expect(client.getPlayerSummaries(["76561198000000000"])).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on an ok response (single attempt)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: { players: [] } }),
      });

      await client.getPlayerSummaries(["76561198000000000"]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("maps 401/403 to AuthError and 429 to RateLimitError", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });
      await expect(client.getPlayerSummaries(["76561198000000000"])).rejects.toBeInstanceOf(
        AuthError
      );

      // 429 is retriable: exhaust retries (3 attempts) then surface RateLimitError.
      vi.useFakeTimers();
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({ ok: false, status: 429, statusText: "Too Many" });
      const p = client.getPlayerSummaries(["76561198000000000"]);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toBeInstanceOf(RateLimitError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws UpstreamError when the body is not JSON", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      await expect(client.getPlayerSummaries(["76561198000000000"])).rejects.toBeInstanceOf(
        UpstreamError
      );
    });

    it("aborts a hung request and surfaces TimeoutError", async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
      );

      const p = client.getPlayerSummaries(["76561198000000000"]);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toBeInstanceOf(TimeoutError);
    });
  });

  describe("getInventory", () => {
    it("maps a 403 to the 'Inventory is private' message", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden" });

      await expect(client.getInventory("76561198000000000", 730)).rejects.toThrow(
        "Inventory is private"
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("threads start_assetid into the request URL as a cursor", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assets: [], descriptions: [], total_inventory_count: 0, success: 1 }),
      });

      await client.getInventory("76561198000000000", 730, 2, 50, "12345");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("start_assetid=12345");
    });
  });

  describe("searchStore", () => {
    it("returns only type='app' rows with numeric appids", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 3,
          items: [
            { id: "440", name: "Team Fortress 2", type: "app", tiny_image: "x" },
            { id: 232250, name: "TF2 Bundle", type: "bundle" },
            { id: "570", name: "Dota 2", type: "app" },
          ],
        }),
      });

      const result = await client.searchStore("tf");

      expect(result.apps).toHaveLength(2);
      expect(result.apps[0]).toMatchObject({ appid: 440, name: "Team Fortress 2", type: "app" });
      expect(typeof result.apps[0].appid).toBe("number");
      expect(result.apps[1].appid).toBe(570);
      // store_total surfaces Steam's (capped) reported total.
      expect(result.store_total).toBe(3);
      // Bundle row must be filtered out so its package id never leaks as an appid.
      expect(result.apps.some((r) => r.name === "TF2 Bundle")).toBe(false);
    });

    it("does not append an API key and hits the storefront endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total: 0, items: [] }),
      });

      await client.searchStore("nothing");

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("store.steampowered.com/api/storesearch/");
      expect(calledUrl).toContain("term=nothing");
      expect(calledUrl).not.toContain("key=");
    });

    it("retries once on a transient 500 then succeeds", async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ total: 1, items: [{ id: "1", name: "A", type: "app" }] }),
        });

      const p = client.searchStore("a");
      await vi.runAllTimersAsync();
      const result = await p;

      expect(result.apps).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });
});
