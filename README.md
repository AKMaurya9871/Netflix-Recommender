# Netflix Recommender

Pick a movie and get ten similar ones, with a match score and the director, cast and genres each pick shares with it. Reviews from TMDB are scored good/bad by the Naive Bayes model from the notebook.

**Stack:** FastAPI (JSON API) + plain HTML, CSS and JavaScript (no build step, no jQuery/Bootstrap).

## Run it

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt                          # or: uv pip install -r requirements.txt
cp .env.example .env                                     # then paste your TMDB key (optional)
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000. API docs are at http://127.0.0.1:8000/docs.

The TMDB key is optional. Without it, search, recommendations and the review tester all work; posters, cast photos and live reviews are skipped. Get a free key at https://www.themoviedb.org/settings/api (the v3 key or the v4 read token both work). The key is read from `.env` via python-dotenv (included in requirements.txt). Restart uvicorn after editing `.env`.

**Posters missing?** Open http://127.0.0.1:8000/api/status. If it shows `"tmdb": false`, the key wasn't picked up (check `.env` is in the project root, named exactly `.env`, with no quotes or spaces around the key). If it shows `true` but images are blank, test http://127.0.0.1:8000/api/poster?title=avatar: an empty `poster` means TMDB rejected the key or your network blocks api.themoviedb.org / image.tmdb.org.

## Browse by year

The left sidebar lists years 2016 down to 1970. The CSV has no release year, so each year is looked up on TMDB (most-voted films of that year) and filtered to titles in the 5,978-movie catalogue. That means it needs the TMDB key, and the number of movies per year depends on how many of TMDB's top films are in the dataset.

## Layout

```
app/main.py          FastAPI routes
app/recommender.py   similarity search + sentiment model wrapper
app/tmdb.py          server-side TMDB client (key never reaches the browser)
frontend/            index.html, style.css, app.js
data/main_data.csv   5,978 movies (director, 3 actors, genres)
models/              nlp_model.pkl, tfidf_vectorizer.pkl, training notebook
```

## API

| Route | Purpose |
|---|---|
| `GET /api/search?q=` | autocomplete titles |
| `GET /api/recommend?title=&n=10` | similar movies with `match` and `shared` |
| `GET /api/movie?title=` | TMDB details + scored reviews |
| `GET /api/year?y=2015` | catalogue movies released that year (needs TMDB key) |
| `GET /api/poster?title=` | poster for a recommendation card |
| `POST /api/sentiment` | `{"text": "..."}` returns `{label, score}` |

## What changed from the two uploaded projects

- **Fixed the FastAPI port:** `list[i][0]` typo, missing sort by similarity, wrong template paths, `app.run()` (not a FastAPI method), and the similarity matrix being rebuilt on every request.
- **Faster and lighter:** one sparse dot product per query (about 4 ms) instead of a 6,000 x 6,000 matrix.
- **TMDB moved server-side:** the old `recommend.js` shipped the API key to every visitor and made 20+ blocking calls per search.
- **IMDB scraping replaced** with TMDB user reviews. IMDB's old `text show-more__control` markup no longer exists, so the scraper returned nothing.
- **Duplicates removed:** 32 repeated titles in the CSV.
- Jinja templates, jQuery and Bootstrap replaced by a static frontend that talks to the JSON API.

## Notes

- If you see a scikit-learn version warning when the pickles load, re-run `models/train_sentiment_model.ipynb` against `data/reviews.txt`. The notebook saves to `pickle/` paths, so point them at `models/`.
- The original key in `recommend.js` is public in the GitHub repo. Rotate it on TMDB and use your own.
