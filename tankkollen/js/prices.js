/* =======================================================================
 * Tankkollen — Live Price Loader
 * -----------------------------------------------------------------------
 * Fetches data/live_prices.json (produced hourly by GitHub Actions), merges
 * the brand-level list prices into window.STATIONS_DATA, and exposes the
 * payload metadata on window.LIVE_PRICES for the UI layer.
 *
 * Each station's displayed price is:
 *     brand_list_price + station_offset  (stable per-station variance)
 *
 * When a user reports a confirmed pump price for a specific station, the
 * report is persisted to localStorage and overrides the computed value
 * for that station, for both the user and (in a real deployment) for
 * upload to a backend.
 * ======================================================================= */

(function () {
  "use strict";

  const FUEL_KEYS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"];
  const LIVE_URL = "data/live_prices.json";
  const REFRESH_MS = 5 * 60 * 1000; // 5 minutes – re-fetch live JSON
  const USER_REPORTS_KEY = "tankkollen-price-reports";

  // ------------------------------------------------------------------
  // Stable station offset so variance is consistent across reloads and
  // across mobile/desktop views.
  // ------------------------------------------------------------------
  function stationOffset(station, fuel) {
    // Deterministic pseudo-random based on station id + fuel
    const seed = (station.id * 2654435761 + hash(fuel)) >>> 0;
    const rand = (seed % 1000) / 1000; // 0..1
    // Range: -0.25 to +0.35 kr
    return -0.25 + rand * 0.6;
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  // ------------------------------------------------------------------
  // Load user reports from localStorage
  // ------------------------------------------------------------------
  function loadUserReports() {
    try {
      return JSON.parse(localStorage.getItem(USER_REPORTS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveUserReports(reports) {
    try {
      localStorage.setItem(USER_REPORTS_KEY, JSON.stringify(reports));
    } catch {}
  }

  // ------------------------------------------------------------------
  // Merge brand list prices into each station
  // ------------------------------------------------------------------
  function applyLivePrices(live, reports) {
    if (!window.STATIONS_DATA) return;
    const brands = live?.brands || {};
    const prevBrands = {}; // cached "yesterday" for trend
    window.STATIONS_DATA.forEach((s) => {
      const brandPrices = brands[s.brand];
      if (!brandPrices) return;

      FUEL_KEYS.forEach((fuel) => {
        const basePrice = brandPrices[fuel];
        const yPrice = brandPrices[`${fuel}_yesterday`];
        if (basePrice == null) {
          // Brand doesn't sell this fuel – remove from station
          delete s.prices[fuel];
          delete s.prices[`${fuel}_trend`];
          return;
        }
        const offset = stationOffset(s, fuel);
        const computed = +(basePrice + offset).toFixed(2);

        // Check for user-reported confirmed price
        const reportKey = `${s.id}:${fuel}`;
        const report = reports[reportKey];
        const ageMs = report ? Date.now() - report.t : Infinity;
        const REPORT_TTL = 6 * 60 * 60 * 1000; // 6 hours
        if (report && ageMs < REPORT_TTL) {
          s.prices[fuel] = report.price;
          s.prices[`${fuel}_source`] = "user";
          s.prices[`${fuel}_reportedAt`] = report.t;
        } else {
          s.prices[fuel] = computed;
          s.prices[`${fuel}_source`] = "listpris";
        }

        // Trend: today - yesterday (relative to brand list price change)
        if (yPrice != null) {
          s.prices[`${fuel}_trend`] = +(basePrice - yPrice).toFixed(2);
        } else {
          s.prices[`${fuel}_trend`] = 0;
        }
      });

      // Set updatedMinutesAgo based on live file timestamp
      if (live?.updated_at_unix) {
        const diffMin = Math.max(
          0,
          Math.round((Date.now() / 1000 - live.updated_at_unix) / 60)
        );
        s.updatedMinutesAgo = diffMin;
      }
    });
  }

  // ------------------------------------------------------------------
  // Fetch the live prices JSON with cache busting so users always see
  // the latest commit.
  // ------------------------------------------------------------------
  async function fetchLivePrices() {
    try {
      const url = `${LIVE_URL}?t=${Date.now()}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      window.LIVE_PRICES = json;
      const reports = loadUserReports();
      applyLivePrices(json, reports);
      document.dispatchEvent(
        new CustomEvent("tankkollen:prices", { detail: json })
      );
      return json;
    } catch (err) {
      console.warn("[Tankkollen] live prices unavailable:", err);
      window.LIVE_PRICES = null;
      // Station data keeps the baked-in fallback prices from stations.js
      document.dispatchEvent(
        new CustomEvent("tankkollen:prices", { detail: null })
      );
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Public API for user price reporting
  // ------------------------------------------------------------------
  window.tankkollenReportPrice = function (stationId, fuel, price) {
    if (typeof price !== "number" || price < 5 || price > 40) {
      throw new Error("Invalid price");
    }
    const reports = loadUserReports();
    reports[`${stationId}:${fuel}`] = {
      price: +price.toFixed(2),
      t: Date.now(),
    };
    saveUserReports(reports);
    // Re-apply immediately
    if (window.LIVE_PRICES) applyLivePrices(window.LIVE_PRICES, reports);
    document.dispatchEvent(
      new CustomEvent("tankkollen:reported", {
        detail: { stationId, fuel, price },
      })
    );
  };

  window.tankkollenGetLiveMeta = function () {
    return window.LIVE_PRICES
      ? {
          updatedAt: window.LIVE_PRICES.updated_at,
          ageMinutes: Math.round(
            (Date.now() / 1000 - window.LIVE_PRICES.updated_at_unix) / 60
          ),
          fetchStatus: window.LIVE_PRICES.fetch_status,
          source: window.LIVE_PRICES.source,
        }
      : null;
  };

  // ------------------------------------------------------------------
  // Auto-load + periodic refresh
  // ------------------------------------------------------------------
  fetchLivePrices();
  setInterval(fetchLivePrices, REFRESH_MS);
})();
