import { useState, useMemo, useCallback } from 'react';
import type { PlayerProfile, Role } from '../types';

// -- Country flag emoji lookup (ISO 3166-1 alpha-2 to emoji) --

function countryToFlag(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return countryCode;
  const offset = 0x1f1e6;
  const a = code.charCodeAt(0) - 65;
  const b = code.charCodeAt(1) - 65;
  return String.fromCodePoint(offset + a) + String.fromCodePoint(offset + b);
}

// -- Formatting helpers --

function formatMoney(value: number | undefined, suffix = ''): string {
  if (value == null || value === 0) return '-';
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}m${suffix}`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k${suffix}`;
  }
  return `$${value}${suffix}`;
}

function formatSalary(value: number | undefined): string {
  return formatMoney(value, '/mo');
}

function formatBuyout(value: number | undefined): string {
  return formatMoney(value);
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// -- Contract status helpers --

function isExpiringSoon(contractEnd: string | undefined): boolean {
  if (!contractEnd) return false;
  const end = new Date(contractEnd);
  const now = new Date();
  const threeMonths = new Date(now);
  threeMonths.setMonth(threeMonths.getMonth() + 3);
  return end > now && end <= threeMonths;
}

function isFreeAgent(contractEnd: string | undefined): boolean {
  if (!contractEnd) return true;
  return new Date(contractEnd) <= new Date();
}

// -- Sort types --

type SortKey =
  | 'name'
  | 'teamName'
  | 'role'
  | 'rating'
  | 'kd'
  | 'adr'
  | 'kast'
  | 'headshot'
  | 'mapsPlayed'
  | 'contractEnd'
  | 'buyout'
  | 'salary';

type SortDir = 'asc' | 'desc';

function getSortValue(player: PlayerProfile, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return player.name.toLowerCase();
    case 'teamName':
      return (player.teamName ?? '').toLowerCase();
    case 'role':
      return (player.role ?? '').toLowerCase();
    case 'rating':
      return player.stats.rating;
    case 'kd':
      return player.stats.kd;
    case 'adr':
      return player.stats.adr;
    case 'kast':
      return player.stats.kast;
    case 'headshot':
      return player.stats.headshot;
    case 'mapsPlayed':
      return player.stats.mapsPlayed;
    case 'contractEnd':
      return player.contract?.contractEnd ?? '';
    case 'buyout':
      return player.contract?.buyout ?? 0;
    case 'salary':
      return player.contract?.salary ?? 0;
  }
}

// -- Column config --

interface ColumnDef {
  key: SortKey;
  label: string;
  mono?: boolean;
  render: (p: PlayerProfile) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'name',
    label: 'Player',
    render: (p) => (
      <span>
        <span className="mr-1">{countryToFlag(p.country)}</span>
        {p.name}
      </span>
    ),
  },
  {
    key: 'teamName',
    label: 'Team',
    render: (p) => p.teamName ?? '-',
  },
  {
    key: 'role',
    label: 'Role',
    render: (p) => p.role ?? '-',
  },
  {
    key: 'rating',
    label: 'Rating',
    mono: true,
    render: (p) => p.stats.rating.toFixed(2),
  },
  {
    key: 'kd',
    label: 'K/D',
    mono: true,
    render: (p) => p.stats.kd.toFixed(2),
  },
  {
    key: 'adr',
    label: 'ADR',
    mono: true,
    render: (p) => p.stats.adr.toFixed(1),
  },
  {
    key: 'kast',
    label: 'KAST%',
    mono: true,
    render: (p) => `${p.stats.kast.toFixed(1)}%`,
  },
  {
    key: 'headshot',
    label: 'HS%',
    mono: true,
    render: (p) => `${p.stats.headshot.toFixed(1)}%`,
  },
  {
    key: 'mapsPlayed',
    label: 'Maps',
    mono: true,
    render: (p) => p.stats.mapsPlayed,
  },
  {
    key: 'contractEnd',
    label: 'Contract',
    render: (p) => formatDate(p.contract?.contractEnd),
  },
  {
    key: 'buyout',
    label: 'Buyout',
    mono: true,
    render: (p) => formatBuyout(p.contract?.buyout),
  },
  {
    key: 'salary',
    label: 'Salary',
    mono: true,
    render: (p) => formatSalary(p.contract?.salary),
  },
];

// -- Roles list --

const ALL_ROLES: Role[] = ['IGL', 'AWPer', 'Entry', 'Support', 'Lurker'];

// -- Status filter --

type StatusFilter = 'all' | 'free-agent' | 'under-contract';

// -- Component --

interface BigBoardProps {
  players: PlayerProfile[];
}

export default function BigBoard({ players }: BigBoardProps) {
  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('rating');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Filter state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set());
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Dropdown open state
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);

  // Debounce search
  const debounceTimer = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 200);
    },
    [debounceTimer],
  );

  // Extract unique values for filters
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      if (p.teamName) set.add(p.teamName);
    }
    return Array.from(set).sort();
  }, [players]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      if (p.country) set.add(p.country);
    }
    return Array.from(set).sort();
  }, [players]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = players;

    // Search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }

    // Team filter
    if (selectedTeams.size > 0) {
      result = result.filter((p) => p.teamName && selectedTeams.has(p.teamName));
    }

    // Role filter
    if (selectedRoles.size > 0) {
      result = result.filter((p) => p.role && selectedRoles.has(p.role));
    }

    // Country filter
    if (selectedCountries.size > 0) {
      result = result.filter((p) => selectedCountries.has(p.country));
    }

    // Status filter
    if (statusFilter === 'free-agent') {
      result = result.filter((p) => isFreeAgent(p.contract?.contractEnd));
    } else if (statusFilter === 'under-contract') {
      result = result.filter((p) => !isFreeAgent(p.contract?.contractEnd));
    }

    // Sort
    result = [...result].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [players, debouncedSearch, selectedTeams, selectedRoles, selectedCountries, statusFilter, sortKey, sortDir]);

  // Sort handler
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'teamName' || key === 'role' ? 'asc' : 'desc');
    }
  };

  // Row highlight class
  const rowHighlight = (p: PlayerProfile): string => {
    if (isFreeAgent(p.contract?.contractEnd)) return 'bg-green-900/20';
    if (isExpiringSoon(p.contract?.contractEnd)) return 'bg-yellow-900/20';
    return '';
  };

  // Toggle helpers for multi-select
  const toggleSet = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  // Empty state
  if (players.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-gray-400">
        <div className="text-center">
          <p className="text-xl mb-2">No player data available</p>
          <p className="text-sm">Run the HLTV scraper to populate player data.</p>
        </div>
      </div>
    );
  }

  const isFiltered =
    debouncedSearch || selectedTeams.size > 0 || selectedRoles.size > 0 || selectedCountries.size > 0 || statusFilter !== 'all';

  return (
    <div className="w-full">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <input
          type="text"
          placeholder="Search player..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="bg-[#1a1a2e] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#2CD4F5] w-48"
        />

        {/* Team dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setTeamDropdownOpen(!teamDropdownOpen); setCountryDropdownOpen(false); }}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 hover:border-[#2CD4F5] flex items-center gap-1"
          >
            Team{selectedTeams.size > 0 ? ` (${selectedTeams.size})` : ''}
            <span className="text-xs ml-1">&#9662;</span>
          </button>
          {teamDropdownOpen && (
            <div className="absolute z-50 mt-1 bg-[#1a1a2e] border border-gray-700 rounded shadow-lg max-h-60 overflow-y-auto w-48">
              <button
                type="button"
                onClick={() => setSelectedTeams(new Set())}
                className="w-full text-left px-3 py-1 text-xs text-[#2CD4F5] hover:bg-[#15152a]"
              >
                Clear all
              </button>
              {teams.map((team) => (
                <label key={team} className="flex items-center px-3 py-1 hover:bg-[#15152a] cursor-pointer text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedTeams.has(team)}
                    onChange={() => toggleSet(selectedTeams, team, setSelectedTeams)}
                    className="mr-2 accent-[#2CD4F5]"
                  />
                  {team}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Role filter */}
        <div className="flex items-center gap-1">
          {ALL_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggleSet(selectedRoles, role, setSelectedRoles)}
              className={`px-2 py-1 text-xs rounded border ${
                selectedRoles.has(role)
                  ? 'bg-[#2CD4F5]/20 border-[#2CD4F5] text-[#2CD4F5]'
                  : 'bg-[#1a1a2e] border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        {/* Country dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setCountryDropdownOpen(!countryDropdownOpen); setTeamDropdownOpen(false); }}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 hover:border-[#2CD4F5] flex items-center gap-1"
          >
            Country{selectedCountries.size > 0 ? ` (${selectedCountries.size})` : ''}
            <span className="text-xs ml-1">&#9662;</span>
          </button>
          {countryDropdownOpen && (
            <div className="absolute z-50 mt-1 bg-[#1a1a2e] border border-gray-700 rounded shadow-lg max-h-60 overflow-y-auto w-48">
              <button
                type="button"
                onClick={() => setSelectedCountries(new Set())}
                className="w-full text-left px-3 py-1 text-xs text-[#2CD4F5] hover:bg-[#15152a]"
              >
                Clear all
              </button>
              {countries.map((country) => (
                <label key={country} className="flex items-center px-3 py-1 hover:bg-[#15152a] cursor-pointer text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedCountries.has(country)}
                    onChange={() => toggleSet(selectedCountries, country, setSelectedCountries)}
                    className="mr-2 accent-[#2CD4F5]"
                  />
                  <span className="mr-1">{countryToFlag(country)}</span>
                  {country.toUpperCase()}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-[#1a1a2e] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#2CD4F5]"
        >
          <option value="all">All Players</option>
          <option value="free-agent">Free Agents</option>
          <option value="under-contract">Under Contract</option>
        </select>
      </div>

      {/* Player count */}
      <div className="text-sm text-gray-400 mb-2">
        {isFiltered ? `${filtered.length} of ${players.length} players shown` : `${players.length} players`}
      </div>

      {/* Table container with horizontal scroll */}
      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 z-10 bg-[#0f0f1a] border-b border-gray-700">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2 text-gray-400 font-medium cursor-pointer select-none hover:text-[#2CD4F5] whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-[#2CD4F5]">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-500">
                  No players match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((player, idx) => (
                <tr
                  key={player.id}
                  className={`border-b border-gray-800/50 hover:bg-[#2CD4F5]/5 transition-colors ${
                    rowHighlight(player) || (idx % 2 === 0 ? 'bg-[#1a1a2e]' : 'bg-[#15152a]')
                  }`}
                >
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 whitespace-nowrap text-gray-200 ${col.mono ? 'font-mono tabular-nums' : ''}`}
                    >
                      {col.render(player)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-green-900/40 border border-green-700/50" />
          Free agent
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-yellow-900/40 border border-yellow-700/50" />
          Contract expiring (&lt;3 months)
        </span>
      </div>
    </div>
  );
}
