/* =======================================================================
 * Tankkollen — main app logic
 * -----------------------------------------------------------------------
 * Swedish fuel station price comparison app.
 * - Map (Leaflet + OpenStreetMap)
 * - List + filtering + search
 * - Station detail panel
 * - Price trend indicators
 * - Geolocation "find nearest"
 * - Theme toggle (persistent)
 * - PWA install flow
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
    selectedFuel: "bensin95",
    sortBy: "price",
    search: "",
    filters: new Set(),
    userLocation: null,
    selectedStationId: null,
    map: null,
    markers: new Map(),
    markerLayer: null,
    theme: localStorage.getItem("tankkollen-theme") || "dark",
  };

  /* -------------------- Utils -------------------- */

  function formatPrice(n) {
    if (typeof n !== "number") return "—";
    return n.toFixed(2).replace(".", ",");
  }

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

  function formatDistance(km) {
    if (km == null) return "";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }

  function trendBadge(trend) {
    if (trend == null || trend === 0) return '<span class="trend flat">±0 öre</span>';
    const ore = Math.abs(Math.round(trend * 100));
    if (trend > 0)
      return `<span class="trend up">▲ ${ore} öre</span>`;
    return `<span class="trend down">▼ ${ore} öre</span>`;
  }

  function ratingStars(rating) {
    return `★ ${rating.toFixed(1)}`;
  }

  /* -------------------- Theme -------------------- */

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tankkollen-theme", theme);
    // Meta theme color for mobile browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f6fb" : "#0a0e1a");
    // Re-style map tiles
    updateMapTileStyle();
  }

  function updateMapTileStyle() {
    document
      .querySelectorAll(".leaflet-tile-pane")
      .forEach((el) => {
        if (state.theme === "dark") el.classList.add("map-tile-dark");
        else el.classList.remove("map-tile-dark");
      });
  }

  /* -------------------- Filtering & sorting -------------------- */

  function recomputeFiltered() {
    const q = state.search.trim().toLowerCase();
    let list = state.stations.filter((s) => {
      // Must have a price for the selected fuel
      if (!(state.selectedFuel in s.prices)) return false;
      // Search
      if (q) {
        const hay = `${s.name} ${s.city} ${s.address} ${s.brand}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Extra filters
      for (const f of state.filters) {
        if (f === "open24h") {
          if (!s.open24h) return false;
        } else if (!s.services.includes(f)) return false;
      }
      return true;
    });

    // Add distance if location known
    if (state.userLocation) {
      list.forEach((s) => {
        s._distance = distanceKm(
          state.userLocation.lat,
          state.userLocation.lng,
          s.lat,
          s.lng
        );
      });
    } else {
      list.forEach((s) => (s._distance = null));
    }

    // Sort
    const fuel = state.selectedFuel;
    list.sort((a, b) => {
      if (state.sortBy === "price")
        return (a.prices[fuel] ?? 1e9) - (b.prices[fuel] ?? 1e9);
      if (state.sortBy === "name") return a.name.localeCompare(b.name, "sv");
      if (state.sortBy === "updated")
        return a.updatedMinutesAgo - b.updatedMinutesAgo;
      if (state.sortBy === "distance") {
        if (a._distance == null) return 1;
        if (b._distance == null) return -1;
        return a._distance - b._distance;
      }
      return 0;
    });

    state.filtered = list;
  }

  /* -------------------- Render: station list -------------------- */

  function renderList() {
    const el = document.getElementById("stationList");
    const countEl = document.getElementById("resultCount");
    const fuel = state.selectedFuel;

    countEl.textContent = `${state.filtered.length} stationer`;

    if (state.filtered.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <strong>Inga stationer matchade</strong>
          Prova att ändra drivmedel eller ta bort filter.
        </div>`;
      return;
    }

    // Determine cheapest price for this fuel (for highlighting)
    const cheapestPrice = Math.min(
      ...state.filtered.map((s) => s.prices[fuel])
    );

    el.innerHTML = state.filtered
      .slice(0, 80) // limit DOM nodes for perf
      .map((s) => stationCardHtml(s, fuel, cheapestPrice))
      .join("");

    el.querySelectorAll(".station-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = Number(card.dataset.id);
        selectStation(id, { zoom: true });
      });
    });
  }

  function stationCardHtml(s, fuel, cheapestPrice) {
    const price = s.prices[fuel];
    const trend = s.prices[`${fuel}_trend`];
    const isCheapest = price === cheapestPrice;
    const active = s.id === state.selectedStationId ? "active" : "";
    const distStr = s._distance != null ? ` • ${formatDistance(s._distance)}` : "";
    return `
      <div class="station-card ${active}" data-id="${s.id}">
        <div class="station-card-top">
          <div class="brand-logo" style="background:${s.brandColor}">${s.brandLogo}</div>
          <div class="station-meta">
            <div class="station-name">${s.name}</div>
            <div class="station-sub">
              <span>${s.city}${distStr}</span>
              <span class="station-rating">${ratingStars(s.rating)}</span>
            </div>
          </div>
        </div>
        <div class="station-price-row">
          <div class="station-price">
            ${formatPrice(price)}<span class="unit">kr/l</span>
          </div>
          ${trendBadge(trend)}
        </div>
        <div class="badges-row">
          ${isCheapest ? '<span class="tag live">Billigast</span>' : ""}
          ${s.open24h ? '<span class="tag open">24h</span>' : ""}
          <span class="tag">Uppdaterad ${s.updatedMinutesAgo} min sedan</span>
        </div>
      </div>
    `;
  }

  /* -------------------- Station detail -------------------- */

  function showDetail(s) {
    const el = document.getElementById("stationDetail");
    const closeBtn = document.getElementById("closeDetail");

    const priceTiles = Object.keys(FUEL_LABELS)
      .filter((k) => k in s.prices)
      .map((k) => {
        const source = s.prices[`${k}_source`];
        const badge =
          source === "user"
            ? '<span class="src-badge src-user">★ Rapporterat</span>'
            : source === "listpris"
            ? '<span class="src-badge src-list">Listpris</span>'
            : "";
        return `
        <div class="price-tile" data-fuel="${k}">
          <div class="price-tile-label">${FUEL_LABELS[k]} ${badge}</div>
          <div class="price-tile-value">
            ${formatPrice(s.prices[k])}<span class="unit">kr/l</span>
          </div>
          <div style="margin-top:.3rem">${trendBadge(s.prices[`${k}_trend`])}</div>
          <button class="report-btn" data-station="${s.id}" data-fuel="${k}">
            Rapportera pris
          </button>
        </div>`;
      })
      .join("");

    const services = s.services
      .map((v) => `<span class="tag">${v}</span>`)
      .join("");

    const dist =
      s._distance != null ? ` • ${formatDistance(s._distance)} härifrån` : "";

    el.innerHTML = `
      <div class="detail-hero">
        <div class="brand-logo" style="background:${s.brandColor}">${s.brandLogo}</div>
        <div>
          <h3>${s.name}</h3>
          <div class="sub">${s.brand} • ${s.city}${dist}</div>
        </div>
      </div>
      <div class="detail-section">
        <h4>Adress</h4>
        <p>${s.address}, ${s.city}</p>
      </div>
      <div class="price-grid">${priceTiles}</div>
      <div class="detail-section">
        <h4>Öppettider</h4>
        <p>${s.open24h ? "Öppet dygnet runt" : "Mån–Sön 06:00–23:00"}</p>
      </div>
      <div class="detail-section">
        <h4>Tjänster</h4>
        <div class="service-list">${services}</div>
      </div>
      <div class="detail-section">
        <h4>Recensioner</h4>
        <p>${ratingStars(s.rating)} (${s.reviewCount} recensioner)</p>
      </div>
      <a
        class="directions-btn"
        target="_blank"
        rel="noopener"
        href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-7-7 18-2-8z"/></svg>
        Visa vägbeskrivning
      </a>
    `;
    el.classList.remove("hidden");
    document.getElementById("stationList").classList.add("hidden");
    closeBtn.classList.remove("hidden");

    // Wire report buttons
    el.querySelectorAll(".report-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const stationId = Number(btn.dataset.station);
        const fuel = btn.dataset.fuel;
        const label = FUEL_LABELS[fuel] || fuel;
        const current = s.prices[fuel];
        const input = prompt(
          `Vilket pris såg du för ${label} vid ${s.name}?\n(Skriv t.ex. 17,89 — nuvarande: ${formatPrice(current)})`,
          formatPrice(current)
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

  function hideDetail() {
    document.getElementById("stationDetail").classList.add("hidden");
    document.getElementById("stationList").classList.remove("hidden");
    document.getElementById("closeDetail").classList.add("hidden");
    state.selectedStationId = null;
    // Remove active highlight
    document.querySelectorAll(".station-card.active").forEach((el) => el.classList.remove("active"));
  }

  function selectStation(id, opts = {}) {
    const s = state.stations.find((x) => x.id === id);
    if (!s) return;
    state.selectedStationId = id;
    showDetail(s);
    if (opts.zoom && state.map) {
      state.map.flyTo([s.lat, s.lng], Math.max(state.map.getZoom(), 13), {
        duration: 0.8,
      });
    }
    // Open popup
    const marker = state.markers.get(id);
    if (marker) marker.openPopup();
  }

  /* -------------------- Map -------------------- */

  function initMap() {
    if (typeof L === "undefined") {
      console.warn("Leaflet not available — map disabled");
      const el = document.getElementById("map");
      if (el)
        el.innerHTML =
          '<div class="empty-state" style="padding:4rem 2rem"><strong>Karta otillgänglig</strong>Kartbiblioteket kunde inte laddas.</div>';
      return;
    }
    const map = L.map("map", {
      center: [62.0, 15.5], // Center of Sweden
      zoom: 5,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    state.map = map;
    state.markerLayer = L.layerGroup().addTo(map);

    // Apply tile styling for theme
    map.on("load", updateMapTileStyle);
    setTimeout(updateMapTileStyle, 300);
  }

  function renderMarkers() {
    if (!state.markerLayer || typeof L === "undefined") return;
    state.markerLayer.clearLayers();
    state.markers.clear();

    const fuel = state.selectedFuel;
    const cheapest =
      state.filtered.length > 0
        ? Math.min(...state.filtered.map((s) => s.prices[fuel]))
        : null;

    state.filtered.forEach((s) => {
      const price = s.prices[fuel];
      const isCheapest = price === cheapest;
      const icon = L.divIcon({
        className: "",
        html: `<div class="station-marker ${isCheapest ? "cheapest" : ""}">${formatPrice(price)}</div>`,
        iconSize: [44, 50],
        iconAnchor: [22, 50],
      });
      const marker = L.marker([s.lat, s.lng], { icon });
      marker.bindPopup(
        `<div class="popup-card">
          <strong>${s.name}</strong>
          <div class="popup-sub">${s.brand} • ${s.city}</div>
          <div class="popup-price">${formatPrice(price)} kr/l</div>
        </div>`,
        { closeButton: true, autoPan: false }
      );
      marker.on("click", () => {
        selectStation(s.id);
      });
      marker.addTo(state.markerLayer);
      state.markers.set(s.id, marker);
    });
  }

  function fitMapToFiltered() {
    if (!state.map || state.filtered.length === 0) return;
    const bounds = L.latLngBounds(state.filtered.map((s) => [s.lat, s.lng]));
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }

  /* -------------------- Controls -------------------- */

  function wireControls() {
    // Fuel chips
    document
      .querySelectorAll(".filter-group .chip[data-fuel]")
      .forEach((chip) => {
        chip.addEventListener("click", () => {
          document
            .querySelectorAll(".filter-group .chip[data-fuel]")
            .forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          state.selectedFuel = chip.dataset.fuel;
          refresh({ fitBounds: false });
        });
      });

    // Filter chips
    document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const f = chip.dataset.filter;
        if (state.filters.has(f)) {
          state.filters.delete(f);
          chip.classList.remove("active");
        } else {
          state.filters.add(f);
          chip.classList.add("active");
        }
        refresh();
      });
    });

    // Search input
    const search = document.getElementById("searchInput");
    search.addEventListener("input", (e) => {
      state.search = e.target.value;
      refresh();
    });

    // Sort
    document.getElementById("sortSelect").addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      refresh({ fitBounds: false });
    });

    // Locate me
    document.getElementById("locateBtn").addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Geolocation stöds inte i din webbläsare");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.userLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          state.sortBy = "distance";
          document.getElementById("sortSelect").value = "distance";
          refresh({ fitBounds: false });
          if (state.map) state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 10);
        },
        () => alert("Kunde inte hämta din plats"),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    // Close detail
    document.getElementById("closeDetail").addEventListener("click", hideDetail);

    // Theme toggle
    document.getElementById("themeToggle").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });
  }

  /* -------------------- Preview list (landing) -------------------- */

  function renderPreviewList() {
    const el = document.getElementById("previewList");
    if (!el) return;
    // Top 5 cheapest bensin95
    const top = [...state.stations]
      .filter((s) => "bensin95" in s.prices)
      .sort((a, b) => a.prices.bensin95 - b.prices.bensin95)
      .slice(0, 5);
    el.innerHTML = top
      .map(
        (s) => `
        <div class="preview-item">
          <div class="p-logo" style="background:${s.brandColor}">${s.brandLogo}</div>
          <div class="p-text">
            <div class="p-name">${s.brand} ${s.city}</div>
            <div class="p-city">${s.address}</div>
          </div>
          <div class="p-price">${formatPrice(s.prices.bensin95)}</div>
        </div>
      `
      )
      .join("");
  }

  /* -------------------- Refresh orchestration -------------------- */

  function refresh(opts = { fitBounds: true }) {
    recomputeFiltered();
    renderList();
    renderMarkers();
    if (opts.fitBounds) fitMapToFiltered();
    // Last updated text — prefer real live-prices timestamp
    const lu = document.getElementById("lastUpdated");
    if (lu) {
      const meta = window.tankkollenGetLiveMeta && window.tankkollenGetLiveMeta();
      if (meta) {
        const age = meta.ageMinutes;
        const label =
          age < 2
            ? "Live-priser just nu"
            : age < 60
            ? `Live-priser · ${age} min sedan`
            : `Live-priser · ${Math.round(age / 60)} tim sedan`;
        lu.textContent = label;
      } else {
        const d = new Date();
        lu.textContent = `Uppdaterad ${d
          .getHours()
          .toString()
          .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
      }
    }
  }

  /* -------------------- Simulated live updates -------------------- */

  function startLiveTicker() {
    // Re-render every minute so "uppdaterad X min sedan" and the age label
    // stay current. Actual price updates come from prices.js (which fetches
    // data/live_prices.json every 5 minutes).
    setInterval(() => refresh({ fitBounds: false }), 60 * 1000);
  }

  /* -------------------- PWA install -------------------- */

  let deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById("installBtn");
    const note = document.getElementById("installNote");
    btn.classList.remove("hidden");
    if (note) note.textContent = "Klicka nedan för att installera Tankkollen på din enhet.";
    btn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      if (result.outcome === "accepted") {
        btn.classList.add("hidden");
        if (note) note.textContent = "Tack! Tankkollen är installerad.";
      }
      deferredInstallPrompt = null;
    });
  });

  window.addEventListener("appinstalled", () => {
    const btn = document.getElementById("installBtn");
    const note = document.getElementById("installNote");
    btn && btn.classList.add("hidden");
    if (note) note.textContent = "Tack! Tankkollen är installerad på din enhet.";
  });

  /* -------------------- Service worker -------------------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("sw.js")
        .catch((err) => console.warn("SW reg failed", err));
    });
  }

  /* -------------------- Init -------------------- */

  function init() {
    applyTheme(state.theme);
    initMap();
    wireControls();
    renderPreviewList();
    refresh();
    startLiveTicker();

    // Re-render when live prices land
    document.addEventListener("tankkollen:prices", () => {
      refresh({ fitBounds: false });
      renderPreviewList();
    });
    document.addEventListener("tankkollen:reported", () => {
      refresh({ fitBounds: false });
      if (state.selectedStationId) {
        const s = state.stations.find((x) => x.id === state.selectedStationId);
        if (s) showDetail(s);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
