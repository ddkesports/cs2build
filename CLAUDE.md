# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

cs2build -- Personal CS2 roster analysis tool. Evaluate T1/T2 professional
players, track contract/financial data, and auto-optimize a 5-man roster
within a budget constraint using weighted scoring.

## Tech Stack

- **Framework:** Astro 5 with React islands (@astrojs/react)
- **Styling:** Tailwind CSS 4 (via @tailwindcss/vite)
- **Language:** TypeScript (strict mode)
- **Package manager:** pnpm
- **Data:** JSON files (no database) -- scraped HLTV stats + manual contract data
- **HTML parsing:** cheerio (for HLTV scraper)

## Build & Dev Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (localhost:4321)
pnpm build            # Production build
pnpm preview          # Preview production build
```

## Directory Structure

```
src/
  components/         # React components (islands)
  layouts/            # Astro layouts (Layout.astro)
  pages/              # Astro pages (index, board, builder)
  types/              # TypeScript type definitions
  lib/                # Utility functions (merge-players, etc.)
  styles/             # Global CSS (Tailwind + theme)
data/                 # JSON data files (players.json, teams.json, contracts.json)
scripts/              # Build-time scripts (HLTV scraper)
public/               # Static assets
```

## Pages

| Route    | Purpose                                    |
|----------|--------------------------------------------|
| /        | Landing/dashboard with links to tools      |
| /board   | Big Board -- sortable player stats table   |
| /builder | Team Builder -- roster builder + optimizer |

## Design

- Dark gaming aesthetic: bg #0f0f1a, accent #2CD4F5
- Theme colors defined in src/styles/global.css via @theme
- React islands for interactive components on /board and /builder pages
- Data baked at build time from JSON files -- no runtime backend

## Key Types

Defined in `src/types/index.ts`:
- `Role` -- tactical roles (IGL, AWPer, Entry, Support, Lurker)
- `Player` / `PlayerProfile` -- player data with optional contract info
- `PlayerStats` -- HLTV stats (rating, K/D, ADR, KAST, etc.)
- `Contract` -- financial data with confidence level
- `Team` -- team roster and ranking
- `RosterSlot` / `WeightConfig` -- team builder types
