#!/usr/bin/env python3
"""Find new class-council notices and update the static PWA event feed."""
from __future__ import annotations

import json
import hashlib
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import fitz
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "public" / "data" / "convocations.json"
BASE = "https://ipsiabirago.edu.it/circolare/"
CLASSES = {"1A", "1B", "1C", "1M", "1N", "2B", "2C", "2D", "2E", "3A"}
HEADERS = {"User-Agent": "ConsigliClasseCalendar/1.0 (public school circular monitor)"}
TIME_RANGE = re.compile(r"(?P<start>\d{1,2}[.:]\d{2})\s*[–—-]\s*(?P<end>\d{1,2}[.:]\d{2})\s+(?P<class>\d[A-Z])\b(?P<tail>[^\n]*)", re.I)
DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?!\d)")


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", value).strip()


def get_soup(url: str) -> BeautifulSoup:
    response = requests.get(url, headers=HEADERS, timeout=35)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def listing_pages(max_pages: int = 6) -> list[str]:
    pages = [BASE]
    visited = set()
    index = 0
    while index < len(pages) and len(pages) < max_pages:
        url = pages[index]
        index += 1
        if url in visited:
            continue
        visited.add(url)
        try:
            soup = get_soup(url)
        except requests.RequestException as exc:
            print(f"Could not read listing page {url}: {exc}", file=sys.stderr)
            continue
        for anchor in soup.select(".pagination a, nav a, a.page-numbers, .pagination__list a"):
            href = urljoin(url, anchor.get("href", ""))
            if urlparse(href).netloc == urlparse(BASE).netloc and href not in visited and href not in pages:
                if "circolare" in href:
                    pages.append(href)
                    if len(pages) >= max_pages:
                        break
        time.sleep(0.2)
    return pages


def notice_links(pages: list[str]) -> list[tuple[str, str]]:
    found: dict[str, str] = {}
    for page in pages:
        try:
            soup = get_soup(page)
        except requests.RequestException as exc:
            print(f"Could not read {page}: {exc}", file=sys.stderr)
            continue
        for anchor in soup.select("a[href]"):
            title = " ".join(anchor.stripped_strings)
            href = urljoin(page, anchor.get("href", ""))
            if (re.search(r"consigli(?:o)?\s+(?:di\s+)?classe", norm(title))
                    and urlparse(href).netloc == urlparse(BASE).netloc
                    and not href.lower().endswith(".pdf")):
                found[href] = title
        time.sleep(0.2)
    return list(found.items())


def pdf_links(detail_url: str) -> list[str]:
    soup = get_soup(detail_url)
    links = []
    for anchor in soup.select("a[href]"):
        href = urljoin(detail_url, anchor.get("href", ""))
        text = " ".join(anchor.stripped_strings).lower()
        if ".pdf" in urlparse(href).path.lower() or "allegat" in text or "scarica" in text:
            if ".pdf" in href.lower():
                links.append(href)
    return list(dict.fromkeys(links))


def parse_time(value: str) -> str:
    return value.replace(".", ":").zfill(5)


def parse_pdf(pdf_url: str, title: str, detail_url: str) -> list[dict]:
    response = requests.get(pdf_url, headers=HEADERS, timeout=50)
    response.raise_for_status()
    document = fitz.open(stream=response.content, filetype="pdf")
    rows: list[dict] = []
    label_match = re.search(r"(?:circ\.?\s*(?:n\.?\s*)?)(\d+[A-Z]+)", title, re.I)
    label = label_match.group(1).upper() if label_match else title[:80]
    source_slug = re.search(r"(?:circ\.?\s*(?:n\.?\s*)?)(\d+[A-Z]+)", title, re.I)
    stable_url = hashlib.sha1(detail_url.encode("utf-8")).hexdigest()[:10]
    source_id = f"circ-{source_slug.group(1).lower()}" if source_slug else f"notice-{stable_url}"

    for page in document:
        current_date: date | None = None
        lines = page.get_text("text", sort=True).splitlines()
        for line in lines:
            date_match = DATE_RE.search(line)
            if date_match:
                try:
                    current_date = date(int(date_match.group(3)), int(date_match.group(2)), int(date_match.group(1)))
                except ValueError:
                    pass
            for match in TIME_RANGE.finditer(line):
                class_name = match.group("class").upper()
                if class_name not in CLASSES or current_date is None:
                    continue
                if "rappresentanti" in norm(match.group("tail")):
                    continue
                room_match = re.search(r"\b(\d{1,3}|Pisacane)\b", match.group("tail"), re.I)
                start, end = parse_time(match.group("start")), parse_time(match.group("end"))
                event_key = f"{source_id}:{current_date.isoformat()}:{class_name}:{start}"
                rows.append({
                    "key": event_key,
                    "class": class_name,
                    "date": current_date.isoformat(),
                    "start": start,
                    "end": end,
                    "room": room_match.group(1) if room_match else "",
                    "sourceId": source_id,
                    "sourceLabel": label,
                    "sourceUrl": detail_url,
                })
    return rows


def main() -> None:
    now = datetime.now(timezone.utc)
    pages = listing_pages()
    notices = notice_links(pages)
    scanned: dict[str, list[dict]] = {}
    warnings = []
    for detail_url, title in notices:
        try:
            urls = pdf_links(detail_url)
            if not urls:
                continue
            events = []
            for url in urls:
                events.extend(parse_pdf(url, title, detail_url))
                time.sleep(0.2)
            if events:
                source_id = events[0]["sourceId"]
                scanned[source_id] = events
        except Exception as exc:  # keep the scheduled run alive if one notice is malformed
            warning = f"{title}: {exc}"
            print(warning, file=sys.stderr)
            warnings.append(warning)

    previous = json.loads(FEED.read_text(encoding="utf-8")) if FEED.exists() else {"events": []}
    old_by_source: dict[str, list[dict]] = {}
    for event in previous.get("events", []):
        old_by_source.setdefault(event.get("sourceId", "legacy"), []).append(event)
    for source_id, events in scanned.items():
        old_by_source[source_id] = events
    today = now.date().isoformat()
    combined = [event for events in old_by_source.values() for event in events if event.get("date", "") >= today]
    unique = {event["key"]: event for event in combined}
    output = {
        "checkedAt": now.isoformat(timespec="seconds"),
        "sourcePage": BASE,
        "warning": " | ".join(warnings[:3]) if warnings else None,
        "events": sorted(unique.values(), key=lambda e: (e["date"], e["start"], e["class"])),
    }
    FEED.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Scanned {len(notices)} notices; {len(output['events'])} future events for selected classes.")


if __name__ == "__main__":
    main()
