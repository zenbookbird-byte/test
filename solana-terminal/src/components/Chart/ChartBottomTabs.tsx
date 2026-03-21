import { useState } from 'react';
import { Users, BarChart2, Activity, ShieldAlert, Code2 } from 'lucide-react';
import clsx from 'clsx';
import type { TokenPair } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'positions' | 'orders' | 'holders' | 'top-traders' | 'dev-tokens';

interface TabDef {
  id: TabId;
  label: string;
  count?: number;
  icon: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_HOLDERS = [
  { rank: 1, wallet: '7xKq...3mPw', amount: '124,500,000', pct: '12.45%', value: '$14,200', type: 'Whale'   },
  { rank: 2, wallet: 'AzBn...9cLr', amount: '98,300,000',  pct: '9.83%',  value: '$11,250', type: 'Insider' },
  { rank: 3, wallet: 'FtRp...2dWx', amount: '72,100,000',  pct: '7.21%',  value: '$8,740',  type: 'Sniper'  },
  { rank: 4, wallet: 'GmVs...8hNk', amount: '51,400,000',  pct: '5.14%',  value: '$6,130',  type: 'Holder'  },
  { rank: 5, wallet: 'HjYu...4bQf', amount: '34,700,000',  pct: '3.47%',  value: '$4,200',  type: 'Holder'  },
];

const MOCK_TOP_TRADERS = [
  { rank: 1, wallet: '9pLm...5vZc', bought: '$48,200', sold: '$142,800', pnl: '+$94,600', winPct: '88%' },
  { rank: 2, wallet: 'BwKt...1nRj', bought: '$22,100', sold: '$58,900',  pnl: '+$36,800', winPct: '76%' },
  { rank: 3, wallet: 'CrXs...7oMu', bought: '$15,400', sold: '$34,200',  pnl: '+$18,800', winPct: '71%' },
  { rank: 4, wallet: 'DqVh...3pFy', bought: '$31,000', sold: '$44,500',  pnl: '+$13,500', winPct: '65%' },
  { rank: 5, wallet: 'EvNa...6kGb', bought: '$9,800',  sold: '$19,300',  pnl: '+$9,500',  winPct: '60%' },
];

const MOCK_DEV_TOKENS = [
  { token: 'FROGAI',  symbol: 'FROGAI', created: '14d ago', mcap: '$2.1M', status: 'Active' as const  },
  { token: 'MOONCAT', symbol: 'MNCT',   created: '31d ago', mcap: '$0',    status: 'Rugged' as const  },
  { token: 'SOLPIG',  symbol: 'SPIG',   created: '45d ago', mcap: '$12K',  status: 'Dead'   as const  },
  { token: 'PEPESOL', symbol: 'PSOL',   created: '62d ago', mcap: '$0',    status: 'Rugged' as const  },
  { token: 'WIFHAT2', symbol: 'WIF2',   created: '78d ago', mcap: '$88K',  status: 'Dead'   as const  },
];

const STATUS_COLORS: Record<'Active' | 'Rugged' | 'Dead', string> = {
  Active: 'bg-green-900/50 text-green-400 border border-green-700/50',
  Rugged: 'bg-red-900/50 text-red-400 border border-red-700/50',
  Dead:   'bg-gray-800 text-gray-400 border border-gray-700/50',
};

const HOLDER_TYPE_COLORS: Record<string, string> = {
  Whale:   'text-blue-400',
  Insider: 'text-yellow-400',
  Sniper:  'text-orange-400',
  Holder:  'text-text-muted',
};

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function PositionsPanel() {
  return (
    <div className="flex flex-col h-full">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ax-border">
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Token</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Bought</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Sold</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Remaining</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">PnL</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
      </table>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-text-muted">Connect wallet to view positions</p>
      </div>
    </div>
  );
}

function OrdersPanel() {
  return (
    <div className="flex flex-col h-full">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ax-border">
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Token</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Type</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Price</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Amount</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Status</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
      </table>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-text-muted">No pending orders</p>
      </div>
    </div>
  );
}

type HolderFilter = 'all' | 'top10' | 'insiders' | 'snipers' | 'dev';

function HoldersPanel() {
  const [filter, setFilter] = useState<HolderFilter>('all');

  const filters: { id: HolderFilter; label: string }[] = [
    { id: 'all',      label: 'All'      },
    { id: 'top10',    label: 'Top10'    },
    { id: 'insiders', label: 'Insiders' },
    { id: 'snipers',  label: 'Snipers'  },
    { id: 'dev',      label: 'Dev'      },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filter pills */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-ax-border shrink-0">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              'px-2 py-0.5 rounded text-2xs font-medium transition-colors border',
              filter === f.id
                ? 'bg-green-900/50 text-green-400 border-green-700/50'
                : 'text-text-muted hover:text-text-secondary hover:bg-ax-hover border-transparent'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ax-panel z-10">
            <tr className="border-b border-ax-border">
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium w-8">#</th>
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Wallet</th>
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Amount</th>
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">% Supply</th>
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Value</th>
              <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_HOLDERS.map((row) => (
              <tr
                key={row.rank}
                className="border-b border-ax-border/50 hover:bg-ax-hover transition-colors"
              >
                <td className="px-3 py-2 text-text-muted font-mono">{row.rank}</td>
                <td className="px-3 py-2 font-mono text-text-secondary">{row.wallet}</td>
                <td className="px-3 py-2 text-text-primary font-mono">{row.amount}</td>
                <td className="px-3 py-2 text-text-secondary">{row.pct}</td>
                <td className="px-3 py-2 text-text-secondary">{row.value}</td>
                <td className="px-3 py-2">
                  <span className={clsx('font-medium', HOLDER_TYPE_COLORS[row.type] ?? 'text-text-muted')}>
                    {row.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopTradersPanel() {
  return (
    <div className="overflow-y-auto h-full">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-ax-panel z-10">
          <tr className="border-b border-ax-border">
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium w-10">Rank</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Wallet</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Bought</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Sold</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">PnL</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Win%</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_TOP_TRADERS.map((row) => (
            <tr
              key={row.rank}
              className="border-b border-ax-border/50 hover:bg-ax-hover transition-colors"
            >
              <td className="px-3 py-2 text-text-muted font-mono">{row.rank}</td>
              <td className="px-3 py-2 font-mono text-text-secondary">{row.wallet}</td>
              <td className="px-3 py-2 text-text-secondary">{row.bought}</td>
              <td className="px-3 py-2 text-text-secondary">{row.sold}</td>
              <td className="px-3 py-2 font-semibold text-green-400">{row.pnl}</td>
              <td className="px-3 py-2 text-text-secondary">{row.winPct}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevTokensPanel({ pair }: { pair: TokenPair | null }) {
  void pair; // available for future use (e.g., fetch by deployer address)

  return (
    <div className="overflow-y-auto h-full">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-ax-panel z-10">
          <tr className="border-b border-ax-border">
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Token</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Created</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">MCap</th>
            <th className="text-left text-2xs text-text-muted px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_DEV_TOKENS.map((row) => (
            <tr
              key={row.token}
              className="border-b border-ax-border/50 hover:bg-ax-hover transition-colors"
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-ax-hover border border-ax-border flex items-center justify-center text-2xs font-bold text-text-muted">
                    {row.symbol[0]}
                  </div>
                  <span className="text-text-primary font-medium">{row.token}</span>
                  <span className="text-text-muted">{row.symbol}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-text-muted">{row.created}</td>
              <td className="px-3 py-2 text-text-secondary font-mono">{row.mcap}</td>
              <td className="px-3 py-2">
                <span className={clsx('px-1.5 py-0.5 rounded text-2xs font-semibold', STATUS_COLORS[row.status])}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChartBottomTabs({ pair }: { pair: TokenPair | null }) {
  const [activeTab, setActiveTab] = useState<TabId>('holders');

  const tabs: TabDef[] = [
    { id: 'positions',   label: 'Positions',   icon: <BarChart2 size={11} />  },
    { id: 'orders',      label: 'Orders',      icon: <Activity size={11} />   },
    { id: 'holders',     label: 'Holders',     count: 254, icon: <Users size={11} />      },
    { id: 'top-traders', label: 'Top Traders', icon: <ShieldAlert size={11} /> },
    { id: 'dev-tokens',  label: 'Dev Tokens',  count: 531, icon: <Code2 size={11} />      },
  ];

  const pillButtons = ['Show Hidden', 'Instant Trade', 'Trades Table', 'USD'];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-ax-border px-3 shrink-0">
        <div className="flex items-center flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'px-3 py-2 text-xs border-b-2 font-medium transition-colors flex items-center gap-1 whitespace-nowrap',
                activeTab === tab.id
                  ? 'text-green-DEFAULT border-green-DEFAULT'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={clsx(
                    'ml-0.5 px-1 rounded text-2xs font-mono',
                    activeTab === tab.id ? 'text-green-DEFAULT/70' : 'text-text-muted'
                  )}
                >
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right-side pill buttons */}
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {pillButtons.map((label) => (
            <button
              key={label}
              className="px-2 py-0.5 rounded border border-ax-border text-2xs text-text-muted hover:text-text-secondary hover:bg-ax-hover transition-colors whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'positions'   && <PositionsPanel />}
        {activeTab === 'orders'      && <OrdersPanel />}
        {activeTab === 'holders'     && <HoldersPanel />}
        {activeTab === 'top-traders' && <TopTradersPanel />}
        {activeTab === 'dev-tokens'  && <DevTokensPanel pair={pair} />}
      </div>
    </div>
  );
}
