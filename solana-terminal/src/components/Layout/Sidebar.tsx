import { TrendingUp, Clock, Wallet, Star, BarChart2, BookOpen } from 'lucide-react'
import { useTerminalStore } from '../../store/terminalStore'
import clsx from 'clsx'

const tabs = [
  { id: 'trending', label: 'Trending', icon: TrendingUp },
  { id: 'new', label: 'New Pairs', icon: Clock },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
] as const

export function Sidebar() {
  const { activeTab, setActiveTab } = useTerminalStore()

  return (
    <aside className="w-48 bg-bg-secondary border-r border-border flex flex-col shrink-0 hidden lg:flex">
      <nav className="flex flex-col gap-0.5 p-2 mt-2">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-accent-purple/10 text-accent-purple border border-accent-purple/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto p-3 border-t border-border">
        <div className="text-xs text-text-muted mb-2 font-medium uppercase tracking-wider">Data</div>
        <div className="space-y-1">
          <a
            href="https://dexscreener.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary py-1 transition-colors"
          >
            <BarChart2 size={12} />
            DexScreener
          </a>
          <a
            href="https://jup.ag"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary py-1 transition-colors"
          >
            <BookOpen size={12} />
            Jupiter
          </a>
        </div>
      </div>
    </aside>
  )
}
