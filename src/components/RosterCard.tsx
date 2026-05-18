import type { Role, PlayerProfile } from '../types';

interface RosterCardProps {
  role: Role;
  player?: PlayerProfile;
  onRemove?: () => void;
  onSelect?: () => void;
  isHighlighted?: boolean;
}

const roleLabels: Record<Role, string> = {
  IGL: 'IGL',
  AWPer: 'AWPer',
  Entry: 'Entry',
  Support: 'Support',
  Lurker: 'Lurker',
};

const roleIcons: Record<Role, string> = {
  IGL: '\u{1F9E0}', // brain
  AWPer: '\u{1F3AF}', // target
  Entry: '\u26A1', // lightning
  Support: '\u{1F6E1}', // shield
  Lurker: '\u{1F441}', // eye
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value}`;
}

function isFreeAgent(player: PlayerProfile): boolean {
  if (!player.contract?.contractEnd) return true;
  return new Date(player.contract.contractEnd) <= new Date();
}

function confidenceBadge(confidence?: string): string {
  switch (confidence) {
    case 'confirmed':
      return 'text-green-400';
    case 'rumored':
      return 'text-yellow-400';
    case 'estimated':
      return 'text-orange-400';
    default:
      return 'text-[var(--color-text-secondary)]';
  }
}

export default function RosterCard({
  role,
  player,
  onRemove,
  onSelect,
  isHighlighted = false,
}: RosterCardProps) {
  if (!player) {
    return (
      <button
        onClick={onSelect}
        className={`
          flex flex-col items-center justify-center
          w-full min-h-[200px] rounded-lg p-4
          border-2 border-dashed
          transition-all cursor-pointer
          ${isHighlighted
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
            : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]'
          }
          hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5
        `}
      >
        <span className="text-2xl mb-2">{roleIcons[role]}</span>
        <span className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
          {roleLabels[role]}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">Click to assign</span>
      </button>
    );
  }

  return (
    <div
      className={`
        relative flex flex-col rounded-lg p-4
        border transition-all
        ${isHighlighted
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
          : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]'
        }
        w-full min-h-[200px]
      `}
    >
      {/* Role label */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{roleIcons[role]}</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            {roleLabels[role]}
          </span>
        </div>
        <button
          onClick={onRemove}
          className="
            w-6 h-6 flex items-center justify-center rounded
            text-[var(--color-text-secondary)] hover:text-red-400
            hover:bg-red-400/10 transition-colors text-sm leading-none
          "
          title="Remove player"
        >
          x
        </button>
      </div>

      {/* Player info */}
      <div className="flex-1">
        <div className="font-bold text-[var(--color-text-primary)] text-base mb-0.5">
          {player.name}
        </div>
        <div className="text-xs text-[var(--color-text-secondary)] mb-2">
          {player.country} {player.teamName ? `-- ${player.teamName}` : ''}
        </div>

        {/* Rating badge */}
        <div className="inline-flex items-center gap-1 bg-[var(--color-bg-tertiary,#252540)] rounded px-2 py-0.5 mb-3">
          <span className="text-xs text-[var(--color-text-secondary)]">Rating</span>
          <span className={`text-sm font-bold ${
            player.stats.rating >= 1.2 ? 'text-green-400' :
            player.stats.rating >= 1.0 ? 'text-[var(--color-text-primary)]' :
            'text-red-400'
          }`}>
            {player.stats.rating.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Status + Financial info */}
      <div className="border-t border-[var(--color-border)] pt-2 mt-auto space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--color-text-secondary)]">Status</span>
          {isFreeAgent(player) ? (
            <span className="text-green-400 font-semibold">Free Agent</span>
          ) : (
            <span className="text-yellow-400">
              Until {player.contract?.contractEnd?.slice(0, 7) ?? '?'}
            </span>
          )}
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[var(--color-text-secondary)]">Salary/mo</span>
          <span className="text-[var(--color-text-primary)]">
            {player.contract?.salary ? formatCurrency(player.contract.salary) : 'N/A'}
          </span>
        </div>
        {!isFreeAgent(player) && (
          <div className="flex justify-between text-xs">
            <span className="text-[var(--color-text-secondary)]">Buyout</span>
            <span className="text-yellow-400">
              {player.contract?.buyout ? formatCurrency(player.contract.buyout) : 'N/A'}
            </span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-[var(--color-text-secondary)]">Total cost</span>
          <span className={`font-semibold ${isFreeAgent(player) ? 'text-green-400' : 'text-[var(--color-text-primary)]'}`}>
            {formatCurrency(player.totalCost)}
          </span>
        </div>
        {player.contract && (
          <div className="flex justify-between text-xs">
            <span className="text-[var(--color-text-secondary)]">Confidence</span>
            <span className={confidenceBadge(player.contract.confidence)}>
              {player.contract.confidence}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
