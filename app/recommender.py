"""Content-based movie recommender + review sentiment model (no web framework here)."""
from __future__ import annotations

import difflib
import pickle
import re
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.preprocessing import normalize

_SMALL = {"a", "an", "the", "of", "in", "on", "and", "or", "to", "for", "at", "by", "vs"}


def pretty(title: str) -> str:
    """'pirates of the caribbean: at world's end' -> "Pirates of the Caribbean: At World's End"."""
    words = title.strip().split(" ")
    out = []
    for n, w in enumerate(words):
        starts_phrase = n == 0 or words[n - 1].endswith(":") or words[n - 1] == "-"
        if re.fullmatch(r"[ivx]{2,}", w):  # roman numerals: vii -> VII
            out.append(w.upper())
        elif w in _SMALL and not starts_phrase:
            out.append(w)
        else:
            out.append(re.sub(r"^\W*\w", lambda m: m.group(0).upper(), w))
    return " ".join(out)


class Recommender:
    """Cosine similarity over director + cast + genres ('comb' column), as in the original notebook.

    Rows are L2-normalised once, so similarity for one movie is a single sparse
    dot product. No 6000x6000 matrix is ever built.
    """

    def __init__(self, csv_path: Path):
        df = pd.read_csv(csv_path).drop_duplicates("movie_title").reset_index(drop=True)
        self.df = df
        self.titles: list[str] = df["movie_title"].str.strip().tolist()
        self._lower = [t.lower() for t in self.titles]
        self._index = {t: i for i, t in enumerate(self._lower)}
        self._matrix = normalize(CountVectorizer().fit_transform(df["comb"]))

    def find(self, title: str) -> int | None:
        return self._index.get(title.strip().lower())

    def suggest(self, query: str, limit: int = 8) -> list[str]:
        q = query.strip().lower()
        if not q:
            return []
        starts = [t for t, l in zip(self.titles, self._lower) if l.startswith(q)]
        has = [t for t, l in zip(self.titles, self._lower) if q in l and not l.startswith(q)]
        return (sorted(starts, key=len) + sorted(has, key=len))[:limit]

    def close_matches(self, title: str, limit: int = 3) -> list[str]:
        return difflib.get_close_matches(title.strip().lower(), self._lower, n=limit, cutoff=0.6)

    def meta(self, i: int) -> dict:
        r = self.df.iloc[i]
        known = lambda v: None if str(v).lower() == "unknown" else str(v)
        return {
            "title": self.titles[i],
            "display": pretty(self.titles[i]),
            "director": known(r["director_name"]),
            "actors": [a for a in (known(r[c]) for c in ("actor_1_name", "actor_2_name", "actor_3_name")) if a],
            "genres": str(r["genres"]).split(),
        }

    def recommend(self, i: int, n: int = 10) -> list[dict]:
        sims = (self._matrix @ self._matrix[i].T).toarray().ravel()
        sims[i] = -1.0  # never recommend the movie itself
        top = np.argpartition(-sims, n)[:n]
        top = top[np.argsort(-sims[top])]
        base = self.meta(i)
        out = []
        for j in top:
            m = self.meta(int(j))
            m["match"] = round(float(sims[j]), 3)
            m["shared"] = {
                "director": base["director"] if base["director"] and base["director"] == m["director"] else None,
                "actors": [a for a in m["actors"] if a in base["actors"]],
                "genres": [g for g in m["genres"] if g in base["genres"]],
            }
            out.append(m)
        return out


class Sentiment:
    """Multinomial Naive Bayes + TF-IDF trained in models/train_sentiment_model.ipynb."""

    def __init__(self, model_path: Path, vectorizer_path: Path):
        with open(model_path, "rb") as f:
            self.clf = pickle.load(f)
        with open(vectorizer_path, "rb") as f:
            self.vec = pickle.load(f)
        self._pos = list(self.clf.classes_).index(1)

    def predict(self, texts: list[str]) -> list[dict]:
        if not texts:
            return []
        p = self.clf.predict_proba(self.vec.transform(texts))[:, self._pos]
        return [{"label": "good" if x >= 0.5 else "bad", "score": round(float(x), 3)} for x in p]
