import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { SolanaWalletProvider } from './providers/WalletProvider'
import { TopNav } from './components/Layout/TopNav'
import { LeftSidebar } from './components/Layout/LeftSidebar'
import { BottomBar } from './components/Layout/BottomBar'
import { TokenScanner } from './components/Discovery/TokenScanner'
import { TradingChart } from './components/Chart/TradingChart'
import { TokenInfoPanel } from './components/TokenInfo/TokenInfoPanel'
import { OrderPanel } from './components/Swap/OrderPanel'
import { Portfolio } from './components/Portfolio/Portfolio'
import { TradesFeed } from './components/Trades/TradesFeed'
import { HolderAnalysis } from './components/Holders/HolderAnalysis'
import { WalletTracker } from './components/WalletTracker/WalletTracker'
import { PerpetualsPage } from './components/Pages/PerpetualsPage'
import { YieldPage } from './components/Pages/YieldPage'
import VisionPage from './components/Pages/VisionPage'
import RewardsPage from './components/Pages/RewardsPage'
import { CopyTradePage } from './components/CopyTrade/CopyTradePage'
import { useTerminalStore } from './store/terminalStore'
import type { RightTab } from './store/terminalStore'
import { Zap, BarChart2, Users, Clock, Wallet, Search } from 'lucide-react'
import clsx from 'clsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
})

const RIGHT_TABS: { id: RightTab; label: string; icon: React.ReactNode }[] = [
  { id: 'trade',   label: 'Trade',   icon: <Zap size={11} /> },
  { id: 'info',    label: 'Info',    icon: <BarChart2 size={11} /> },
  { id: 'holders', label: 'Holders', icon: <Users size={11} /> },
  { id: 'trades',  label: 'Trades',  icon: <Clock size={11} /> },
]

function RightPanel() {
  const { rightTab, setRightTab } = useTerminalStore()
  return (
    <div className="w-60 xl:w-64 shrink-0 border-l border-ax-border bg-ax-sidebar flex flex-col overflow-hidden">
      <div className="flex border-b border-ax-border shrink-0">
        {RIGHT_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRightTab(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1 py-2 text-2xs font-semibold transition-colors border-b-2',
              rightTab === tab.id
                ? 'text-green-DEFAULT border-green-DEFAULT'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            )}
          >
            {tab.icon}
            <span className="hidden xl:block">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {rightTab === 'trade'   && <OrderPanel />}
        {rightTab === 'info'    && <TokenInfoPanel />}
        {rightTab === 'holders' && <HolderAnalysis />}
        {rightTab === 'trades'  && <TradesFeed />}
      </div>
    </div>
  )
}

function TrackersTabs() {
  const [tab, setTab] = useState<'wallets' | 'copytrading'>('wallets')
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-ax-border px-4 shrink-0">
        {([
          { id: 'wallets', label: 'Wallet Tracker', icon: <Wallet size={11} /> },
          { id: 'copytrading', label: 'Copy Trading', icon: <Search size={11} /> },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('scan-tab flex items-center gap-1.5', tab === t.id && 'active')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        <WalletTracker />
      </div>
    </div>
  )
}

// Need useState for TrackersTabs
import { useState } from 'react'

function DiscoverView() {
  const { selectedPair } = useTerminalStore()
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Scanner or chart depending on selection */}
      {!selectedPair ? (
        <div className="flex-1 overflow-hidden">
          <TokenScanner />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: scanner (narrow) */}
          <div className="hidden xl:flex w-64 2xl:w-72 shrink-0 border-r border-ax-border overflow-hidden">
            <TokenScanner />
          </div>
          {/* Center: chart */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <TradingChart />
          </div>
        </div>
      )}
      {/* Right panel */}
      {selectedPair && <RightPanel />}
    </div>
  )
}

function MainContent() {
  const { pageView } = useTerminalStore()
  switch (pageView) {
    case 'discover':    return <DiscoverView />
    case 'pulse':       return <div className="flex flex-1 overflow-hidden"><TokenScanner /></div>
    case 'trackers':    return <div className="flex-1 overflow-hidden"><TrackersTabs /></div>
    case 'copytrade':   return <div className="flex-1 overflow-hidden"><CopyTradePage /></div>
    case 'perpetuals':  return <div className="flex-1 overflow-hidden"><PerpetualsPage /></div>
    case 'yield':       return <div className="flex-1 overflow-hidden"><YieldPage /></div>
    case 'vision':      return <div className="flex-1 overflow-hidden"><VisionPage /></div>
    case 'rewards':     return <div className="flex-1 overflow-hidden"><RewardsPage /></div>
    case 'portfolio':   return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden"><Portfolio /></div>
        <RightPanel />
      </div>
    )
    default: return <DiscoverView />
  }
}

function Terminal() {
  return (
    <div className="flex flex-col h-screen bg-ax-base overflow-hidden">
      <TopNav />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <LeftSidebar />
        <main className="flex flex-1 flex-col overflow-hidden min-w-0">
          <MainContent />
        </main>
      </div>
      <BottomBar />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <Terminal />
        <Toaster
          position="bottom-right"
          toastOptions={{ style: { background: 'transparent', boxShadow: 'none', padding: 0 } }}
        />
      </SolanaWalletProvider>
    </QueryClientProvider>
  )
}
