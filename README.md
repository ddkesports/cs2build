# CS2 Build

Static Astro + React MVP for evaluating Counter-Strike 2 players and building a
five-role roster under a budget constraint.

## Current State

- Dashboard at `/` linking to the two tool surfaces.
- Big Board at `/board`: sortable and filterable player table.
- Team Builder at `/builder`: five role slots, player picker, budget controls,
  scoring weights, and an auto-build optimizer.
- Data is version-controlled JSON under `data/`.
- The HLTV scraper has a mock mode for generating development data.

The MVP is complete and currently parked. Refresh data and contract-source
confidence before any public or decision-grade use.

## Commands

Run from this repo:

| Command | Action |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Start local dev server |
| `bun run build` | Build the static site to `dist/` |
| `bun run preview` | Preview the production build locally |
| `bun run astro -- --help` | Astro CLI help |

## Project Structure

```text
data/
  players.json      HLTV-derived or mock player records
  teams.json        team metadata
  contracts.json    manually maintained contract estimates
scripts/
  scrape-hltv.ts    scraper/mock data generator
src/
  components/       BigBoard, TeamBuilder, RosterCard
  lib/              merge-data and optimizer logic
  pages/            dashboard, board, builder
  types/            shared player, contract, roster types
```

## Runtime Model

This is a static site. JSON data is imported at build time; there is no backend,
database, authentication, or scheduled scraping in the MVP.
