#!/usr/bin/env python3
"""
Alert system for Polymarket copy-trade bot.
Sends Telegram and/or Discord notifications when:
  • New copy-trade signals appear
  • Smart money convergence detected
  • Sharp wallets exit positions
  • Watchlist wallets open new positions
  • High-conviction contrarian edges emerge

Configuration via environment variables or alerts_config.json:
  TELEGRAM_BOT_TOKEN   — from @BotFather
  TELEGRAM_CHAT_ID     — your chat/channel ID
  DISCORD_WEBHOOK_URL  — Discord channel webhook URL
"""

import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

import requests

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_FILE = "alerts_config.json"


def load_config() -> dict:
    """Load alert config from file, falling back to env vars."""
    cfg = {
        "telegram_token":    os.environ.get("TELEGRAM_BOT_TOKEN", ""),
        "telegram_chat_id":  os.environ.get("TELEGRAM_CHAT_ID", ""),
        "discord_webhook":   os.environ.get("DISCORD_WEBHOOK_URL", ""),
        "min_signal_ev":     0.02,    # only alert when EV > this
        "min_convergence":   3,       # min wallets for convergence alert
        "exit_urgency_min":  2.0,     # min urgency score for exit alerts
        "contrarian_min_pp": 10.0,    # min pp divergence for contrarian alert
        "cooldown_secs":     3600,    # don't repeat same alert within N secs
        "quiet_hours":       [],      # e.g. [[23,6]] = no alerts 11pm–6am UTC
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                cfg.update(json.load(f))
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


def save_config(cfg: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"Config saved → {CONFIG_FILE}")


# ── Cooldown tracker (per-run, use SQLite for persistence) ───────────────────
_COOLDOWN_FILE = ".cache/alert_cooldowns.json"


def _load_cooldowns() -> dict:
    os.makedirs(".cache", exist_ok=True)
    if os.path.exists(_COOLDOWN_FILE):
        try:
            with open(_COOLDOWN_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_cooldowns(cd: dict):
    with open(_COOLDOWN_FILE, "w") as f:
        json.dump(cd, f)


def is_on_cooldown(key: str, cooldown_secs: int) -> bool:
    cd = _load_cooldowns()
    last = cd.get(key, 0)
    return (time.time() - last) < cooldown_secs


def mark_sent(key: str):
    cd = _load_cooldowns()
    cd[key] = time.time()
    _save_cooldowns(cd)


def in_quiet_hours(quiet_hours: list) -> bool:
    """Return True if current UTC hour falls in any quiet window."""
    now_h = datetime.now(timezone.utc).hour
    for window in quiet_hours:
        if len(window) == 2:
            start, end = window
            if start <= end:
                if start <= now_h < end:
                    return True
            else:  # wraps midnight
                if now_h >= start or now_h < end:
                    return True
    return False


# ── Telegram ──────────────────────────────────────────────────────────────────
def send_telegram(token: str, chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    """Send a Telegram message. Returns True on success."""
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for attempt in range(3):
        try:
            r = requests.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            }, timeout=10)
            if r.status_code == 200:
                return True
            print(f"  [telegram] HTTP {r.status_code}: {r.text[:120]}")
        except requests.RequestException as e:
            print(f"  [telegram] Error: {e}")
        if attempt < 2:
            time.sleep(2 ** attempt)
    return False


# ── Discord ───────────────────────────────────────────────────────────────────
def send_discord(webhook_url: str, content: str, embeds: list = None) -> bool:
    """Send a Discord webhook message. Returns True on success."""
    if not webhook_url:
        return False
    payload = {"content": content}
    if embeds:
        payload["embeds"] = embeds
    for attempt in range(3):
        try:
            r = requests.post(webhook_url, json=payload, timeout=10)
            if r.status_code in (200, 204):
                return True
            print(f"  [discord] HTTP {r.status_code}: {r.text[:120]}")
        except requests.RequestException as e:
            print(f"  [discord] Error: {e}")
        if attempt < 2:
            time.sleep(2 ** attempt)
    return False


# ── Unified send ──────────────────────────────────────────────────────────────
def send_alert(cfg: dict, telegram_text: str, discord_text: str = None,
               discord_embeds: list = None):
    """Send to all configured destinations."""
    sent = False
    if cfg.get("telegram_token") and cfg.get("telegram_chat_id"):
        ok = send_telegram(cfg["telegram_token"], cfg["telegram_chat_id"], telegram_text)
        if ok:
            sent = True
            print("  [alert] ✓ Telegram sent")
    if cfg.get("discord_webhook"):
        ok = send_discord(cfg["discord_webhook"], discord_text or telegram_text.replace("<b>", "**").replace("</b>", "**").replace("<code>", "`").replace("</code>", "`"), discord_embeds)
        if ok:
            sent = True
            print("  [alert] ✓ Discord sent")
    if not sent:
        print("  [alert] No destinations configured. Set TELEGRAM_BOT_TOKEN/CHAT_ID or DISCORD_WEBHOOK_URL.")
    return sent


# ── Alert formatters ──────────────────────────────────────────────────────────
def fmt_copy_signal_alert(signal: dict, rank: int = 1) -> tuple[str, str]:
    """Returns (telegram_html, discord_text) for a copy-trade signal."""
    p = signal.get("yes_price", 0)
    ev = signal.get("ev_85", 0) * 100
    wallets = signal.get("wallet_count", 0)
    title = signal.get("market_title", "Unknown market")[:80]
    source = "★ MULTI-PERIOD" if signal.get("source") == "multi_period" else "TOP-50"
    alloc = signal.get("kelly_alloc") or signal.get("allocation", 0)
    kelly_f = signal.get("kelly_f", 0)

    tg = (
        f"🎯 <b>COPY-TRADE SIGNAL #{rank}</b>  [{source}]\n\n"
        f"<b>Market:</b> {title}\n"
        f"<b>YES price:</b> ${p:.3f} ({p*100:.1f}% implied)\n"
        f"<b>EV:</b> +{ev:.1f}¢ per $1\n"
        f"<b>Consensus:</b> {wallets} wallets long\n"
        f"<b>Kelly size:</b> ${alloc:.2f} (f={kelly_f:.3f})\n"
        f"<b>Volume:</b> ${signal.get('volume_usdc', 0):,.0f}"
    )
    dc = (
        f"🎯 **COPY-TRADE SIGNAL #{rank}** [{source}]\n"
        f"Market: {title}\n"
        f"YES: ${p:.3f} | EV: +{ev:.1f}¢ | {wallets} wallets long\n"
        f"Kelly: ${alloc:.2f}"
    )
    return tg, dc


def fmt_convergence_alert(event: dict, market_titles: dict) -> tuple[str, str]:
    title = market_titles.get(event["market_id"], event["market_id"][:24])
    n = event["independent_count"]
    bars = "█" * min(n, 10)
    tg = (
        f"⚡ <b>SMART MONEY CONVERGENCE</b>\n\n"
        f"<b>Market:</b> {title[:80]}\n"
        f"<b>Strength:</b> {bars} {n} independent wallets\n"
        f"<b>Window:</b> last 24h\n\n"
        f"This is the strongest signal type — multiple uncorrelated sharp actors agreeing."
    )
    dc = (
        f"⚡ **SMART MONEY CONVERGENCE**\n"
        f"{title[:80]}\n"
        f"Strength: {bars} {n} wallets — last 24h"
    )
    return tg, dc


def fmt_exit_alert(signal: dict, market_titles: dict) -> tuple[str, str]:
    title = market_titles.get(signal["market_id"], signal["market_id"][:24])
    urg = signal["urgency"]
    emoji = "🔴" if urg > 5 else "🟡"
    tg = (
        f"{emoji} <b>EXIT SIGNAL — sharp wallets selling</b>\n\n"
        f"<b>Market:</b> {title[:80]}\n"
        f"<b>Sellers:</b> {signal['unique_wallets']} sharp wallets\n"
        f"<b>Tokens sold:</b> {signal['total_tokens_sold']:.1f}\n"
        f"<b>Latest:</b> {signal['latest_exit_hours_ago']:.1f}h ago\n\n"
        f"⚠ Consider reducing exposure to this market."
    )
    dc = (
        f"{emoji} **EXIT SIGNAL**\n"
        f"{title[:80]}\n"
        f"{signal['unique_wallets']} sharp wallets selling · latest {signal['latest_exit_hours_ago']:.1f}h ago"
    )
    return tg, dc


def fmt_contrarian_alert(signal: dict) -> tuple[str, str]:
    edge_pp = signal["contrarian_edge"] * 100
    direction = signal["direction"]
    emoji = "📈" if edge_pp > 0 else "📉"
    tg = (
        f"{emoji} <b>CONTRARIAN EDGE</b>  [{direction}]\n\n"
        f"<b>Market:</b> {signal['market_title'][:80]}\n"
        f"<b>Crowd:</b> {signal['crowd_prob']*100:.0f}%\n"
        f"<b>Smart money:</b> {signal['smart_money_prob']*100:.0f}%\n"
        f"<b>Gap:</b> {'+' if edge_pp > 0 else ''}{edge_pp:.1f}pp\n"
        f"<b>Sharp wallets long:</b> {signal['long_wallets']}/{signal['total_wallets']}"
    )
    dc = (
        f"{emoji} **CONTRARIAN EDGE** [{direction}]\n"
        f"{signal['market_title'][:80]}\n"
        f"Crowd {signal['crowd_prob']*100:.0f}% vs Smart {signal['smart_money_prob']*100:.0f}% → {'+' if edge_pp > 0 else ''}{edge_pp:.1f}pp gap"
    )
    return tg, dc


def fmt_watchlist_alert(wallet: dict, market_title: str, position: dict) -> tuple[str, str]:
    addr = wallet["address"]
    tokens = position.get("net_tokens", 0)
    cost = position.get("total_cost", 0)
    avg_e = cost / tokens if tokens > 0 else 0
    tg = (
        f"👁 <b>WATCHLIST WALLET MOVED</b>\n\n"
        f"<b>Wallet:</b> <code>{addr}</code>\n"
        f"<b>Market:</b> {market_title[:80]}\n"
        f"<b>Position:</b> {tokens:.1f} YES tokens\n"
        f"<b>Avg entry:</b> ${avg_e:.4f}\n"
        f"<b>Cluster:</b> {wallet.get('cluster', '?').upper()}\n"
        f"<b>Win rate:</b> {wallet.get('win_rate', 0):.1f}%"
    )
    dc = (
        f"👁 **WATCHLIST WALLET MOVED**\n"
        f"`{addr}`\n"
        f"{market_title[:80]} · {tokens:.1f} tokens @ ${avg_e:.4f}"
    )
    return tg, dc


# ── Main dispatcher ───────────────────────────────────────────────────────────
def dispatch_alerts(
    cfg: dict,
    copy_signals: list,
    convergence_events: list,
    exit_signals: list,
    contrarian_signals: list,
    market_titles: dict,
    watchlist_hits: list = None,
):
    """
    Check all signal types and send alerts for any that pass thresholds
    and are not on cooldown.
    """
    if in_quiet_hours(cfg.get("quiet_hours", [])):
        print("  [alert] In quiet hours — skipping alerts.")
        return

    cooldown = cfg.get("cooldown_secs", 3600)
    sent_count = 0

    # ── Copy-trade signals ────────────────────────────────────────────────────
    for i, s in enumerate(copy_signals, 1):
        if s.get("ev_85", 0) < cfg.get("min_signal_ev", 0.02):
            continue
        key = f"copy:{s.get('market_title', '')[:40]}"
        if is_on_cooldown(key, cooldown):
            continue
        tg, dc = fmt_copy_signal_alert(s, rank=i)
        if send_alert(cfg, tg, dc):
            mark_sent(key)
            sent_count += 1

    # ── Convergence alerts ────────────────────────────────────────────────────
    for e in convergence_events:
        if e["independent_count"] < cfg.get("min_convergence", 3):
            continue
        key = f"conv:{e['market_id'][:24]}"
        if is_on_cooldown(key, cooldown):
            continue
        tg, dc = fmt_convergence_alert(e, market_titles)
        if send_alert(cfg, tg, dc):
            mark_sent(key)
            sent_count += 1

    # ── Exit signals ──────────────────────────────────────────────────────────
    for s in exit_signals:
        if s["urgency"] < cfg.get("exit_urgency_min", 2.0):
            continue
        key = f"exit:{s['market_id'][:24]}"
        if is_on_cooldown(key, cooldown):
            continue
        tg, dc = fmt_exit_alert(s, market_titles)
        if send_alert(cfg, tg, dc):
            mark_sent(key)
            sent_count += 1

    # ── Contrarian signals ────────────────────────────────────────────────────
    for s in contrarian_signals:
        if abs(s["contrarian_edge"]) * 100 < cfg.get("contrarian_min_pp", 10.0):
            continue
        key = f"contra:{s['market_id'][:24]}"
        if is_on_cooldown(key, cooldown):
            continue
        tg, dc = fmt_contrarian_alert(s)
        if send_alert(cfg, tg, dc):
            mark_sent(key)
            sent_count += 1

    # ── Watchlist hits ────────────────────────────────────────────────────────
    for hit in (watchlist_hits or []):
        key = f"watch:{hit['wallet']['address'][:12]}:{hit['market_id'][:16]}"
        if is_on_cooldown(key, cooldown):
            continue
        tg, dc = fmt_watchlist_alert(hit["wallet"], hit["market_title"], hit["position"])
        if send_alert(cfg, tg, dc):
            mark_sent(key)
            sent_count += 1

    print(f"  [alert] Dispatched {sent_count} alert(s).")
    return sent_count


# ── CLI test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    cfg = load_config()

    if len(sys.argv) > 1 and sys.argv[1] == "test":
        print("Sending test alerts...")
        tg = (
            "✅ <b>Polymarket Bot — Alert System Active</b>\n\n"
            "Connection test successful.\n"
            "You will receive alerts for:\n"
            "• 🎯 Copy-trade signals\n"
            "• ⚡ Smart money convergence\n"
            "• 🔴 Exit / de-risk signals\n"
            "• 📈 Contrarian edge opportunities\n"
            "• 👁 Watchlist wallet moves"
        )
        send_alert(cfg, tg)
    elif len(sys.argv) > 1 and sys.argv[1] == "config":
        print("Current config:")
        print(json.dumps({k: v for k, v in cfg.items() if "token" not in k and "webhook" not in k}, indent=2))
        print("\nSet credentials via environment variables:")
        print("  export TELEGRAM_BOT_TOKEN=your_token")
        print("  export TELEGRAM_CHAT_ID=your_chat_id")
        print("  export DISCORD_WEBHOOK_URL=your_webhook_url")
    else:
        print("Usage: python alerts.py [test|config]")
