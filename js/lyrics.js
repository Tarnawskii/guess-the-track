// ---------- lyrics (opt-in, from lrclib.net): a hint while guessing, karaoke after the reveal
let lyricsOn = false;
try { lyricsOn = localStorage.getItem("gtt_lyrics") === "1"; } catch {}
const lyricsCache = new Map(); // track key -> Promise<lyrics | null>
let karaokeIdx = -2;

function setLyricsOn(on) {
  lyricsOn = on;
  try { localStorage.setItem("gtt_lyrics", on ? "1" : "0"); } catch {}
  els.lyrBtn.setAttribute("aria-pressed", String(on));
  syncMenuBtn();
  if (on && state.track && state.track.song && (!state.lyrics || state.lyrics.key !== state.trackKey)) loadLyrics(state.track, state.trackKey);
  renderLyrics();
  setStatus(on ? "lyrics on — song names get looked up on lrclib.net" : "lyrics off");
}

// "Song - Remastered 2011" / "Song (feat. X)" -> "Song", for the fuzzy fallback search
function plainTitle(song) {
  return song.replace(/\s+-\s+.*$/, "").replace(/\s*[([].*?[)\]]/g, "").trim() || song;
}

async function fetchLyrics(t) {
  const artist = t.artists[0] || "";
  const q = new URLSearchParams({ artist_name: artist, track_name: t.song });
  if (t.album) q.set("album_name", t.album);
  if (t.duration) q.set("duration", String(Math.round(t.duration / 1000)));
  const res = await fetch("https://lrclib.net/api/get?" + q);
  if (res.ok) return res.json();
  if (res.status !== 404) throw new Error("lrclib " + res.status);
  // exact match failed (remaster titles, slightly different durations): search, prefer synced + closest length
  const sr = await fetch("https://lrclib.net/api/search?" + new URLSearchParams({ artist_name: artist, track_name: plainTitle(t.song) }));
  if (!sr.ok) return null;
  const list = (await sr.json()) || [];
  const off = (r) => (t.duration ? Math.abs(r.duration * 1000 - t.duration) : 0);
  const ok = list.filter((r) => (r.syncedLyrics || r.plainLyrics || r.instrumental) && off(r) < 8000);
  ok.sort((a, b) => (!b.syncedLyrics - !a.syncedLyrics) || off(a) - off(b));
  return ok[0] || null;
}

function parseLrc(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) out.push({ t: (Number(m[1]) * 60 + Number(m[2])) * 1000, text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}

function loadLyrics(track, key) {
  state.lyrics = { key, status: "loading" };
  if (!lyricsCache.has(key)) lyricsCache.set(key, fetchLyrics(track).catch((e) => { console.error("[gtt] lyrics:", e); lyricsCache.delete(key); return null; }));
  lyricsCache.get(key).then((r) => {
    if (state.trackKey !== key || !state.lyrics || state.lyrics.key !== key) return;
    const synced = r && r.syncedLyrics ? parseLrc(r.syncedLyrics) : [];
    const plain = r && r.plainLyrics ? r.plainLyrics.split(/\r?\n/).map((l) => l.trim()) : synced.map((l) => l.text);
    state.lyrics = {
      key,
      status: !r ? "none" : r.instrumental ? "instrumental" : synced.length || plain.some(Boolean) ? "ok" : "none",
      synced: synced.length ? synced : null,
      plain,
    };
    karaokeIdx = -2;
    renderLyrics();
  });
}

// one early-ish line, title words blanked so the hint isn't the answer
function lyricHint(lines, song) {
  const title = normalize(song).split(" ").filter((w) => w.length >= 3);
  const hasTitle = (l) => normalize(l).split(" ").some((w) => title.includes(w));
  const usable = [...new Set(lines.filter((l) => l && l.split(/\s+/).length >= 4))];
  if (!usable.length) return null;
  const clean = usable.filter((l) => !hasTitle(l));
  const pool = clean.length ? clean : usable;
  const early = pool.slice(0, Math.max(1, Math.ceil(pool.length * 0.4)));
  const line = early[Math.floor(Math.random() * early.length)];
  return line.split(/(\s+)/).map((tok) => (title.includes(normalize(tok)) ? "___" : tok)).join("");
}

function useHint() {
  const ly = state.lyrics;
  if (state.revealed || vs.on || state.hint || !ly || ly.status !== "ok" || ly.key !== state.trackKey) return;
  const hint = lyricHint(ly.plain, state.track.song);
  if (!hint) { state.hint = "no usable line in these lyrics — no charge"; renderLyrics(); return; }
  state.hint = "“" + hint + "”";
  state.points -= 1;
  updateScore();
  popPoints(-1);
  renderLyrics();
}

function lyNote(text) {
  const n = document.createElement("div");
  n.className = "ly-note";
  n.textContent = text;
  return n;
}

function renderLyrics() {
  const ly = state.lyrics && state.lyrics.key === state.trackKey ? state.lyrics : null;
  let kids = [];
  if (lyricsOn && state.track && state.track.song) {
    if (!state.revealed) {
      // hint: solo only, versus would need a fair way to charge both players
      if (!vs.on && ly && ly.status === "ok") {
        if (state.hint) {
          const h = document.createElement("div");
          h.className = "ly-hint"; h.textContent = state.hint;
          kids = [h];
        } else {
          const b = document.createElement("button");
          b.id = "hintBtn"; b.type = "button"; b.textContent = "🎤 lyric hint · −1 point";
          b.onclick = useHint;
          kids = [b];
        }
      }
    } else if (!ly || ly.status === "loading") kids = [lyNote("finding lyrics…")];
    else if (ly.status === "none") kids = [lyNote("no lyrics on LRCLIB for this one")];
    else if (ly.status === "instrumental") kids = [lyNote("♪ instrumental ♪")];
    else if (ly.synced) {
      const k = document.createElement("div");
      k.className = "karaoke";
      k.append(...["prev", "now", "next"].map((c) => { const p = document.createElement("p"); p.className = c; return p; }));
      kids = [k];
      karaokeIdx = -2;
    } else {
      const p = document.createElement("div");
      p.className = "ly-plain"; p.textContent = ly.plain.join("\n");
      kids = [p, lyNote("not synced — LRCLIB only has the plain text")];
    }
  }
  els.lyrics.replaceChildren(...kids);
  els.lyrics.classList.toggle("show", kids.length > 0);
}

function syncKaraoke(elapsed) {
  const ly = state.lyrics;
  if (!state.revealed || !lyricsOn || !ly || !ly.synced || ly.key !== state.trackKey) return;
  const lines = ly.synced;
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].t <= elapsed + 200) i++; // a hair early reads better
  if (i === karaokeIdx) return;
  karaokeIdx = i;
  const ps = els.lyrics.querySelectorAll(".karaoke p");
  if (ps.length !== 3) return;
  const text = (j) => (j < 0 ? "" : j >= lines.length ? "" : lines[j].text || "♪");
  ps[0].textContent = text(i - 1);
  ps[1].textContent = i < 0 ? "♪" : text(i);
  ps[2].textContent = text(i + 1);
  ps[1].classList.remove("pop"); void ps[1].offsetWidth; ps[1].classList.add("pop");
}

els.lyrBtn.onclick = () => setLyricsOn(!lyricsOn);
els.lyrBtn.setAttribute("aria-pressed", String(lyricsOn));
syncMenuBtn();
