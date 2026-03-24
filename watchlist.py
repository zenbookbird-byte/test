#!/usr/bin/env python3
"""
Wallet watchlist tracker.
Monitors specific wallets for new position opens and changes,
diffing against a previous snapshot to detect new moves.

Usage:
  python watchlist.py add 0xABC...          # add wallet to watchlist
  python watchlist.py remove 0xABC...       # remove wallet
  python watchlist.py list                  # show watchlist
  python watchlist.py check                 # check for new moves (used by scheduler)
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

WATCHLIST_FILE = "watchlist.json"
SNAPSHOT_FILE  = ".cache/watchlist_snapshot.json"


# ── Watchlist management ──────────────────────────────────────────────────────
def load_watchlist() -> dict:
    """Returns {address: {label, added_at, notes}}."""
    if os.path.exists(WATCHLIST_FILE):
        try:
            with open(WATCHLIST_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_watchlist(wl: dict):
    with open(WATCHLIST_FILE, "w") as f:
        json.dump(wl, f, indent=2)


def add_wallet(addr: str, label: str = "", notes: str = ""):
    wl = load_watchlist()
    addr = addr.lower().strip()
    if addr in wl:
        print(f"  Already in watchlist: {addr}")
        return
    wl[addr] = {
        "label":    label or addr[:10] + "…",
        "added_at": datetime.now(timezone.utc).isoformat(),
        "notes":    notes,
    }
    save_watchlist(wl)
    print(f"  Added: {addr}  ({label})")


def remove_wallet(addr: str):
    wl = load_watchlist()
    addr = addr.lower().strip()
    if addr not in wl:
        print(f"  Not in watchlist: {addr}")
        return
    del wl[addr]
    save_watchlist(wl)
    print(f"  Removed: {addr}")


def print_watchlist():
    wl = load_watchlist()
    if not wl:
        print("  Watchlist is empty. Use: python watchlist.py add 0xABC...")
        return
    print(f"\n{'Address':<44} {'Label':<20} {'Added':<22} Notes")
    print("─" * 100)
    for addr, meta in wl.items():
        added = meta.get("added_at", "")[:10]
        print(f"  {addr:<44} {meta.get('label',''):<20} {added:<22} {meta.get('notes','')}")
    print(f"\n  {len(wl)} wallet(s) on watchlist.")


# ── Snapshot diff ─────────────────────────────────────────────────────────────
def load_snapshot() -> dict:
    os.makedirs(".cache", exist_ok=True)
    if os.path.exists(SNAPSHOT_FILE):
        try:
            with open(SNAPSHOT_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_snapshot(snap: dict):
    with open(SNAPSHOT_FILE, "w") as f:
        json.dump(snap, f)


def diff_positions(old_positions: dict, new_positions: dict) -> list:
    """
    Returns list of position changes:
      - New positions opened
      - Positions significantly increased (>20% more tokens)
      - Positions closed (net_tokens dropped to ~0)
    """
    changes = []
    all_markets = set(old_positions) | set(new_positions)
    for mid in all_markets:
        old = old_positions.get(mid, {"net_tokens": 0.0, "total_cost": 0.0})
        new = new_positions.get(mid, {"net_tokens": 0.0, "total_cost": 0.0})
        old_t = old.get("net_tokens", 0.0)
        new_t = new.get("net_tokens", 0.0)

        if old_t < 0.5 and new_t >= 0.5:
            changes.append({"market_id": mid, "type": "OPENED", "tokens": new_t, "position": new})
        elif old_t >= 0.5 and new_t < 0.5:
            changes.append({"market_id": mid, "type": "CLOSED", "tokens": old_t, "position": old})
        elif new_t >= 0.5 and old_t > 0 and (new_t - old_t) / old_t > 0.20:
            changes.append({"market_id": mid, "type": "INCREASED", "tokens": new_t,
                           "prev_tokens": old_t, "position": new})
    return changes


def check_watchlist(all_rows: list, market_titles: dict) -> list:
    """
    Compare current wallet positions against last snapshot.
    Returns list of {wallet, market_id, market_title, change_type, position}.
    """
    wl = load_watchlist()
    if not wl:
        return []

    old_snap = load_snapshot()
    new_snap = {}
    hits = []

    # Build a lookup from the scored rows
    row_by_addr = {r["address"]: r for r in all_rows}

    for addr in wl:
        row = row_by_addr.get(addr)
        if not row:
            continue
        positions = row.get("positions", {})
        new_snap[addr] = positions

        old_positions = old_snap.get(addr, {})
        changes = diff_positions(old_positions, positions)
        for ch in changes:
            hits.append({
                "wallet":       row,
                "market_id":    ch["market_id"],
                "market_title": market_titles.get(ch["market_id"], ch["market_id"][:20]),
                "change_type":  ch["type"],
                "position":     ch["position"],
                "tokens":       ch["tokens"],
            })

    save_snapshot(new_snap)
    return hits


def print_watchlist_hits(hits: list):
    if not hits:
        print("  No new moves from watchlist wallets.")
        return
    print(f"\n  ── Watchlist Moves ({len(hits)}) ───────────────────────────")
    for h in hits:
        emoji = {"OPENED": "🟢", "CLOSED": "🔴", "INCREASED": "🔼"}.get(h["change_type"], "◆")
        pos = h["position"]
        avg_e = pos["total_cost"] / pos["net_tokens"] if pos.get("net_tokens", 0) > 0 else 0
        print(f"  {emoji} {h['change_type']} | {h['wallet']['address']}")
        print(f"     {h['market_title'][:70]}")
        print(f"     {h['tokens']:.1f} tokens  avg entry ${avg_e:.4f}  "
              f"cluster={h['wallet'].get('cluster','?')}")
    print()


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "list":
        print_watchlist()
    elif args[0] == "add" and len(args) >= 2:
        label = args[2] if len(args) > 2 else ""
        notes = args[3] if len(args) > 3 else ""
        add_wallet(args[1], label, notes)
    elif args[0] == "remove" and len(args) >= 2:
        remove_wallet(args[1])
    elif args[0] == "check":
        print("Loading latest rankings to check watchlist positions...")
        if not os.path.exists("war_wallet_rankings.json"):
            print("  No rankings file found. Run polymarket_wallet_analysis.py first.")
            sys.exit(1)
        with open("war_wallet_rankings.json") as f:
            data = json.load(f)
        rows = data.get("winrate_ranking", [])
        hits = check_watchlist(rows, {})
        print_watchlist_hits(hits)
    else:
        print("Usage:")
        print("  python watchlist.py list")
        print("  python watchlist.py add 0xABC... [label] [notes]")
        print("  python watchlist.py remove 0xABC...")
        print("  python watchlist.py check")
