import React, { useState } from 'react';
import clsx from 'clsx';
import {
  Gift,
  Crown,
  Star,
  Zap,
  Copy,
  Check,
  TrendingUp,
  Users,
  Trophy,
  Coins,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type TaskId = 'daily-trade' | 'volume-milestone' | 'refer-friend' | 'hold-7-days';

interface EarnTask {
  id: TaskId;
  icon: React.ElementType;
  name: string;
  description: string;
  points: number;
  initialDone?: boolean;
}

interface HistoryRow {
  id: string;
  date: string;
  action: string;
  points: number;
}

interface RedeemOption {
  id: string;
  icon: React.ElementType;
  name: string;
  description: string;
  cost: number;
}

// ── Static data ──────────────────────────────────────────────────────────────

const REFERRAL_LINK = 'https://flipit.gg/ref/sol_ace_9x7k';

const earnTasks: EarnTask[] = [
  {
    id: 'daily-trade',
    icon: Zap,
    name: 'Daily Trade',
    description: 'Execute any trade today',
    points: 50,
  },
  {
    id: 'volume-milestone',
    icon: TrendingUp,
    name: 'Volume Milestone',
    description: 'Trade $1,000+ in total volume',
    points: 200,
    initialDone: true,
  },
  {
    id: 'refer-friend',
    icon: Users,
    name: 'Refer a Friend',
    description: 'Share your referral link with a new user',
    points: 500,
  },
  {
    id: 'hold-7-days',
    icon: Star,
    name: 'Hold 7 Days',
    description: 'Hold any token for 7 consecutive days',
    points: 150,
  },
];

const historyRows: HistoryRow[] = [
  { id: 'h1', date: 'Mar 21, 2026', action: 'Volume Milestone',  points: 200 },
  { id: 'h2', date: 'Mar 20, 2026', action: 'Daily Trade',       points: 50  },
  { id: 'h3', date: 'Mar 20, 2026', action: 'Referral Bonus',    points: 500 },
  { id: 'h4', date: 'Mar 19, 2026', action: 'Daily Trade',       points: 50  },
  { id: 'h5', date: 'Mar 18, 2026', action: 'Hold 7 Days',       points: 150 },
];

const redeemOptions: RedeemOption[] = [
  {
    id: 'fee-discount',
    icon: Coins,
    name: 'Fee Discount 10%',
    description: 'Reduce trading fees by 10% for 30 days',
    cost: 1000,
  },
  {
    id: 'priority-access',
    icon: Trophy,
    name: 'Priority Access',
    description: 'Early access to new features and token launches',
    cost: 2500,
  },
  {
    id: 'exclusive-badge',
    icon: Crown,
    name: 'Exclusive Badge',
    description: 'Unlock a rare profile badge displayed on leaderboards',
    cost: 5000,
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="ax-card panel flex-1 min-w-[140px] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-secondary">
        <Icon size={16} className={accent ? 'text-[#16c784]' : undefined} />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className={clsx('text-2xl font-bold', accent ? 'pos' : 'text-primary')}>{value}</p>
    </div>
  );
}

function TaskCard({
  task,
  done,
  onClaim,
}: {
  task: EarnTask;
  done: boolean;
  onClaim: (id: TaskId) => void;
}) {
  const Icon = task.icon;
  return (
    <div className="ax-card panel p-4 flex items-center gap-4">
      <div
        className={clsx(
          'p-2.5 rounded-lg flex-shrink-0',
          done ? 'bg-green-500/10' : 'bg-ax-base',
        )}
      >
        <Icon size={18} className={done ? 'text-[#16c784]' : 'text-secondary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-primary">{task.name}</p>
        <p className="text-xs text-muted mt-0.5 truncate">{task.description}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="badge badge-yellow text-xs font-semibold">+{task.points} pts</span>
        {done ? (
          <div className="flex items-center gap-1 text-[#16c784] text-xs font-medium">
            <Check size={14} />
            <span>Done</span>
          </div>
        ) : (
          <button
            onClick={() => onClaim(task.id)}
            className="px-3 py-1.5 rounded-md bg-[#16c784] hover:bg-[#12a86e] text-black text-xs font-semibold transition-colors"
          >
            Claim
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RewardsPage() {
  // Track which tasks the user has claimed (pre-populate with initially-done tasks)
  const [claimedTasks, setClaimedTasks] = useState<Set<TaskId>>(() => {
    const initial = new Set<TaskId>();
    earnTasks.forEach((t) => {
      if (t.initialDone) initial.add(t.id);
    });
    return initial;
  });

  const [copied, setCopied] = useState(false);

  const handleClaim = (id: TaskId) => {
    setClaimedTasks((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(REFERRAL_LINK).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-ax-base min-h-screen overflow-y-auto p-4 flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg ax-panel">
            <Gift size={20} className="text-[#16c784]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-primary">Rewards</h1>
            <p className="text-sm text-muted">Earn points, climb the ranks, and unlock perks</p>
          </div>
        </div>
        {/* Level badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full ax-panel border ax-border">
          <Crown size={14} className="text-yellow-400" />
          <span className="text-xs font-semibold text-primary">Diamond Trader</span>
        </div>
      </div>

      {/* ── Points summary ── */}
      <div className="flex flex-wrap gap-4">
        <StatCard icon={Star}       label="Total Points" value="12,450" />
        <StatCard icon={TrendingUp} label="This Week"    value="+840"   accent />
        <StatCard icon={Trophy}     label="Rank"         value="#1,337" />
      </div>

      {/* ── Level progress ── */}
      <div className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-[#16c784]" />
            <span className="text-sm font-semibold text-primary">Level Progress</span>
          </div>
          <span className="text-xs text-muted">12,450 / 19,000 pts to Elite</span>
        </div>
        <div className="w-full h-2.5 rounded-full bg-ax-base overflow-hidden">
          <div
            className="h-full rounded-full bg-[#16c784] transition-all duration-500"
            style={{ width: '65%' }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Diamond Trader</span>
          <span className="badge badge-green">65% to Elite</span>
        </div>
      </div>

      {/* ── Earn Points ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">Earn Points</h2>
        </div>
        <div className="flex flex-col gap-2">
          {earnTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              done={claimedTasks.has(task.id)}
              onClaim={handleClaim}
            />
          ))}
        </div>
      </section>

      {/* ── Referral Program ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Referral Program
          </h2>
        </div>

        {/* Referral link input + copy */}
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={REFERRAL_LINK}
            className={clsx(
              'flex-1 bg-ax-base border ax-border rounded-lg px-3 py-2 text-sm font-mono text-secondary',
              'focus:outline-none focus:ring-1 focus:ring-[#16c784] truncate',
            )}
          />
          <button
            onClick={handleCopy}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex-shrink-0',
              copied
                ? 'bg-green-500/10 text-[#16c784]'
                : 'ax-card hover:bg-ax-card text-secondary hover:text-primary',
            )}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Referral stats */}
        <div className="flex flex-wrap gap-3">
          <div className="ax-card flex-1 min-w-[140px] p-3 rounded-lg flex flex-col gap-1">
            <span className="text-xs text-muted">Referred Users</span>
            <span className="text-lg font-bold text-primary">3</span>
          </div>
          <div className="ax-card flex-1 min-w-[140px] p-3 rounded-lg flex flex-col gap-1">
            <span className="text-xs text-muted">Referral Earnings</span>
            <span className="text-lg font-bold pos">1,500 pts</span>
          </div>
        </div>
      </section>

      {/* ── Rewards History ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Rewards History
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="ax-border border-b text-left">
                <th className="pb-2 pr-4 text-xs text-muted font-medium">Date</th>
                <th className="pb-2 pr-4 text-xs text-muted font-medium">Action</th>
                <th className="pb-2 text-xs text-muted font-medium text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => (
                <tr key={row.id} className="ax-border border-b last:border-0 hover:bg-ax-card transition-colors">
                  <td className="py-2.5 pr-4 text-xs text-muted">{row.date}</td>
                  <td className="py-2.5 pr-4 text-sm text-secondary">{row.action}</td>
                  <td className="py-2.5 text-right font-semibold pos text-sm">+{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Redeem Points ── */}
      <section className="ax-panel panel p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Coins size={16} className="text-[#16c784]" />
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
            Redeem Points
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {redeemOptions.map((opt) => {
            const Icon = opt.icon;
            const canAfford = 12450 >= opt.cost;
            return (
              <div key={opt.id} className="ax-card panel p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-ax-base">
                    <Icon size={16} className="text-[#16c784]" />
                  </div>
                  <span className="text-sm font-semibold text-primary">{opt.name}</span>
                </div>
                <p className="text-xs text-muted flex-1">{opt.description}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="badge badge-yellow text-xs font-semibold">{opt.cost.toLocaleString()} pts</span>
                  <button
                    disabled={!canAfford}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                      canAfford
                        ? 'bg-[#16c784] hover:bg-[#12a86e] text-black cursor-pointer'
                        : 'bg-ax-base text-muted cursor-not-allowed opacity-50',
                    )}
                  >
                    Redeem
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
