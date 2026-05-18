export type Role = 'IGL' | 'AWPer' | 'Entry' | 'Support' | 'Lurker';

export interface PlayerStats {
  rating: number;      // HLTV Rating 3.0
  kd: number;          // Kill/Death ratio
  adr: number;         // Average Damage per Round
  kast: number;        // KAST% (0-100)
  headshot: number;    // Headshot% (0-100)
  mapsPlayed: number;
  killsPerRound: number;
  deathsPerRound: number;
  impactRating: number;
}

export interface Player {
  id: number;          // HLTV player ID
  name: string;        // IGN/nickname
  realName?: string;
  country: string;
  age?: number;
  teamId?: number;
  teamName?: string;
  stats: PlayerStats;
  role?: Role;         // Tactical role (may be auto-detected or manual)
  imageUrl?: string;
}

export interface Contract {
  playerId: number;
  contractEnd?: string;  // ISO date
  buyout?: number;       // USD
  salary?: number;       // USD monthly
  notes?: string;
  source?: string;       // Where the info came from
  confidence: 'confirmed' | 'rumored' | 'estimated';
}

export interface PlayerProfile extends Player {
  contract?: Contract;
  totalCost: number;    // buyout + (salary * months remaining) or just salary if free agent
}

export interface Team {
  id: number;
  name: string;
  country: string;
  ranking: number;
  players: number[];   // Player IDs
  tier: 1 | 2;
}

export interface RosterSlot {
  role: Role;
  player?: PlayerProfile;
}

export interface WeightConfig {
  rating: number;
  kd: number;
  adr: number;
  kast: number;
  impact: number;
}
