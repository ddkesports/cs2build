import type { Role, PlayerProfile, WeightConfig } from '../types';

export interface OptimizerConfig {
  budget: number;
  weights: WeightConfig;
  players: PlayerProfile[];
  lockedSlots?: Partial<Record<Role, number>>; // role -> locked player ID
}

export interface OptimizerResult {
  roster: Record<Role, PlayerProfile>;
  totalCost: number;
  totalScore: number;
  perPlayerScore: Record<number, number>; // player ID -> weighted score
}

const ALL_ROLES: Role[] = ['IGL', 'AWPer', 'Entry', 'Support', 'Lurker'];

// Roles sorted by constraint level -- fewer eligible players = more constrained
const CONSTRAINED_ROLE_ORDER: Role[] = ['AWPer', 'IGL', 'Entry', 'Lurker', 'Support'];

// Flexible roles that players without an explicit role can fill
const FLEXIBLE_ROLES: Role[] = ['Support', 'Lurker'];

/**
 * Score a player using the weighted formula.
 * Each stat is normalized to roughly 0-2 range before weighting.
 */
export function scorePlayer(player: PlayerProfile, weights: WeightConfig): number {
  const totalWeight = weights.rating + weights.kd + weights.adr + weights.kast + weights.impact;
  if (totalWeight === 0) return 0;

  const s = player.stats;

  // Normalize stats to roughly 0-2 range:
  // rating: already ~0.8-1.5 range, use as-is
  // kd: already ~0.7-1.5 range, use as-is
  // adr: ~50-100 range, divide by 100 -> 0.5-1.0, multiply by 2 -> 1.0-2.0
  // kast: ~60-80 range (percentage), divide by 100 -> 0.6-0.8, multiply by 2 -> 1.2-1.6
  // impact: already ~0.8-1.5 range, use as-is
  const normalizedRating = s.rating;
  const normalizedKd = s.kd;
  const normalizedAdr = (s.adr / 100) * 2;
  const normalizedKast = (s.kast / 100) * 2;
  const normalizedImpact = s.impactRating;

  const score =
    (normalizedRating * weights.rating +
      normalizedKd * weights.kd +
      normalizedAdr * weights.adr +
      normalizedKast * weights.kast +
      normalizedImpact * weights.impact) /
    totalWeight;

  return score;
}

/**
 * Check if a player is eligible for a given role.
 * - If the player has an explicit role matching, they are eligible.
 * - If the player has no role, they can fill any role (role data is sparse in MVP).
 * - If the player has a different explicit role, they are NOT eligible
 *   (e.g., a known AWPer won't be assigned as IGL).
 */
function isEligibleForRole(player: PlayerProfile, role: Role): boolean {
  if (player.role === role) return true;
  if (!player.role) return true; // No role data -- eligible for any position
  return false;
}

/**
 * Get eligible players for a role, sorted by score descending.
 */
function getEligiblePlayers(
  role: Role,
  players: PlayerProfile[],
  weights: WeightConfig,
  usedPlayerIds: Set<number>,
): Array<{ player: PlayerProfile; score: number }> {
  return players
    .filter((p) => isEligibleForRole(p, role) && !usedPlayerIds.has(p.id))
    .map((p) => ({ player: p, score: scorePlayer(p, weights) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Greedy roster optimizer with backtracking.
 *
 * Strategy:
 * 1. Respect locked slots (manually placed players).
 * 2. Fill most constrained roles first (AWPer, IGL have fewer candidates).
 * 3. For each role, pick the highest-scored player that fits within remaining budget.
 * 4. If a role cannot be filled, backtrack and try the next candidate for the previous role.
 */
export function optimizeRoster(config: OptimizerConfig): OptimizerResult | null {
  const { budget, weights, players, lockedSlots } = config;

  // Pre-compute scores for all players
  const playerScores = new Map<number, number>();
  for (const p of players) {
    playerScores.set(p.id, scorePlayer(p, weights));
  }

  // Determine which roles need filling and which are locked
  const lockedRoster: Partial<Record<Role, PlayerProfile>> = {};
  let lockedCost = 0;

  if (lockedSlots) {
    for (const [role, playerId] of Object.entries(lockedSlots) as Array<[Role, number]>) {
      const player = players.find((p) => p.id === playerId);
      if (player) {
        lockedRoster[role] = player;
        lockedCost += player.totalCost;
      }
    }
  }

  const rolesToFill = CONSTRAINED_ROLE_ORDER.filter((r) => !(r in lockedRoster));
  const lockedPlayerIds = new Set(
    Object.values(lockedRoster)
      .filter((p): p is PlayerProfile => p !== undefined)
      .map((p) => p.id),
  );

  // Backtracking search
  const result = backtrack(
    rolesToFill,
    0,
    budget - lockedCost,
    new Set(lockedPlayerIds),
    {},
    players,
    weights,
  );

  if (!result) return null;

  // Build full roster with locked + found players
  const fullRoster: Record<Role, PlayerProfile> = {} as Record<Role, PlayerProfile>;
  for (const role of ALL_ROLES) {
    if (lockedRoster[role]) {
      fullRoster[role] = lockedRoster[role]!;
    } else if (result[role]) {
      fullRoster[role] = result[role]!;
    } else {
      return null; // Should not happen if backtrack succeeded
    }
  }

  const totalCost = ALL_ROLES.reduce((sum, r) => sum + fullRoster[r].totalCost, 0);
  const perPlayerScore: Record<number, number> = {};
  let totalScore = 0;

  for (const role of ALL_ROLES) {
    const p = fullRoster[role];
    const s = playerScores.get(p.id) ?? 0;
    perPlayerScore[p.id] = s;
    totalScore += s;
  }

  return { roster: fullRoster, totalCost, totalScore, perPlayerScore };
}

/**
 * Recursive backtracking to fill roles within budget.
 */
function backtrack(
  roles: Role[],
  index: number,
  remainingBudget: number,
  usedPlayerIds: Set<number>,
  assigned: Partial<Record<Role, PlayerProfile>>,
  allPlayers: PlayerProfile[],
  weights: WeightConfig,
): Partial<Record<Role, PlayerProfile>> | null {
  if (index >= roles.length) {
    return { ...assigned };
  }

  const role = roles[index];
  const candidates = getEligiblePlayers(role, allPlayers, weights, usedPlayerIds);

  for (const { player } of candidates) {
    if (player.totalCost > remainingBudget) continue;

    // Try assigning this player
    usedPlayerIds.add(player.id);
    assigned[role] = player;

    const result = backtrack(
      roles,
      index + 1,
      remainingBudget - player.totalCost,
      usedPlayerIds,
      assigned,
      allPlayers,
      weights,
    );

    if (result) return result;

    // Backtrack
    usedPlayerIds.delete(player.id);
    delete assigned[role];
  }

  return null; // No valid assignment found
}
