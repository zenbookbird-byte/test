import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { SolanaWalletProvider } from './providers/WalletProvider'
import { Header } from './components/Layout/Header'
import { TokenList } from './components/Discovery/TokenList'
import { TradingChart } from './components/Chart/TradingChart'
import { TokenInfoPanel } from './components/TokenInfo/TokenInfoPanel'
import { OrderPanel } from './components/Swap/OrderPanel'
import { Portfolio } from './components/Portfolio/Portfolio'
import { TradesFeed } from './components/Trades/TradesFeed'
import { HolderAnalysis } from './components/Holders/HolderAnalysis'
import { WalletTracker } from './components/WalletTracker/WalletTracker'
import { useTerminalStore } from './store/terminalStore'
import type { RightTab, MainTab } from './store/terminalStore'
import { BarChart2, Zap, Users, Clock, Wallet, Search } from 'lucide-react'
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
    <div className="flex flex-col h-full w-64 xl:w-72 shrink-0 border-l border-border bg-bg-primary overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {RIGHT_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRightTab(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors border-b-2',
              rightTab === tab.id ? 'tab-active' : 'tab-inactive'
            )}
          >
            {tab.icon}
            <span className="hidden xl:block">{tab.label}</span>
          </button>
        ))}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {rightTab === 'trade'   && <OrderPanel />}
        {rightTab === 'info'    && <TokenInfoPanel />}
        {rightTab === 'holders' && <HolderAnalysis />}
        {rightTab === 'trades'  && <TradesFeed />}
      </div>
    </div>
  )
}

const BOTTOM_TABS: { id: MainTab; label: string; icon: React.ReactNode }[] = [
  { id: 'portfolio',     label: 'Portfolio',  icon: <Wallet size={11} /> },
  { id: 'wallettracker', label: 'Copy Trade', icon: <Search size={11} /> },
]

function BottomPanel() {
  const { mainTab, setMainTab } = useTerminalStore()
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border shrink-0">
        {BOTTOM_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setMainTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2',
              mainTab === tab.id ? 'tab-active' : 'tab-inactive'
            )}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {mainTab === 'portfolio'     && <Portfolio />}
        {mainTab === 'wallettracker' && <WalletTracker />}
      </div>
    </div>
  )
}

function Terminal() {
  const { mainTab } = useTerminalStore()
  const isBottomView = mainTab === 'portfolio' || mainTab === 'wallettracker'

  return (
    <div className="flex flex-col h-screen bg-bg-base overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Token list */}
        <TokenList />

        {/* Center + Right */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {isBottomView ? (
            // Portfolio / Wallet tracker full view
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <BottomPanel />
              </div>
              <RightPanel />
            </div>
          ) : (
            // Trading view: chart on top, panels on sides
            <div className="flex flex-1 overflow-hidden">
              {/* Chart */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <TradingChart />
              </div>
              {/* Right panel */}
              <RightPanel />
            </div>
          )}
        </div>
      </div>
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
