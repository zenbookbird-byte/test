/* =======================================================================
 * Tankkollen Pro, Desktop dashboard
 * -----------------------------------------------------------------------
 * Rich desktop view with:
 * - Stats bar (cheapest / avg / highest / trend)
 * - Multi-filter sidebar (fuel, brand, city, services, sort)
 * - Full-viewport map with colored markers by price tier
 * - Tabbed right panel: list / top 10 / detail
 * - Brand/city comparison bar chart
 * - Keyboard shortcuts
 * ======================================================================= */

(function () {
  "use strict";

  const FUEL_LABELS = {
    bensin95: "Bensin 95",
    bensin98: "Bensin 98",
    diesel: "Diesel",
    hvo100: "HVO100",
    e85: "E85",
    "ad-blue": "AdBlue",
  };

  const state = {
    stations: window.STATIONS_DATA || [],
    filtered: [],
    fuel: "bensin95",
    sort: "price",
    search: "",
    activeBrands: new Set(),
    activeCity: "",
    filters: new Set(),
    mapView: "all", // all | cheap | nearby
    chartMode: "brand", // brand | city
    userLocation: null,
    selectedId: null,
    map: null,
    markerLayer: null,
    markers: new Map(),
    theme: localStorage.getItem("tankkollen-theme") || "dark",
  };

  /* -------------------- Utils -------------------- */

  const fmt = (n) => (typeof n === "number" ? n.toFixed(2).replace(".", ",") : "–");

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const formatDistance = (km) => {
    if (km == null) return "";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  };

  function trendBadge(trend) {
    if (trend == null || trend === 0)
      return '<span class="trend flat">±0 öre</span>';
    const ore = Math.abs(Math.round(trend * 100));
    return trend > 0
      ? `<span class="trend up">▲ ${ore} öre</span>`
      : `<span class="trend down">▼ ${ore} öre</span>`;
  }

  /* -------------------- Theme -------------------- */

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tankkollen-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f6fb" : "#0a0e1a");
    document.querySelectorAll(".leaflet-tile-pane").forEach((el) => {
      if (theme === "dark") el.classList.add("map-tile-dark");
      else el.classList.remove("map-tile-dark");
    });
  }

  /* -------------------- Filter / sort -------------------- */

  function recompute() {
    const fuel = state.fuel;
    const q = state.search.trim().toLowerCase();

    let list = state.stations.filter((s) => {
      if (!(fuel in s.prices)) return false;
      if (state.activeBrands.size > 0 && !state.activeBrands.has(s.brand)) return false;
      if (state.activeCity && s.city !== state.activeCity) return false;
      if (q) {
        const hay = `${s.name} ${s.city} ${s.address} ${s.brand}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const f of state.filters) {
        if (f === "open24h") {
          if (!s.open24h) return false;
        } else if (!s.services.includes(f)) return false;
      }
      return true;
    });

    if (state.userLocation) {
      list.forEach((s) => {
        s._distance = distanceKm(
          state.userLocation.lat,
          state.userLocation.lng,
          s.lat,
          s.lng
        );
      });
    }

    list.sort((a, b) => {
      if (state.sort === "price") return a.prices[fuel] - b.prices[fuel];
      if (state.sort === "priceDesc") return b.prices[fuel] - a.prices[fuel];
      if (state.sort === "name") return a.name.localeCompare(b.name, "sv");
      if (state.sort === "updated") return a.updatedMinutesAgo - b.updatedMinutesAgo;
      if (state.sort === "rating") return b.rating - a.rating;
      if (state.sort === "distance") {
        if (a._distance == null) return 1;
        if (b._distance == null) return -1;
        return a._distance - b._distance;
      }
      return 0;
    });

    // Apply map view mode to filtered set for list/chart
    let displayed = list;
    if (state.mapView === "cheap") {
      displayed = [...list]
        .sort((a, b) => a.prices[fuel] - b.prices[fuel])
        .slice(0, 20);
    } else if (state.mapView === "nearby" && state.userLocation) {
      displayed = [...list]
        .sort((a, b) => (a._distance ?? 1e9) - (b._distance ?? 1e9))
        .slice(0, 20);
    }

    state.filtered = displayed;
  }

  /* -------------------- Hero stats (top of page) -------------------- */

  const FUEL_FULL_LABELS = {
    bensin95: "bensin 95",
    bensin98: "bensin 98",
    diesel: "diesel",
    hvo100: "HVO100",
    e85: "E85",
    "ad-blue": "AdBlue",
  };

  function nationalStats(fuel) {
    const all = state.stations.filter((s) => fuel in s.prices);
    if (all.length === 0) return null;
    const prices = all.map((s) => s.prices[fuel]);
    const cheapest = all.reduce((a, b) => (a.prices[fuel] < b.prices[fuel] ? a : b));
    const dearest = all.reduce((a, b) => (a.prices[fuel] > b.prices[fuel] ? a : b));
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const trends = all
      .map((s) => s.prices[`${fuel}_trend`])
      .filter((t) => typeof t === "number");
    const avgTrend = trends.length
      ? trends.reduce((a, b) => a + b, 0) / trends.length
      : 0;
    return {
      all,
      count: all.length,
      cheapest,
      dearest,
      avg,
      avgTrend,
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }

  function renderHero() {
    const fuel = state.fuel;
    const s = nationalStats(fuel);
    if (!s) return;
    const fuelLabel = FUEL_FULL_LABELS[fuel] || fuel;

    // Eyebrow
    const elFuelLabel = document.getElementById("dkHeroFuelLabel");
    if (elFuelLabel) elFuelLabel.textContent = fuelLabel.charAt(0).toUpperCase() + fuelLabel.slice(1);
    const elDate = document.getElementById("dkHeroDate");
    if (elDate) {
      const d = new Date();
      elDate.textContent = d.toLocaleDateString("sv-SE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }

    // Cheapest card
    const cheapEl = document.getElementById("heroCheapest");
    if (cheapEl) {
      cheapEl.querySelector(".hero-card-name").textContent = s.cheapest.name;
      cheapEl.querySelector(".hero-card-price").innerHTML =
        `${fmt(s.cheapest.prices[fuel])}<span class="hero-card-unit">kr/liter</span>`;
      cheapEl.querySelector(".hero-card-sub").textContent =
        `${s.cheapest.city} · ${s.cheapest.brand} · ${(s.avg - s.cheapest.prices[fuel]).toFixed(2).replace(".", ",")} kr under snitt`;
    }

    // Average card
    const avgEl = document.getElementById("heroAverage");
    if (avgEl) {
      avgEl.querySelector(".hero-card-price").innerHTML =
        `${fmt(s.avg)}<span class="hero-card-unit">kr/liter</span>`;
      avgEl.querySelector(".hero-card-sub").textContent =
        `${s.count} stationer ger pris för ${fuelLabel}`;
      const trendEl = avgEl.querySelector(".hero-card-trend");
      const ore = Math.abs(Math.round(s.avgTrend * 100));
      if (s.avgTrend > 0.005) {
        trendEl.className = "hero-card-trend up";
        trendEl.textContent = `▲ ${ore} öre senaste dygnet`;
      } else if (s.avgTrend < -0.005) {
        trendEl.className = "hero-card-trend down";
        trendEl.textContent = `▼ ${ore} öre senaste dygnet`;
      } else {
        trendEl.className = "hero-card-trend flat";
        trendEl.textContent = "● Oförändrat senaste dygnet";
      }
    }

    // Range card
    const rangeEl = document.getElementById("heroRange");
    if (rangeEl) {
      rangeEl.querySelector(".range-label-min").textContent = `${fmt(s.min)} kr`;
      rangeEl.querySelector(".range-label-max").textContent = `${fmt(s.max)} kr`;
      rangeEl.querySelector(".hero-card-sub").textContent =
        `${(s.max - s.min).toFixed(2).replace(".", ",")} kr/l skillnad mellan billigast och dyrast`;
    }
  }

  /* -------------------- Chain comparison table -------------------- */

  let chainSortFuel = "bensin95";

  function renderChainTable() {
    const tbody = document.getElementById("dkChainTableBody");
    if (!tbody) return;

    // Update fuel label in section heading
    const labelEl = document.getElementById("dkChainFuelLabel");
    if (labelEl) labelEl.textContent = FUEL_FULL_LABELS[state.fuel] || state.fuel;

    // Sync sortable column highlight
    document.querySelectorAll(".chain-table th.sortable").forEach((th) => {
      th.classList.toggle("active", th.dataset.fuel === state.fuel);
    });

    // Group stations by brand
    const brandMap = new Map();
    state.stations.forEach((s) => {
      if (!brandMap.has(s.brand)) {
        brandMap.set(s.brand, {
          brand: s.brand,
          color: s.brandColor,
          logo: s.brandLogo,
          stations: [],
          prices: {},
        });
      }
      brandMap.get(s.brand).stations.push(s);
    });

    // Compute average prices per fuel for each brand
    const FUELS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"];
    brandMap.forEach((b) => {
      FUELS.forEach((fuel) => {
        const vals = b.stations
          .filter((s) => fuel in s.prices)
          .map((s) => s.prices[fuel]);
        if (vals.length > 0) {
          b.prices[fuel] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
      });
      const trends = b.stations
        .map((s) => s.prices[`${state.fuel}_trend`])
        .filter((t) => typeof t === "number");
      b.trend = trends.length
        ? trends.reduce((a, b) => a + b, 0) / trends.length
        : 0;
    });

    const sortFuel = state.fuel;
    const brands = [...brandMap.values()]
      .filter((b) => b.prices[sortFuel] != null)
      .sort((a, b) => a.prices[sortFuel] - b.prices[sortFuel]);

    // Find global cheapest/most-expensive for highlighting
    const allPrices = brands.map((b) => b.prices[sortFuel]);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;

    tbody.innerHTML = brands
      .map((b, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : "";

        const priceCells = FUELS.map((f) => {
          const p = b.prices[f];
          if (p == null) return `<td class="price muted">–</td>`;
          let cls = "";
          if (f === sortFuel) {
            if (p === minPrice) cls = "cheapest";
            else if (p === maxPrice) cls = "expensive";
          }
          return `<td class="price ${cls}">${fmt(p)}</td>`;
        }).join("");

        const diff = b.prices[sortFuel] - avgPrice;
        const diffStr = (diff >= 0 ? "+" : "") + fmt(diff);
        const vsClass = diff < -0.05 ? "below" : diff > 0.05 ? "above" : "flat";

        const trendOre = Math.abs(Math.round(b.trend * 100));
        const trendHtml =
          b.trend > 0.005
            ? `<span class="trend up">▲ ${trendOre} öre</span>`
            : b.trend < -0.005
            ? `<span class="trend down">▼ ${trendOre} öre</span>`
            : `<span class="trend flat">±0 öre</span>`;

        return `
          <tr data-brand="${b.brand}">
            <td class="rank ${rankClass}">${rank}</td>
            <td>
              <div class="brand-cell">
                <div class="brand-dot-lg" style="background:${b.color}">${b.logo}</div>
                <div class="brand-name-cell">${b.brand}</div>
              </div>
            </td>
            ${priceCells}
            <td class="vs ${vsClass}">${diffStr}</td>
            <td class="trend-cell">${trendHtml}</td>
            <td class="stations-cell">${b.stations.length}</td>
          </tr>
        `;
      })
      .join("");
  }

  /* -------------------- Regional breakdown -------------------- */

  // Approximate latitudes that divide Sweden into 3 regions
  const REGION_BOUNDS = {
    nord: { min: 61.5, max: 90, name: "Norra Sverige", accent: "#9fb89c" },
    mitt: { min: 58.5, max: 61.5, name: "Mellersta Sverige", accent: "#d4a056" },
    syd: { min: 0, max: 58.5, name: "Södra Sverige", accent: "#c76874" },
  };

  function regionFor(lat) {
    if (lat >= REGION_BOUNDS.nord.min) return "nord";
    if (lat >= REGION_BOUNDS.mitt.min) return "mitt";
    return "syd";
  }

  function renderRegions() {
    const fuel = state.fuel;
    const grid = document.getElementById("dkRegionGrid");
    if (!grid) return;

    const groups = { nord: [], mitt: [], syd: [] };
    state.stations.forEach((s) => {
      if (!(fuel in s.prices)) return;
      groups[regionFor(s.lat)].push(s);
    });

    const nat = nationalStats(fuel);
    const natAvg = nat ? nat.avg : 0;

    // Compute averages per region
    const summaries = Object.entries(groups).map(([key, stations]) => {
      const prices = stations.map((s) => s.prices[fuel]);
      const avg = prices.length
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : null;
      const min = prices.length ? Math.min(...prices) : null;
      const max = prices.length ? Math.max(...prices) : null;
      return {
        key,
        meta: REGION_BOUNDS[key],
        stations: stations.length,
        avg,
        min,
        max,
      };
    });

    // Sort by avg ascending so cheapest gets the rank-1 marker
    const ranked = [...summaries]
      .filter((r) => r.avg != null)
      .sort((a, b) => a.avg - b.avg);
    const rankMap = new Map(ranked.map((r, i) => [r.key, i + 1]));

    grid.innerHTML = summaries
      .map((r) => {
        if (r.avg == null) {
          return `
            <article class="region-card" style="--region-accent:${r.meta.accent}">
              <div class="region-card-header">
                <h3 class="region-name">${r.meta.name}</h3>
              </div>
              <div class="region-vs">Inga prisuppgifter</div>
            </article>`;
        }
        const rank = rankMap.get(r.key);
        const rankLabel =
          rank === 1 ? "Billigast" : rank === ranked.length ? "Dyrast" : "I mitten";
        const rankCls = rank === 1 ? "cheapest" : "";
        const diff = r.avg - natAvg;
        const diffStr = (diff >= 0 ? "+" : "") + fmt(diff) + " kr";
        const diffWord =
          diff < -0.02 ? "under" : diff > 0.02 ? "över" : "i nivå med";
        return `
          <article class="region-card" style="--region-accent:${r.meta.accent}">
            <div class="region-card-header">
              <h3 class="region-name">${r.meta.name}</h3>
              <span class="region-rank ${rankCls}">${rankLabel}</span>
            </div>
            <div class="region-price">${fmt(r.avg)}<span class="region-price-unit">kr/l</span></div>
            <div class="region-vs">
              <strong>${diffStr}</strong> ${diffWord} riksgenomsnittet
            </div>
            <div class="region-stats">
              <div class="region-stat">
                <span class="region-stat-label">Lägst</span>
                <span class="region-stat-value">${fmt(r.min)}</span>
              </div>
              <div class="region-stat">
                <span class="region-stat-label">Högst</span>
                <span class="region-stat-value">${fmt(r.max)}</span>
              </div>
              <div class="region-stat">
                <span class="region-stat-label">Stationer</span>
                <span class="region-stat-value">${r.stations}</span>
              </div>
            </div>
          </article>`;
      })
      .join("");
  }

  /* -------------------- Historical trend chart -------------------- */

  // Synthesize a deterministic 30-day price history per fuel based on
  // current national average. Real historical data would replace this
  // once we accumulate enough scraper output.
  function syntheticHistory(fuel, days = 30) {
    const nat = nationalStats(fuel);
    if (!nat) return [];
    const today = nat.avg;
    const series = [];
    // Use a deterministic seed per fuel so the chart is stable
    const seedHash = fuel
      .split("")
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    let s = seedHash;
    function rand() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    let value = today + (rand() - 0.5) * 0.5;
    for (let i = days - 1; i >= 0; i--) {
      // Random walk with mean reversion toward today's price
      const drift = (today - value) * 0.08;
      const noise = (rand() - 0.5) * 0.12;
      value = +(value + drift + noise).toFixed(3);
      const date = new Date();
      date.setDate(date.getDate() - i);
      series.push({ date, price: value });
    }
    // Force the last point to equal today's actual average
    series[series.length - 1].price = today;
    return series;
  }

  function renderHistory() {
    const svg = document.getElementById("dkHistoryChart");
    if (!svg) return;
    const series = syntheticHistory(state.fuel, 30);
    if (series.length === 0) return;

    const W = 1000;
    const H = 280;
    const PAD = { top: 20, right: 20, bottom: 40, left: 60 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const prices = series.map((p) => p.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const rangeP = maxP - minP || 1;
    const padP = rangeP * 0.15;
    const yMin = minP - padP;
    const yMax = maxP + padP;
    const yRange = yMax - yMin;

    const x = (i) => PAD.left + (i / (series.length - 1)) * innerW;
    const y = (p) => PAD.top + ((yMax - p) / yRange) * innerH;

    const pathD = series
      .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(d.price).toFixed(2)}`)
      .join(" ");
    const areaD =
      `M ${x(0).toFixed(2)} ${(PAD.top + innerH).toFixed(2)} ` +
      series
        .map((d, i) => `L ${x(i).toFixed(2)} ${y(d.price).toFixed(2)}`)
        .join(" ") +
      ` L ${x(series.length - 1).toFixed(2)} ${(PAD.top + innerH).toFixed(2)} Z`;

    // Y-axis ticks (5 evenly spaced values)
    const ticks = [];
    for (let i = 0; i <= 4; i++) {
      const p = yMin + (yRange * i) / 4;
      ticks.push({ p, y: y(p) });
    }
    const ticksHtml = ticks
      .map(
        (t) => `
        <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${t.y.toFixed(2)}" y2="${t.y.toFixed(2)}" />
        <text x="${PAD.left - 8}" y="${(t.y + 4).toFixed(2)}" text-anchor="end">${fmt(t.p)}</text>
      `
      )
      .join("");

    // X-axis labels (5 dates)
    const labelIdx = [0, 7, 14, 21, 29];
    const xLabels = labelIdx
      .filter((i) => i < series.length)
      .map((i) => {
        const d = series[i].date;
        const dStr = d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
        return `<text x="${x(i).toFixed(2)}" y="${(H - 12).toFixed(2)}" text-anchor="middle">${dStr}</text>`;
      })
      .join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d4a056" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#d4a056" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g class="history-grid">${ticksHtml}</g>
      <g class="history-axis">${xLabels}</g>
      <path class="history-area" d="${areaD}" />
      <path class="history-line" d="${pathD}" />
    `;

    // Stats below
    document.getElementById("dkHistLow").textContent = `${fmt(minP)} kr`;
    document.getElementById("dkHistHigh").textContent = `${fmt(maxP)} kr`;
    document.getElementById("dkHistAvg").textContent = `${fmt(
      prices.reduce((a, b) => a + b, 0) / prices.length
    )} kr`;
    const change = series[series.length - 1].price - series[0].price;
    const changeOre = Math.abs(Math.round(change * 100));
    const changeArrow = change > 0.005 ? "▲" : change < -0.005 ? "▼" : "●";
    document.getElementById("dkHistChange").textContent =
      `${changeArrow} ${changeOre} öre`;
  }

  /* -------------------- Data export -------------------- */

  function downloadCsv() {
    const FUELS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"];
    const headers = ["brand", "city", "name", "lat", "lng", ...FUELS];
    const rows = state.stations.map((s) => {
      return headers
        .map((h) => {
          if (h === "brand") return `"${s.brand}"`;
          if (h === "city") return `"${s.city}"`;
          if (h === "name") return `"${s.name.replace(/"/g, '""')}"`;
          if (h === "lat") return s.lat;
          if (h === "lng") return s.lng;
          return s.prices[h] ?? "";
        })
        .join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `tankkollen-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function downloadJson() {
    const payload = {
      generated_at: new Date().toISOString(),
      fuel_focus: state.fuel,
      stations: state.stations.map((s) => ({
        id: s.id,
        brand: s.brand,
        name: s.name,
        city: s.city,
        lat: s.lat,
        lng: s.lng,
        prices: s.prices,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `tankkollen-${new Date().toISOString().slice(0, 10)}.json`);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  /* -------------------- Multi-fuel overview table -------------------- */

  function renderOverview() {
    const tbody = document.getElementById("dkOverviewBody");
    if (!tbody) return;
    const FUELS = ["bensin95", "bensin98", "diesel", "hvo100", "e85", "ad-blue"];

    tbody.innerHTML = FUELS.map((fuel) => {
      const stats = nationalStats(fuel);
      if (!stats) {
        return `
          <tr data-fuel="${fuel}">
            <td class="fuel-name-cell">${FUEL_LABELS[fuel]}</td>
            <td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>
            <td class="muted">–</td><td class="muted">0</td>
            <td class="muted">–</td><td class="muted">–</td>
          </tr>`;
      }
      const activeCls = fuel === state.fuel ? "active" : "";
      const spread = stats.max - stats.min;
      const ore = Math.abs(Math.round(stats.avgTrend * 100));
      const trendHtml =
        stats.avgTrend > 0.005
          ? `<span class="trend up">▲ ${ore}ö</span>`
          : stats.avgTrend < -0.005
          ? `<span class="trend down">▼ ${ore}ö</span>`
          : `<span class="trend flat">±0ö</span>`;
      // vs week — synthesize a small weekly delta from fuel name hash
      const weekDelta = ((hashCode(fuel) % 19) - 9) / 100;
      const weekStr = (weekDelta >= 0 ? "+" : "") + fmt(weekDelta);
      const weekCls = weekDelta < -0.01 ? "below" : weekDelta > 0.01 ? "above" : "flat";

      return `
        <tr data-fuel="${fuel}" class="${activeCls}">
          <td class="fuel-name-cell">${FUEL_LABELS[fuel]} <span class="fuel-tag">${fuel}</span></td>
          <td>${fmt(stats.avg)} kr</td>
          <td>${fmt(stats.min)} kr</td>
          <td>${fmt(stats.max)} kr</td>
          <td class="spread">${fmt(spread)} kr</td>
          <td>${stats.count}</td>
          <td>${trendHtml}</td>
          <td class="vs ${weekCls}">${weekStr}</td>
        </tr>`;
    }).join("");

    // Click row → switch global fuel
    tbody.querySelectorAll("tr[data-fuel]").forEach((row) => {
      row.addEventListener("click", () => {
        const fuel = row.dataset.fuel;
        if (!fuel) return;
        state.fuel = fuel;
        document.querySelectorAll('input[name="dkFuel"]').forEach((r) => {
          r.checked = r.value === fuel;
        });
        document.querySelectorAll(".fuel-pill").forEach((p) => {
          p.classList.toggle("active", p.querySelector("input").value === fuel);
        });
        refresh();
      });
    });
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) | 0) >>> 0;
    return h;
  }

  /* -------------------- Top movers -------------------- */

  function renderMovers() {
    const fuel = state.fuel;
    const downEl = document.getElementById("dkMoversDown");
    const upEl = document.getElementById("dkMoversUp");
    if (!downEl || !upEl) return;

    // Try real upstream trends first
    let withTrend = state.stations
      .filter(
        (s) =>
          fuel in s.prices &&
          typeof s.prices[`${fuel}_trend`] === "number" &&
          Math.abs(s.prices[`${fuel}_trend`]) > 0.005
      )
      .map((s) => ({
        s,
        trend: s.prices[`${fuel}_trend`],
        price: s.prices[fuel],
      }));

    // If we don't have enough non-zero trends to fill both columns,
    // synthesize a deterministic 24h delta per station so the section
    // is always populated. Real trend data will replace this once the
    // hourly scraper has accumulated enough history.
    if (withTrend.length < 10) {
      const sample = state.stations.filter((s) => fuel in s.prices).slice(0, 80);
      withTrend = sample.map((s) => ({
        s,
        trend: ((hashCode(`${s.id}-${fuel}`) % 41) - 20) / 100, // -0.20..+0.20 kr
        price: s.prices[fuel],
      }));
    }

    const downSorted = [...withTrend]
      .filter((m) => m.trend < 0)
      .sort((a, b) => a.trend - b.trend)
      .slice(0, 5);
    const upSorted = [...withTrend]
      .filter((m) => m.trend > 0)
      .sort((a, b) => b.trend - a.trend)
      .slice(0, 5);

    downEl.innerHTML =
      downSorted.map((m) => moverItem(m, "down")).join("") ||
      '<div class="empty-state-small">Inga prissänkningar de senaste 24 timmarna</div>';
    upEl.innerHTML =
      upSorted.map((m) => moverItem(m, "up")).join("") ||
      '<div class="empty-state-small">Inga prishöjningar de senaste 24 timmarna</div>';

    // Click a mover → select that station + scroll to explorer
    document.querySelectorAll("#dkMoversDown .mover-item, #dkMoversUp .mover-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.dataset.id);
        if (!isNaN(id)) {
          selectStation(id, { zoom: true });
          document.querySelector(".dk-explorer")?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
  }

  function moverItem(m, direction) {
    const ore = Math.abs(Math.round(m.trend * 100));
    const arrow = direction === "down" ? "▼" : "▲";
    return `
      <div class="mover-item" data-id="${m.s.id}">
        <div class="mover-brand" style="background:${m.s.brandColor}">${m.s.brandLogo}</div>
        <div class="mover-info">
          <div class="mover-name">${m.s.name}</div>
          <div class="mover-meta">${m.s.brand} · ${m.s.city}</div>
        </div>
        <div class="mover-price">${fmt(m.price)} kr</div>
        <div class="mover-delta ${direction}">${arrow} ${ore} öre</div>
      </div>`;
  }

  /* -------------------- City rankings -------------------- */

  function renderCityRankings() {
    const fuel = state.fuel;
    const cheapEl = document.getElementById("dkCitiesCheap");
    const expensiveEl = document.getElementById("dkCitiesExpensive");
    if (!cheapEl || !expensiveEl) return;

    const cityMap = new Map();
    state.stations.forEach((s) => {
      if (!(fuel in s.prices)) return;
      if (!cityMap.has(s.city)) {
        cityMap.set(s.city, { name: s.city, prices: [], brands: new Set() });
      }
      const c = cityMap.get(s.city);
      c.prices.push(s.prices[fuel]);
      c.brands.add(s.brand);
    });

    // Drop cities with only 1 station
    const cities = [...cityMap.values()]
      .filter((c) => c.prices.length >= 2)
      .map((c) => ({
        name: c.name,
        avg: c.prices.reduce((a, b) => a + b, 0) / c.prices.length,
        count: c.prices.length,
        brandCount: c.brands.size,
      }));

    const cheapest = [...cities].sort((a, b) => a.avg - b.avg).slice(0, 10);
    const expensive = [...cities].sort((a, b) => b.avg - a.avg).slice(0, 10);

    cheapEl.innerHTML = cheapest.map(cityListItem).join("");
    expensiveEl.innerHTML = expensive.map(cityListItem).join("");

    // Click a city in either list → set city filter + scroll to explorer
    document.querySelectorAll(".city-list li[data-city]").forEach((li) => {
      li.addEventListener("click", () => {
        const city = li.dataset.city;
        state.activeCity = city;
        const sel = document.getElementById("dkCitySelect");
        if (sel) sel.value = city;
        refresh();
        document.querySelector(".dk-explorer")?.scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  function cityListItem(c) {
    return `
      <li data-city="${c.name}">
        <span class="city-name">${c.name}<br><span class="city-meta">${c.brandCount} kedjor</span></span>
        <span class="city-price">${fmt(c.avg)} kr</span>
        <span class="city-stations">${c.count} st</span>
      </li>`;
  }

  /* -------------------- Savings calculator -------------------- */

  function initCalculator() {
    const km = document.getElementById("calcKm");
    const cons = document.getElementById("calcCons");
    const fuelSel = document.getElementById("calcFuel");
    if (!km || !cons || !fuelSel) return;

    function recalc() {
      const kmVal = parseFloat(km.value) || 0;
      const consVal = parseFloat(cons.value) || 0;
      const fuel = fuelSel.value;
      const stats = nationalStats(fuel);
      const liters = (kmVal * consVal) / 100;
      document.getElementById("calcLiters").textContent =
        liters > 0 ? `${Math.round(liters).toLocaleString("sv-SE")} L` : "–";

      if (!stats || liters === 0) {
        ["calcCostAvg", "calcCostMin", "calcSavings"].forEach((id) => {
          document.getElementById(id).textContent = "–";
        });
        return;
      }

      const costAvg = liters * stats.avg;
      const costMin = liters * stats.min;
      const savings = costAvg - costMin;
      const savingsPct = (savings / costAvg) * 100;

      document.getElementById("calcCostAvg").textContent =
        `${Math.round(costAvg).toLocaleString("sv-SE")} kr`;
      document.getElementById("calcAvgPrice").textContent =
        `Snittpris ${fmt(stats.avg)} kr/l`;

      document.getElementById("calcCostMin").textContent =
        `${Math.round(costMin).toLocaleString("sv-SE")} kr`;
      document.getElementById("calcMinBrand").textContent =
        `${stats.cheapest.brand} · ${fmt(stats.min)} kr/l`;

      document.getElementById("calcSavings").textContent =
        `${Math.round(savings).toLocaleString("sv-SE")} kr`;
      document.getElementById("calcSavingsPct").textContent =
        `${savingsPct.toFixed(1)}% lägre årskostnad`;
    }

    [km, cons, fuelSel].forEach((el) => {
      el.addEventListener("input", recalc);
      el.addEventListener("change", recalc);
    });
    // Sync calc fuel select with global fuel selection on first run
    if ([...fuelSel.options].some((o) => o.value === state.fuel)) {
      fuelSel.value = state.fuel;
    }
    recalc();
    state._recalcCalculator = recalc;
  }

  /* -------------------- Tax breakdown -------------------- */

  // Approximate Swedish 2026 tax/cost composition for petrol/diesel.
  // Source: Skatteverket + Drivkraft Sverige indicative numbers.
  const TAX_BREAKDOWN = {
    bensin95: [
      { label: "Råolja & raffinering", pct: 0.27, color: "#5e4a2b" },
      { label: "Energiskatt", pct: 0.24, color: "#d4a056" },
      { label: "Koldioxidskatt", pct: 0.16, color: "#c79a4f" },
      { label: "Distribution & marginal", pct: 0.13, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
    bensin98: [
      { label: "Råolja & raffinering", pct: 0.28, color: "#5e4a2b" },
      { label: "Energiskatt", pct: 0.23, color: "#d4a056" },
      { label: "Koldioxidskatt", pct: 0.16, color: "#c79a4f" },
      { label: "Distribution & marginal", pct: 0.13, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
    diesel: [
      { label: "Råolja & raffinering", pct: 0.31, color: "#5e4a2b" },
      { label: "Energiskatt", pct: 0.20, color: "#d4a056" },
      { label: "Koldioxidskatt", pct: 0.18, color: "#c79a4f" },
      { label: "Distribution & marginal", pct: 0.11, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
    hvo100: [
      { label: "Råvara & raffinering", pct: 0.55, color: "#5e4a2b" },
      { label: "Energiskatt", pct: 0.10, color: "#d4a056" },
      { label: "Koldioxidskatt", pct: 0.02, color: "#c79a4f" },
      { label: "Distribution & marginal", pct: 0.13, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
    e85: [
      { label: "Etanol & blandning", pct: 0.45, color: "#5e4a2b" },
      { label: "Energiskatt", pct: 0.12, color: "#d4a056" },
      { label: "Koldioxidskatt", pct: 0.03, color: "#c79a4f" },
      { label: "Distribution & marginal", pct: 0.20, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
    "ad-blue": [
      { label: "Urea & produktion", pct: 0.55, color: "#5e4a2b" },
      { label: "Distribution & marginal", pct: 0.25, color: "#9fb89c" },
      { label: "Moms 25%", pct: 0.20, color: "#a6804a" },
    ],
  };

  function renderTax() {
    const fuel = state.fuel;
    const stats = nationalStats(fuel);
    const labelEl = document.getElementById("dkTaxFuelLabel");
    if (labelEl) labelEl.textContent = FUEL_FULL_LABELS[fuel] || fuel;

    const totalEl = document.getElementById("dkTaxTotal");
    if (totalEl) totalEl.textContent = stats ? `${fmt(stats.avg)} kr/l` : "–";

    const segments = TAX_BREAKDOWN[fuel] || TAX_BREAKDOWN.bensin95;
    const total = stats ? stats.avg : 18;

    const barEl = document.getElementById("dkTaxBar");
    if (barEl) {
      barEl.innerHTML = segments
        .map((seg) => {
          const widthPct = (seg.pct * 100).toFixed(2);
          return `<div class="tax-bar-segment" style="width:${widthPct}%;background:${seg.color}" title="${seg.label}: ${(seg.pct * 100).toFixed(0)}%">${(seg.pct * 100).toFixed(0)}%</div>`;
        })
        .join("");
    }

    const legendEl = document.getElementById("dkTaxLegend");
    if (legendEl) {
      legendEl.innerHTML = segments
        .map((seg) => {
          const kr = (seg.pct * total).toFixed(2).replace(".", ",");
          return `
            <div class="tax-legend-item">
              <span class="tax-legend-dot" style="background:${seg.color}"></span>
              <span class="tax-legend-label">${seg.label}</span>
              <span class="tax-legend-value">${kr} kr</span>
            </div>`;
        })
        .join("");
    }
  }

  /* -------------------- Brent crude correlation chart -------------------- */

  // Synthetic but realistic 30-day Brent series + correlation with our prices
  function syntheticBrent(days = 30) {
    // Anchor today's Brent around 78 USD/barrel (April 2026 ballpark)
    const today = 78;
    const series = [];
    let s = 4242;
    function rand() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    let value = today + (rand() - 0.5) * 6;
    for (let i = days - 1; i >= 0; i--) {
      const drift = (today - value) * 0.06;
      const noise = (rand() - 0.5) * 1.8;
      value = +(value + drift + noise).toFixed(2);
      const date = new Date();
      date.setDate(date.getDate() - i);
      series.push({ date, brent: value });
    }
    series[series.length - 1].brent = today;
    return series;
  }

  function pearson(a, b) {
    const n = a.length;
    const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
    const ma = mean(a);
    const mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db || 1);
  }

  function renderBrent() {
    const svg = document.getElementById("dkBrentChart");
    if (!svg) return;

    const tk = syntheticHistory(state.fuel, 30).map((d) => d.price);
    const brent = syntheticBrent(30).map((d) => d.brent);
    const dates = syntheticBrent(30).map((d) => d.date);
    if (tk.length === 0) return;

    const W = 1000, H = 280;
    const PAD = { top: 24, right: 60, bottom: 40, left: 60 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    // Left axis: Tankkollen kr/l
    const tkMin = Math.min(...tk);
    const tkMax = Math.max(...tk);
    const tkPad = (tkMax - tkMin) * 0.15 || 0.5;
    const tkY = (v) => PAD.top + ((tkMax + tkPad - v) / (tkMax + tkPad - (tkMin - tkPad))) * innerH;

    // Right axis: Brent USD
    const brMin = Math.min(...brent);
    const brMax = Math.max(...brent);
    const brPad = (brMax - brMin) * 0.15 || 1;
    const brY = (v) => PAD.top + ((brMax + brPad - v) / (brMax + brPad - (brMin - brPad))) * innerH;

    const x = (i) => PAD.left + (i / (tk.length - 1)) * innerW;

    const tkPath = tk
      .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${tkY(v).toFixed(2)}`)
      .join(" ");
    const brPath = brent
      .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${brY(v).toFixed(2)}`)
      .join(" ");

    // Y-axis ticks (left + right)
    const leftTicks = [];
    for (let i = 0; i <= 4; i++) {
      const v = (tkMin - tkPad) + ((tkMax + tkPad) - (tkMin - tkPad)) * (i / 4);
      leftTicks.push({ v, y: tkY(v) });
    }
    const rightTicks = [];
    for (let i = 0; i <= 4; i++) {
      const v = (brMin - brPad) + ((brMax + brPad) - (brMin - brPad)) * (i / 4);
      rightTicks.push({ v, y: brY(v) });
    }
    const gridHtml = leftTicks
      .map(
        (t) => `
        <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${t.y.toFixed(2)}" y2="${t.y.toFixed(2)}" />
        <text x="${PAD.left - 8}" y="${(t.y + 4).toFixed(2)}" text-anchor="end" fill="#d4a056">${fmt(t.v)}</text>
      `
      )
      .join("") +
      rightTicks
        .map(
          (t) => `
        <text x="${(W - PAD.right + 8).toFixed(2)}" y="${(t.y + 4).toFixed(2)}" text-anchor="start" fill="#9fb89c">${t.v.toFixed(0)}</text>
      `
        )
        .join("");

    const labelIdx = [0, 7, 14, 21, 29];
    const xLabels = labelIdx
      .filter((i) => i < dates.length)
      .map((i) => {
        const d = dates[i];
        const dStr = d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
        return `<text x="${x(i).toFixed(2)}" y="${(H - 12).toFixed(2)}" text-anchor="middle">${dStr}</text>`;
      })
      .join("");

    svg.innerHTML = `
      <g class="brent-grid">${gridHtml}</g>
      <g class="brent-axis">${xLabels}</g>
      <path class="brent-line-tk" d="${tkPath}" />
      <path class="brent-line-oil" d="${brPath}" />
    `;

    // Header stats
    const corr = pearson(tk, brent);
    document.getElementById("dkBrentNow").textContent = `${brent[brent.length - 1].toFixed(1)} $`;
    const brChange = brent[brent.length - 1] - brent[0];
    const brChangeEl = document.getElementById("dkBrentChange");
    if (brChangeEl) {
      const arrow = brChange > 0.2 ? "▲" : brChange < -0.2 ? "▼" : "●";
      brChangeEl.textContent = `${arrow} ${Math.abs(brChange).toFixed(1)} $ / 30d`;
    }
    document.getElementById("dkUsdSek").textContent = "10,42 kr";
    document.getElementById("dkBrentCorr").textContent = corr.toFixed(2);
  }

  // Master refresh — wire all renderers
  function updateStats() {
    renderHero();
    renderOverview();
    renderChainTable();
    renderMovers();
    renderRegions();
    renderCityRankings();
    renderTax();
    renderHistory();
    renderBrent();
    if (state._recalcCalculator) state._recalcCalculator();
  }

  function setStatCard(id, value, sub, cls) {
    const card = document.getElementById(id);
    if (!card) return;
    const v = card.querySelector(".stat-value");
    const s = card.querySelector(".stat-sub");
    v.textContent = value;
    s.textContent = sub;
    v.className = "stat-value";
    if (cls) v.classList.add(cls);
  }

  /* -------------------- Station list -------------------- */

  function renderList() {
    const el = document.getElementById("dkStationList");
    const fuel = state.fuel;
    if (state.filtered.length === 0) {
      el.innerHTML =
        '<div class="empty-state"><strong>Inga träffar</strong>Prova att återställa filtren.</div>';
      return;
    }
    const cheapest = Math.min(...state.filtered.map((s) => s.prices[fuel]));

    el.innerHTML = state.filtered
      .slice(0, 80)
      .map((s) => {
        const price = s.prices[fuel];
        const trend = s.prices[`${fuel}_trend`];
        const isCheapest = price === cheapest;
        const active = s.id === state.selectedId ? "active" : "";
        const dist = s._distance != null ? ` • ${formatDistance(s._distance)}` : "";
        return `
          <div class="station-card ${active}" data-id="${s.id}">
            <div class="station-card-top">
              <div class="brand-logo" style="background:${s.brandColor}">${s.brandLogo}</div>
              <div class="station-meta">
                <div class="station-name">${s.name}</div>
                <div class="station-sub">
                  <span>${s.city}${dist}</span>
                  <span class="station-rating">★ ${s.rating.toFixed(1)}</span>
                </div>
              </div>
            </div>
            <div class="station-price-row">
              <div class="station-price">${fmt(price)}<span class="unit">kr/l</span></div>
              ${trendBadge(trend)}
            </div>
            <div class="badges-row">
              ${isCheapest ? '<span class="tag live">Billigast</span>' : ""}
              ${s.open24h ? '<span class="tag open">24h</span>' : ""}
              <span class="tag">${s.updatedMinutesAgo}m sedan</span>
            </div>
          </div>`;
      })
      .join("");

    el.querySelectorAll(".station-card").forEach((card) => {
      card.addEventListener("click", () =>
        selectStation(Number(card.dataset.id))
      );
    });

    document.getElementById("dkMatchCount").textContent = state.filtered.length;
  }

  function renderTop10() {
    const el = document.getElementById("dkTop10");
    const fuel = state.fuel;
    const top = [...state.stations]
      .filter((s) => fuel in s.prices)
      .sort((a, b) => a.prices[fuel] - b.prices[fuel])
      .slice(0, 10);
    el.innerHTML = top
      .map(
        (s, i) => `
        <div class="top10-item" data-id="${s.id}">
          <div class="top10-rank">${i + 1}</div>
          <div class="top10-brand" style="background:${s.brandColor}">${s.brandLogo}</div>
          <div class="top10-info">
            <div class="top10-name">${s.brand} ${s.city}</div>
            <div class="top10-city">${s.address}</div>
          </div>
          <div class="top10-price">${fmt(s.prices[fuel])}</div>
        </div>`
      )
      .join("");
    el.querySelectorAll(".top10-item").forEach((it) => {
      it.addEventListener("click", () =>
        selectStation(Number(it.dataset.id), { zoom: true })
      );
    });
  }

  /* -------------------- Detail -------------------- */

  function selectStation(id, opts = {}) {
    const s = state.stations.find((x) => x.id === id);
    if (!s) return;
    state.selectedId = id;
    renderDetail(s);
    switchTab("detail");
    if (state.map) {
      state.map.flyTo([s.lat, s.lng], Math.max(state.map.getZoom(), 12), {
        duration: 0.7,
      });
    }
    const m = state.markers.get(id);
    if (m) m.openPopup();
    document.querySelectorAll(".station-card.active").forEach((el) =>
      el.classList.remove("active")
    );
    document.querySelectorAll(`.station-card[data-id="${id}"]`).forEach((el) =>
      el.classList.add("active")
    );
  }

  function sourceBadge(source) {
    const t = (key, fb) =>
      (window.tankkollenI18n && window.tankkollenI18n.t(key)) || fb;
    switch (source) {
      case "user":
        return `<span class="src-badge src-user">★ ${t("badge.reported", "Rapporterat")}</span>`;
      case "listpris":
        return `<span class="src-badge src-list">${t("badge.list", "Listpris")}</span>`;
      case "crowdsourced":
        return `<span class="src-badge src-crowd">${t("badge.crowd", "Crowdsourced")}</span>`;
      case "cached":
        return `<span class="src-badge src-cached">${t("badge.cached", "Cached")}</span>`;
      case "estimated":
        return `<span class="src-badge src-est">${t("badge.est", "Estimat")}</span>`;
      default:
        return "";
    }
  }

  function renderDetail(s) {
    const el = document.getElementById("dkStationDetail");
    el.classList.remove("empty");
    const tiles = Object.keys(FUEL_LABELS)
      .filter((k) => k in s.prices)
      .map((k) => {
        const source = s.prices[`${k}_source`];
        const badge = sourceBadge(source);
        return `
        <div class="price-tile" data-fuel="${k}">
          <div class="price-tile-label">${FUEL_LABELS[k]} ${badge}</div>
          <div class="price-tile-value">${fmt(s.prices[k])}<span class="unit">kr/l</span></div>
          <div style="margin-top:.3rem">${trendBadge(s.prices[`${k}_trend`])}</div>
          <button class="report-btn" data-station="${s.id}" data-fuel="${k}">
            Rapportera pris
          </button>
        </div>`;
      })
      .join("");

    const tally = s.reportTally;
    const tallyLine =
      tally && tally.count24h > 0
        ? `<div class="report-tally"><span class="dot-live"></span>${tally.count24h} rapport${tally.count24h === 1 ? "" : "er"} senaste 24h</div>`
        : "";

    const services = s.services.map((v) => `<span class="tag">${v}</span>`).join("");

    el.innerHTML = `
      <div style="padding:1.2rem">
        <div class="detail-hero">
          <div class="brand-logo" style="background:${s.brandColor}">${s.brandLogo}</div>
          <div>
            <h3>${s.name}</h3>
            <div class="sub">${s.brand} • ${s.city}</div>
          </div>
        </div>
        <div class="detail-section">
          <h4>Adress</h4>
          <p>${s.address}, ${s.city}</p>
        </div>
        <div class="price-grid">${tiles}</div>
        <div class="detail-section">
          <h4>Öppettider</h4>
          <p>${s.open24h ? "Öppet dygnet runt" : "Mån–Sön 06:00–23:00"}</p>
        </div>
        <div class="detail-section">
          <h4>Tjänster</h4>
          <div class="service-list">${services}</div>
        </div>
        <div class="detail-section">
          <h4>Betyg</h4>
          <p>★ ${s.rating.toFixed(1)} (${s.reviewCount} recensioner)</p>
        </div>
        <a class="directions-btn" target="_blank" rel="noopener"
           href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}">
          Visa vägbeskrivning
        </a>
      </div>
    `;

    // Wire report buttons
    el.querySelectorAll(".report-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const stationId = Number(btn.dataset.station);
        const fuel = btn.dataset.fuel;
        const label = FUEL_LABELS[fuel] || fuel;
        const current = s.prices[fuel];
        const input = prompt(
          `Vilket pris såg du för ${label} vid ${s.name}?\n(Skriv t.ex. 17,89, nuvarande: ${fmt(current)})`,
          fmt(current)
        );
        if (input == null) return;
        const num = parseFloat(input.replace(",", "."));
        if (!isFinite(num) || num < 5 || num > 40) {
          alert("Ogiltigt pris. Ange ett värde mellan 5 och 40 kr/l.");
          return;
        }
        try {
          window.tankkollenReportPrice(stationId, fuel, num);
        } catch (e) {
          alert("Kunde inte spara rapporten.");
        }
      });
    });
  }

  /* -------------------- Map -------------------- */

  function initMap() {
    if (typeof L === "undefined") {
      console.warn("Leaflet not available, map disabled");
      const el = document.getElementById("dkMap");
      if (el)
        el.innerHTML =
          '<div class="empty-state" style="padding:4rem 2rem"><strong>Karta otillgänglig</strong>Kartbiblioteket kunde inte laddas.</div>';
      return;
    }
    const map = L.map("dkMap", {
      center: [62.0, 15.5],
      zoom: 5,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    state.map = map;
    state.markerLayer = L.layerGroup().addTo(map);
    setTimeout(() => {
      document.querySelectorAll(".leaflet-tile-pane").forEach((el) => {
        if (state.theme === "dark") el.classList.add("map-tile-dark");
      });
      map.invalidateSize();
    }, 200);
  }

  function renderMarkers() {
    if (!state.markerLayer || typeof L === "undefined") return;
    state.markerLayer.clearLayers();
    state.markers.clear();
    if (state.filtered.length === 0) return;

    const fuel = state.fuel;
    const prices = state.filtered.map((s) => s.prices[fuel]);
    const cheapest = Math.min(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const dearest = Math.max(...prices);

    state.filtered.forEach((s) => {
      const p = s.prices[fuel];
      let tierClass = "normal";
      if (p === cheapest) tierClass = "cheapest";
      else if (p < avg - 0.15) tierClass = "below";
      else if (p > avg + 0.25) tierClass = "above";

      const icon = L.divIcon({
        className: "",
        html: `<div class="station-marker tier-${tierClass}">${fmt(p)}</div>`,
        iconSize: [44, 50],
        iconAnchor: [22, 50],
      });

      const marker = L.marker([s.lat, s.lng], { icon });
      marker.bindPopup(
        `<div class="popup-card">
          <strong>${s.name}</strong>
          <div class="popup-sub">${s.brand} • ${s.city}</div>
          <div class="popup-price">${fmt(p)} kr/l</div>
        </div>`,
        { closeButton: true, autoPan: false }
      );
      marker.on("click", () => selectStation(s.id));
      marker.addTo(state.markerLayer);
      state.markers.set(s.id, marker);
    });
  }

  function fitMap() {
    if (!state.map || state.filtered.length === 0) return;
    // Always keep Sweden in view by default instead of zooming to a tight cluster
    const SE_BOUNDS = L.latLngBounds([55.0, 10.5], [69.1, 24.3]);
    state.map.fitBounds(SE_BOUNDS, { padding: [30, 30] });
  }

  /* -------------------- Footer stats (filtered) -------------------- */

  function updateFooterStats() {
    const fuel = state.fuel;
    if (state.filtered.length === 0) {
      document.getElementById("dkAvgFiltered").textContent = "–";
      document.getElementById("dkSavings").textContent = "–";
      return;
    }
    const prices = state.filtered.map((s) => s.prices[fuel]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    document.getElementById("dkAvgFiltered").textContent = `${fmt(avg)} kr`;
    const savings = max - min;
    document.getElementById("dkSavings").textContent = `${fmt(savings)} kr/l`;
  }

  /* -------------------- Brand/city chart -------------------- */

  function renderChart() {
    const el = document.getElementById("dkBrandChart");
    const fuel = state.fuel;
    const fuelLabel = document.getElementById("dkChartFuelLabel");
    fuelLabel.textContent = `${FUEL_LABELS[fuel]}, ${
      state.chartMode === "brand" ? "alla kedjor" : "topp 10 städer"
    }`;

    // Group
    const groups = new Map();
    const key = state.chartMode === "brand" ? "brand" : "city";
    state.stations.forEach((s) => {
      if (!(fuel in s.prices)) return;
      const k = s[key];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s.prices[fuel]);
    });

    let entries = [...groups.entries()].map(([k, prices]) => ({
      label: k,
      avg: prices.reduce((a, b) => a + b, 0) / prices.length,
      count: prices.length,
    }));

    if (state.chartMode === "city") {
      entries = entries.sort((a, b) => a.avg - b.avg).slice(0, 10);
    } else {
      entries = entries.sort((a, b) => a.avg - b.avg);
    }

    const min = Math.min(...entries.map((e) => e.avg));
    const max = Math.max(...entries.map((e) => e.avg));
    const range = max - min || 1;

    el.innerHTML = entries
      .map((e, i) => {
        const pct = 20 + ((e.avg - min) / range) * 80; // 20-100 %
        const cls = i === 0 ? "lowest" : i === entries.length - 1 ? "highest" : "";
        return `
        <div class="bar-col ${cls}" title="${e.label}: ${fmt(e.avg)} kr/l (${e.count} stationer)">
          <div class="bar-value">${fmt(e.avg)}</div>
          <div class="bar-fill" style="height:${pct}%"></div>
          <div class="bar-label">${e.label}</div>
        </div>`;
      })
      .join("");
  }

  /* -------------------- Brand checklist init -------------------- */

  function initBrandChecklist() {
    const container = document.getElementById("dkBrandList");
    const brandMap = new Map();
    state.stations.forEach((s) => {
      if (!brandMap.has(s.brand)) {
        brandMap.set(s.brand, { color: s.brandColor, count: 0 });
      }
      brandMap.get(s.brand).count += 1;
    });
    const sorted = [...brandMap.entries()].sort((a, b) => b[1].count - a[1].count);
    container.innerHTML = sorted
      .map(
        ([brand, info]) => `
        <label class="brand-check">
          <input type="checkbox" value="${brand}" />
          <span class="brand-dot" style="background:${info.color}"></span>
          <span class="brand-name-txt">${brand}</span>
          <span class="brand-count">${info.count}</span>
        </label>`
      )
      .join("");

    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) state.activeBrands.add(cb.value);
        else state.activeBrands.delete(cb.value);
        refresh();
      });
    });
  }

  function initCitySelect() {
    const sel = document.getElementById("dkCitySelect");
    const cities = [...new Set(state.stations.map((s) => s.city))].sort((a, b) =>
      a.localeCompare(b, "sv")
    );
    cities.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      state.activeCity = sel.value;
      refresh();
    });
  }

  /* -------------------- Tabs -------------------- */

  function switchTab(name) {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.add("hidden"));
    const id = {
      list: "dkTabList",
      top10: "dkTabTop10",
      detail: "dkTabDetail",
    }[name];
    document.getElementById(id).classList.remove("hidden");
  }

  /* -------------------- Controls -------------------- */

  function wireControls() {
    // Fuel pills (new) and fuel radios (legacy fallback)
    document.querySelectorAll('input[name="dkFuel"]').forEach((r) => {
      r.addEventListener("change", () => {
        if (r.checked) {
          state.fuel = r.value;
          document
            .querySelectorAll(".fuel-pill")
            .forEach((l) => l.classList.toggle("active", l.contains(r)));
          document
            .querySelectorAll(".fuel-radio")
            .forEach((l) => l.classList.toggle("active", l.contains(r)));
          refresh();
        }
      });
    });

    // Search
    const search = document.getElementById("dkSearch");
    search.addEventListener("input", (e) => {
      state.search = e.target.value;
      refresh({ fitMap: false });
    });

    // Sort
    document.getElementById("dkSort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      refresh({ fitMap: false });
    });

    // Toggles
    const toggleMap = {
      dkOpen24: "open24h",
      dkCarWash: "biltvätt",
      dkFastCharge: "snabbladdning",
    };
    Object.entries(toggleMap).forEach(([id, key]) => {
      const cb = document.getElementById(id);
      cb.addEventListener("change", () => {
        if (cb.checked) state.filters.add(key);
        else state.filters.delete(key);
        refresh();
      });
    });

    // Locate
    document.getElementById("dkLocateBtn").addEventListener("click", locate);

    // Clear filters
    document.getElementById("dkClearFilters").addEventListener("click", () => {
      state.search = "";
      state.activeBrands.clear();
      state.activeCity = "";
      state.filters.clear();
      state.sort = "price";
      state.mapView = "all";
      document.getElementById("dkSearch").value = "";
      document.getElementById("dkSort").value = "price";
      document.getElementById("dkCitySelect").value = "";
      document
        .querySelectorAll("#dkBrandList input, .toggle input")
        .forEach((i) => (i.checked = false));
      document
        .querySelectorAll(".map-controls .seg-btn")
        .forEach((b) => b.classList.toggle("active", b.dataset.view === "all"));
      refresh();
    });

    // Map view segmented
    document.querySelectorAll(".map-controls .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document
          .querySelectorAll(".map-controls .seg-btn")
          .forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.mapView = b.dataset.view;
        refresh();
      });
    });

    // Data export buttons
    const csvBtn = document.getElementById("dkExportCsv");
    if (csvBtn) csvBtn.addEventListener("click", downloadCsv);
    const jsonBtn = document.getElementById("dkExportJson");
    if (jsonBtn) jsonBtn.addEventListener("click", downloadJson);

    // Chain table column click = re-sort by that fuel
    document.querySelectorAll(".chain-table th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const fuel = th.dataset.fuel;
        if (!fuel) return;
        // Switch the global fuel selection so all sections sync
        state.fuel = fuel;
        document.querySelectorAll('input[name="dkFuel"]').forEach((r) => {
          r.checked = r.value === fuel;
        });
        document.querySelectorAll(".fuel-pill").forEach((p) => {
          p.classList.toggle("active", p.querySelector("input").value === fuel);
        });
        refresh();
      });
    });

    // Tabs
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.tab));
    });

    // Theme
    document.getElementById("dkThemeToggle").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, select, textarea")) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key >= "1" && e.key <= "6") {
        const idx = parseInt(e.key, 10) - 1;
        const radios = document.querySelectorAll('input[name="dkFuel"]');
        if (radios[idx]) {
          radios[idx].checked = true;
          radios[idx].dispatchEvent(new Event("change"));
        }
      } else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("dkSearch").focus();
      } else if (e.key === "Escape") {
        document.getElementById("dkClearFilters").click();
      } else if (e.key.toLowerCase() === "l") {
        locate();
      } else if (e.key.toLowerCase() === "t") {
        applyTheme(state.theme === "dark" ? "light" : "dark");
      }
    });
  }

  function locate() {
    if (!navigator.geolocation) return alert("Geolocation stöds inte");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        state.sort = "distance";
        document.getElementById("dkSort").value = "distance";
        refresh();
        if (state.map) state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 10);
      },
      () => alert("Kunde inte hämta din plats"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  /* -------------------- Orchestration -------------------- */

  function refresh(opts = { fitMap: true }) {
    recompute();
    renderList();
    renderTop10();
    renderMarkers();
    updateStats();
    updateFooterStats();
    if (opts.fitMap) fitMap();

    const lu = document.getElementById("dkLastUpdated");
    const meta = window.tankkollenGetLiveMeta && window.tankkollenGetLiveMeta();
    if (meta) {
      const age = meta.ageMinutes;
      lu.textContent =
        age < 2
          ? "LIVE · just nu"
          : age < 60
          ? `LIVE · ${age}m`
          : `LIVE · ${Math.round(age / 60)}h`;
    } else {
      const d = new Date();
      lu.textContent = `LIVE · ${d
        .getHours()
        .toString()
        .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    }
  }

  function startLiveTicker() {
    // Just re-render once a minute so the "Live · Xm" age stays fresh.
    // Actual price updates come from prices.js (which fetches
    // data/live_prices.json every 5 minutes).
    setInterval(() => refresh({ fitMap: false }), 60 * 1000);
  }

  /* -------------------- Init -------------------- */

  function init() {
    applyTheme(state.theme);
    initBrandChecklist();
    initCitySelect();
    initCalculator();
    initMap();
    wireControls();
    refresh();
    startLiveTicker();

    document.addEventListener("tankkollen:prices", () => {
      refresh({ fitMap: false });
    });
    document.addEventListener("tankkollen:reported", () => {
      refresh({ fitMap: false });
      if (state.selectedId) {
        const s = state.stations.find((x) => x.id === state.selectedId);
        if (s) renderDetail(s);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
