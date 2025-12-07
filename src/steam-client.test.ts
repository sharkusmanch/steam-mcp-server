import { describe, it, expect, vi, beforeEach } from "vitest";
import { SteamClient } from "./steam-client.js";

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
});
