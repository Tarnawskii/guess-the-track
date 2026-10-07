// ---------- a round: status, answer matching, scoring, the vinyl label, the answer key, Pick 6 choices ----------
function setStatus(text, win) {
  els.status.textContent = text;
  els.status.classList.toggle("win", !!win);
}

setInterval(() => {
  if (state.mode !== "spotify" || !state.lastPoll) return;
  const age = Math.round((Date.now() - state.lastPoll) / 1000);
  if (age > 15) setConn("wait", "stale · last heard " + age + "s ago");
  else setConn("on", (state.userName ? "live: " + state.userName : "live") + " · " + age + "s");
}, 1000);

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/\(.*?\)/g, " ").replace(/\bfeat\.?\b.*$/, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}

function fuzzyMatch(guess, answers) {
  const g = normalize(guess);
  if (!g) return false;
  return answers.some((ans) => {
    const a = normalize(ans);
    if (g === a) return true;
    const d = levenshtein(g, a);
    return d / Math.max(g.length, a.length) <= 0.2;
  });
}

function setVerdict(field, verdict) {
  field.classList.remove("ok", "close", "bad");
  if (verdict) field.classList.add(verdict);
  field.querySelector("input").readOnly = verdict === "ok";
}

function shake(el) {
  if (reduceMotion.matches) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
  el.addEventListener("animationend", () => el.classList.remove("shake"), { once: true });
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function setProgress(elapsed, total) {
  const p = total ? Math.min(1, Math.max(0, elapsed / total)) : 0;
  els.progress.style.transform = "scaleX(" + p.toFixed(4) + ")";
  els.tNow.textContent = fmt(Math.min(elapsed, total));
  els.tTotal.textContent = fmt(total);
  updateArm(p);
}

// the streak in flames: one lights (with a pop) per song in a row, up to five; a broken streak fizzles out
const FLAMES = 5;
const SVGNS = "http://www.w3.org/2000/svg";
let shownStreak = 0;

function renderFlames() {
  const box = $("flames");
  if (!box) return;
  if (!box.children.length) {
    for (let i = 0; i < FLAMES; i++) {
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "flame");
      svg.setAttribute("viewBox", "0 0 24 30");
      const use = document.createElementNS(SVGNS, "use");
      use.setAttribute("href", "#flameShape");
      svg.append(use);
      box.append(svg);
    }
  }
  const lit = Math.min(state.streak, FLAMES), was = Math.min(shownStreak, FLAMES);
  [...box.children].forEach((f, i) => {
    const on = i < lit;
    if (on && i >= was) {
      f.setAttribute("class", "flame lit pop");
      f.addEventListener("animationend", () => f.classList.remove("pop"), { once: true });
    } else if (!on && i < was) {
      f.setAttribute("class", "flame out");
      f.addEventListener("animationend", () => { if (!f.classList.contains("lit")) f.setAttribute("class", "flame"); }, { once: true });
    } else if (!f.classList.contains("out")) {
      f.setAttribute("class", on ? "flame lit" : "flame");
    }
  });
  shownStreak = state.streak;
}

function updateScore() {
  els.sPoints.textContent = state.points;
  els.sStreak.textContent = state.streak;
  els.sRounds.textContent = state.rounds;
  els.stStreak.classList.toggle("hot", state.streak >= 3);
  els.stStreak.classList.toggle("blaze", state.streak >= FLAMES);
  els.stStreak.setAttribute("aria-label", "Streak: " + state.streak + " in a row");
  renderFlames();
  renderPlayers();
}

// versus scoreboard, one row per seat; rows are reused so a name being typed keeps focus
function renderPlayers() {
  const n = vs.players.length;
  while (els.rows.length < n) els.rows.push(makePlayerRow(els.rows.length));
  while (els.rows.length > n) els.rows.pop().stat.remove();
  els.rows.forEach((r, i) => {
    const p = vs.players[i];
    r.name.readOnly = !(net.role ? i === myIndex() : true);
    if (r.name.value !== p.name && r.name.ownerDocument.activeElement !== r.name) r.name.value = p.name;
    r.pts.textContent = p.points;
    r.stat.classList.toggle("away", !!p.away);
    r.stat.classList.toggle("me", !!net.role && i === myIndex());
  });
  // head to head keeps the songs tally; a bigger room just ranks by points
  if (n === 2) { els.sWins.textContent = vs.players[0].wins + "–" + vs.players[1].wins; els.vsScore.append(els.songsRow); }
  else els.songsRow.remove();
  els.vsScore.classList.toggle("many", n > 3);
}

function makePlayerRow(i) {
  const stat = document.createElement("div");
  stat.className = "stat";
  const name = document.createElement("input");
  name.className = "pname"; name.maxLength = 12; name.autocomplete = "off";
  name.placeholder = "Player " + (i + 1);
  name.setAttribute("aria-label", "Player " + (i + 1) + " name");
  name.addEventListener("input", () => { if (!name.readOnly) setName(i, name.value); });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });
  const pts = document.createElement("b");
  stat.append(name, pts);
  els.vsScore.append(stat);
  return { stat, name, pts };
}

function setName(i, name) {
  vs.players[i].name = name;
  // a guest's own name lives in slot 1, where it's always been
  const slot = net.role === "guest" ? 1 : i;
  try {
    const names = storedNames();
    names[slot] = name;
    localStorage.setItem("gtt_players", JSON.stringify(names));
  } catch {}
  if (net.role === "guest") { net.myName = name; netSend({ t: "name", name }); }
  else if (net.role === "host") netSend({ t: "players", players: vs.players });
  renderJam();
}

function statOf(i) {
  return els.rows[i] ? els.rows[i].stat : els.stPoints;
}

function popPoints(n, statEl = els.stPoints) {
  if (reduceMotion.matches) return;
  const el = document.createElement("span");
  el.className = "plus" + (n < 0 ? " minus" : ""); el.textContent = n < 0 ? "−" + -n : "+" + n;
  el.addEventListener("animationend", () => el.remove());
  statEl.appendChild(el);
}

function burst() {
  vinylBoost(); // a victory spin
  if (reduceMotion.matches) return;
  const colors = ["var(--mustard)", "var(--orange)", "var(--pink)", "var(--ok)", "var(--cream)"];
  for (let i = 0; i < 16; i++) {
    const c = document.createElement("i");
    const a = (i / 16) * Math.PI * 2, r = 48 + Math.random() * 40;
    c.className = "confetti";
    c.style.background = colors[i % colors.length];
    c.style.setProperty("--dx", (Math.cos(a) * r).toFixed(0) + "px");
    c.style.setProperty("--dy", (Math.sin(a) * r).toFixed(0) + "px");
    c.style.setProperty("--r", (Math.random() * 540 - 270).toFixed(0) + "deg");
    c.addEventListener("animationend", () => c.remove());
    els.stage.appendChild(c);
  }
}

// ---------- vinyl label: album colours while it plays, the cover once it's revealed
const labelCache = new Map();

function setLabelColors(cols) {
  const s = els.discLabel.style;
  if (cols) { s.setProperty("--lab1", cols[0]); s.setProperty("--lab2", cols[1]); }
  else { s.removeProperty("--lab1"); s.removeProperty("--lab2"); }
}

function setLabelArt(url) {
  els.discLabel.style.backgroundImage = url ? "url(" + JSON.stringify(url) + ")" : "";
}

// the revealed cover as a glow behind the page: two layers so one song's art crossfades into the next
let ambientLayer = 0;
function setAmbient(url) {
  const layers = document.querySelectorAll("#ambient i");
  if (!layers.length) return;
  if (!url) { layers.forEach((l) => l.classList.remove("show")); return; }
  ambientLayer = 1 - ambientLayer;
  const on = layers[ambientLayer], off = layers[1 - ambientLayer];
  on.style.backgroundImage = "url(" + JSON.stringify(url) + ")";
  on.classList.add("show");
  off.classList.remove("show");
}

// every song drifts its own way
function kenBurnsDirection() {
  const pick = () => ((Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4)).toFixed(1) + "%";
  document.documentElement.style.setProperty("--kb-x", pick());
  document.documentElement.style.setProperty("--kb-y", pick());
  els.app.style.setProperty("--kb-x", pick()); // the pop-out window has its own root
  els.app.style.setProperty("--kb-y", pick());
}

// two dominant colours of the cover; null if the image can't be read (CORS, offline)
function albumColors(url) {
  if (!labelCache.has(url)) labelCache.set(url, new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { try { resolve(dominantColors(img)); } catch { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = url;
  }));
  return labelCache.get(url);
}

function dominantColors(img) {
  const n = 32, cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, n, n);
  const px = ctx.getImageData(0, 0, n, n).data;
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const k = (px[i] >> 5) << 6 | (px[i + 1] >> 5) << 3 | px[i + 2] >> 5;
    const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
    buckets.set(k, b);
  }
  // favour colourful, mid-bright swatches over the black/white most covers are full of
  const cols = [...buckets.values()].map(({ n: c, r, g, b }) => {
    r /= c; g /= c; b /= c;
    const max = Math.max(r, g, b), sat = max ? (max - Math.min(r, g, b)) / max : 0;
    return { r, g, b, score: c * (0.25 + sat) * (max < 50 ? 0.3 : max > 235 && sat < 0.1 ? 0.5 : 1) };
  }).sort((a, b) => b.score - a.score);
  const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const first = cols[0], second = cols.find((c) => dist(c, first) > 80) || first;
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return [hex(first), hex(second)];
}

function colorLabel(track, key) {
  if (!track.artUrl) { state.colors = null; setLabelColors(null); return; }
  albumColors(track.artUrl).then((colors) => {
    if (state.trackKey !== key) return;
    state.colors = colors && { key, colors };
    setLabelColors(colors);
    if (colors && net.role === "host") netSend({ t: "colors", key, colors });
  });
}

function newRound(track, key, carry = "") {
  const timedOut = !vs.on ? "" : net.role === "guest" ? carry : vsTimeUp();
  state.track = track; state.trackKey = key; state.revealed = false; state.choicesFailed = false;
  state.paid = [false, false, false];
  state.hint = null;
  applyInputUI();
  setLabelArt(null);
  setAmbient(null); // the next cover is a secret until it's revealed
  if (net.role !== "guest") colorLabel(track, key);
  els.artist.value = ""; els.song.value = ""; els.year.value = "";
  els.answer.style.display = "none"; els.answer.replaceChildren();
  els.answer.classList.remove("pop");
  els.vsResult.style.display = "none"; els.vsResult.classList.remove("pop");
  fields.forEach((f) => setVerdict(f, null));
  els.cover.classList.remove("flipped");
  els.stage.classList.add("live");
  setStatus("new track — guess!");
  if (!els.app.classList.contains("pick") && els.app.ownerDocument.hasFocus()) els.artist.focus();
  if (vs.on) {
    vs.guesses = []; net.myLocked = false;
    els.rows.forEach((r) => r.stat.classList.remove("locked"));
    if (net.role) vsOnlineUI(timedOut);
    else { vs.turn = vs.next; vs.next = 1 - vs.next; vsTurnUI(timedOut); }
  } else setTurnHighlight(-1);
  if (net.role === "host") netSend({ t: "round", key, carry: timedOut, players: vs.players });
  setupChoices(track);
  if (lyricsOn && track.song) loadLyrics(track, key); // early, for the hint
  renderLyrics();
  gameRoundStart();
}

// answer key: the last 5 songs, newest first, kept across reloads for practice
const FASIT_MAX = 5;
let fasit = [];
try { fasit = (JSON.parse(localStorage.getItem("gtt_fasit")) || []).slice(0, FASIT_MAX); } catch {}

function addFasit(note) {
  const t = state.track;
  fasit = fasit.filter((f) => f.key !== state.trackKey);
  fasit.unshift({ key: state.trackKey, artists: t.artists, song: t.song, year: t.third.answer, artUrl: t.artUrl || null, note: note || "" });
  fasit.length = Math.min(fasit.length, FASIT_MAX);
  try { localStorage.setItem("gtt_fasit", JSON.stringify(fasit)); } catch {}
}

function renderFasit() {
  const head = document.createElement("div");
  head.className = "fasit-head";
  head.textContent = "answer key · last " + fasit.length;
  const rows = fasit.map((f, i) => {
    const row = document.createElement("div");
    row.className = "fasit-row" + (i === 0 ? " now" : "");
    let art;
    if (f.artUrl) { art = document.createElement("img"); art.src = f.artUrl; art.alt = ""; }
    else { art = document.createElement("i"); art.textContent = (f.song.match(/\b\p{L}/gu) || ["♪"]).slice(0, 2).join("").toUpperCase(); }
    art.className = "fasit-art";
    const txt = document.createElement("div");
    txt.className = "fasit-txt";
    const song = document.createElement("b");
    song.textContent = f.song;
    const meta = document.createElement("span");
    meta.textContent = f.artists.join(", ") + " · " + f.year;
    txt.append(song, meta);
    const pts = document.createElement("span");
    pts.className = "fasit-pts" + (/\+[1-9]/.test(f.note) ? " won" : "");
    pts.textContent = f.note;
    row.append(art, txt, pts);
    return row;
  });
  els.answer.replaceChildren(head, ...rows);
}

function check() {
  if (!state.track || state.revealed) return;
  if (usingPick()) return;
  if (vs.on) { vsLockTyped(); return; }
  if (activeGame() === "heardle") { heardleCheck(); return; }
  if (activeGame() === "hitster") return;
  const t = state.track;
  const aOk = fuzzyMatch(els.artist.value, t.artists);
  const sOk = fuzzyMatch(els.song.value, [t.song]);
  let thirdOk = null, earned = 0;
  const yv = parseInt(els.year.value, 10);
  if (!isNaN(yv)) {
    const diff = Math.abs(yv - t.third.answer);
    if (diff === 0) { thirdOk = "ok"; earned += 2; }
    else if (diff <= 2) { thirdOk = "close"; earned += 1; }
    else thirdOk = "bad";
  }
  if (aOk) earned += 1;
  if (sOk) earned += 1;
  const thirdVerdict = thirdOk === null ? "bad" : thirdOk;
  setVerdict(els.fArtist, aOk ? "ok" : "bad");
  setVerdict(els.fSong, sOk ? "ok" : "bad");
  setVerdict(els.fYear, thirdVerdict);
  fields.filter((f) => f.classList.contains("bad")).forEach(shake);
  const thirdRight = !!thirdOk && thirdOk !== "bad";
  const complete = aOk && sOk && thirdRight;
  if (complete) {
    state.rounds += 1; state.points += earned;
    state.streak = state.streak + 1;
    finish(state.streak >= 3 ? `far out! ${state.streak} in a row` : "groovy! nailed it", true, "+" + earned);
    popPoints(earned);
    burst();
    return;
  }
  const right = [aOk, sOk, thirdRight].filter(Boolean).length;
  setStatus(right ? `${right}/3 right — fix the red ones` : "nope. try again or reveal");
  const firstBad = fields.find((f) => !f.classList.contains("ok"));
  if (firstBad) firstBad.querySelector("input").focus();
}

// note: what this song scored, shown in the answer key ("+3", "skipped", "2–1" head to head)
function finish(msg, win, note) {
  state.revealed = true;
  setStatus(msg, win);
  updateScore();
  addFasit(note);
  renderFasit();
  if (lyricsOn && (!state.lyrics || state.lyrics.key !== state.trackKey)) loadLyrics(state.track, state.trackKey);
  renderLyrics();
  els.answer.style.display = "flex";
  els.answer.classList.add("pop");
  fields.forEach((f) => { f.querySelector("input").readOnly = true; });
  for (const b of els.choiceList.querySelectorAll("button")) b.disabled = true;
  if (state.track.artUrl) {
    const img = document.createElement("img");
    img.src = state.track.artUrl;
    img.alt = "";
    kenBurnsDirection();
    els.coverBack.replaceChildren(img);
    setLabelArt(state.track.artUrl);
    setAmbient(state.track.artUrl);
  } else {
    els.coverBack.textContent = (state.track.song.match(/\b\p{L}/gu) || ["♪"]).slice(0, 2).join("").toUpperCase();
  }
  els.cover.classList.add("flipped");
  gameRoundEnd();
}

function reveal() {
  if (!state.track || state.revealed) return;
  if (vs.on) {
    if (vsMeLocked()) return;
    if (net.role === "guest") guestLock({ kind: "pass" });
    else vsLock(BAD3, "passed");
    return;
  }
  state.rounds += 1; state.streak = 0;
  finish("revealed — 0 points", false, "revealed");
}

let choiceSeq = 0;
const albumCache = new Map();

// pick mode: sequential multiple choice — artist, then song, then year
function usingPick() {
  return state.imode === "pick" && !state.choicesFailed;
}

function applyInputUI() {
  els.app.classList.toggle("pick", usingPick());
  const g = activeGame();
  els.app.classList.toggle("heardle", g === "heardle");
  els.app.classList.toggle("hd-both", g === "heardle" && game.heardle.guess === "both");
  els.app.classList.toggle("hitster", g === "hitster");
}

function setImode(imode) {
  if (state.imode === imode) return;
  state.imode = imode;
  state.choicesFailed = false;
  choiceSeq++;
  renderModeBtn();
  renderModes();
  els.artist.value = ""; els.song.value = ""; els.year.value = "";
  fields.forEach((f) => setVerdict(f, null));
  state.choice = { stage: 0, opts: null, accepted: null, results: [], picks: [] };
  els.choiceList.replaceChildren();
  els.choiceLabel.textContent = "";
  if (net.role === "host") netSend({ t: "imode", imode });
  if (imode === "pick" && state.track && !state.revealed) { setupChoices(state.track); return; }
  applyInputUI();
  if (imode === "pick") setStatus("pick mode on — options come with the next track");
}

function setupChoices(track) {
  applyInputUI();
  state.choice = { stage: 0, opts: null, accepted: null, results: [], picks: [] };
  els.choiceList.replaceChildren();
  if (state.imode !== "pick" || !track || state.revealed) { els.choiceLabel.textContent = ""; return; }
  const seq = ++choiceSeq;
  els.choiceLabel.textContent = "loading choices…";
  if (net.role === "guest") return; // the host sends the options
  const ready = fetchSpotifyPools(track);
  ready.then((pools) => {
    if (seq !== choiceSeq || state.revealed || state.track !== track) return;
    morph(els.app, appKids, () => buildChoices(pools, track));
  }).catch(() => { if (seq === choiceSeq) choicesFallback(); });
}

function choicesFallback() {
  state.choicesFailed = true;
  applyInputUI();
  if (net.role === "host") netSend({ t: "choices", key: state.trackKey, failed: true });
  setStatus("not enough to pick from — type it" + (vs.on && !net.role ? " · " + pname(vs.turn) + "'s turn" : ""));
  if (els.app.ownerDocument.hasFocus()) els.artist.focus();
}

async function fetchSpotifyPools(track) {
  const pools = { artists: [], songs: [], years: [] };
  const jobs = [];
  if (track.albumId) jobs.push((async () => {
    let items = albumCache.get(track.albumId);
    if (items === undefined) {
      try {
        const res = await api(`https://api.spotify.com/v1/albums/${track.albumId}/tracks?limit=50`);
        items = res.ok ? (await res.json()).items : null;
      } catch { items = null; }
      albumCache.set(track.albumId, items);
    }
    if (items) for (const it of items) {
      pools.songs.push(it.name);
      for (const a of it.artists || []) pools.artists.push(a.name);
    }
  })());
  jobs.push((async () => {
    try {
      const res = await api("https://api.spotify.com/v1/me/player/queue");
      if (res.ok) {
        const data = await res.json();
        for (const item of data.queue || []) {
          if (!item || !item.name) continue;
          pools.songs.push(item.name);
          for (const a of item.artists || []) pools.artists.push(a.name);
          if (item.album && item.album.release_date) {
            const y = parseInt(item.album.release_date.slice(0, 4), 10);
            if (y) pools.years.push(y);
          }
        }
      }
    } catch {}
  })());
  await Promise.all(jobs);
  return pools;
}

function shuffled(arr) {
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// accepted = answers that count as correct (first is the one shown as the right button)
function buildOptions(accepted, pool) {
  const seen = new Set(accepted.map((a) => normalize(String(a))));
  const opts = [String(accepted[0])];
  for (const cand of shuffled(pool)) {
    const s = String(cand);
    const n = normalize(s);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    opts.push(s);
    if (opts.length >= 6) break;
  }
  return shuffled(opts);
}

function yearPool(answer, years) {
  const now = new Date().getFullYear();
  const out = years.filter((y) => y && y !== answer);
  for (const off of [1, -1, 2, -2, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14]) {
    const y = answer + off;
    if (y >= 1950 && y <= now + 1) out.push(y);
  }
  return out;
}

function buildChoices(pools, track) {
  const accepted = [track.artists, [track.song], [String(track.third.answer)]];
  const opts = [
    buildOptions(track.artists, pools.artists),
    buildOptions([track.song], pools.songs),
    buildOptions(accepted[2], yearPool(track.third.answer, pools.years)),
  ];
  if (opts[0].length < 2 || opts[1].length < 2 || opts[2].length < 2) { choicesFallback(); return; }
  state.choice.accepted = accepted;
  state.choice.opts = opts;
  if (net.role === "host") netSend({ t: "choices", key: state.trackKey, opts });
  if (!vsMeLocked()) renderStage();
}

function renderStage() {
  const c = state.choice;
  if (!c.opts) return;
  els.choiceLabel.textContent = (c.stage + 1) + "/3 · " + ["artist", "song", "year"][c.stage];
  els.choiceList.replaceChildren();
  for (const opt of c.opts[c.stage]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt;
    b.onclick = () => pickOption(opt, b);
    els.choiceList.appendChild(b);
  }
  if (els.app.ownerDocument.hasFocus()) els.choiceList.firstChild.focus();
}

function pickOption(opt, btn) {
  const c = state.choice;
  if (!c.opts || state.revealed || c.results.length !== c.stage) return;
  const ok = !!c.accepted && c.accepted[c.stage].includes(opt); // guests don't get the answers
  c.results.push(ok);
  c.picks.push(opt);
  if (vs.on) {
    btn.classList.add("pick-sel");
    for (const b of els.choiceList.children) b.disabled = true;
    const stage = ++c.stage;
    setTimeout(() => {
      if (state.choice !== c || state.revealed || c.stage !== stage || vsMeLocked()) return;
      if (stage < 3) renderStage();
      else if (net.role === "guest") guestLock({ kind: "pick", picks: c.picks });
      else vsLock(c.results.map((r) => (r ? "ok" : "bad")));
    }, reduceMotion.matches ? 150 : 300);
    return;
  }
  btn.classList.add(ok ? "pick-ok" : "pick-bad");
  if (ok && !state.paid[c.stage]) {
    // paid once per stage per song, so flipping Type/Pick can't farm points
    const pts = STAGE_POINTS[c.stage];
    state.paid[c.stage] = true;
    state.points += pts;
    updateScore();
    popPoints(pts);
  }
  const answer = c.accepted[c.stage][0];
  for (const b of els.choiceList.children) {
    b.disabled = true;
    if (!ok && b.textContent === answer) b.classList.add("pick-right");
  }
  c.stage += 1;
  const wait = reduceMotion.matches ? 250 : ok ? 650 : 1500;
  setTimeout(() => {
    if (state.choice !== c || state.revealed) return;
    if (c.stage < 3) renderStage();
    else finishPick();
  }, wait);
}

function finishPick() {
  const results = state.choice.results;
  const right = results.filter(Boolean).length;
  const earned = markPoints(results.map((r) => (r ? "ok" : "bad")));
  state.rounds += 1;
  if (right === 3) {
    state.streak = state.streak + 1;
    finish(state.streak >= 3 ? `far out! ${state.streak} in a row` : "groovy! nailed it", true, "+" + earned);
    burst();
  } else {
    state.streak = 0;
    finish(`${right}/3 right · +${earned} — next one's yours`, false, earned ? "+" + earned : "0");
  }
  els.choiceLabel.textContent = "next track inbound…";
}
