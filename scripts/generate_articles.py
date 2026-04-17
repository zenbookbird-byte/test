#!/usr/bin/env python3
"""
BilNytt.se AI article generator.

Anropar Claude API för att generera artiklar via specialiserade agenter.
Körs av GitHub Actions (schemalagd) eller lokalt/manuellt.

Exempel:
    # Kör schemalagt (alla agenters daily-kvot)
    python scripts/generate_articles.py --mode scheduled

    # Manuell artikel med valfritt ämne
    python scripts/generate_articles.py --mode manual \\
        --agent elbilar \\
        --topic "Volvo EX30 får ny batterivariant 2026"

Miljövariabler:
    ANTHROPIC_API_KEY  (krävs)
    CLAUDE_MODEL       (valfri, default: claude-sonnet-4-6)
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import feedparser
import yaml
from slugify import slugify

# ── Paths ───────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
CARNEWS = REPO_ROOT / "carnews"
AGENTS_DIR = CARNEWS / "agents"
ARTICLES_DIR = CARNEWS / "articles"
DATA_DIR = CARNEWS / "data"
TEMPLATE_PATH = REPO_ROOT / "scripts" / "templates" / "article.html"

ARTICLES_JSON = DATA_DIR / "articles.json"
SOURCES_YML = AGENTS_DIR / "sources.yml"
STYLE_GUIDE = AGENTS_DIR / "style-guide.md"

# ── Config ──────────────────────────────────────────────────────────
MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-4-7")
MAX_TOKENS = 8000
API_TIMEOUT = 300.0  # 5 min – prevents stream idle disconnect

SECTION_LABEL = {
    "nyheter": "Nyhet",
    "elbilar": "Elbil",
    "tester": "Test",
    "motorsport": "Motorsport",
    "kopguide": "Guide",
    "erbjudanden": "Erbjudande",
    "klassiker": "Klassiker",
}

SWEDISH_MONTHS = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december",
]


# ── Data classes ────────────────────────────────────────────────────
@dataclass
class Topic:
    title: str
    source_url: str | None = None
    source_name: str | None = None
    source_summary: str | None = None


# ── Utilities ───────────────────────────────────────────────────────
def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_articles_index() -> dict:
    if not ARTICLES_JSON.exists():
        return {"articles": []}
    return json.loads(ARTICLES_JSON.read_text(encoding="utf-8"))


def save_articles_index(index: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARTICLES_JSON.write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def existing_titles(index: dict) -> set[str]:
    return {a["title"].strip().lower() for a in index.get("articles", [])}


def existing_slugs(index: dict) -> set[str]:
    return {a["slug"] for a in index.get("articles", [])}


def unique_slug(base: str, taken: set[str]) -> str:
    candidate = slugify(base)[:70] or "artikel"
    n = 2
    final = candidate
    while final in taken:
        final = f"{candidate}-{n}"
        n += 1
    return final


def swedish_date(dt: datetime) -> str:
    return f"{dt.day} {SWEDISH_MONTHS[dt.month - 1]} {dt.year}"


def unsplash_image(query: str) -> str:
    # Unsplash "source" URL ger deterministiska bilder för sökord utan API-nyckel.
    q = "%20".join(query.strip().split())
    return f"https://source.unsplash.com/1200x800/?{q}"


# ── RSS ingestion ───────────────────────────────────────────────────
def fetch_rss_topics(feeds: list[str], limit: int = 5) -> list[Topic]:
    topics: list[Topic] = []
    for url in feeds:
        try:
            parsed = feedparser.parse(url)
        except Exception as e:  # pragma: no cover
            print(f"  ! kunde inte läsa {url}: {e}", file=sys.stderr)
            continue
        source_name = (parsed.feed.get("title") or url) if parsed.feed else url
        for entry in parsed.entries[:limit]:
            summary = re.sub(
                r"<[^>]+>", "", entry.get("summary", "") or entry.get("description", "")
            )
            topics.append(
                Topic(
                    title=entry.get("title", "").strip(),
                    source_url=entry.get("link"),
                    source_name=source_name,
                    source_summary=summary[:1200],
                )
            )
    return topics


# ── Claude call ─────────────────────────────────────────────────────
ARTICLE_SCHEMA_INSTRUCTION = """
Returnera ENBART giltig JSON (ingen markdown, inga kodblock). JSON-schema:

{
  "title":        "string – rubrik max 70 tecken",
  "excerpt":      "string – 1 mening max 200 tecken för kort",
  "lead":         "string – 1–2 meningar, max 220 tecken",
  "body_html":    "string – brödtext som HTML. Ingen <h1>. Får innehålla <h2>, <h3>, <p>, <ol>/<ul>/<li>, <figure><img><figcaption>, <div class=\\"car-entry\\">, <div class=\\"pros-cons\\">, <div class=\\"pros\\">, <div class=\\"cons\\">, <div class=\\"toc\\">, <div class=\\"verdict-box\\">, <span class=\\"price-tag\\">. För inline-bilder använd https://source.unsplash.com/1200x800/?SÖKORD direkt som src.",
  "tag":          "string – etikett enligt agentens tillåtna taggar",
  "author":       "string – namn från agentens författarlista",
  "image_query":  "string – 2-4 engelska sökord för coverbild",
  "price_label":  "string eller null – ENDAST för erbjudanden-agenten: t.ex. 'Från 179 000 kr'",
  "score":        "number eller null – ENDAST för testagenten (1.0–5.0)"
}
""".strip()


def build_user_message(agent_name: str, agent_prompt: str, topic: Topic) -> str:
    source_block = ""
    if topic.source_url:
        source_block = (
            f"\n\nKälla: {topic.source_name} – {topic.source_url}\n"
            f"Sammanfattning från källan:\n{topic.source_summary or '(ingen)'}"
        )
    return (
        f"Du arbetar som agent **{agent_name}**. Följande rollbeskrivning gäller "
        f"utöver den gemensamma stilguiden:\n\n"
        f"---\n{agent_prompt}\n---\n\n"
        f"Skriv en svensk artikel om följande ämne:\n"
        f"ÄMNE: {topic.title}"
        f"{source_block}\n\n"
        f"{ARTICLE_SCHEMA_INSTRUCTION}"
    )


def call_claude(client: anthropic.Anthropic, style_guide: str, user_message: str) -> dict:
    """Call Claude with streaming to avoid idle timeout on long articles."""
    print(f"  API: model={MODEL}, max_tokens={MAX_TOKENS} (streaming)")
    system_msgs = [
        {
            "type": "text",
            "text": (
                "Du är en erfaren svensk motorjournalist på BilNytt.se. "
                "Din text ska INTE gå att känna igen som AI-genererad. "
                "Följ anti-AI-reglerna i stilguiden strikt: undvik AI-klyschor, "
                "variera meningslängd, ha egen åsikt, använd konkreta detaljer och "
                "svensk kulturell kontext. Skriv som en riktig människa med egen röst. "
                "Returnera ALLTID giltig JSON enligt schemat som ges i användarmeddelandet."
            ),
        },
        {
            "type": "text",
            "text": f"# Stilguide\n\n{style_guide}",
            "cache_control": {"type": "ephemeral"},
        },
    ]
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_msgs,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            text = stream.get_final_text().strip()
    except anthropic.APIError as e:
        print(f"  ! API-fel: {e.status_code} {e.message}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"  ! Oväntat fel vid API-anrop: {type(e).__name__}: {e}", file=sys.stderr)
        raise
    # Strip common ```json wrappers if model slips up
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Claude returned non-JSON: {text[:500]}") from e


# ── HTML rendering ──────────────────────────────────────────────────
def render_article_html(payload: dict, section: str, slug: str, published_at: datetime, source: Topic | None) -> str:
    template = load_text(TEMPLATE_PATH)
    tag = payload.get("tag") or SECTION_LABEL.get(section, "Nyhet")
    image = unsplash_image(payload.get("image_query") or section)
    score = payload.get("score")
    score_pill = (
        f'<span class="score-pill">{score}/5</span>' if (section == "tester" and score) else ""
    )
    source_note = ""
    if source and source.source_name and source.source_url:
        source_note = (
            f' · baserat på material från <a href="{source.source_url}" '
            f'rel="nofollow noopener" target="_blank">{source.source_name}</a>'
        )

    replacements = {
        "{{TITLE}}": payload["title"],
        "{{TITLE_JSON}}": payload["title"].replace('"', '\\"'),
        "{{EXCERPT}}": payload["excerpt"].replace('"', "&quot;"),
        "{{LEAD}}": payload["lead"],
        "{{BODY_HTML}}": payload["body_html"],
        "{{TAG_UPPER}}": tag.upper(),
        "{{SCORE_PILL}}": score_pill,
        "{{IMAGE}}": image,
        "{{AUTHOR}}": payload["author"],
        "{{SLUG}}": slug,
        "{{PUBLISHED_AT}}": published_at.isoformat(),
        "{{PUBLISHED_DATE_SV}}": swedish_date(published_at),
        "{{SECTION_LABEL}}": SECTION_LABEL.get(section, section),
        "{{SOURCE_NOTE}}": source_note,
    }
    html = template
    for k, v in replacements.items():
        html = html.replace(k, v)
    return html


# ── Main generation flow ────────────────────────────────────────────
def generate_one(
    client: anthropic.Anthropic,
    style_guide: str,
    agent_name: str,
    agent_prompt: str,
    topic: Topic,
    index: dict,
) -> dict | None:
    titles = existing_titles(index)
    if topic.title.strip().lower() in titles:
        print(f"  – hoppar över (redan publicerad): {topic.title}")
        return None

    print(f"  → genererar: {topic.title[:80]}")
    try:
        payload = call_claude(client, style_guide, build_user_message(agent_name, agent_prompt, topic))
    except Exception as e:
        print(f"  ! Claude-fel: {e}", file=sys.stderr)
        return None

    # Validate required fields
    for field in ("title", "excerpt", "lead", "body_html", "tag", "author", "image_query"):
        if not payload.get(field):
            print(f"  ! saknar fält '{field}' i svar, hoppar över", file=sys.stderr)
            return None

    slug = unique_slug(payload["title"], existing_slugs(index))
    published_at = datetime.now(timezone.utc)
    html = render_article_html(payload, agent_name, slug, published_at, topic)

    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    (ARTICLES_DIR / f"{slug}.html").write_text(html, encoding="utf-8")

    entry = {
        "slug": slug,
        "section": agent_name,
        "title": payload["title"],
        "excerpt": payload["excerpt"],
        "tag": payload["tag"],
        "author": payload["author"],
        "img": unsplash_image(payload["image_query"]),
        "url": f"articles/{slug}.html",
        "publishedAt": published_at.isoformat(),
        "source": {"name": topic.source_name, "url": topic.source_url} if topic.source_url else None,
    }
    if agent_name == "tester" and payload.get("score"):
        entry["score"] = str(payload["score"])
    if agent_name == "erbjudanden" and payload.get("price_label"):
        entry["priceLabel"] = payload["price_label"]

    index.setdefault("articles", []).insert(0, entry)
    print(f"  ✓ skrev {slug}.html")
    return entry


def load_agent(name: str) -> str:
    path = AGENTS_DIR / f"{name}.md"
    if not path.exists():
        raise SystemExit(f"Agent saknas: {path}")
    return load_text(path)


def run_scheduled(client: anthropic.Anthropic, style_guide: str, sources_cfg: dict, index: dict) -> int:
    created = 0
    for agent_name, cfg in sources_cfg.items():
        daily = int(cfg.get("daily", 0))
        if daily < 1:
            continue
        print(f"\n═══ Agent: {agent_name} (daily={daily}) ═══")
        agent_prompt = load_agent(agent_name)

        topics: list[Topic] = fetch_rss_topics(cfg.get("feeds", []) or [])
        random.shuffle(topics)
        # Fill with fallback topics if needed
        fallback = list(cfg.get("topics", []) or [])
        random.shuffle(fallback)
        for t in fallback:
            topics.append(Topic(title=t))

        made_here = 0
        for t in topics:
            if made_here >= daily:
                break
            res = generate_one(client, style_guide, agent_name, agent_prompt, t, index)
            if res:
                made_here += 1
                created += 1
                save_articles_index(index)
                time.sleep(1)
    return created


def run_manual(
    client: anthropic.Anthropic, style_guide: str, index: dict, agent: str, topic: str, url: str | None
) -> int:
    print(f"\n═══ Manuell körning: {agent} ═══")
    agent_prompt = load_agent(agent)
    t = Topic(title=topic, source_url=url, source_name="Manuell input" if url else None)
    res = generate_one(client, style_guide, agent, agent_prompt, t, index)
    if res:
        save_articles_index(index)
        return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["scheduled", "manual"], required=True)
    p.add_argument("--agent", help="För --mode manual: agentnamn (t.ex. elbilar)")
    p.add_argument("--topic", help="För --mode manual: artikelns ämne/rubrik")
    p.add_argument("--url", help="För --mode manual (valfri): käll-URL")
    args = p.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("FEL: ANTHROPIC_API_KEY saknas.", file=sys.stderr)
        return 1

    client = anthropic.Anthropic(
        timeout=API_TIMEOUT,
        max_retries=3,
    )
    style_guide = load_text(STYLE_GUIDE)
    sources_cfg = yaml.safe_load(load_text(SOURCES_YML)) or {}
    index = load_articles_index()

    if args.mode == "scheduled":
        created = run_scheduled(client, style_guide, sources_cfg, index)
    else:
        if not args.agent or not args.topic:
            print("--agent och --topic krävs för manual mode", file=sys.stderr)
            return 1
        created = run_manual(client, style_guide, index, args.agent, args.topic, args.url)

    print(f"\nKlart. {created} artiklar skapade.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
