import type { PlayerProfile, Contract } from '../types';

interface RawPlayer {
  id: number;
  name: string;
  realName?: string;
  country: string;
  age?: number;
  teamId?: number;
  teamName?: string;
  role?: string;
  imageUrl?: string;
  stats: {
    rating: number;
    kd: number;
    adr: number;
    kast: number;
    headshot: number;
    mapsPlayed: number;
    killsPerRound: number;
    deathsPerRound: number;
    impactRating: number;
  };
}

/**
 * Merge raw player data with contract/financial data into PlayerProfile[].
 *
 * totalCost calculation:
 * - Free agent (no contract or expired): salary only (one month)
 * - Under contract: buyout + remaining months of salary
 */
export function mergePlayerData(
  players: RawPlayer[],
  contracts: Contract[],
): PlayerProfile[] {
  const contractMap = new Map<number, Contract>();
  for (const c of contracts) {
    contractMap.set(c.playerId, c);
  }

  const now = new Date();

  return players.map((p) => {
    const contract = contractMap.get(p.id);
    const buyout = contract?.buyout ?? 0;
    const salary = contract?.salary ?? 0;

    let totalCost = salary; // default: just one month salary for free agents

    if (contract?.contractEnd) {
      const endDate = new Date(contract.contractEnd);
      if (endDate > now) {
        // Under contract: buyout + remaining salary
        const remainingMonths = Math.max(
          0,
          (endDate.getFullYear() - now.getFullYear()) * 12 +
            (endDate.getMonth() - now.getMonth()),
        );
        totalCost = buyout + salary * remainingMonths;
      }
    }

    return {
      id: p.id,
      name: p.name,
      realName: p.realName,
      country: p.country,
      age: p.age,
      teamId: p.teamId,
      teamName: p.teamName,
      stats: p.stats,
      role: p.role as PlayerProfile['role'],
      imageUrl: p.imageUrl,
      contract,
      totalCost,
    };
  });
}
