"""FastAPI app: JSON API under /api, static frontend at /.

Run:  uvicorn app.main:app --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .recommender import Recommender, Sentiment, pretty
from .tmdb import TMDB

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

try:  # optional: load TMDB_API_KEY from .env if python-dotenv is installed
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

recommender = Recommender(ROOT / "data" / "main_data.csv")
sentiment = Sentiment(ROOT / "models" / "nlp_model.pkl", ROOT / "models" / "tfidf_vectorizer.pkl")
tmdb = TMDB()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await tmdb.close()


app = FastAPI(title="Netflix Recommender", lifespan=lifespan)


def _index_or_404(title: str) -> int:
    i = recommender.find(title)
    if i is None:
        raise HTTPException(404, {"message": f"'{title}' is not in the catalogue.", "did_you_mean": [{"title": t, "display": pretty(t)} for t in recommender.close_matches(title)]})
    return i


@app.get("/api/status")
def status():
    return {"tmdb": tmdb.enabled, "titles": len(recommender.titles)}


@app.get("/api/search")
def search(q: str = Query("", max_length=80)):
    return [{"title": t, "display": recommender.meta(recommender.find(t))["display"]} for t in recommender.suggest(q)]


@app.get("/api/recommend")
def recommend(title: str = Query(..., max_length=200), n: int = Query(10, ge=1, le=20)):
    i = _index_or_404(title)
    return {"movie": recommender.meta(i), "recommendations": recommender.recommend(i, n)}


@app.get("/api/movie")
async def movie(title: str = Query(..., max_length=200)):
    """Rich details from TMDB plus sentiment for each TMDB user review. Degrades to CSV data only."""
    base = recommender.meta(_index_or_404(title))
    info = None
    if tmdb.enabled:
        try:
            info = await tmdb.details(base["title"])
        except httpx.HTTPError:
            info = None  # TMDB down or key rejected: frontend shows the CSV data
    if not info:
        return {"movie": base, "tmdb": None, "reviews": []}
    reviews = info.pop("reviews")
    scored = sentiment.predict([r["text"] for r in reviews])
    return {"movie": base, "tmdb": info, "reviews": [{**r, **s} for r, s in zip(reviews, scored)]}


@app.get("/api/year")
async def by_year(y: int = Query(..., ge=1900, le=2030)):
    """Catalogue movies released in year `y` (TMDB decides the year; the CSV decides what is recommendable)."""
    if not tmdb.enabled:
        return {"enabled": False, "movies": []}
    try:
        found = await tmdb.by_year(y)
    except httpx.HTTPError:
        raise HTTPException(502, "TMDB is unreachable right now. Try again in a moment.")
    movies, seen = [], set()
    for m in found:
        i = recommender.find(m["title"])
        if i is None or i in seen:
            continue
        seen.add(i)
        t = recommender.titles[i]
        movies.append({"title": t, "display": pretty(t), "poster": m["poster"], "rating": m["rating"]})
    return {"enabled": True, "movies": movies[:40]}


@app.get("/api/poster")
async def poster(title: str = Query(..., max_length=200)):
    if not tmdb.enabled:
        return {"poster": None}
    try:
        return await tmdb.poster(title)
    except httpx.HTTPError:
        return {"poster": None}


class ReviewIn(BaseModel):
    text: str = Field(..., max_length=5000)


@app.post("/api/sentiment")
def classify(body: ReviewIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Write a review first.")
    return sentiment.predict([text])[0]


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(FRONTEND / "index.html")
