import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { SolanaWalletProvider } from './providers/WalletProvider'
import { Header } from './components/Layout/Header'
import { TokenList } from './components/Discovery/TokenList'
import { TradingChart } from './components/Chart/TradingChart'
import { TokenInfoPanel } from './components/TokenInfo/TokenInfoPanel'
import { SwapPanel } from './components/Swap/SwapPanel'
import { Portfolio } from './components/Portfolio/Portfolio'
import { useTerminalStore } from './store/terminalStore'
import { Wallet, TrendingUp } from 'lucide-react'
import clsx from 'clsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

type RightTab = 'info' | 'trade'

function RightPanel() {
  const [tab, setTab] = useState<RightTab>('info')

  return (
    <>
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setTab('info')}
          className={clsx(
            'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2.5 border-b-2 transition-colors',
            tab === 'info'
              ? 'text-accent-blue border-accent-blue'
              : 'text-text-secondary border-transparent hover:text-text-primary'
          )}
        >
          <TrendingUp size={12} />
          Info
        </button>
        <button
          onClick={() => setTab('trade')}
          className={clsx(
            'flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2.5 border-b-2 transition-colors',
            tab === 'trade'
              ? 'text-accent-blue border-accent-blue'
              : 'text-text-secondary border-transparent hover:text-text-primary'
          )}
        >
          <Wallet size={12} />
          Trade
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'info' ? <TokenInfoPanel /> : <SwapPanel />}
      </div>
    </>
  )
}

function Terminal() {
  const { activeTab } = useTerminalStore()

  return (
    <div className="flex flex-col h-screen bg-bg-primary overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Token list panel */}
        <TokenList />

        {/* Main area */}
        {activeTab === 'portfolio' ? (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <Portfolio />
            </div>
            <div className="w-72 xl:w-80 border-l border-border flex flex-col overflow-hidden shrink-0">
              <RightPanel />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Chart */}
            <div className="flex-1 overflow-hidden">
              <TradingChart />
            </div>
            {/* Right panel */}
            <div className="w-72 xl:w-80 border-l border-border flex flex-col overflow-hidden shrink-0">
              <RightPanel />
            </div>
          </div>
        )}
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
          toastOptions={{
            style: {
              background: 'transparent',
              boxShadow: 'none',
              padding: 0,
            },
          }}
        />
      </SolanaWalletProvider>
    </QueryClientProvider>
  )
}
