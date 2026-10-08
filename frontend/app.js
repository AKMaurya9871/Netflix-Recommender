const $ = (s) => document.querySelector(s);
const state = { tmdb: false, token: 0, reviewsOpen: true };

/* Tiny DOM builder. Text always goes through text nodes, never innerHTML. */
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = body.detail;
    const err = new Error(typeof d === 'string' ? d : d?.message || 'Something went wrong. Try again.');
    err.didYouMean = d?.did_you_mean || [];
    throw err;
  }
  return body;
}

/* ---------- posters ---------- */
function addImg(box, url) {
  box.append(h('img', { src: url, alt: '', loading: 'lazy', onload: (e) => e.target.classList.add('in') }));
}
function poster(title, url, cls = '') {
  let hue = 0;
  for (const c of title) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const initials = title.split(/\s+/).filter((w) => /^\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const box = h('div', { class: `poster ${cls}`, style: `--hue:${hue}` }, h('span', { 'aria-hidden': 'true' }, initials));
  if (url) addImg(box, url);
  return box;
}
async function fillPoster(box, title) {
  try {
    const p = await api(`/api/poster?title=${encodeURIComponent(title)}`);
    if (p.poster) addImg(box, p.poster);
  } catch { /* keep the gradient fallback */ }
}

/* ---------- rendering ---------- */
const chip = (kind, text) => h('li', { class: `chip ${kind}`, title: kind }, text);

function renderDetail(movie, info) {
  const t = info?.tmdb;
  const facts = [
    t?.release_date?.slice(0, 4),
    t?.runtime ? `${Math.floor(t.runtime / 60)}h ${t.runtime % 60}m` : null,
    t?.rating ? `${t.rating} / 10 from ${t.votes.toLocaleString()} votes` : null,
  ].filter(Boolean);
  const detail = $('#detail');
  detail.style.setProperty('--backdrop', t?.backdrop ? `url("${t.backdrop}")` : 'none');
  detail.replaceChildren(
    poster(movie.display, t?.poster, 'big'),
    h('div', {},
      h('h2', {}, movie.display),
      t?.tagline ? h('p', { class: 'tagline' }, t.tagline) : null,
      facts.length ? h('p', { class: 'facts' }, facts.map((f) => h('span', {}, f))) : null,
      h('ul', { class: 'chips' }, movie.genres.map((g) => chip('genre', g))),
      t?.overview ? h('p', { class: 'overview' }, t.overview) : null,
      h('p', { class: 'credits' },
        movie.director ? h('span', {}, h('b', {}, 'Director'), movie.director) : null,
        movie.actors.length ? h('span', {}, h('b', {}, 'Starring'), movie.actors.join(', ')) : null),
      t?.cast?.length
        ? h('ul', { class: 'cast', 'aria-label': 'Top cast' }, t.cast.map((c) =>
            h('li', {}, poster(c.name, c.photo), c.name, h('small', {}, c.character || ''))))
        : null));
}

function recCard(m) {
  const pct = Math.round(m.match * 100);
  const chips = [];
  if (m.shared.director) chips.push(['director', m.shared.director]);
  m.shared.actors.forEach((a) => chips.push(['actor', a]));
  m.shared.genres.forEach((g) => chips.push(['genre', g]));
  const box = poster(m.display, null);
  if (state.tmdb) fillPoster(box, m.title);
  return h('a', { class: 'rec', href: `?t=${encodeURIComponent(m.title)}`, onclick: (e) => { e.preventDefault(); showMovie(m.title); } },
    box,
    h('div', { class: 'rec-body' },
      h('div', { class: 'rec-top' }, h('span', { class: 'rec-name' }, m.display), h('span', { class: 'match' }, `${pct}%`)),
      h('div', { class: 'bar', role: 'img', 'aria-label': `${pct}% match` }, h('i', { style: `width:${pct}%` })),
      h('ul', { class: 'chips' }, chips.slice(0, 5).map(([k, v]) => chip(k, v)))));
}

function renderRecs(data) {
  $('#recs').replaceChildren(
    h('h3', {}, `Because you picked ${data.movie.display}`),
    h('p', { class: 'note' }, 'Match compares director, cast and genres. Chips show what each film shares with it.'),
    h('div', { class: 'grid' }, data.recommendations.map(recCard)));
}

const confidence = (r) => Math.round((r.label === 'good' ? r.score : 1 - r.score) * 100);

function renderReviews(info) {
  const box = $('#reviews');
  const head = h('h3', {}, 'What viewers say');
  if (!state.tmdb) return box.replaceChildren(head, h('p', { class: 'note' }, 'Live reviews need a TMDB key. You can still test the review model at the bottom of the page.'));
  if (!info?.tmdb) return box.replaceChildren(head, h('p', { class: 'note' }, "Couldn't load TMDB data for this film, so only catalogue details are shown."));
  const rs = info.reviews;
  if (!rs.length) return box.replaceChildren(head, h('p', { class: 'note' }, 'TMDB has no user reviews for this film yet.'));
  const good = rs.filter((r) => r.label === 'good').length;
  const list = h('div', { id: 'review-list', hidden: !state.reviewsOpen }, ...rs.map((r) => {
    const text = h('p', { class: 'clamp' }, r.text);
    const more = r.text.length > 280
      ? h('button', { type: 'button', class: 'link', 'aria-expanded': 'false', onclick: (e) => {
          const open = text.classList.toggle('clamp') === false;
          e.target.textContent = open ? 'Show less' : 'Read more';
          e.target.setAttribute('aria-expanded', String(open));
        } }, 'Read more')
      : null;
    return h('article', { class: 'review' },
      h('div', { class: 'review-head' },
        h('span', { class: `badge ${r.label}` }, r.label === 'good' ? 'Good' : 'Bad'),
        h('span', {}, `${confidence(r)}% sure`),
        h('span', {}, r.author || 'Anonymous')),
      text, more);
  }));
  const toggle = h('button', { type: 'button', class: 'btn-ghost', 'aria-expanded': String(state.reviewsOpen), 'aria-controls': 'review-list', onclick: () => {
    state.reviewsOpen = !state.reviewsOpen;
    list.hidden = !state.reviewsOpen;
    toggle.textContent = state.reviewsOpen ? 'Minimise' : 'Expand';
    toggle.setAttribute('aria-expanded', String(state.reviewsOpen));
  } }, state.reviewsOpen ? 'Minimise' : 'Expand');
  box.replaceChildren(
    h('div', { class: 'reviews-head' }, head, toggle),
    h('p', { class: 'note' }, `The model reads ${good} of ${rs.length} reviews as good.`),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${good} good, ${rs.length - good} bad` }, h('i', { style: `width:${(good / rs.length) * 100}%` })),
    list);
}

/* ---------- flow ---------- */
function setStatus(...kids) { $('#status').replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); }

async function showMovie(title, push = true) {
  const mine = ++state.token;
  $('#q').value = '';
  closeList();
  document.body.classList.add('compact');
  setStatus(`Finding movies like ${title}…`);
  if (push) history.pushState({}, '', `?t=${encodeURIComponent(title)}`);
  const enc = encodeURIComponent(title);
  const infoP = api(`/api/movie?title=${enc}`).catch(() => null); // TMDB is slower; render recs first
  try {
    const data = await api(`/api/recommend?title=${enc}`);
    if (mine !== state.token) return;
    setStatus();
    $('#result').hidden = false;
    renderDetail(data.movie, null);
    renderRecs(data);
    $('#reviews').replaceChildren();
    window.scrollTo({ top: 0 });
    const info = await infoP;
    if (mine !== state.token) return;
    renderDetail(data.movie, info);
    renderReviews(info);
  } catch (e) {
    if (mine !== state.token) return;
    $('#result').hidden = true;
    setStatus(
      h('span', { class: 'err' }, e.message),
      e.didYouMean.length ? [' Did you mean ', e.didYouMean.map((t) => h('button', { type: 'button', class: 'link', onclick: () => showMovie(t.title) }, t.display))] : null);
  }
}

function loadFromUrl() {
  const t = new URLSearchParams(location.search).get('t');
  if (t) return showMovie(t, false);
  state.token++;
  document.body.classList.remove('compact');
  $('#result').hidden = true;
  setStatus();
}

/* ---------- autocomplete ---------- */
const input = $('#q'), list = $('#suggestions');
let items = [], active = -1;

function closeList() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
function setActive(n) {
  active = (n + items.length) % items.length;
  [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
  input.setAttribute('aria-activedescendant', `opt${active}`);
}
function renderList() {
  active = -1;
  list.replaceChildren(...(items.length
    ? items.map((it, n) => h('li', { role: 'option', id: `opt${n}`, 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); showMovie(it.title); } }, it.display))
    : [h('li', { class: 'none', role: 'presentation' }, 'No titles match. Check the spelling.')]));
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  const q = input.value.trim();
  if (q.length < 2) return closeList();
  timer = setTimeout(async () => {
    try { items = await api(`/api/search?q=${encodeURIComponent(q)}`); } catch { items = []; }
    if (q === input.value.trim()) renderList();
  }, 120);
});
input.addEventListener('keydown', (e) => {
  if (list.hidden || !items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
  else if (e.key === 'Escape') closeList();
  else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); showMovie(items[active].title); }
});
input.addEventListener('blur', closeList);
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = input.value.trim();
  if (t) showMovie(t);
});
document.querySelectorAll('.examples [data-title]').forEach((b) => b.addEventListener('click', () => showMovie(b.dataset.title)));

/* ---------- browse by year ---------- */
const yearCache = new Map();

async function loadYear(year, panel) {
  panel.replaceChildren(h('li', { class: 'msg' }, 'Loading…'));
  try {
    if (!yearCache.has(year)) yearCache.set(year, (await api(`/api/year?y=${year}`)).movies);
    const movies = yearCache.get(year);
    panel.replaceChildren(...(movies.length
      ? movies.map((m) => h('li', {}, h('a', { href: `?t=${encodeURIComponent(m.title)}`, onclick: (e) => { e.preventDefault(); showMovie(m.title); } },
          poster(m.display, m.poster, 'thumb'),
          h('span', {}, m.display, m.rating ? h('small', {}, `${m.rating} / 10`) : null))))
      : [h('li', { class: 'msg' }, 'No catalogue movies found for this year.')]));
  } catch (e) {
    panel.replaceChildren(h('li', { class: 'msg' }, e.message));
  }
}

function buildYears() {
  const ul = $('#year-list');
  if (!state.tmdb) { $('#years-note').hidden = false; return; }
  let openBtn = null;
  for (let y = 2016; y >= 1970; y--) {
    const panel = h('ul', { class: 'year-movies', hidden: true });
    const btn = h('button', { type: 'button', class: 'year-btn', 'aria-expanded': 'false', onclick: () => {
      const opening = btn.getAttribute('aria-expanded') === 'false';
      if (openBtn && openBtn !== btn) { openBtn.setAttribute('aria-expanded', 'false'); openBtn.nextElementSibling.hidden = true; }
      btn.setAttribute('aria-expanded', String(opening));
      panel.hidden = !opening;
      openBtn = opening ? btn : null;
      if (opening) loadYear(y, panel);
    } }, String(y));
    ul.append(h('li', {}, btn, panel));
  }
}

/* ---------- review tester ---------- */
$('#tester-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#tester-out'), btn = e.submitter, text = $('#tester-text').value.trim();
  if (!text) return out.replaceChildren('Write a review first.');
  btn.disabled = true;
  try {
    const r = await api('/api/sentiment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    out.replaceChildren(h('span', { class: `badge ${r.label}` }, r.label === 'good' ? 'Good' : 'Bad'), ` The model is ${confidence(r)}% sure.`);
  } catch (err) {
    out.replaceChildren(err.message);
  } finally { btn.disabled = false; }
});

/* ---------- init ---------- */
window.addEventListener('popstate', loadFromUrl);
api('/api/status').then((s) => { state.tmdb = s.tmdb; $('#hint').hidden = s.tmdb; }).catch(() => {}).finally(() => { buildYears(); loadFromUrl(); });
