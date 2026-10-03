"""
Aurora — a light, privacy-friendly visit counter (judge mode).

The team wants to know when judges opened the site and which link they used (the
main page, a story, a module), without a third-party tracker and without a cookie.

What is stored: aggregate counts per IST day, hour and entry point (visit_counts).
What is not stored: no IP address, user agent, cookie or visitor id, ever.

How visitors are told apart: hash(daily salt + IP + user agent), the approach of
privacy-first analytics. The salt is random, lives only in memory and is replaced
every IST day, so a hash cannot be linked across days and nothing on disk can be
traced back to a person. A restart forgets the salt: a visitor seen before and after
it is counted twice that day (an accepted, conservative error).

  visit    the page opened by someone not seen in the last VISIT_GAP_S (30 min)
  visitor  someone counted once per IST day, in the hour they first came

Not counted: the team (a valid X-Admin-Token), crawlers, link previews and headless
browsers (our own e2e runs), so the numbers are judges and other people.
"""

import hashlib
import logging
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import db

log = logging.getLogger("aurora.visits")

IST = timezone(timedelta(hours=5, minutes=30))     # no daylight saving; no tzdata needed
VISIT_GAP_S = 30 * 60
MAX_TRACKED = 20_000                                 # per day; beyond, visits count without de-duplication
RETENTION_DAYS = 90
ENTRY_RE = re.compile(r"^(main|tour|story:(blizzard|generator|fuel)|module:[A-Za-z]{1,32})$")
NOT_A_PERSON = re.compile(r"bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpx",
                          re.IGNORECASE)


def ist_now(ts: float | None = None) -> datetime:
    return datetime.fromtimestamp(time.time() if ts is None else ts, IST)


def clean_entry(raw: str | None) -> str:
    """The entry point as recorded: a known shape, or 'main'."""
    raw = (raw or "").strip()
    return raw if ENTRY_RE.match(raw) else "main"


class VisitCounter:
    def __init__(self):
        self._lock = threading.Lock()
        self._day: str | None = None
        self._salt = b""
        self._last_seen: dict[str, float] = {}       # hash → last visit time, today only

    def _rotate(self, day: str) -> None:
        """A new IST day: new salt, forget every hash, prune old counts (lock held)."""
        self._day = day
        self._salt = secrets.token_bytes(16)
        self._last_seen = {}
        cutoff = (ist_now() - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d")
        with db.connect() as conn:
            conn.execute("DELETE FROM visit_counts WHERE day < ?", (cutoff,))

    def record(self, ip: str, user_agent: str, entry: str, ts: float | None = None) -> dict:
        """Count one page open. Returns what was counted (for tests and the response)."""
        if not user_agent or NOT_A_PERSON.search(user_agent):
            return {"counted": False, "reason": "not a person"}
        now = time.time() if ts is None else ts
        t = ist_now(now)
        day, hour = t.strftime("%Y-%m-%d"), t.hour
        entry = clean_entry(entry)
        with self._lock:
            if day != self._day:
                self._rotate(day)
            h = hashlib.sha256(self._salt + f"{ip}|{user_agent}".encode()).hexdigest()
            last = self._last_seen.get(h)
            new_visitor = last is None
            new_visit = last is None or now - last >= VISIT_GAP_S
            if len(self._last_seen) < MAX_TRACKED or not new_visitor:
                self._last_seen[h] = now
            if not new_visit:
                return {"counted": False, "reason": "same visit"}
            with db.connect() as conn:
                conn.execute(
                    "INSERT INTO visit_counts (day, hour, entry, visits, visitors) VALUES (?, ?, ?, 1, ?) "
                    "ON CONFLICT(day, hour, entry) DO UPDATE SET visits = visits + 1, "
                    "visitors = visitors + excluded.visitors", (day, hour, entry, int(new_visitor)))
        return {"counted": True, "newVisitor": new_visitor, "day": day, "hour": hour, "entry": entry}

    @staticmethod
    def summary(days: int = 14) -> dict:
        """Per-day totals (newest first), today's hours, and entry points over the period."""
        today = ist_now()
        first = (today - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        with db.connect() as conn:
            rows = conn.execute("SELECT day, hour, entry, visits, visitors FROM visit_counts WHERE day >= ? "
                                "ORDER BY day DESC, hour", (first,)).fetchall()
        by_day: dict[str, dict] = {}
        entries: dict[str, int] = {}
        hours = {h: {"hour": h, "visits": 0, "visitors": 0} for h in range(24)}
        last_hour = None
        for r in rows:
            d = by_day.setdefault(r["day"], {"day": r["day"], "visits": 0, "visitors": 0})
            d["visits"] += r["visits"]
            d["visitors"] += r["visitors"]
            entries[r["entry"]] = entries.get(r["entry"], 0) + r["visits"]
            if r["day"] == today.strftime("%Y-%m-%d"):
                hours[r["hour"]]["visits"] += r["visits"]
                hours[r["hour"]]["visitors"] += r["visitors"]
            if last_hour is None or (r["day"], r["hour"]) > last_hour:
                last_hour = (r["day"], r["hour"])
        return {
            "timezone": "IST (UTC+05:30)", "days": days,
            "byDay": sorted(by_day.values(), key=lambda d: d["day"], reverse=True),
            "today": {"day": today.strftime("%Y-%m-%d"), "hours": list(hours.values())},
            "entries": [{"entry": k, "visits": v} for k, v in sorted(entries.items(), key=lambda kv: -kv[1])],
            "lastVisitHour": None if last_hour is None else {"day": last_hour[0], "hour": last_hour[1]},
            "totals": {"visits": sum(d["visits"] for d in by_day.values()),
                       "visitors": sum(d["visitors"] for d in by_day.values())},
            "method": ("Aggregate counts only. Visitors are told apart by a hash with a daily random salt kept in "
                       "memory; no IP, user agent, cookie or id is stored. The team, crawlers and headless browsers "
                       "are not counted."),
        }


VISITS = VisitCounter()
