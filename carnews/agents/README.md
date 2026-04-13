# BilNytt.se – AI-agenter

Det här är redaktionen. Varje fil styr en agent som skriver artiklar till sidan.
Allt genereras av Claude via `scripts/generate_articles.py` och GitHub Actions.

## Filstruktur

| Fil | Roll |
| --- | --- |
| `style-guide.md` | Gemensam stilguide som alla agenter följer (skickas cachat som system-prompt) |
| `nyheter.md` | Allmänna bilnyheter och spionbilder |
| `elbilar.md` | Elbilar, laddning, räckvidd |
| `tester.md` | Biltester med betyg (1–5) |
| `motorsport.md` | F1, WRC, STCC m.m. |
| `kopguide.md` | Köpguider och jämförelser |
| `klassiker.md` | Veteran- och klassiska bilar |
| `sources.yml` | RSS-flöden + fallback-ämnen per agent + daglig kvot |

## Så styr du agenterna

- **Tonen/stilen:** redigera respektive `.md`-fil. Förändringar slår igenom nästa körning.
- **Hur många artiklar per dag:** ändra `daily:` i `sources.yml` per agent.
- **Källor:** lägg till/ta bort RSS-URL:er under `feeds:` i `sources.yml`.
- **Fallback-ämnen** (om RSS är tomt): fyll på listan under `topics:`.

## Köra manuellt (trigger via GitHub)

1. Gå till **Actions → Generate BilNytt articles**
2. Klicka **Run workflow**
3. Fyll i:
   - `agent`: t.ex. `elbilar`
   - `topic`: t.ex. `Volvo EX30 får ny batterivariant 2026`
   - `source_url`: valfri URL
4. Sidan uppdateras inom ett par minuter.

## Schemalagd körning

Cron i `.github/workflows/generate_articles.yml` kör kl **06:00 UTC dagligen**
och genererar så många artiklar som varje agent har konfigurerat (`daily`-fältet).

## Krav

Sätt **`ANTHROPIC_API_KEY`** som GitHub Secret (repo → Settings → Secrets → Actions).
Default-modell är `claude-sonnet-4-6`. Kan ändras med miljövariabeln `CLAUDE_MODEL`.

## Köra lokalt

```bash
pip install -r scripts/requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...

# Schemalagd-läge (alla agenters daily-kvot)
python scripts/generate_articles.py --mode scheduled

# Manuellt med ett specifikt ämne
python scripts/generate_articles.py --mode manual \
  --agent elbilar \
  --topic "Polestar 5 levereras till svenska kunder"
```

Artiklar läggs i `carnews/articles/<slug>.html` och indexet i
`carnews/data/articles.json`. Startsidan (`carnews/index.html`) läser
indexet dynamiskt via `script.js`.
