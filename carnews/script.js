/* BilNytt.se - dynamisk laddning av nyheter */

// Artikelbank (simulerar en ständigt uppdaterad flöde)
const articles = {
  nyheter: [
    {
      title: "Volvo EX30 får ny batterivariant – längre räckvidd utlovas",
      excerpt: "Den populära kompaktelbilen får nu ett större batteripaket som ska ge upp till 520 km räckvidd.",
      img: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=600&q=70",
      tag: "Nyhet", author: "Erik Lundqvist", minutes: 3
    },
    {
      title: "Ny Porsche 911 Turbo S visad – fortfarande bensin",
      excerpt: "Porsche vägrar ge upp förbränningsmotorn och lanserar nu en vassare Turbo S med 650 hk.",
      img: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&q=70",
      tag: "Nyhet", author: "Anna Berg", minutes: 8
    },
    {
      title: "Tesla sänker priset på Model Y – igen",
      excerpt: "För tredje gången på sex månader sänker Tesla priset. Hur påverkar det begagnatmarknaden?",
      img: "https://images.unsplash.com/photo-1536700503339-1e4b06520771?w=600&q=70",
      tag: "Nyhet", author: "Martin Ek", minutes: 12
    },
    {
      title: "BMW visar ny M3 CS Touring – 550 hk i en kombi",
      excerpt: "Kombiälskare, gläd er. BMW M har nu gjort den snabbaste kombin i sin klass någonsin.",
      img: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=600&q=70",
      tag: "Nyhet", author: "Johan Dahl", minutes: 18
    },
    {
      title: "Polestar 5 nu till försäljning – så kör den",
      excerpt: "Den svensk-kinesiska GT-elbilen har nått återförsäljarna. Vi har provkört.",
      img: "https://images.unsplash.com/photo-1617788138017-80ad40651399?w=600&q=70",
      tag: "Test", author: "Sara Holm", minutes: 25
    },
    {
      title: "Audi RS6 Avant e-tron – så kommer den se ut",
      excerpt: "Läckta bilder avslöjar den eldrivna arvtagaren till kombi-ikonen.",
      img: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=600&q=70",
      tag: "Spion", author: "Viktor Nilsson", minutes: 34
    },
  ],
  ev: [
    {
      title: "Räckviddstest vintern 2026: Vilken elbil klarar kylan bäst?",
      excerpt: "Vi mätte verklig räckvidd vid –15°C på 14 elbilar. Resultatet förvånade.",
      img: "https://images.unsplash.com/photo-1593941707882-a5bba14938c7?w=600&q=70",
      tag: "Elbil", author: "Redaktionen", minutes: 45
    },
    {
      title: "Nya laddstationer i Sverige – här är listan",
      excerpt: "Ionity, Tesla och Recharge expanderar kraftigt under 2026.",
      img: "https://images.unsplash.com/photo-1633078654544-f1e95f9b3f11?w=600&q=70",
      tag: "Laddning", author: "Anna Berg", minutes: 60
    },
    {
      title: "Xiaomi SU7 landar i Europa – priset chockar",
      excerpt: "Kinesiska tech-jätten går på offensiven med sin första elbil.",
      img: "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=600&q=70",
      tag: "Elbil", author: "Martin Ek", minutes: 90
    },
  ],
  tester: [
    {
      title: "Test: Volvo EX90",
      excerpt: "Stor, lyxig och elektrisk. Men är den värd sitt höga pris?",
      img: "https://images.unsplash.com/photo-1550355291-bbee04a92027?w=400&q=70",
      score: "4.5", author: "Erik Lundqvist"
    },
    {
      title: "Test: Kia EV9",
      excerpt: "Rymdig sjusitsig elbil med retrodesign som vi älskar.",
      img: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=400&q=70",
      score: "4.3", author: "Sara Holm"
    },
    {
      title: "Test: BMW i5 M60",
      excerpt: "Snabb, bekväm och teknisk – BMW:s svar på Tesla Model S.",
      img: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=400&q=70",
      score: "4.7", author: "Johan Dahl"
    },
    {
      title: "Test: Renault 5 E-Tech",
      excerpt: "Den franska retro-raketen är här. Vi har kört den.",
      img: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=400&q=70",
      score: "4.2", author: "Anna Berg"
    },
  ],
  motorsport: [
    {
      title: "F1 2026: Nya reglerna förklarade på 3 minuter",
      excerpt: "Aktiv aerodynamik, mindre motorer och hälften elektrisk kraft. Så förändras F1.",
      img: "https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=600&q=70",
      tag: "F1", author: "Viktor Nilsson", minutes: 120
    },
    {
      title: "Verstappen och Red Bull – skils vägarna 2027?",
      excerpt: "Rykten om att världsmästaren förhandlar med Mercedes växer.",
      img: "https://images.unsplash.com/photo-1541348263662-e068662d82af?w=600&q=70",
      tag: "F1", author: "Martin Ek", minutes: 180
    },
    {
      title: "STCC premiärstart på Ring Knutstorp",
      excerpt: "Svenska racermästerskapet kör igång med tätare fält än någonsin.",
      img: "https://images.unsplash.com/photo-1506469810127-c0aa1ba33b10?w=600&q=70",
      tag: "STCC", author: "Redaktionen", minutes: 240
    },
  ],
  guider: [
    {
      title: "Bästa begagnade elbilen 2026 – köpguiden",
      excerpt: "Vi listar de 10 bästa fynden på begagnatmarknaden just nu.",
      img: "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600&q=70",
      tag: "Guide", author: "Sara Holm", minutes: 300
    },
    {
      title: "Så väljer du rätt vinterdäck",
      excerpt: "Dubb eller friktion? Testvinnare och budgetalternativ.",
      img: "https://images.unsplash.com/photo-1615906655593-ad0386982a0f?w=600&q=70",
      tag: "Guide", author: "Johan Dahl", minutes: 420
    },
    {
      title: "Så skyddar du din bil mot stöld",
      excerpt: "Stöldligorna blir smartare. Här är 7 konkreta tips från polisen.",
      img: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=600&q=70",
      tag: "Guide", author: "Anna Berg", minutes: 500
    },
  ],
};

const tickerItems = [
  "Volvo EX90 får ny mjukvara – snabbare laddning",
  "Tesla kallar in 120 000 bilar för stängselfel",
  "Nya BMW M3 CS presenterad i Genève",
  "Polestar öppnar ny fabrik i Skåne",
  "Kia EV4 börjar säljas i Sverige nästa vecka",
  "Porsche Taycan uppdateras med 800 km räckvidd",
  "Svensk startup tar fram solcellstak för elbilar",
];

const mostRead = [
  "Tesla sänker priset på Model Y – igen",
  "Vintertest: Vinnande elbilen klarade 480 km",
  "Volvo EX30 kommer i ny utgåva",
  "F1 2026: Nya reglerna förklarade",
  "Porsche 911 Turbo S – fortfarande bensin",
];

/* ------- Renderers ------- */

function minutesAgo(n){
  if(n < 1) return "Just nu";
  if(n < 60) return n + " min sedan";
  if(n < 1440) return Math.floor(n/60) + " tim sedan";
  return Math.floor(n/1440) + " dygn sedan";
}

function minutesSince(iso){
  if(!iso) return 0;
  const then = new Date(iso).getTime();
  if(isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60000));
}

function cardHtml(a){
  const href = a.url || "#";
  return `
    <a class="card" href="${href}">
      <div class="card-img" style="background-image:url('${a.img}')"></div>
      <div class="card-body">
        <span class="tag">${a.tag}</span>
        <h3>${a.title}</h3>
        <p>${a.excerpt}</p>
        <span class="meta">${minutesAgo(a.minutes ?? minutesSince(a.publishedAt))} · ${a.author}</span>
      </div>
    </a>
  `;
}

function testHtml(t){
  const href = t.url || "#";
  return `
    <a class="test-item" href="${href}">
      <div class="card-img" style="background-image:url('${t.img}')"></div>
      <div>
        <h3>${t.title}</h3>
        <p>${t.excerpt}</p>
        <span class="meta">av ${t.author}</span>
      </div>
      <div class="score">${t.score}<small>AV 5</small></div>
    </a>
  `;
}

/* ------- Dynamisk inläsning från articles.json ------- */
// Mappa section (från agenter) -> bucket i UI:t
const SECTION_BUCKET = {
  nyheter: "nyheter",
  elbilar: "ev",
  tester: "tester",
  motorsport: "motorsport",
  kopguide: "guider",
  klassiker: "nyheter", // Klassiker visas i huvudflödet
};

async function loadDynamicArticles(){
  try{
    const res = await fetch("data/articles.json", {cache: "no-store"});
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = (data.articles || []);
    if(items.length === 0) return; // Ingen override – behåll demo-data

    // Töm och fyll från articles.json
    Object.keys(articles).forEach(k => articles[k] = []);
    items.forEach(a => {
      const bucket = SECTION_BUCKET[a.section];
      if(!bucket || !articles[bucket]) return;
      articles[bucket].push(a);
    });

    // Rita om
    render();
  }catch(e){
    console.warn("Kunde inte ladda articles.json – visar demo-data.", e);
  }
}

function render(){
  document.getElementById("news-grid").innerHTML = articles.nyheter.map(cardHtml).join("");
  document.getElementById("ev-grid").innerHTML = articles.ev.map(cardHtml).join("");
  document.getElementById("sport-grid").innerHTML = articles.motorsport.map(cardHtml).join("");
  document.getElementById("guide-grid").innerHTML = articles.guider.map(cardHtml).join("");
  document.getElementById("test-list").innerHTML = articles.tester.map(testHtml).join("");

  // Ticker (dubbletter för sömlös loop)
  const tickerHtml = tickerItems.concat(tickerItems).map(t => `<span>${t}</span>`).join("");
  document.getElementById("ticker-track").innerHTML = tickerHtml;

  // Mest läst
  document.getElementById("mostread").innerHTML =
    mostRead.map(t => `<li>${t}</li>`).join("");

  document.getElementById("year").textContent = new Date().getFullYear();
}

/* ------- Live klocka ------- */
function tick(){
  const now = new Date();
  const time = now.toLocaleTimeString("sv-SE", {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  document.getElementById("live-time").textContent = "LIVE · " + time;
  document.getElementById("updated-time").textContent = time;
  document.getElementById("hero-time").textContent = "Uppdaterad " + time;
}

/* ------- Start ------- */
render();
tick();
setInterval(tick, 1000);
loadDynamicArticles();

// Simulera att en ny artikel dyker upp var 30:e sekund (flyttas längst upp)
setInterval(() => {
  const pool = [
    {title:"Breaking: Ny Koenigsegg-modell avtäckt i natt", excerpt:"Den svenska superbilstillverkaren överraskar med sin nya hypercar.", img:"https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=600&q=70", tag:"BREAKING", author:"Redaktionen", minutes:0},
    {title:"Volvo höjer produktionsmålet för EX30", excerpt:"Stor efterfrågan gör att Volvo ökar takten i Gent-fabriken.", img:"https://images.unsplash.com/photo-1550355291-bbee04a92027?w=600&q=70", tag:"Nyhet", author:"Erik Lundqvist", minutes:0},
    {title:"Ny svensk elbilstillverkare får miljardinvestering", excerpt:"Start-upen Luvly säkrar finansiering för serieproduktion.", img:"https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600&q=70", tag:"Nyhet", author:"Martin Ek", minutes:0},
  ];
  const fresh = pool[Math.floor(Math.random()*pool.length)];
  articles.nyheter.unshift({...fresh, minutes: 0});
  // bumpa upp tider på de andra
  articles.nyheter.slice(1).forEach(a => a.minutes += 1);
  if(articles.nyheter.length > 8) articles.nyheter.pop();
  document.getElementById("news-grid").innerHTML = articles.nyheter.map(cardHtml).join("");
}, 30000);
