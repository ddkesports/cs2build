import { useState, useMemo, useCallback } from 'react';
import type { Role, PlayerProfile, WeightConfig, RosterSlot } from '../types';
import { optimizeRoster, scorePlayer } from '../lib/optimizer';
import RosterCard from './RosterCard';

interface TeamBuilderProps {
  players: PlayerProfile[];
}

const ALL_ROLES: Role[] = ['IGL', 'AWPer', 'Entry', 'Support', 'Lurker'];

const DEFAULT_WEIGHTS: WeightConfig = {
  rating: 40,
  kd: 20,
  adr: 20,
  kast: 10,
  impact: 10,
};

function isPlayerFreeAgent(player: PlayerProfile): boolean {
  if (!player.contract?.contractEnd) return true;
  return new Date(player.contract.contractEnd) <= new Date();
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value}`;
}

export default function TeamBuilder({ players }: TeamBuilderProps) {
  // Roster state: role -> player mapping
  const [roster, setRoster] = useState<Partial<Record<Role, PlayerProfile>>>({});

  // Budget and weight controls
  const [budget, setBudget] = useState(5_000_000);
  const [weights, setWeights] = useState<WeightConfig>(DEFAULT_WEIGHTS);

  // Player picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'free' | 'contracted'>('all');
  const [activeSlot, setActiveSlot] = useState<Role | null>(null);

  // Optimizer state
  const [optimizerResult, setOptimizerResult] = useState<string | null>(null);

  // Derived: set of player IDs in roster
  const rosterPlayerIds = useMemo(() => {
    return new Set(
      Object.values(roster)
        .filter((p): p is PlayerProfile => p !== undefined)
        .map((p) => p.id),
    );
  }, [roster]);

  // Derived: totals
  const totals = useMemo(() => {
    let totalSalary = 0;
    let totalBuyout = 0;
    for (const p of Object.values(roster)) {
      if (!p) continue;
      totalSalary += p.contract?.salary ?? 0;
      totalBuyout += p.contract?.buyout ?? 0;
    }
    return {
      salary: totalSalary,
      buyout: totalBuyout,
      combined: totalSalary + totalBuyout,
      totalCost: Object.values(roster).reduce(
        (sum, p) => sum + (p?.totalCost ?? 0),
        0,
      ),
    };
  }, [roster]);

  // Filtered player list for picker
  const filteredPlayers = useMemo(() => {
    let list = players;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.teamName?.toLowerCase().includes(q) ?? false) ||
          p.country.toLowerCase().includes(q),
      );
    }

    if (roleFilter !== 'all') {
      list = list.filter((p) => p.role === roleFilter);
    }

    if (statusFilter !== 'all') {
      list = list.filter((p) => {
        const isFreeAgent = isPlayerFreeAgent(p);
        return statusFilter === 'free' ? isFreeAgent : !isFreeAgent;
      });
    }

    return list;
  }, [players, searchQuery, roleFilter, statusFilter]);

  // Assign player to roster
  const assignPlayer = useCallback(
    (player: PlayerProfile) => {
      setRoster((prev) => {
        // If there's an active slot, assign to that slot
        if (activeSlot) {
          return { ...prev, [activeSlot]: player };
        }

        // If the player has a role and that slot is empty, assign there
        if (player.role && !prev[player.role]) {
          return { ...prev, [player.role]: player };
        }

        // Find first empty slot
        for (const role of ALL_ROLES) {
          if (!prev[role]) {
            return { ...prev, [role]: player };
          }
        }

        return prev; // No empty slots
      });
      setActiveSlot(null);
    },
    [activeSlot],
  );

  // Remove player from roster
  const removePlayer = useCallback((role: Role) => {
    setRoster((prev) => {
      const next = { ...prev };
      delete next[role];
      return next;
    });
  }, []);

  // Handle slot click (empty slot)
  const handleSlotSelect = useCallback((role: Role) => {
    setActiveSlot((prev) => (prev === role ? null : role));
  }, []);

  // Auto-build: run optimizer
  const handleAutoBuild = useCallback(() => {
    // Build locked slots from current roster
    const lockedSlots: Partial<Record<Role, number>> = {};
    for (const [role, player] of Object.entries(roster) as Array<[Role, PlayerProfile]>) {
      if (player) {
        lockedSlots[role] = player.id;
      }
    }

    const result = optimizeRoster({
      budget,
      weights,
      players,
      lockedSlots: Object.keys(lockedSlots).length > 0 ? lockedSlots : undefined,
    });

    if (result) {
      setRoster(result.roster);
      setOptimizerResult(
        `Found roster: ${formatCurrency(result.totalCost)} total cost, ${result.totalScore.toFixed(2)} combined score`,
      );
    } else {
      setOptimizerResult('No valid roster found within budget. Try increasing the budget.');
    }
  }, [budget, weights, players, roster]);

  // Clear roster
  const handleClear = useCallback(() => {
    setRoster({});
    setOptimizerResult(null);
  }, []);

  // Update a single weight
  const updateWeight = useCallback((key: keyof WeightConfig, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isOverBudget = totals.totalCost > budget;

  return (
    <div className="space-y-8">
      {/* Roster Display */}
      <section>
        <h2 className="text-xl font-bold mb-4 text-[var(--color-text-primary)]">Roster</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {ALL_ROLES.map((role) => (
            <RosterCard
              key={role}
              role={role}
              player={roster[role]}
              onRemove={() => removePlayer(role)}
              onSelect={() => handleSlotSelect(role)}
              isHighlighted={activeSlot === role}
            />
          ))}
        </div>

        {/* Running totals */}
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-secondary)]">Salary/mo:</span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(totals.salary)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-secondary)]">Buyout total:</span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(totals.buyout)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-secondary)]">Total cost:</span>
            <span
              className={`font-bold ${isOverBudget ? 'text-red-400' : 'text-green-400'}`}
            >
              {formatCurrency(totals.totalCost)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-secondary)]">Budget:</span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(budget)}
            </span>
          </div>
          {isOverBudget && (
            <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">
              Over budget by {formatCurrency(totals.totalCost - budget)}
            </span>
          )}
        </div>
      </section>

      {/* Player Picker */}
      <section>
        <h2 className="text-xl font-bold mb-4 text-[var(--color-text-primary)]">
          Player Picker
          {activeSlot && (
            <span className="text-sm font-normal text-[var(--color-accent)] ml-2">
              -- Assigning to {activeSlot}
            </span>
          )}
        </h2>

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="Search players..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="
              bg-[var(--color-bg-secondary)] border border-[var(--color-border)]
              rounded px-3 py-2 text-sm text-[var(--color-text-primary)]
              placeholder:text-[var(--color-text-secondary)]
              focus:outline-none focus:border-[var(--color-accent)]
              flex-1 min-w-[200px]
            "
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
            className="
              bg-[var(--color-bg-secondary)] border border-[var(--color-border)]
              rounded px-3 py-2 text-sm text-[var(--color-text-primary)]
              focus:outline-none focus:border-[var(--color-accent)]
            "
          >
            <option value="all">All Roles</option>
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'free' | 'contracted')}
            className="
              bg-[var(--color-bg-secondary)] border border-[var(--color-border)]
              rounded px-3 py-2 text-sm text-[var(--color-text-primary)]
              focus:outline-none focus:border-[var(--color-accent)]
            "
          >
            <option value="all">All Status</option>
            <option value="free">Free Agents</option>
            <option value="contracted">Under Contract</option>
          </select>
        </div>

        {/* Player list */}
        <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg overflow-hidden max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-bg-tertiary,#252540)]">
              <tr className="text-left text-xs text-[var(--color-text-secondary)] uppercase tracking-wider">
                <th className="px-4 py-2">Player</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Rating</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((player) => {
                const inRoster = rosterPlayerIds.has(player.id);
                const score = scorePlayer(player, weights);
                const freeAgent = isPlayerFreeAgent(player);
                return (
                  <tr
                    key={player.id}
                    onClick={() => !inRoster && assignPlayer(player)}
                    className={`
                      border-t border-[var(--color-border)] transition-colors
                      ${inRoster
                        ? 'opacity-40 cursor-not-allowed'
                        : 'cursor-pointer hover:bg-[var(--color-accent)]/5'
                      }
                    `}
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {player.name}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {player.country}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {player.teamName ?? '--'}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-[var(--color-accent)] text-xs font-semibold">
                        {player.role ?? '--'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {freeAgent ? (
                        <span className="text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
                          Free Agent
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          Until {player.contract?.contractEnd?.slice(0, 7) ?? '?'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`font-semibold ${
                          player.stats.rating >= 1.2
                            ? 'text-green-400'
                            : player.stats.rating >= 1.0
                              ? 'text-[var(--color-text-primary)]'
                              : 'text-red-400'
                        }`}
                      >
                        {player.stats.rating.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {freeAgent ? (
                        <span className="text-green-400">{formatCurrency(player.totalCost)}</span>
                      ) : (
                        <span>
                          {formatCurrency(player.totalCost)}
                          {player.contract?.buyout ? (
                            <span className="text-xs text-yellow-400 ml-1">(buyout)</span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-primary)] font-mono">
                      {score.toFixed(3)}
                    </td>
                  </tr>
                );
              })}
              {filteredPlayers.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-[var(--color-text-secondary)]"
                  >
                    No players found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Budget Optimizer */}
      <section className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4 text-[var(--color-text-primary)]">
          Budget Optimizer
        </h2>

        {/* Budget slider */}
        <div className="mb-6">
          <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
            Budget: {formatCurrency(budget)}
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={10_000_000}
              step={100_000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="flex-1 accent-[var(--color-accent)] h-2"
            />
            <input
              type="number"
              min={0}
              max={10_000_000}
              step={100_000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="
                w-32 bg-[var(--color-bg-primary)] border border-[var(--color-border)]
                rounded px-3 py-1 text-sm text-[var(--color-text-primary)]
                focus:outline-none focus:border-[var(--color-accent)]
              "
            />
          </div>
        </div>

        {/* Weight sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {(
            [
              ['rating', 'Rating'],
              ['kd', 'K/D'],
              ['adr', 'ADR'],
              ['kast', 'KAST'],
              ['impact', 'Impact'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">
                {label}: {weights[key]}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={weights[key]}
                onChange={(e) => updateWeight(key, Number(e.target.value))}
                className="w-full accent-[var(--color-accent)] h-1.5"
              />
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleAutoBuild}
            className="
              bg-[var(--color-accent)] text-[var(--color-bg-primary)]
              font-semibold px-6 py-2 rounded
              hover:brightness-110 transition-all
              text-sm
            "
          >
            Auto-Build
          </button>
          <button
            onClick={handleClear}
            className="
              bg-transparent border border-[var(--color-border)]
              text-[var(--color-text-secondary)] font-semibold px-6 py-2 rounded
              hover:border-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
              transition-all text-sm
            "
          >
            Clear Roster
          </button>
        </div>

        {/* Optimizer result message */}
        {optimizerResult && (
          <div
            className={`mt-4 text-sm px-4 py-2 rounded ${
              optimizerResult.startsWith('No valid')
                ? 'bg-red-400/10 text-red-400'
                : 'bg-green-400/10 text-green-400'
            }`}
          >
            {optimizerResult}
          </div>
        )}
      </section>
    </div>
  );
}
