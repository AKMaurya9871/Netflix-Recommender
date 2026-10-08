"""Thin async TMDB client. Runs server-side so the API key never reaches the browser."""
from __future__ import annotations

import asyncio
import os

import httpx

BASE = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"


def _img(path: str | None, size: str) -> str | None:
    return f"{IMG}/{size}{path}" if path else None


class TMDB:
    def __init__(self) -> None:
        self.key = os.getenv("TMDB_API_KEY", "").strip()
        self.client = httpx.AsyncClient(base_url=BASE, timeout=10)
        self._cache: dict = {}

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def close(self) -> None:
        await self.client.aclose()

    async def _get(self, path: str, **params):
        cache_key = (path, tuple(sorted(params.items())))
        if cache_key in self._cache:
            return self._cache[cache_key]
        headers, query = {}, dict(params)
        if len(self.key) > 40:  # v4 read-access token
            headers["Authorization"] = f"Bearer {self.key}"
        else:  # v3 api key
            query["api_key"] = self.key
        resp = await self.client.get(path, params=query, headers=headers)
        resp.raise_for_status()
        self._cache[cache_key] = data = resp.json()
        return data

    async def _first_match(self, title: str) -> dict | None:
        results = (await self._get("/search/movie", query=title)).get("results", [])
        return results[0] if results else None

    async def by_year(self, year: int, pages: int = 6) -> list[dict]:
        """Most-voted films released in `year` (pages x 20), lightweight fields only."""
        batches = await asyncio.gather(*(
            self._get("/discover/movie", primary_release_year=year, sort_by="vote_count.desc", include_adult="false", page=p)
            for p in range(1, pages + 1)
        ))
        return [
            {"title": m.get("title") or "", "poster": _img(m.get("poster_path"), "w185"), "rating": round(m.get("vote_average") or 0, 1)}
            for b in batches for m in b.get("results", [])
        ]

    async def poster(self, title: str) -> dict:
        m = await self._first_match(title)
        if not m:
            return {"poster": None}
        return {
            "poster": _img(m.get("poster_path"), "w342"),
            "year": (m.get("release_date") or "")[:4] or None,
            "rating": round(m.get("vote_average") or 0, 1),
        }

    async def details(self, title: str) -> dict | None:
        m = await self._first_match(title)
        if not m:
            return None
        d = await self._get(f"/movie/{m['id']}", append_to_response="credits,reviews")
        return {
            "poster": _img(d.get("poster_path"), "w500"),
            "backdrop": _img(d.get("backdrop_path"), "w1280"),
            "tagline": d.get("tagline") or None,
            "overview": d.get("overview") or None,
            "rating": round(d.get("vote_average") or 0, 1),
            "votes": d.get("vote_count") or 0,
            "release_date": d.get("release_date") or None,
            "runtime": d.get("runtime") or None,
            "status": d.get("status"),
            "genres": [g["name"] for g in d.get("genres", [])],
            "cast": [
                {"name": c["name"], "character": c.get("character"), "photo": _img(c.get("profile_path"), "w185")}
                for c in d.get("credits", {}).get("cast", [])[:10]
            ],
            "reviews": [
                {"author": r.get("author"), "text": r.get("content", "").strip(), "rating": (r.get("author_details") or {}).get("rating")}
                for r in d.get("reviews", {}).get("results", [])[:10]
                if r.get("content", "").strip()
            ],
        }
