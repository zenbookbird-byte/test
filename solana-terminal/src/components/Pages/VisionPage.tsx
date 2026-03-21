import React, { useState } from 'react';
import clsx from 'clsx';
import {
  Eye,
  TrendingUp,
  Users,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Crown,
  Activity,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Narrative {
  id: string;
  name: string;
  change: string;
  positive: boolean;
  tokenCount: number;
  color: string;
}

interface TopWallet {
  rank: number;
  address: string;
  pnl: string;
  pnlPositive: boolean;
  winRate: string;
  trades: number;
}

interface WhaleTransaction {
  id: string;
  type: 'buy' | 'sell';
  amount: string;
  token: string;
  timeAgo: string;
  wallet: string;
}

// ── Static data ──────────────────────────────────────────────────────────────

const narratives: Narrative[] = [
  { id: 'ai-agents', name: 'AI Agents', change: '+42.3%', positive: true, tokenCount: 28, color: 'bg-blue-500' },
  { id: 'depin', name: 'DePIN', change: '+18.7%', positive: true, tokenCount: 14, color: 'bg-purple-500' },
  { id: 'memecoins', name: 'Memecoins', change: '+31.2%', positive: true, tokenCount: 156, color: 'bg-green-500' },
  { id: 'rwa', name: 'RWA', change: '+9.4%', positive: true, tokenCount: 8, color: 'bg-yellow-500' },
  { id: 'gamefi', name: 'GameFi', change: '+22.1%', positive: true, tokenCount: 19, color: 'bg-orange-500' },
];

const topWallets: TopWallet[] = [
  { rank: 1, address: '3a4Kx...f21b', pnl: '+$24.2K', pnlPositive: true, winRate: '89%', trades: 87 },
  { rank: 2, address: '7cB2e...94aD', pnl: '+$18.7K', pnlPositive: true, winRate: '81%', trades: 63 },
  { rank: 3, address: 'Fd91c...3e0F', pnl: '+$11.3K', pnlPositive: true, winRate: '74%', trades: 41 },
  { rank: 4, address: '2aE7b...c55A', pnl: '-$3.1K',  pnlPositive: false, winRate: '65%', trades: 29 },
  { rank: 5, address: '9dF4a...88bC', pnl: '+$7.9K',  pnlPositive: true, winRate: '71%', trades: 12 },
];

const whaleTransactions: WhaleTransaction[] = [
  { id: 'w1', type: 'buy',  amount: '4,200 SOL', token: '$BONK',  timeAgo: '2m ago',  wallet: 'A1b2...C3d4' },
  { id: 'w2', type: 'sell', amount: '1,850 SOL', token: '$WIF',   timeAgo: '7m ago',  wallet: 'E5f6...G7h8' },
  { id: 'w3', type: 'buy',  amount: '9,100 SOL', token: '$JTO',   timeAgo: '14m ago', wallet: 'I9j0...K1l2' },
  { id: 'w4', type: 'sell', amount: '650 SOL',   token: '$POPCAT', timeAgo: '31m ago', wallet: 'M3n4...O5p6' },
  { id: 'w5', type: 'buy',  amount: '2,375 SOL', token: '$RAY',   timeAgo: '58m ago', wallet: 'Q7r8...S9t0' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="ax-card panel flex-1 min-w-[160px] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-secondary">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-primary">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function NarrativeCard({
  narrative,
  selected,
  onClick,
}: {
  narrative: Narrative;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'ax-card panel flex flex-col gap-3 p-4 text-left transition-all duration-150 cursor-pointer',
        selected && 'ring-2 ring-[#16c784]',
      )}
    >
      <div className="flex items-center gap-3">
        <span className={clsx('w-3 h-3 rounded-full flex-shrink-0', narrative.color)} />
        <span className="text-sm font-semibold text-primary">{narrative.name}</span>
      </div>
      <div className="flex items-center justify-between">
        <span
          className={clsx(
            'text-lg font-bold',
            narrative.positive ? 'pos' : 'neg',
          )}
        >
          {narrative.change}
        </span>
        <span className="badge text-xs">{narrative.tokenCount} tokens</span>
      </div>
    </button>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown size={16} className="text-yellow-400" />;
  if (rank === 2) return <span className="text-secondary font-bold text-sm">2</span>;
  if (rank === 3) return <span className="text-orange-400 font-bold text-sm">3</span>;
  return <span className="text-muted text-sm">{rank}</span>;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function VisionPage() {
  const [selectedNarrative, setSelectedNarrative] = useState<string | null>(null);

  const handleNarrativeClick = (id: string) => {
    setSelectedNarrative((prev) => (prev === id ? null : id));
  };

  return (
    <div className="bg-ax-base min-h-screen overflow-y-auto p-4 flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg ax-panel">
          <Eye size={20} className="text-[#16c784]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-primary">Vision — Market Intelligence</h1>
          <p className="text-sm text-muted">Real-time on-chain analytics and narrative tracking for Solana</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="flex flex-wrap gap-4">
        <StatCard
          icon={Activity}
          label="Total On-Chain Volume"
          value="$2.4B"
          sub="Last 24 hours"
        />
        <StatCard
          icon={Users}
          label="Active Traders"
          value="142K"
          sub="Unique wallets today"
        />
        <StatCard
          icon={Zap}
          label="New Tokens 24h"
          value="3.8K"
          sub="Newly deployed"
        />
      </div>

      {/* ── Trending Narratives ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Trending Narratives
          </h2>
          {selectedNarrative && (
            <span className="badge badge-green ml-auto text-xs">
              {narratives.find((n) => n.id === selectedNarrative)?.name} selected
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {narratives.map((n) => (
            <NarrativeCard
              key={n.id}
              narrative={n}
              selected={selectedNarrative === n.id}
              onClick={() => handleNarrativeClick(n.id)}
            />
          ))}
        </div>
      </section>

      {/* ── Top Wallets Leaderboard ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Crown size={16} className="text-yellow-400" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Top Wallets This Week
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="ax-border border-b text-left">
                <th className="pb-2 pr-4 text-xs text-muted font-medium">Rank</th>
                <th className="pb-2 pr-4 text-xs text-muted font-medium">Wallet</th>
                <th className="pb-2 pr-4 text-xs text-muted font-medium text-right">PnL</th>
                <th className="pb-2 pr-4 text-xs text-muted font-medium text-right">Win Rate</th>
                <th className="pb-2 text-xs text-muted font-medium text-right">Trades</th>
              </tr>
            </thead>
            <tbody>
              {topWallets.map((w) => (
                <tr
                  key={w.rank}
                  className="ax-border border-b last:border-0 hover:bg-ax-card transition-colors"
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center justify-center w-6">
                      <RankBadge rank={w.rank} />
                    </div>
                  </td>
                  <td className="py-3 pr-4 font-mono text-secondary">{w.address}</td>
                  <td className={clsx('py-3 pr-4 text-right font-semibold', w.pnlPositive ? 'pos' : 'neg')}>
                    {w.pnl}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <span className="badge badge-green">{w.winRate}</span>
                  </td>
                  <td className="py-3 text-right text-secondary">{w.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Whale Activity ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Whale Activity
          </h2>
          <span className="badge badge-green ml-auto text-xs animate-pulse">Live</span>
        </div>
        <div className="flex flex-col gap-2">
          {whaleTransactions.map((tx) => (
            <div
              key={tx.id}
              className="ax-card flex items-center gap-3 p-3 rounded-lg"
            >
              <div
                className={clsx(
                  'p-1.5 rounded-md flex-shrink-0',
                  tx.type === 'buy' ? 'bg-green-500/10' : 'bg-red-500/10',
                )}
              >
                {tx.type === 'buy' ? (
                  <ArrowUpRight size={14} className="pos" />
                ) : (
                  <ArrowDownRight size={14} className="neg" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'text-xs font-semibold uppercase tracking-wide',
                      tx.type === 'buy' ? 'pos' : 'neg',
                    )}
                  >
                    {tx.type}
                  </span>
                  <span className="text-sm font-bold text-primary">{tx.token}</span>
                </div>
                <p className="text-xs text-muted font-mono truncate">{tx.wallet}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-primary">{tx.amount}</p>
                <p className="text-xs text-muted">{tx.timeAgo}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
