// ---------- release radar: the newest albums and singles from the artists you play most ----------
const RADAR_SCOPES = ["user-top-read"];
const RADAR_MAX_DAYS = 90;      // fetched once, the Week/Month/3 months tabs just filter
const RADAR_TTL = 6 * 3600e3;   // cached this long, Refresh skips it
const radar = { open: false, loading: false, done: 0, total: 0, artists: 0, failed: 0, releases: [], at: 0, error: "", flash: "", days: 30, since: "", shown: new Set() };
let radarRenderTimer = 0;

function radarScopeOk() {
  try {
    const granted = (JSON.parse(localStorage.getItem("pip_widget_auth")).scope || "").split(" ");
    return RADAR_SCOPES.every((s) => granted.includes(s));
  } catch { return false; }
}

// local calendar day, n days back, as Spotify writes release dates: YYYY-MM-DD
function isoDay(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function relDay(iso) {
  if (iso.length < 10) return iso.slice(0, 4);
  const days = Math.round((new Date(isoDay() + "T00:00") - new Date(iso + "T00:00")) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  return new Date(iso + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function spotifyJson(url) {
  for (let i = 0; ; i++) {
    const res = await api(url);
    if (res.ok) return res.json();
    if (res.status !== 429 || i >= 3) throw Object.assign(new Error("Spotify said " + res.status), { status: res.status });
    const after = Number(res.headers.get("Retry-After")) || 2 ** i;
    if (after > 30) throw Object.assign(new Error("Spotify is rate-limiting us — try again in a bit"), { status: 429 });
    await wait(after * 1000);
  }
}

// your 50 most played artists over the last ~6 months (Spotify's "medium_term")
async function radarArtists() {
  const d = await spotifyJson("https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term");
  return d.items.map((a) => a.id);
}

// newest first within each group, so a handful per group always holds anything recent
async function artistReleases(id, cutoff) {
  const out = [];
  for (const group of ["album", "single"]) {
    const d = await spotifyJson(`https://api.spotify.com/v1/artists/${id}/albums?include_groups=${group}&market=from_token&limit=10`);
    out.push(...d.items.filter((a) => a && a.release_date >= cutoff));
  }
  return out;
}

function cleanRelease(a) {
  const img = (a.images || []).find((i) => i.width && i.width <= 300) || (a.images || []).slice(-1)[0];
  return {
    id: a.id, uri: a.uri, name: a.name, date: a.release_date,
    type: a.album_type === "single" ? (a.total_tracks >= 4 ? "EP" : "Single") : a.album_type === "compilation" ? "Compilation" : "Album",
    tracks: a.total_tracks || 0,
    artists: (a.artists || []).map((x) => x.name).join(", "),
    img: img ? img.url : "",
    url: a.external_urls ? a.external_urls.spotify : "",
  };
}

// a collab shows up once per artist, and clean + explicit versions are separate releases
function dedupeReleases(list) {
  const seen = new Map();
  for (const r of list) {
    const k = r.name.toLowerCase() + "|" + r.artists.split(", ")[0].toLowerCase() + "|" + r.date;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}

function readRadarCache() {
  try { return JSON.parse(localStorage.getItem("gtt_radar_v2")) || null; } catch { return null; }
}

async function loadRadar(force) {
  if (radar.loading || state.mode !== "spotify" || !radarScopeOk()) { renderRadar(); return; }
  const cached = readRadarCache();
  if (!force && cached && Date.now() - cached.at < RADAR_TTL) {
    Object.assign(radar, { releases: cached.releases, artists: cached.artists, at: cached.at, failed: 0, error: "" });
    renderRadar();
    return;
  }
  Object.assign(radar, { loading: true, error: "", done: 0, total: 0, failed: 0 });
  renderRadar();
  try {
    const ids = await radarArtists();
    radar.total = ids.length;
    const cutoff = isoDay(RADAR_MAX_DAYS);
    const found = [];
    let next = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try { found.push(...(await artistReleases(id, cutoff)).map(cleanRelease)); } catch { radar.failed++; }
        radar.done++;
        radar.releases = dedupeReleases(found);
        if (!radarRenderTimer) radarRenderTimer = setTimeout(() => { radarRenderTimer = 0; renderRadar(); }, 150);
      }
    }));
    radar.artists = ids.length;
    radar.at = Date.now();
    if (ids.length && radar.failed === ids.length) radar.error = "couldn't reach Spotify — hit Refresh";
    else try { localStorage.setItem("gtt_radar_v2", JSON.stringify({ at: radar.at, artists: radar.artists, releases: radar.releases })); } catch {}
  } catch (e) {
    console.error("[gtt] radar failed", e);
    radar.error = e.status === 401 || e.status === 403 ? "Spotify said no — log in again below" : e.message;
    if (e.status === 401 || e.status === 403) try { localStorage.removeItem("gtt_radar_v2"); } catch {}
  }
  radar.loading = false;
  renderRadar();
}

async function playRelease(r, btn) {
  btn.disabled = true;
  try {
    const res = await api("https://api.spotify.com/v1/me/player/play", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context_uri: r.uri }),
    });
    radar.flash = res.ok ? "playing " + r.name + " — you'll ace this round 😉"
      : res.status === 404 ? "open Spotify on a device first, then hit ▶"
      : res.status === 403 ? "Spotify only lets Premium start playback from here"
      : "couldn't start it (" + res.status + ")";
  } catch { radar.flash = "couldn't reach Spotify"; }
  btn.disabled = false;
  renderRadar();
  setTimeout(() => { radar.flash = ""; renderRadar(); }, 4000);
}

// the shell (and so the card) is moved by bubbleMotion only: shifting it here first made the card jump
// instead of float. While the radar fills up, the bubble grows smoothly instead of in steps
function renderRadar() {
  els.radarBtn.setAttribute("aria-expanded", String(radar.open));
  if (!radar.open) return;
  const bubble = els.radar;
  const settled = bubble.classList.contains("show") && !bubble.getAnimations().some((a) => a.id === "bubble");
  const h0 = settled ? bubble.getBoundingClientRect().height : 0; // mid-grow height counts
  bubble.getAnimations().forEach((a) => { if (a.id === "grow") a.cancel(); });
  renderRadarContent();
  if (!settled || reduceMotion.matches) return;
  const h1 = bubble.getBoundingClientRect().height;
  if (Math.abs(h1 - h0) > 1) {
    const a = bubble.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 420, easing: MORPH_EASE });
    a.id = "grow";
  }
}

function renderRadarContent() {
  const allowed = radarScopeOk();
  els.radarLogin.hidden = allowed && !/log in again/.test(radar.error);
  els.radarRefresh.disabled = radar.loading || !allowed;
  els.radarSeg.hidden = !allowed;
  els.radarRanges.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.range) === radar.days)));
  const cutoff = isoDay(radar.days);
  const list = allowed ? radar.releases.filter((r) => r.date >= cutoff) : [];
  let fresh = 0;
  els.radarList.replaceChildren(...list.map((r) => {
    const row = document.createElement("div");
    row.className = "rel";
    // rows slide in one after another the first time they show up, not on every progress repaint
    if (!radar.shown.has(r.id)) {
      radar.shown.add(r.id);
      row.classList.add("in");
      row.style.setProperty("--i", Math.min(fresh++, 12));
    }
    const img = document.createElement("img");
    img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    if (r.img) img.src = r.img;
    const txt = document.createElement("div");
    const title = document.createElement("b");
    if (radar.since && r.date > radar.since) {
      const badge = document.createElement("em");
      badge.textContent = "NEW";
      title.append(badge);
    }
    const link = document.createElement(r.url ? "a" : "span");
    link.textContent = r.name;
    if (r.url) { link.href = r.url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    title.append(link);
    const who = document.createElement("span");
    who.textContent = r.artists;
    const meta = document.createElement("span");
    meta.textContent = r.type + (r.type === "Single" ? "" : " · " + r.tracks + " tracks") + " · " + relDay(r.date);
    txt.append(title, who, meta);
    const play = document.createElement("button");
    play.type = "button";
    play.textContent = "▶";
    play.title = "Play " + r.name + " in Spotify";
    play.setAttribute("aria-label", play.title);
    play.onclick = () => playRelease(r, play);
    row.append(img, txt, play);
    return row;
  }));
  const span = radar.days === 7 ? "this week" : radar.days === 30 ? "this month" : "in 3 months";
  els.radarNote.textContent = !allowed ? "Spotify has to let the app see which artists you play most — one quick login"
    : radar.flash ? radar.flash
    : radar.loading ? "checking " + (radar.total ? radar.done + "/" + radar.total + " artists" : "who you play most") + "…"
    : radar.error ? radar.error
    : !radar.artists ? "Spotify doesn't know your favourites yet — play some music and check back"
    : list.length ? list.length + (list.length === 1 ? " release" : " releases") + " from " + radar.artists + " artists" + (radar.failed ? " · " + radar.failed + " couldn't be checked" : "")
    : "nothing new from your " + radar.artists + " artists " + span + (radar.days < 90 ? " — try a longer stretch" : "");
}

function setRadarOpen(open) {
  if (open === radar.open) return;
  radar.open = open;
  if (open && crampedScreen()) setModesOpen(false); // one at a time when there's no room for both
  radar.shown.clear();
  if (open) {
    // NEW = released since the last day you looked, kept for the rest of today
    let visit = {};
    try { visit = JSON.parse(localStorage.getItem("gtt_radar_visit")) || {}; } catch {}
    if (visit.day !== isoDay()) visit = { day: isoDay(), prev: visit.day || "" };
    try { localStorage.setItem("gtt_radar_visit", JSON.stringify(visit)); } catch {}
    radar.since = visit.prev;
    loadRadar(false);
  }
  renderRadar();
  bubbleMotion(els.radar, els.radarBtn, open);
  if (!open && els.radar.contains(els.radar.ownerDocument.activeElement)) els.radarBtn.focus();
}

els.radarBtn.onclick = () => setRadarOpen(!radar.open);
els.radarClose.onclick = () => setRadarOpen(false);
els.radarRefresh.onclick = () => loadRadar(true);
els.radarRanges.forEach((b) => { b.onclick = () => { radar.days = Number(b.dataset.range); radar.shown.clear(); renderRadar(); }; });
els.radarScrim.onclick = () => { setRadarOpen(false); setModesOpen(false); };
function radarEscape(e) {
  if (e.key !== "Escape") return;
  if (radar.open) setRadarOpen(false);
  if (modes.open) setModesOpen(false);
}
document.addEventListener("keydown", radarEscape);
// the new permissions need a fresh login, which goes through reconnect's "scores will reset" guard
els.radarLogin.onclick = () => { sessionStorage.setItem("gtt_radar_login", "1"); els.reconnect.onclick(); };
