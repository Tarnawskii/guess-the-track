// ---------- CH2: GROOVTEXT, a teletext service ----------
// P100 index · P200 new releases (the radar) · P300 for you · P400 tonight's programme · P500 your charts
const TT_PAGES = { 100: "INDEX", 200: "NEW RELEASES", 300: "FOR YOU", 400: "TONIGHT", 500: "YOUR CHARTS" };
const TT_FAST = [[200, "NEW"], [300, "FOR YOU"], [400, "TONIGHT"], [500, "CHARTS"]]; // red, green, yellow, cyan
try { const p = Number(localStorage.getItem("gtt_tv_page")); if (TT_PAGES[p]) tv.page = p; } catch {}
if (!tv.page) tv.page = 100;
const charts = { loading: false, at: 0, tracks: [], artists: [], error: "" };
const CHARTS_TTL = 60 * 60 * 1000;
const forYou = { loading: false, at: 0, items: [], error: "", done: 0, total: 0 };
const FORYOU_TTL = 12 * 60 * 60 * 1000;
try { const c = JSON.parse(localStorage.getItem("gtt_foryou")); if (c && c.items) Object.assign(forYou, { at: c.at, items: c.items }); } catch {}

const clock = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const spotErr = (res) => (!res ? "NO SIGNAL" : res.status === 403 ? "PREMIUM ONLY" : res.status === 404 ? "NO PLAYER" : "ERR " + res.status);

function tvSetPage(p) {
  if (!TT_PAGES[p]) return;
  if (tv.page !== p) { tv.page = p; tv.sub = 0; tv.subAt = Date.now(); tvStatic(180); }
  try { localStorage.setItem("gtt_tv_page", String(p)); } catch {}
  if (p === 400 && Date.now() - tv.queueAt > 5000) tvLoadQueue();
  tvRenderText(true);
}

function ttHead(page, sub) {
  const h = el("div", "tt-head");
  h.append(el("b", "", "P" + page + (sub ? " " + sub : "")), el("span", "", "GROOVTEXT"), el("span", "", clock(new Date())));
  return h;
}

function ttRow(mark, parts, title, onclick) {
  const row = el("button", "tt-row");
  row.type = "button";
  const name = el("span");
  name.append(...parts);
  row.append(el("i", "", mark), name);
  row.title = title;
  row.onclick = onclick;
  return row;
}

// the four coloured keys go to the four pages; on its own page a key goes back to the index
function ttFastext() {
  const fast = el("div", "fastext");
  TT_FAST.forEach(([p, label]) => {
    const b = el("button", "", tv.page === p ? "INDEX" : label);
    b.type = "button";
    b.title = tv.page === p ? "P100 index" : "P" + p + " " + TT_PAGES[p].toLowerCase();
    b.onclick = () => tvSetPage(tv.page === p ? 100 : p);
    fast.append(b);
  });
  return fast;
}

function tvRenderText(force) {
  const page = tv.page;
  const view = page === 100 ? ttIndex() : page === 200 ? ttNew() : page === 300 ? ttForYou() : page === 400 ? ttTonight() : ttCharts();
  const box = T.fresh;
  if (!force && box.dataset.view === view.sig) return;
  box.dataset.view = view.sig;
  const title = view.title instanceof Node ? view.title : el("div", "tt-title", view.title || TT_PAGES[page]);
  box.replaceChildren(ttHead(page, view.sub), title, view.list, ttFastext());
}

function ttNeedsLogin(list) {
  if (radarScopeOk()) return false;
  list.append(el("div", "tt-empty", "This page needs one more Spotify login: open 📡 Radar on the card first."));
  return true;
}

function ttIndex() {
  const list = el("div", "tt-list");
  const lines = [[200, "New releases from your artists"], [300, "Deep cuts picked for you"], [400, "Tonight's programme"], [500, "Your charts this month"]];
  lines.forEach(([p, text]) => list.append(ttRow(String(p).slice(0, 1), [el("em", "", "P" + p + " "), text], "Go to page " + p, () => tvSetPage(p))));
  const now = state.track;
  if (now) list.append(el("div", "tt-empty", "ON AIR: " + now.song + " — " + now.artists.join(", ")));
  return { sig: "p100:" + (now ? state.trackKey : "") + ":" + clock(new Date()), list, title: "GROOVTEXT INDEX" };
}

// P200: the release radar — tap one to play it
function ttNew() {
  const list = el("div", "tt-list");
  if (ttNeedsLogin(list)) return { sig: "p200:login", list };
  if (!radar.at && !radar.loading && !tv.radarAsked) { tv.radarAsked = true; loadRadar(false); }
  const items = radar.releases.slice(0, 6); // seven rows fit, and the last one is ↻
  if (!items.length) list.append(el("div", "tt-empty", radar.loading ? "SEARCHING… " + radar.done + "/" + (radar.total || "?") : radar.error || "NOTHING NEW IN 3 MONTHS"));
  items.forEach((r) => {
    const mark = r.type === "Album" ? "A" : r.type === "EP" ? "E" : "S";
    const date = el("small", "", r.date.slice(5).split("-").reverse().join("/") + " ");
    list.append(ttRow(mark, [date, r.name + " ", el("em", "", r.artists)], "Play " + r.name, async () => {
      tvStatic(400);
      let res = null;
      try { res = await playerCall("play", { context_uri: r.uri }); } catch {}
      tvOsd(res && res.ok ? "▶ " + r.type.toUpperCase() : spotErr(res));
      setTimeout(pollSpotify, 600);
    }));
  });
  if (!radar.loading) list.append(ttRow("↻", ["REFRESH ", el("small", "", items.length && radar.error ? radar.error.toUpperCase() : "")], "Search again", () => loadRadar(true)));
  return { sig: "p200:" + radar.loading + ":" + radar.at + ":" + radar.releases.length + ":" + radar.done + ":" + radar.error, list };
}

// put a song at the front of Spotify's queue
async function tvQueueTrack(uri) {
  let res = null;
  try { res = await api("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), { method: "POST" }); } catch {}
  tvOsd(res && res.ok ? "QUEUED" : spotErr(res));
  if (res && res.ok) setTimeout(tvLoadQueue, 700);
}

// P300: deep cuts. Spotify retired its recommendations for apps like this one, so these are album tracks by
// the artists you play most that you haven't been playing yourself
async function loadForYou(force) {
  if (forYou.loading || state.mode !== "spotify" || !radarScopeOk()) return;
  if (!force && forYou.at && Date.now() - forYou.at < FORYOU_TTL && forYou.items.length) return;
  Object.assign(forYou, { loading: true, error: "", done: 0, total: 0 });
  tvRenderText(true);
  while (radar.loading) await wait(500); // one big search at a time, or Spotify starts saying "slow down"
  try {
    const top = (range) => spotifyJson("https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=" + range).catch(() => ({ items: [] }));
    const [artists, ...tops] = await Promise.all([
      spotifyJson("https://api.spotify.com/v1/me/top/artists?limit=12&time_range=medium_term"),
      top("short_term"), top("medium_term"), top("long_term"),
    ]);
    // anything you already play, by id and by name (the same song sits on singles, albums and deluxe editions)
    const known = new Set();
    tops.forEach((t) => (t.items || []).forEach((x) => {
      if (!x) return;
      known.add(x.id);
      (x.artists || []).forEach((a) => known.add(normalize(x.name) + "|" + a.id));
    }));
    const pool = shuffled((artists.items || []).filter(Boolean)).slice(0, 8);
    forYou.total = pool.length;
    const picks = [];
    let next = 0, problem = null;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < pool.length) {
        const a = pool[next++];
        try { picks.push(...(await deepCuts(a, known))); }
        catch (e) {
          console.warn("[gtt] for you", a.name, e);
          problem = e;
          if (e.status === 429) next = pool.length;
        }
        await wait(150);
        forYou.done++;
        tvRenderText();
      }
    }));
    // spread the artists out instead of three in a row from the same one
    const byArtist = new Map();
    shuffled(picks).forEach((p) => { if (!byArtist.has(p.from)) byArtist.set(p.from, []); byArtist.get(p.from).push(p); });
    const mixed = [];
    while (mixed.length < 12 && [...byArtist.values()].some((l) => l.length)) byArtist.forEach((l) => { if (l.length && mixed.length < 12) mixed.push(l.shift()); });
    forYou.items = mixed;
    forYou.at = Date.now();
    if (!mixed.length) forYou.error = problem ? spotifyProblem(problem).toUpperCase() : pool.length ? "NO DEEP CUTS FOUND — try ↻" : "PLAY SOME MORE MUSIC FIRST";
    else if (problem && problem.status === 429) forYou.error = spotifyProblem(problem).toUpperCase(); // shown under the ones we got
    else try { localStorage.setItem("gtt_foryou", JSON.stringify({ at: forYou.at, items: mixed })); } catch {}
  } catch (e) {
    console.error("[gtt] for you failed", e);
    forYou.error = spotifyProblem(e).toUpperCase();
  }
  forYou.loading = false;
  tvRenderText(true);
}

async function albumTracks(id) {
  try { return (await spotifyJson(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50&market=from_token`)).items || []; }
  catch (e) {
    if (e.status !== 400) throw e;
    return (await spotifyJson(`https://api.spotify.com/v1/albums/${id}/tracks?limit=10&market=from_token`)).items || [];
  }
}

// one song from the artist's newest album and one from an older one, skipping the ones you already know
async function deepCuts(artist, known) {
  let albums = (await spotifyJson(`https://api.spotify.com/v1/artists/${artist.id}/albums?include_groups=album&market=from_token&limit=10`)).items || [];
  if (!albums.length) albums = (await spotifyJson(`https://api.spotify.com/v1/artists/${artist.id}/albums?include_groups=single&market=from_token&limit=10`)).items || [];
  albums = albums.filter(Boolean);
  if (!albums.length) return [];
  const chosen = [albums[0]];
  if (albums.length > 1) chosen.push(albums[1 + Math.floor(Math.random() * (albums.length - 1))]);
  const out = [];
  for (const al of chosen) {
    const fresh = (await albumTracks(al.id)).filter((t) => t && t.uri && !known.has(t.id)
      && (t.artists || []).some((x) => x.id === artist.id)
      && !known.has(normalize(t.name) + "|" + artist.id)
      && !/\b(live|remix|demo|instrumental|commentary|interlude|intro|outro|skit|edit)\b/i.test(t.name));
    if (!fresh.length) continue;
    const t = fresh[Math.floor(Math.random() * fresh.length)];
    known.add(t.id);
    out.push({ uri: t.uri, name: t.name, artists: (t.artists || []).map((x) => x.name).join(", "), from: artist.name, album: al.name, year: (al.release_date || "").slice(0, 4) });
  }
  return out;
}

function ttForYou() {
  const list = el("div", "tt-list");
  if (ttNeedsLogin(list)) return { sig: "p300:login", list };
  if (!forYou.loading && !tv.forYouAsked) { tv.forYouAsked = true; loadForYou(false); }
  const items = forYou.items.slice(0, 6);
  if (forYou.loading && !items.length) list.append(el("div", "tt-empty", "DIGGING… " + forYou.done + "/" + (forYou.total || "?")));
  else if (!items.length) list.append(el("div", "tt-empty", forYou.error || "NOTHING YET"));
  items.forEach((s, i) => list.append(ttRow(String(i + 1), [s.name + " ", el("em", "", s.artists + " "), el("small", "", s.year)],
    "Queue " + s.name + " (from " + s.album + ")", () => tvQueueTrack(s.uri))));
  // the retry row also says what went wrong, if anything did
  if (!forYou.loading) list.append(ttRow("↻", [items.length ? "NEW PICKS " : "TRY AGAIN ", el("small", "", items.length && forYou.error ? forYou.error : items.length ? "tap a song to queue it" : "")], "Dig up new songs", () => loadForYou(true)));
  return { sig: "p300:" + forYou.loading + ":" + forYou.at + ":" + forYou.done + ":" + items.length + ":" + forYou.error, list };
}

// P400: what's on — the queue as a TV listing, with start times
function ttTonight() {
  const list = el("div", "tt-list");
  const t = state.track;
  const now = Date.now();
  let at = now;
  if (t) {
    const left = Math.max(0, (state.trackDuration || t.duration || 0) - currentElapsed());
    list.append(ttRow("▶", [el("small", "", clock(new Date(now - currentElapsed())) + " "), t.song + " ", el("em", "", t.artists.join(", "))], "Now playing", () => tvSetChannel(1)));
    at = now + left;
  }
  if (!tv.queue) list.append(el("div", "tt-empty", "PAGE NOT FOUND — couldn't read the queue"));
  else {
    // the queue can lag a song behind; don't list the current one twice
    const items = tv.queue.filter((q) => q.id !== state.trackKey).slice(0, t ? 6 : 7);
    if (!items.length) list.append(el("div", "tt-empty", "CLOSEDOWN — nothing queued after this"));
    items.forEach((item, i) => {
      const by = (item.artists || []).map((a) => a.name).join(", ") || (item.show && item.show.name) || "";
      list.append(ttRow(String(i + 1), [el("small", "", clock(new Date(at)) + " "), item.name + " ", el("em", "", by)], "Play " + item.name + " now", () => tvJump(tv.queue.indexOf(item), item)));
      at += item.duration_ms || 0;
    });
    if (items.length) list.append(el("div", "tt-empty", "ENDS ABOUT " + clock(new Date(at))));
  }
  // start times shift as the song plays, so the page redraws each minute (and on every queue reload)
  return { sig: "p400:" + state.trackKey + ":" + tv.queueAt + ":" + clock(new Date(at)) + ":" + clock(new Date()), list };
}

// P500: your charts — the songs and artists you've played most these past four weeks, flipping between the two
async function loadCharts(force) {
  if (charts.loading || state.mode !== "spotify" || !radarScopeOk()) return;
  if (!force && charts.at && Date.now() - charts.at < CHARTS_TTL) return;
  Object.assign(charts, { loading: true, error: "" });
  try {
    const [tr, ar] = await Promise.all([
      spotifyJson("https://api.spotify.com/v1/me/top/tracks?limit=10&time_range=short_term"),
      spotifyJson("https://api.spotify.com/v1/me/top/artists?limit=10&time_range=short_term"),
    ]);
    charts.tracks = (tr.items || []).filter(Boolean).map((x) => ({ uri: x.uri, name: x.name, artists: (x.artists || []).map((a) => a.name).join(", ") }));
    charts.artists = (ar.items || []).filter(Boolean).map((x) => ({ uri: x.uri, name: x.name, genre: (x.genres || [])[0] || "" }));
    charts.at = Date.now();
  } catch (e) {
    charts.error = spotifyProblem(e).toUpperCase();
  }
  charts.loading = false;
  tvRenderText(true);
}

function ttCharts() {
  const list = el("div", "tt-list");
  if (ttNeedsLogin(list)) return { sig: "p500:login", list };
  if (!charts.loading && !tv.chartsAsked) { tv.chartsAsked = true; loadCharts(false); }
  // subpages 1/2 and 2/2 take turns every 8 seconds, like the real thing; tapping the title flips early
  if (!tv.subAt) tv.subAt = Date.now();
  else if (Date.now() - tv.subAt > 8000) { tv.sub = ((tv.sub || 0) + 1) % 2; tv.subAt = Date.now(); }
  const s = tv.sub || 0;
  if (charts.loading && !charts.at) list.append(el("div", "tt-empty", "COUNTING THE VOTES…"));
  else if (charts.error && !charts.at) list.append(el("div", "tt-empty", charts.error));
  else if (s === 0) {
    if (!charts.tracks.length) list.append(el("div", "tt-empty", "NO CHART THIS MONTH"));
    charts.tracks.slice(0, 7).forEach((x, i) => list.append(ttRow(String(i + 1), [x.name + " ", el("em", "", x.artists)], "Queue " + x.name, () => tvQueueTrack(x.uri))));
  } else {
    if (!charts.artists.length) list.append(el("div", "tt-empty", "NO CHART THIS MONTH"));
    charts.artists.slice(0, 7).forEach((x, i) => list.append(ttRow(String(i + 1), [x.name + " ", el("small", "", x.genre)], "Play " + x.name, async () => {
      tvStatic(400);
      let res = null;
      try { res = await playerCall("play", { context_uri: x.uri }); } catch {}
      tvOsd(res && res.ok ? "▶ " + x.name.toUpperCase().slice(0, 14) : spotErr(res));
      setTimeout(pollSpotify, 600);
    })));
  }
  const title = el("button", "tt-title tt-flip", s === 0 ? "TOP SONGS ▸" : "TOP ARTISTS ▸");
  title.type = "button";
  title.title = "Flip to " + (s === 0 ? "top artists" : "top songs");
  title.onclick = () => { tv.sub = (s + 1) % 2; tv.subAt = Date.now(); tvRenderText(true); };
  return { sig: "p500:" + s + ":" + charts.loading + ":" + charts.at, list, sub: (s + 1) + "/2", title };
}
