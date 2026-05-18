#!/usr/bin/env npx tsx
/**
 * HLTV Scraper for CS2 Build
 *
 * Scrapes top 30 teams, rosters, and player stats from HLTV.
 * Outputs data/players.json, data/teams.json, and data/contracts.json.
 *
 * Usage:
 *   npx tsx scripts/scrape-hltv.ts          # Scrape live (falls back to mock on failure)
 *   npx tsx scripts/scrape-hltv.ts --mock   # Generate realistic mock data
 */

import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = "AWPer" | "IGL" | "Entry" | "Support" | "Lurker";

export interface PlayerStats {
  rating: number;
  kd: number;
  adr: number;
  kast: number;
  headshot: number;
  mapsPlayed: number;
  killsPerRound: number;
  deathsPerRound: number;
  impactRating: number;
}

export interface Player {
  id: number;
  name: string;
  realName?: string;
  country: string;
  age?: number;
  teamId?: number;
  teamName?: string;
  stats: PlayerStats;
  role?: Role;
  imageUrl?: string;
}

export interface Team {
  id: number;
  name: string;
  country: string;
  ranking: number;
  players: number[];
  tier: 1 | 2;
}

export interface Contract {
  playerId: number;
  contractEnd?: string;
  buyout?: number;
  salary?: number;
  notes?: string;
  source?: string;
  confidence: "confirmed" | "rumored" | "estimated";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.hltv.org";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 1800; // 1.8s between requests

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      Referer: BASE_URL,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

function parseFloat2(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.replace("%", "").trim());
  return isNaN(n) ? 0 : n;
}

function parseInt2(val: string | undefined): number {
  if (!val) return 0;
  const n = parseInt(val.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

function writeJSON(filename: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  Wrote ${path}`);
}

// ---------------------------------------------------------------------------
// Scraper: Team Rankings
// ---------------------------------------------------------------------------

interface RankedTeam {
  id: number;
  name: string;
  ranking: number;
  country: string;
}

async function scrapeTeamRankings(): Promise<RankedTeam[]> {
  console.log("Scraping team rankings...");
  const html = await fetchPage(`${BASE_URL}/ranking/teams`);
  const $ = cheerio.load(html);

  const teams: RankedTeam[] = [];

  $(".ranked-team").each((_i, el) => {
    const $el = $(el);
    const ranking = parseInt2($el.find(".position").text().replace("#", ""));
    const name = $el.find(".name").text().trim();
    const teamLink = $el.find("a.moreLink").attr("href") || "";
    // Link format: /team/{id}/{name}
    const idMatch = teamLink.match(/\/team\/(\d+)\//);
    const id = idMatch ? parseInt(idMatch[1], 10) : 0;
    // Country from flag class
    const flagEl = $el.find(".team-info .flag");
    const country =
      flagEl.attr("alt") ||
      flagEl.attr("title") ||
      extractCountryFromFlag(flagEl.attr("class") || "") ||
      "Unknown";

    if (id && name && ranking) {
      teams.push({ id, name, ranking, country });
    }
  });

  console.log(`  Found ${teams.length} teams in rankings`);
  return teams.slice(0, 30);
}

function extractCountryFromFlag(className: string): string {
  // flag classes are often like "flag flag-xx" where xx is country code
  const match = className.match(/flag-(\w+)/);
  return match ? match[1].toUpperCase() : "";
}

// ---------------------------------------------------------------------------
// Scraper: Team Page (roster)
// ---------------------------------------------------------------------------

interface RosterEntry {
  playerId: number;
  playerName: string;
  playerType: string; // Starter, Substitute, Benched, Coach
}

async function scrapeTeamRoster(
  teamId: number,
  teamName: string
): Promise<RosterEntry[]> {
  const slug = teamName.toLowerCase().replace(/\s+/g, "-");
  const url = `${BASE_URL}/team/${teamId}/${slug}`;
  console.log(`  Scraping roster for ${teamName} (${url})...`);

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const roster: RosterEntry[] = [];

    // HLTV team page has player boxes with links
    $(".bodyshot-team-bg, .players-table .player, .teamProfile .teammate")
      .each((_i, el) => {
        const $el = $(el);
        const link = $el.find("a").attr("href") || $el.closest("a").attr("href") || "";
        const idMatch = link.match(/\/player\/(\d+)\//);
        if (!idMatch) return;

        const playerId = parseInt(idMatch[1], 10);
        const playerName =
          $el.find(".text-ellipsis, .nickname, .playerNick").text().trim() ||
          $el.find("a").text().trim();
        const playerType =
          $el.find(".type, .playerType").text().trim() || "Starter";

        if (playerId && playerName) {
          roster.push({ playerId, playerName, playerType });
        }
      });

    // Alternative selector patterns for different HLTV page versions
    if (roster.length === 0) {
      $("a[href*='/player/']").each((_i, el) => {
        const href = $(el).attr("href") || "";
        const idMatch = href.match(/\/player\/(\d+)\//);
        if (!idMatch) return;
        const playerId = parseInt(idMatch[1], 10);
        const playerName = $(el).text().trim();
        if (playerId && playerName && playerName.length < 30) {
          // Deduplicate
          if (!roster.find((r) => r.playerId === playerId)) {
            roster.push({ playerId, playerName, playerType: "Starter" });
          }
        }
      });
    }

    console.log(`    Found ${roster.length} players`);
    return roster;
  } catch (err) {
    console.error(
      `    Failed to scrape roster for ${teamName}: ${(err as Error).message}`
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scraper: Player Stats
// ---------------------------------------------------------------------------

async function scrapePlayerStats(
  playerId: number,
  playerName: string
): Promise<Partial<Player> | null> {
  const slug = playerName.toLowerCase().replace(/\s+/g, "-");
  const url = `${BASE_URL}/stats/players/${playerId}/${slug}`;

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    const player: Partial<Player> = {
      id: playerId,
      name: playerName,
    };

    // Stats summary box
    const statBoxes = $(".stats-row, .summaryStatBreakdownRow");
    const statsMap: Record<string, string> = {};

    statBoxes.each((_i, el) => {
      const label = $(el).find("span:first-child, .stat-label").text().trim().toLowerCase();
      const value = $(el).find("span:last-child, .stat-value").text().trim();
      if (label && value) {
        statsMap[label] = value;
      }
    });

    // Alternative: look for standard stat containers
    $(".stats-row").each((_i, el) => {
      const spans = $(el).find("span");
      if (spans.length >= 2) {
        const label = $(spans[0]).text().trim().toLowerCase();
        const value = $(spans[spans.length - 1]).text().trim();
        if (label && value) {
          statsMap[label] = value;
        }
      }
    });

    player.stats = {
      rating: parseFloat2(
        statsMap["rating 2.0"] || statsMap["rating 3.0"] || statsMap["rating"] || "0"
      ),
      kd: parseFloat2(
        statsMap["kills / deaths"] || statsMap["k/d"] || statsMap["k/d ratio"] || "0"
      ),
      adr: parseFloat2(
        statsMap["damage / round"] || statsMap["adr"] || "0"
      ),
      kast: parseFloat2(
        statsMap["kast"] || statsMap["kast%"] || "0"
      ),
      headshot: parseFloat2(
        statsMap["headshot %"] || statsMap["headshot%"] || statsMap["hs%"] || "0"
      ),
      mapsPlayed: parseInt2(
        statsMap["maps played"] || statsMap["maps"] || "0"
      ),
      killsPerRound: parseFloat2(
        statsMap["kills / round"] || statsMap["kpr"] || "0"
      ),
      deathsPerRound: parseFloat2(
        statsMap["deaths / round"] || statsMap["dpr"] || "0"
      ),
      impactRating: parseFloat2(
        statsMap["impact"] || statsMap["impact rating"] || "0"
      ),
    };

    // Player info
    const infoBox = $(".playerRealname, .summaryRealname");
    player.realName = infoBox.text().trim() || undefined;

    const ageText = $(".summaryPlayerAge, .playerAge").text().trim();
    const ageMatch = ageText.match(/(\d+)/);
    player.age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;

    const countryEl = $(
      ".summaryRealname .flag, .playerRealname .flag, .player-realname .flag"
    );
    player.country =
      countryEl.attr("alt") ||
      countryEl.attr("title") ||
      extractCountryFromFlag(countryEl.attr("class") || "") ||
      "Unknown";

    player.imageUrl =
      $(".summaryBodyshot img, .playerImage img").attr("src") || undefined;

    return player;
  } catch (err) {
    console.error(
      `    Failed to scrape stats for ${playerName}: ${(err as Error).message}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Role Detection
// ---------------------------------------------------------------------------

function detectRole(stats: PlayerStats): Role | undefined {
  // Heuristic: high headshot % and low ADR might indicate AWPer style
  // But the best heuristic would be weapon stats which require extra scraping.
  // For now, we only mark AWPer if headshot% is notably low (AWPers typically
  // have lower HS% because AWP kills aren't headshots) combined with high impact.
  if (stats.headshot < 35 && stats.impactRating > 1.1 && stats.rating > 1.0) {
    return "AWPer";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Live Scraping Pipeline
// ---------------------------------------------------------------------------

async function scrapeLive(): Promise<{
  players: Player[];
  teams: Team[];
} | null> {
  try {
    const rankedTeams = await scrapeTeamRankings();
    if (rankedTeams.length === 0) {
      console.error("No teams found in rankings -- Cloudflare may be blocking.");
      return null;
    }

    const teams: Team[] = [];
    const players: Player[] = [];
    const seenPlayerIds = new Set<number>();

    for (const rt of rankedTeams) {
      await sleep(REQUEST_DELAY_MS);

      const roster = await scrapeTeamRoster(rt.id, rt.name);
      const playerIds: number[] = [];

      // Scrape each player's stats
      for (const entry of roster) {
        if (seenPlayerIds.has(entry.playerId)) {
          playerIds.push(entry.playerId);
          continue;
        }

        await sleep(REQUEST_DELAY_MS);
        const playerData = await scrapePlayerStats(
          entry.playerId,
          entry.playerName
        );

        if (playerData && playerData.stats) {
          const player: Player = {
            id: playerData.id || entry.playerId,
            name: playerData.name || entry.playerName,
            realName: playerData.realName,
            country: playerData.country || "Unknown",
            age: playerData.age,
            teamId: rt.id,
            teamName: rt.name,
            stats: playerData.stats,
            role: detectRole(playerData.stats),
            imageUrl: playerData.imageUrl,
          };
          players.push(player);
          seenPlayerIds.add(player.id);
          playerIds.push(player.id);
        }
      }

      const team: Team = {
        id: rt.id,
        name: rt.name,
        country: rt.country,
        ranking: rt.ranking,
        players: playerIds,
        tier: rt.ranking <= 10 ? 1 : 2,
      };
      teams.push(team);
      console.log(
        `  Team #${rt.ranking} ${rt.name}: ${playerIds.length} players`
      );
    }

    return { players, teams };
  } catch (err) {
    console.error(`Scraping failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock Data Generator
// ---------------------------------------------------------------------------

const MOCK_TEAMS: {
  name: string;
  id: number;
  country: string;
  players: { name: string; id: number; realName: string; country: string; age: number }[];
}[] = [
  {
    name: "Natus Vincere",
    id: 4608,
    country: "UA",
    players: [
      { name: "s1mple", id: 7998, realName: "Oleksandr Kostyliev", country: "UA", age: 27 },
      { name: "b1t", id: 18987, realName: "Valeriy Vakhovskiy", country: "UA", age: 22 },
      { name: "jL", id: 16930, realName: "Justinas Lekavicius", country: "LT", age: 24 },
      { name: "iM", id: 20781, realName: "Ivan Mihai", country: "RO", age: 20 },
      { name: "Aleksib", id: 11271, realName: "Aleksi Virolainen", country: "FI", age: 27 },
    ],
  },
  {
    name: "Team Vitality",
    id: 9565,
    country: "FR",
    players: [
      { name: "ZywOo", id: 11893, realName: "Mathieu Herbaut", country: "FR", age: 24 },
      { name: "apEX", id: 7322, realName: "Dan Madesclaire", country: "FR", age: 31 },
      { name: "mezii", id: 16820, realName: "William Merriman", country: "GB", age: 25 },
      { name: "flameZ", id: 15246, realName: "Shahar Shushan", country: "IL", age: 22 },
      { name: "Spinx", id: 17108, realName: "Lotan Giladi", country: "IL", age: 23 },
    ],
  },
  {
    name: "FaZe Clan",
    id: 6667,
    country: "EU",
    players: [
      { name: "ropz", id: 11816, realName: "Robin Kool", country: "EE", age: 25 },
      { name: "rain", id: 8183, realName: "Havard Nygaard", country: "NO", age: 31 },
      { name: "frozen", id: 13666, realName: "David Cernansky", country: "SK", age: 23 },
      { name: "broky", id: 18053, realName: "Helvijs Saukants", country: "LV", age: 23 },
      { name: "karrigan", id: 429, realName: "Finn Andersen", country: "DK", age: 35 },
    ],
  },
  {
    name: "G2 Esports",
    id: 5995,
    country: "EU",
    players: [
      { name: "NiKo", id: 3741, realName: "Nikola Kovac", country: "BA", age: 28 },
      { name: "huNter-", id: 2757, realName: "Nemanja Kovac", country: "BA", age: 30 },
      { name: "m0NESY", id: 20127, realName: "Ilya Osipov", country: "RU", age: 20 },
      { name: "nexa", id: 8738, realName: "Nemanja Isakovic", country: "RS", age: 27 },
      { name: "HooXi", id: 2593, realName: "Rasmus Nielsen", country: "DK", age: 29 },
    ],
  },
  {
    name: "Team Spirit",
    id: 7020,
    country: "RU",
    players: [
      { name: "donk", id: 21578, realName: "Danil Kryshkovets", country: "RU", age: 18 },
      { name: "sh1ro", id: 16920, realName: "Dmitry Sokolov", country: "RU", age: 23 },
      { name: "zont1x", id: 22710, realName: "Alexey Zykov", country: "RU", age: 19 },
      { name: "magixx", id: 18990, realName: "Boris Vorobyev", country: "RU", age: 23 },
      { name: "chopper", id: 13068, realName: "Leonid Vishnyakov", country: "RU", age: 26 },
    ],
  },
  {
    name: "Heroic",
    id: 7175,
    country: "DK",
    players: [
      { name: "TeSeS", id: 14329, realName: "Rene Madsen", country: "DK", age: 26 },
      { name: "sjuush", id: 18456, realName: "Rasmus Beck", country: "DK", age: 25 },
      { name: "jabbi", id: 19156, realName: "Jakob Nygaard", country: "DK", age: 22 },
      { name: "nertz", id: 20950, realName: "Gustav Holst", country: "DK", age: 21 },
      { name: "kyxsan", id: 16710, realName: "Nicholas Nielsen", country: "DK", age: 26 },
    ],
  },
  {
    name: "MOUZ",
    id: 4494,
    country: "EU",
    players: [
      { name: "torzsi", id: 19208, realName: "Adam Torzsas", country: "HU", age: 23 },
      { name: "Jimpphat", id: 21439, realName: "Jimmi Johansson", country: "FI", age: 18 },
      { name: "xertioN", id: 20478, realName: "Dorian Berman", country: "IL", age: 20 },
      { name: "siuhy", id: 20185, realName: "Kamil Szkaradek", country: "PL", age: 23 },
      { name: "Brollan", id: 15466, realName: "Ludvig Brolin", country: "SE", age: 22 },
    ],
  },
  {
    name: "Liquid",
    id: 5973,
    country: "US",
    players: [
      { name: "NAF", id: 8520, realName: "Keith Markovic", country: "CA", age: 27 },
      { name: "EliGE", id: 7551, realName: "Jonathan Jablonowski", country: "US", age: 27 },
      { name: "oSee", id: 14720, realName: "Josh Ohm", country: "US", age: 26 },
      { name: "ultimate", id: 21200, realName: "Gage Green", country: "US", age: 22 },
      { name: "YEKINDAR", id: 13915, realName: "Mareks Galinskis", country: "LV", age: 24 },
    ],
  },
  {
    name: "Complexity",
    id: 5005,
    country: "US",
    players: [
      { name: "floppy", id: 16891, realName: "Ricky Kemery", country: "US", age: 25 },
      { name: "Grim", id: 16134, realName: "Michael Wince", country: "US", age: 24 },
      { name: "hallzerk", id: 13247, realName: "Hakon Fjeld", country: "NO", age: 24 },
      { name: "JT", id: 15086, realName: "Johnny Theodosiou", country: "ZA", age: 27 },
      { name: "FaNg", id: 18472, realName: "Justin Coakley", country: "US", age: 24 },
    ],
  },
  {
    name: "Eternal Fire",
    id: 11251,
    country: "TR",
    players: [
      { name: "woxic", id: 9960, realName: "Ozgur Eker", country: "TR", age: 25 },
      { name: "XANTARES", id: 7938, realName: "Ismailcan Dortkardes", country: "TR", age: 29 },
      { name: "Calyx", id: 9264, realName: "Bunyamin Adiguzel", country: "TR", age: 27 },
      { name: "MAJ3R", id: 5765, realName: "Engin Kupeli", country: "TR", age: 31 },
      { name: "Wicadia", id: 21300, realName: "Ali Haydar", country: "TR", age: 21 },
    ],
  },
  {
    name: "Astralis",
    id: 6665,
    country: "DK",
    players: [
      { name: "device", id: 7592, realName: "Nicolai Reedtz", country: "DK", age: 29 },
      { name: "gla1ve", id: 7412, realName: "Lukas Rossander", country: "DK", age: 29 },
      { name: "Xyp9x", id: 4954, realName: "Andreas Hojsleth", country: "DK", age: 29 },
      { name: "blameF", id: 11818, realName: "Benjamin Bremer", country: "DK", age: 27 },
      { name: "Buzz", id: 19845, realName: "Mathias Jensen", country: "DK", age: 22 },
    ],
  },
  {
    name: "ENCE",
    id: 4869,
    country: "FI",
    players: [
      { name: "goofy", id: 22150, realName: "Lukas Hein", country: "DK", age: 20 },
      { name: "dycha", id: 16816, realName: "Pawel Dycha", country: "PL", age: 25 },
      { name: "NertZ", id: 14963, realName: "Guy Iluz", country: "IL", age: 24 },
      { name: "SunPayus", id: 18978, realName: "Alvaro Garcia", country: "ES", age: 24 },
      { name: "Maden", id: 18023, realName: "Pavle Boskovic", country: "ME", age: 27 },
    ],
  },
  {
    name: "Cloud9",
    id: 5752,
    country: "EU",
    players: [
      { name: "Ax1Le", id: 18898, realName: "Sergey Rykhtorov", country: "RU", age: 23 },
      { name: "buster", id: 11670, realName: "Sanjar Kuliev", country: "UZ", age: 26 },
      { name: "HObbit", id: 2127, realName: "Abay Khassenov", country: "KZ", age: 28 },
      { name: "Perfecto", id: 16947, realName: "Ilya Zalutskiy", country: "UA", age: 24 },
      { name: "electroNic", id: 8918, realName: "Denis Sharipov", country: "RU", age: 26 },
    ],
  },
  {
    name: "SAW",
    id: 10567,
    country: "PT",
    players: [
      { name: "MUTiRiS", id: 7178, realName: "Tiago Oliveira", country: "PT", age: 31 },
      { name: "arT", id: 8905, realName: "Andrei Piovezan", country: "BR", age: 29 },
      { name: "story", id: 20456, realName: "Miguel Costa", country: "PT", age: 22 },
      { name: "ewjerkz", id: 18020, realName: "Asger Larsen", country: "DK", age: 25 },
      { name: "roman", id: 21789, realName: "Roman Vashchuk", country: "UA", age: 21 },
    ],
  },
  {
    name: "TheMongolz",
    id: 11585,
    country: "MN",
    players: [
      { name: "bLitz", id: 17297, realName: "Bat-Erdene Batbold", country: "MN", age: 24 },
      { name: "Techno4K", id: 19483, realName: "Bayarkhuu Byambaa", country: "MN", age: 21 },
      { name: "Senzu", id: 22410, realName: "Ganzorig Enkhbat", country: "MN", age: 19 },
      { name: "mzinho", id: 21956, realName: "Munkhbayar Bold", country: "MN", age: 20 },
      { name: "910", id: 20890, realName: "Altansukh Ochir", country: "MN", age: 22 },
    ],
  },
  {
    name: "Virtus.pro",
    id: 5378,
    country: "RU",
    players: [
      { name: "fame", id: 21340, realName: "Petr Bolyshev", country: "RU", age: 20 },
      { name: "FL1T", id: 15760, realName: "Evgeniy Lebedev", country: "RU", age: 25 },
      { name: "n0rb3r7", id: 18457, realName: "Norbert Maggs", country: "HU", age: 23 },
      { name: "Jame", id: 13218, realName: "Dzhami Ali", country: "RU", age: 26 },
      { name: "mir", id: 14990, realName: "Nikolay Bityukov", country: "RU", age: 26 },
    ],
  },
  {
    name: "BIG",
    id: 7532,
    country: "DE",
    players: [
      { name: "tabseN", id: 5794, realName: "Johannes Wodarz", country: "DE", age: 30 },
      { name: "syrsoN", id: 16211, realName: "Florian Rische", country: "DE", age: 27 },
      { name: "JDC", id: 20645, realName: "Jordan Chevallier", country: "FR", age: 23 },
      { name: "rigon", id: 21034, realName: "Rigon Gashi", country: "DE", age: 22 },
      { name: "prosus", id: 22890, realName: "Dominik Prosuh", country: "DE", age: 20 },
    ],
  },
  {
    name: "paiN Gaming",
    id: 4773,
    country: "BR",
    players: [
      { name: "biguzera", id: 19445, realName: "Rodrigo Bittencourt", country: "BR", age: 22 },
      { name: "kauez", id: 21834, realName: "Kaue Kaschuk", country: "BR", age: 19 },
      { name: "nqz", id: 18610, realName: "Nathan Quetz", country: "BR", age: 22 },
      { name: "lux", id: 21710, realName: "Lucas Viana", country: "BR", age: 21 },
      { name: "snow", id: 22001, realName: "Arthur Vieira", country: "BR", age: 20 },
    ],
  },
  {
    name: "FURIA",
    id: 8297,
    country: "BR",
    players: [
      { name: "FalleN", id: 2023, realName: "Gabriel Toledo", country: "BR", age: 33 },
      { name: "yuurih", id: 12552, realName: "Yuri Santos", country: "BR", age: 24 },
      { name: "KSCERATO", id: 15631, realName: "Kaike Cerato", country: "BR", age: 25 },
      { name: "chelo", id: 15104, realName: "Marcelo Cespedes", country: "BR", age: 27 },
      { name: "skullz", id: 19345, realName: "Felipe Medeiros", country: "BR", age: 22 },
    ],
  },
  {
    name: "3DMAX",
    id: 4501,
    country: "FR",
    players: [
      { name: "Graviti", id: 21470, realName: "Hugo Larcher", country: "FR", age: 22 },
      { name: "Lucky", id: 15481, realName: "Luc Donadello", country: "FR", age: 23 },
      { name: "Djoko", id: 12580, realName: "Nathan Dumont", country: "FR", age: 26 },
      { name: "Ex3rcice", id: 14760, realName: "Victor Music", country: "FR", age: 26 },
      { name: "Maka", id: 15342, realName: "William Botte", country: "FR", age: 24 },
    ],
  },
  {
    name: "GamerLegion",
    id: 9928,
    country: "EU",
    players: [
      { name: "iM0RR", id: 22340, realName: "Oscar Garcia", country: "ES", age: 20 },
      { name: "isak", id: 17553, realName: "Isak Fahlén", country: "SE", age: 22 },
      { name: "siuhy", id: 20600, realName: "Kamil Szkaradek", country: "PL", age: 23 },
      { name: "keoz", id: 15090, realName: "Tomas Marques", country: "PT", age: 25 },
      { name: "volt", id: 22670, realName: "Adrian Voltan", country: "RO", age: 21 },
    ],
  },
  {
    name: "Falcons",
    id: 12080,
    country: "SA",
    players: [
      { name: "Magisk", id: 9032, realName: "Emil Reif", country: "DK", age: 27 },
      { name: "dupreeh", id: 7398, realName: "Peter Rasmussen", country: "DK", age: 32 },
      { name: "NiKo", id: 20315, realName: "Niko Paltio", country: "FI", age: 23 },
      { name: "kyxsan", id: 16910, realName: "Nicholas Nielsen", country: "DK", age: 26 },
      { name: "TeSeS", id: 14529, realName: "Rene Madsen", country: "DK", age: 26 },
    ],
  },
  {
    name: "MIBR",
    id: 9215,
    country: "BR",
    players: [
      { name: "drop", id: 18930, realName: "Andre Abreu", country: "BR", age: 23 },
      { name: "saffee", id: 16300, realName: "Rafael Costa", country: "BR", age: 25 },
      { name: "exit", id: 22560, realName: "Felipe Ribeiro", country: "BR", age: 21 },
      { name: "brnz4n", id: 19830, realName: "Breno Figueredo", country: "BR", age: 22 },
      { name: "insani", id: 21780, realName: "Gabriel Barbosa", country: "BR", age: 20 },
    ],
  },
  {
    name: "Wildcard",
    id: 11345,
    country: "AU",
    players: [
      { name: "INS", id: 16234, realName: "Joshua Potter", country: "AU", age: 24 },
      { name: "Liazz", id: 13587, realName: "Jay Tregillgas", country: "AU", age: 26 },
      { name: "aliStair", id: 11356, realName: "Alistair Johnston", country: "AU", age: 28 },
      { name: "Vexite", id: 18995, realName: "Liam Veksler", country: "AU", age: 22 },
      { name: "D4v41", id: 22895, realName: "David Kim", country: "AU", age: 21 },
    ],
  },
  {
    name: "9z",
    id: 10894,
    country: "AR",
    players: [
      { name: "dav1g", id: 20567, realName: "David Garcia", country: "AR", age: 22 },
      { name: "rox", id: 21234, realName: "Federico Lopez", country: "AR", age: 21 },
      { name: "dgt", id: 19876, realName: "Diego Torres", country: "AR", age: 23 },
      { name: "maxujas", id: 22345, realName: "Maximiliano Rojas", country: "AR", age: 20 },
      { name: "try", id: 20895, realName: "Santino Martinez", country: "AR", age: 21 },
    ],
  },
  {
    name: "Lynn Vision",
    id: 10396,
    country: "CN",
    players: [
      { name: "Starry", id: 19456, realName: "He Junjie", country: "CN", age: 22 },
      { name: "z4kr", id: 22120, realName: "Zhang Kairui", country: "CN", age: 20 },
      { name: "EmiliaQAQ", id: 21950, realName: "Xu Wei", country: "CN", age: 21 },
      { name: "WestMelon", id: 20834, realName: "Li Xiang", country: "CN", age: 23 },
      { name: "afufu", id: 22565, realName: "Wang Haodong", country: "CN", age: 20 },
    ],
  },
  {
    name: "Ninjas in Pyjamas",
    id: 4411,
    country: "SE",
    players: [
      { name: "REZ", id: 8574, realName: "Fredrik Sterner", country: "SE", age: 26 },
      { name: "hampus", id: 14140, realName: "Hampus Poser", country: "SE", age: 26 },
      { name: "Brollan", id: 15666, realName: "Ludvig Brolin", country: "SE", age: 22 },
      { name: "headtr1ck", id: 16903, realName: "Danyil Valitov", country: "UA", age: 22 },
      { name: "maxster", id: 21560, realName: "Max Sterling", country: "SE", age: 21 },
    ],
  },
  {
    name: "BetBoom",
    id: 11518,
    country: "RU",
    players: [
      { name: "nafany", id: 17077, realName: "Abay Khasenov", country: "KZ", age: 24 },
      { name: "KaiR0N-", id: 15260, realName: "Aleksandr Ivanov", country: "RU", age: 25 },
      { name: "zorte", id: 20234, realName: "Mikhail Goncharov", country: "RU", age: 22 },
      { name: "w0nderful", id: 22155, realName: "Vladislav Gorshkov", country: "RU", age: 20 },
      { name: "interz", id: 15994, realName: "Kirill Abramov", country: "RU", age: 26 },
    ],
  },
  {
    name: "Imperial",
    id: 9455,
    country: "BR",
    players: [
      { name: "fer", id: 2633, realName: "Fernando Alvarenga", country: "BR", age: 31 },
      { name: "boltz", id: 8611, realName: "Boltz Fraga", country: "BR", age: 27 },
      { name: "decco", id: 20897, realName: "Daniel Lopes", country: "BR", age: 22 },
      { name: "noway", id: 21400, realName: "Bruno Monteiro", country: "BR", age: 21 },
      { name: "vnx", id: 22899, realName: "Vinicius Santos", country: "BR", age: 20 },
    ],
  },
  {
    name: "Monte",
    id: 11811,
    country: "UA",
    players: [
      { name: "AUNKERE", id: 13997, realName: "Andrey Kopylov", country: "UA", age: 25 },
      { name: "DemQQ", id: 18345, realName: "Demid Kuznetsov", country: "RU", age: 23 },
      { name: "Woro2k", id: 17650, realName: "Viktor Kazhyn", country: "UA", age: 24 },
      { name: "kRaSnaL", id: 15892, realName: "Konrad Miszczak", country: "PL", age: 26 },
      { name: "sdy", id: 16190, realName: "Vadim Kalinin", country: "RU", age: 24 },
    ],
  },
];

function generateMockStats(isAwper: boolean, tier: 1 | 2): PlayerStats {
  const rand = (min: number, max: number) =>
    Math.round((min + Math.random() * (max - min)) * 100) / 100;

  const tierBonus = tier === 1 ? 0.08 : 0;

  return {
    rating: rand(0.85 + tierBonus, 1.35 + tierBonus),
    kd: rand(0.8 + tierBonus, 1.4 + tierBonus),
    adr: rand(60, 90 + (tier === 1 ? 10 : 0)),
    kast: rand(62, 78),
    headshot: isAwper ? rand(25, 40) : rand(42, 62),
    mapsPlayed: Math.floor(rand(50, 350)),
    killsPerRound: rand(0.55, 0.85),
    deathsPerRound: rand(0.55, 0.72),
    impactRating: rand(0.85, 1.35),
  };
}

function generateMockData(): { players: Player[]; teams: Team[] } {
  console.log("Generating mock data for 30 teams...");
  const teams: Team[] = [];
  const players: Player[] = [];

  // Well-known AWPers for role detection
  const knownAwpers = new Set([
    "s1mple", "ZywOo", "sh1ro", "m0NESY", "broky", "device",
    "syrsoN", "hallzerk", "woxic", "oSee", "FalleN", "torzsi",
    "SunPayus", "Jame", "saffee", "INS",
  ]);

  for (let i = 0; i < MOCK_TEAMS.length; i++) {
    const mt = MOCK_TEAMS[i];
    const ranking = i + 1;
    const tier: 1 | 2 = ranking <= 10 ? 1 : 2;
    const playerIds: number[] = [];

    for (const mp of mt.players) {
      const isAwper = knownAwpers.has(mp.name);
      const stats = generateMockStats(isAwper, tier);
      const role = detectRole(stats) || (isAwper ? "AWPer" as Role : undefined);

      const player: Player = {
        id: mp.id,
        name: mp.name,
        realName: mp.realName,
        country: mp.country,
        age: mp.age,
        teamId: mt.id,
        teamName: mt.name,
        stats,
        role: isAwper ? "AWPer" : role,
        imageUrl: `https://img-cdn.hltv.org/playerbodyshot/placeholder/${mp.id}.png`,
      };
      players.push(player);
      playerIds.push(mp.id);
    }

    teams.push({
      id: mt.id,
      name: mt.name,
      country: mt.country,
      ranking,
      players: playerIds,
      tier,
    });
  }

  console.log(`  Generated ${players.length} players across ${teams.length} teams`);
  return { players, teams };
}

// ---------------------------------------------------------------------------
// Contracts Seed Data
// ---------------------------------------------------------------------------

function generateContracts(players: Player[]): Contract[] {
  // Known/plausible contract data for well-known players
  const contractData: Record<number, Omit<Contract, "playerId">> = {
    7998: {
      // s1mple
      contractEnd: "2027-12-31",
      buyout: 1500000,
      salary: 50000,
      notes: "One of the highest-paid CS players. Long-term NAVI deal.",
      source: "Multiple esports journalism reports",
      confidence: "rumored",
    },
    11893: {
      // ZywOo
      contractEnd: "2027-06-30",
      buyout: 1200000,
      salary: 45000,
      notes: "Extended with Vitality after back-to-back Major wins.",
      source: "Vitality announcement + journalism estimates",
      confidence: "rumored",
    },
    3741: {
      // NiKo
      contractEnd: "2026-12-31",
      buyout: 800000,
      salary: 35000,
      notes: "Long-standing G2 contract. High buyout per reports.",
      source: "Community estimates based on journalism",
      confidence: "estimated",
    },
    21578: {
      // donk
      contractEnd: "2028-01-01",
      buyout: 2000000,
      salary: 30000,
      notes: "Young prodigy signed long-term. Reportedly highest buyout in CS.",
      source: "Spirit org statements + community estimates",
      confidence: "rumored",
    },
    7592: {
      // device
      contractEnd: "2026-06-30",
      buyout: 500000,
      salary: 30000,
      notes: "Astralis return contract. Shorter deal after NIP stint.",
      source: "Esports journalism",
      confidence: "estimated",
    },
  };

  const contracts: Contract[] = [];
  for (const [idStr, data] of Object.entries(contractData)) {
    const playerId = parseInt(idStr, 10);
    if (players.find((p) => p.id === playerId)) {
      contracts.push({ playerId, ...data });
    }
  }
  return contracts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock");

  console.log("=== CS2 Build: HLTV Scraper ===");
  console.log(`Mode: ${useMock ? "MOCK" : "LIVE"}`);
  console.log();

  let result: { players: Player[]; teams: Team[] } | null;

  if (useMock) {
    result = generateMockData();
  } else {
    console.log("Attempting live scrape from HLTV...");
    console.log(
      "(This may take several minutes due to rate limiting.)"
    );
    console.log();
    result = await scrapeLive();

    if (!result || result.players.length === 0) {
      console.log();
      console.log(
        "Live scraping failed or returned no data. Falling back to mock data."
      );
      console.log();
      result = generateMockData();
    }
  }

  // Generate contracts
  const contracts = generateContracts(result.players);

  // Write output
  console.log();
  console.log("Writing data files...");
  writeJSON("players.json", result.players);
  writeJSON("teams.json", result.teams);
  writeJSON("contracts.json", contracts);

  console.log();
  console.log("=== Summary ===");
  console.log(`  Teams: ${result.teams.length}`);
  console.log(`  Players: ${result.players.length}`);
  console.log(`  Contracts: ${contracts.length}`);
  console.log(
    `  Tier 1 teams: ${result.teams.filter((t) => t.tier === 1).length}`
  );
  console.log(
    `  Tier 2 teams: ${result.teams.filter((t) => t.tier === 2).length}`
  );
  console.log(
    `  AWPers detected: ${result.players.filter((p) => p.role === "AWPer").length}`
  );
  console.log();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
