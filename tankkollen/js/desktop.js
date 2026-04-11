/* =======================================================================
 * Tankkollen Pro — Desktop dashboard
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

  const fmt = (n) => (typeof n === "number" ? n.toFixed(2).replace(".", ",") : "—");

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

  /* -------------------- Stats bar -------------------- */

  function updateStats() {
    const fuel = state.fuel;
    const all = state.stations.filter((s) => fuel in s.prices);
    if (all.length === 0) return;

    const prices = all.map((s) => s.prices[fuel]);
    const cheapest = all.reduce((a, b) => (a.prices[fuel] < b.prices[fuel] ? a : b));
    const dearest = all.reduce((a, b) => (a.prices[fuel] > b.prices[fuel] ? a : b));
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Average trend across all
    const trends = all
      .map((s) => s.prices[`${fuel}_trend`])
      .filter((t) => typeof t === "number");
    const avgTrend = trends.length
      ? trends.reduce((a, b) => a + b, 0) / trends.length
      : 0;

    setStatCard("statCheapest", `${fmt(cheapest.prices[fuel])}`, `${cheapest.city}, ${cheapest.brand}`, "highlight");
    setStatCard("statAverage", `${fmt(avg)}`, "kr/liter", "");
    setStatCard("statHighest", `${fmt(dearest.prices[fuel])}`, `${dearest.city}, ${dearest.brand}`, "danger");
    const arrow = avgTrend > 0 ? "▲" : avgTrend < 0 ? "▼" : "●";
    const ore = Math.abs(Math.round(avgTrend * 100));
    setStatCard(
      "statTrend",
      `${arrow} ${ore} öre`,
      avgTrend > 0 ? "stigande" : avgTrend < 0 ? "sjunkande" : "oförändrad",
      avgTrend > 0 ? "danger" : avgTrend < 0 ? "highlight" : ""
    );
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

  function renderDetail(s) {
    const el = document.getElementById("dkStationDetail");
    el.classList.remove("empty");
    const tiles = Object.keys(FUEL_LABELS)
      .filter((k) => k in s.prices)
      .map(
        (k) => `
        <div class="price-tile">
          <div class="price-tile-label">${FUEL_LABELS[k]}</div>
          <div class="price-tile-value">${fmt(s.prices[k])}<span class="unit">kr/l</span></div>
          <div style="margin-top:.3rem">${trendBadge(s.prices[`${k}_trend`])}</div>
        </div>`
      )
      .join("");

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
  }

  /* -------------------- Map -------------------- */

  function initMap() {
    if (typeof L === "undefined") {
      console.warn("Leaflet not available — map disabled");
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
    const bounds = L.latLngBounds(state.filtered.map((s) => [s.lat, s.lng]));
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }

  /* -------------------- Footer stats (filtered) -------------------- */

  function updateFooterStats() {
    const fuel = state.fuel;
    if (state.filtered.length === 0) {
      document.getElementById("dkAvgFiltered").textContent = "—";
      document.getElementById("dkSavings").textContent = "—";
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
    fuelLabel.textContent = `${FUEL_LABELS[fuel]} — ${
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
    // Fuel radios
    document.querySelectorAll('input[name="dkFuel"]').forEach((r) => {
      r.addEventListener("change", () => {
        if (r.checked) {
          state.fuel = r.value;
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

    // Chart toggle
    document.querySelectorAll(".chart-toggle .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        document
          .querySelectorAll(".chart-toggle .seg-btn")
          .forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.chartMode = b.dataset.chart;
        renderChart();
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
    renderChart();
    if (opts.fitMap) fitMap();
    const d = new Date();
    document.getElementById("dkLastUpdated").textContent = `LIVE · ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  function startLiveTicker() {
    setInterval(() => {
      const sampleSize = Math.max(2, Math.floor(state.stations.length * 0.04));
      for (let i = 0; i < sampleSize; i++) {
        const s = state.stations[Math.floor(Math.random() * state.stations.length)];
        Object.keys(FUEL_LABELS).forEach((fuel) => {
          if (fuel in s.prices) {
            const delta = (Math.random() - 0.5) * 0.06;
            s.prices[fuel] = Math.max(1, +(s.prices[fuel] + delta).toFixed(2));
            s.prices[`${fuel}_trend`] = +(
              s.prices[`${fuel}_trend`] + delta
            ).toFixed(2);
          }
        });
        s.updatedMinutesAgo = 0;
      }
      refresh({ fitMap: false });
    }, 45000);
  }

  /* -------------------- Init -------------------- */

  function init() {
    applyTheme(state.theme);
    initBrandChecklist();
    initCitySelect();
    initMap();
    wireControls();
    refresh();
    startLiveTicker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
