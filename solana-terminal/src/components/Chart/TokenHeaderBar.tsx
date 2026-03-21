import { useState } from 'react';
import { Star, Globe, Twitter, ExternalLink, Copy, Share2 } from 'lucide-react';
import clsx from 'clsx';
import type { TokenPair } from '../../types';

const formatUsd = (v: number) =>
  v >= 1e6
    ? '$' + (v / 1e6).toFixed(1) + 'M'
    : v >= 1e3
    ? '$' + (v / 1e3).toFixed(1) + 'K'
    : '$' + v.toFixed(2);

function getPlatformLabel(dexId?: string): string {
  if (!dexId) return 'Unknown';
  const d = dexId.toLowerCase();
  if (d.includes('pump')) return 'Pump';
  if (d.includes('orca')) return 'Orca';
  return 'Raydium';
}

function getPlatformColorClass(dexId?: string): string {
  if (!dexId) return 'bg-gray-800 text-gray-400 border-gray-700/50';
  const d = dexId.toLowerCase();
  if (d.includes('pump')) return 'bg-green-900/60 text-green-300 border-green-700/50';
  if (d.includes('orca')) return 'bg-purple-900/60 text-purple-300 border-purple-700/50';
  return 'bg-blue-900/60 text-blue-300 border-blue-700/50';
}

function PlatformBadge({ dexId }: { dexId: string | undefined }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold border shrink-0',
        getPlatformColorClass(dexId)
      )}
    >
      {getPlatformLabel(dexId)}
    </span>
  );
}

function AgeBadge({ pairCreatedAt }: { pairCreatedAt: number | undefined }) {
  if (!pairCreatedAt) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono bg-ax-hover text-text-muted border border-ax-border shrink-0">
        —
      </span>
    );
  }
  const ageMs = Date.now() - pairCreatedAt;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHr = Math.floor(ageMin / 60);
  const ageDays = Math.floor(ageHr / 24);
  const label = ageDays > 0 ? `${ageDays}d` : ageHr > 0 ? `${ageHr}h` : `${ageMin}m`;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono bg-ax-hover text-text-muted border border-ax-border shrink-0">
      {label}
    </span>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-ax-hover border border-ax-border text-2xs shrink-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

export function TokenHeaderBar({ pair }: { pair: TokenPair | null }) {
  const [starred, setStarred] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (pair?.pairAddress) {
      navigator.clipboard.writeText(pair.pairAddress).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Placeholder state
  if (!pair) {
    return (
      <div className="h-10 shrink-0 border-b border-ax-border bg-ax-panel flex items-center px-3 gap-3">
        <div className="w-6 h-6 rounded-full bg-ax-hover animate-pulse" />
        <div className="w-28 h-4 rounded bg-ax-hover animate-pulse" />
        <div className="flex-1" />
        <div className="w-20 h-5 rounded bg-ax-hover animate-pulse" />
        <div className="w-14 h-5 rounded bg-ax-hover animate-pulse" />
      </div>
    );
  }

  const baseToken = pair.baseToken;
  const symbol = baseToken?.symbol ?? '???';
  const name = baseToken?.name ?? symbol;
  const priceUsd = parseFloat(pair.priceUsd ?? '0');
  const liquidityUsd = pair.liquidity?.usd ?? 0;

  const twitterUrl = pair.info?.socials?.find(
    (s: { type: string; url: string }) => s.type === 'twitter'
  )?.url;
  const telegramUrl = pair.info?.socials?.find(
    (s: { type: string; url: string }) => s.type === 'telegram'
  )?.url;
  const websiteUrl = pair.info?.websites?.[0]?.url;

  const displayPrice =
    priceUsd <= 0
      ? '—'
      : priceUsd < 0.0001
      ? '$' + priceUsd.toExponential(2)
      : formatUsd(priceUsd);

  return (
    <div className="h-10 shrink-0 border-b border-ax-border bg-ax-panel flex items-center px-2 gap-2 overflow-x-auto scrollbar-none">
      {/* Token avatar */}
      <div className="shrink-0 w-6 h-6 rounded-full bg-ax-hover border border-ax-border overflow-hidden flex items-center justify-center text-2xs font-bold text-text-muted">
        {pair.info?.imageUrl ? (
          <img
            src={pair.info.imageUrl}
            alt={symbol}
            className="w-full h-full object-cover"
          />
        ) : (
          symbol.slice(0, 2).toUpperCase()
        )}
      </div>

      {/* Token name + symbol */}
      <div className="shrink-0 flex items-center gap-1.5">
        <span className="text-sm font-semibold text-text-primary leading-none">{symbol}</span>
        <span className="text-2xs text-text-muted leading-none">{name}</span>
      </div>

      {/* Age badge */}
      <AgeBadge pairCreatedAt={pair.pairCreatedAt} />

      {/* Platform badge */}
      <PlatformBadge dexId={pair.dexId} />

      {/* Social icons */}
      <div className="shrink-0 flex items-center gap-0.5">
        {twitterUrl && (
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-sky-400 hover:bg-ax-hover transition-colors"
            title="Twitter"
          >
            <Twitter size={11} />
          </a>
        )}
        {telegramUrl && (
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-blue-400 hover:bg-ax-hover transition-colors"
            title="Telegram"
          >
            <ExternalLink size={11} />
          </a>
        )}
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-green-400 hover:bg-ax-hover transition-colors"
            title="Website"
          >
            <Globe size={11} />
          </a>
        )}
      </div>

      {/* View count */}
      <span className="shrink-0 text-2xs text-text-muted flex items-center gap-0.5">
        <span>👁</span>
        <span>289</span>
      </span>

      {/* Divider */}
      <div className="shrink-0 w-px h-4 bg-ax-border" />

      {/* Price – large */}
      <span className="shrink-0 text-sm font-bold text-text-primary font-mono tabular-nums">
        {displayPrice}
      </span>

      {/* Divider */}
      <div className="shrink-0 w-px h-4 bg-ax-border" />

      {/* Stat pills */}
      <div className="flex items-center gap-1 shrink-0">
        <StatPill label="Price" value={displayPrice} />
        <StatPill label="Liq" value={liquidityUsd > 0 ? formatUsd(liquidityUsd) : '—'} />
        <StatPill label="Supply" value="1B" />
        <StatPill label="Global Fees Paid" value="$9.079" />
        <StatPill label="Tax" value="1.25%" />
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right-side actions */}
      <div className="shrink-0 flex items-center gap-0.5">
        <button
          onClick={handleCopy}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-ax-hover transition-colors"
          title={copied ? 'Copied!' : 'Copy address'}
        >
          <Copy size={12} />
        </button>

        <button
          onClick={() => setStarred((s) => !s)}
          className={clsx(
            'w-6 h-6 flex items-center justify-center rounded transition-colors',
            starred
              ? 'text-yellow-400 hover:bg-ax-hover'
              : 'text-text-muted hover:text-yellow-400 hover:bg-ax-hover'
          )}
          title={starred ? 'Remove bookmark' : 'Bookmark'}
        >
          <Star size={12} fill={starred ? 'currentColor' : 'none'} />
        </button>

        <button
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-ax-hover transition-colors"
          title="Share"
        >
          <Share2 size={12} />
        </button>
      </div>
    </div>
  );
}
