// ---------- game modes: Quiz and Pick 6 (versus too), Heardle and Hitster (solo) ----------
const GAMES = {
  quiz: { icon: "✍️", name: "Quiz", short: "type artist · song · year", desc: "Type the artist, song and year" },
  pick: { icon: "🎲", name: "Pick 6", short: "multiple choice, 3 steps", desc: "Pick from 6 — artist, song, then year" },
  heardle: { icon: "⏱", name: "Heardle", short: "name it from the first seconds", desc: "1 second of intro, then a bit more. Needs Premium" },
  hitster: { icon: "🃏", name: "Hitster", short: "place songs on your timeline", desc: "Before or after? Build a timeline of years" },
};
const SOLO_GAMES = ["heardle", "hitster"];
const HEARDLE_LADDERS = { classic: [1, 2, 4, 7, 11, 16], hard: [0.5, 1, 2, 4, 8], chill: [2, 4, 8, 16, 30] };
// mode + settings live in this browser's localStorage, like the scores and the answer key
const game = { id: "quiz", heardle: { ladder: "classic", guess: "song" }, hitster: { target: 10, lives: 3 } };
try {
  const g = JSON.parse(localStorage.getItem("gtt_game")) || {};
  if (GAMES[g.id]) game.id = g.id;
  if (g.heardle && HEARDLE_LADDERS[g.heardle.ladder]) game.heardle.ladder = g.heardle.ladder;
  if (g.heardle && ["song", "both"].includes(g.heardle.guess)) game.heardle.guess = g.heardle.guess;
  if (g.hitster && [5, 10, 15].includes(g.hitster.target)) game.hitster.target = g.hitster.target;
  if (g.hitster && [1, 3, 5].includes(g.hitster.lives)) game.hitster.lives = g.hitster.lives;
} catch {}
state.imode = game.id === "pick" ? "pick" : "type";
const modes = { open: false, armed: 0 };

function saveGame() {
  try { localStorage.setItem("gtt_game", JSON.stringify(game)); } catch {}
}

// versus (and every guest) only plays Quiz or Pick 6
function activeGame() {
  if (vs.on || net.role) return state.imode === "pick" ? "pick" : "quiz";
  return game.id;
}

// both bubbles fit beside the card only on a wide screen; below that it's one at a time
function crampedScreen() {
  return els.app.ownerDocument.defaultView.matchMedia("(max-width: 63.99rem)").matches;
}

// the pill grows into its bubble: it stretches from the pill's spot and size to the bubble's while the card
// makes room, then the contents fade in; closing runs it backwards and the pill comes back
const BUBBLE_SPRING = "cubic-bezier(0.34, 1.32, 0.64, 1)";
const BUBBLE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const BUBBLE_IN = "cubic-bezier(0.55, 0, 0.45, 1)";

function bubbleMotion(bubble, pill, open) {
  const show = () => { bubble.classList.toggle("show", open); pill.classList.toggle("away", open); };
  // a toggle mid-flight starts from the finished state, never from a half-built one
  bubble.getAnimations().forEach((a) => { if (a.id === "bubble") a.finish(); });
  [...bubble.children].forEach((el) => el.getAnimations().forEach((a) => { if (a.id === "bubble") a.finish(); }));
  if (reduceMotion.matches || !bubble.animate || !shown(pill) && open) { syncBubbles(); show(); return; }
  const shell = els.shell;
  const sh0 = shell.getBoundingClientRect();
  shell.style.setProperty("--bubble-top", (pill.getBoundingClientRect().top - sh0.top) + "px");
  const p0 = pill.getBoundingClientRect();
  shell.getAnimations().forEach((a) => { if (a.id === "bubble") a.cancel(); });
  if (open) show();
  syncBubbles();
  const sh1 = shell.getBoundingClientRect();
  const shift = sh0.left - sh1.left;
  const r = bubble.getBoundingClientRect(); // the bubble's open spot, where the card is heading
  const p1 = pill.getBoundingClientRect(); // the pill's spot, ditto
  const run = (el, frames, opts) => { const a = el.animate(frames, opts); a.id = "bubble"; return a; };
  if (Math.abs(shift) > 0.5) run(shell, [{ translate: shift + "px 0" }, { translate: "0 0" }], { duration: open ? 560 : 420, easing: BUBBLE_OUT });
  // a bubble inside the shell rides along with the card; a fixed bottom sheet doesn't
  const rides = getComputedStyle(bubble).position !== "fixed";
  const asPill = (p, carry) => ({
    translate: (p.left - r.left - carry) + "px " + (p.top - r.top) + "px",
    clipPath: "inset(0px " + (r.width - p.width) + "px " + (r.height - p.height) + "px 0px round " + p.height / 2 + "px)",
  });
  const full = { translate: "0px 0px", clipPath: "inset(0px 0px 0px 0px round 24px)" };
  const kids = [...bubble.children];
  if (open) {
    const from = asPill(p0, rides ? shift : 0);
    run(bubble, [{ translate: from.translate }, { translate: full.translate }], { duration: 620, easing: BUBBLE_SPRING });
    run(bubble, [{ clipPath: from.clipPath }, { clipPath: full.clipPath }], { duration: 560, easing: BUBBLE_OUT });
    kids.forEach((k, i) => run(k, [{ opacity: 0, translate: "0 0.375rem" }, { opacity: 1, translate: "0 0" }], { duration: 320, delay: 170 + i * 40, easing: BUBBLE_OUT, fill: "backwards" }));
  } else {
    const to = asPill(p1, 0);
    kids.forEach((k) => run(k, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" }));
    run(bubble, [{ clipPath: full.clipPath }, { clipPath: to.clipPath }], { duration: 400, easing: BUBBLE_IN, fill: "forwards" });
    const fly = run(bubble, [{ translate: full.translate }, { translate: to.translate }], { duration: 420, easing: BUBBLE_IN, fill: "forwards" });
    fly.onfinish = () => {
      show();
      bubble.getAnimations().forEach((a) => { if (a.id === "bubble") a.cancel(); });
      kids.forEach((k) => k.getAnimations().forEach((a) => { if (a.id === "bubble") a.cancel(); }));
    };
  }
}

function syncBubbles() {
  els.shell.classList.toggle("radar-open", radar.open);
  els.shell.classList.toggle("modes-open", modes.open);
  els.radarScrim.classList.toggle("show", radar.open || modes.open);
}

function setPollRate() {
  if (state.mode !== "spotify" || !state.pollTimer) return;
  clearInterval(state.pollTimer);
  // Heardle polls faster: a song Spotify starts on its own should be caught before it gives itself away
  state.pollTimer = setInterval(pollSpotify, activeGame() === "heardle" ? 1500 : CONFIG.pollMs);
}

function setGame(id) {
  if (!GAMES[id] || net.role === "guest") return;
  if (vs.on && SOLO_GAMES.includes(id)) return;
  const prev = game.id;
  const inBubble = (fn) => (modes.open ? morph(els.modes, modesKids, fn) : fn());
  morph(els.app, appKids, () => inBubble(() => switchGame(id, prev)));
  if (prev !== id) popModeBtn();
}

function popModeBtn() {
  if (reduceMotion.matches || !els.modeIcon.animate) return;
  els.modeIcon.animate([{ opacity: 0, rotate: "-120deg", scale: "0.4" }, { opacity: 1, rotate: "0deg", scale: "1" }],
    { duration: 560, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  els.modeName.parentNode.animate([{ opacity: 0, translate: "-0.75rem 0" }, { opacity: 1, translate: "0 0" }],
    { duration: 420, delay: 60, easing: MORPH_EASE, fill: "backwards" });
  const card = els.modeList.querySelector('[aria-checked="true"]');
  if (card) card.animate([{ scale: "0.94" }, { scale: "1" }], { duration: 480, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
}

function switchGame(id, prev) {
  game.id = id;
  saveGame();
  state.choicesFailed = false;
  setImode(id === "pick" ? "pick" : "type");
  applyInputUI();
  renderModeBtn();
  renderModes();
  setPollRate();
  if (prev === id) return;
  if (prev === "heardle") { heardleStop(); playerCall("play"); } // let the music run again
  if (id === "heardle") { heardleNext(true); return; } // a fresh song, from second zero
  if (!replayRound()) {
    if (id === "hitster") renderTimeline();
    setStatus(GAMES[id].name + " — next song's up");
  }
}

function gameRoundStart() {
  const g = activeGame();
  if (g === "heardle") heardleStart();
  else if (g === "hitster") hitsterStart();
}

function gameRoundEnd() {
  const g = activeGame();
  if (g === "heardle" && hd.key === state.trackKey) {
    // the reward: hear it properly, from the top
    heardleStop();
    api("https://api.spotify.com/v1/me/player/seek?position_ms=0", { method: "PUT" }).then(() => playerCall("play")).catch(() => {});
  }
  if (g === "hitster") renderTimeline();
}

function playerCall(path, body) {
  return api("https://api.spotify.com/v1/me/player/" + path, {
    method: "PUT",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ----- Heardle: 1 second, then 2, 4, 7… every wrong guess (or "+ more") unlocks a longer snippet
const hd = { key: null, stage: 0, timer: 0, pending: null, busy: false, playingSecs: 0 };

function hdLadder() {
  return HEARDLE_LADDERS[game.heardle.ladder];
}

function fmtSecs(n) {
  return (n < 1 ? "½" : n) + "s";
}

function heardleStop() {
  clearTimeout(hd.timer);
  hd.playingSecs = 0;
  renderHeardle();
}

// switching = just changed modes, so the song that was on doesn't count as skipped
async function heardleNext(switching) {
  if (hd.busy || state.mode !== "spotify") return;
  hd.busy = true;
  els.skip.disabled = true;
  try {
    hd.key = null; // no victory lap for a skipped song
    if (state.track && !state.revealed && !switching) {
      state.rounds += 1; state.streak = 0;
      finish("skipped", false, "skipped");
    }
    heardleStop();
    const q = await spotifyJson("https://api.spotify.com/v1/me/player/queue");
    const item = (q.queue || []).find((t) => t && t.type === "track" && t.id && t.id !== state.trackKey);
    if (!item) { setStatus("nothing up next in Spotify — start a playlist, then hit Skip"); return; }
    hd.pending = { uri: item.uri, ctx: state.context };
    state.expect = { key: item.id, until: Date.now() + 8000 };
    newRound(trackFromItem(item), item.id);
  } catch (e) {
    setStatus(e.status === 404 ? "no active Spotify player — press play in Spotify first" : "couldn't get the next song (" + (e.status || e.message) + ")");
  } finally {
    hd.busy = false;
    setTimeout(() => { els.skip.disabled = false; }, 800);
  }
}

function heardleStart() {
  hd.key = state.trackKey;
  hd.stage = 0;
  setStatus("Heardle — " + fmtSecs(hdLadder()[0]) + " of intro, name it!");
  if (els.app.ownerDocument.hasFocus()) (game.heardle.guess === "both" ? els.artist : els.song).focus();
  heardleSnippet();
}

async function heardleSnippet() {
  const ladder = hdLadder();
  const secs = ladder[Math.min(hd.stage, ladder.length - 1)];
  const key = hd.key;
  clearTimeout(hd.timer);
  let res;
  try {
    if (hd.pending) {
      // switch songs ourselves so the first thing you hear is second zero
      const p = hd.pending;
      hd.pending = null;
      const inContext = p.ctx && !/:artist:/.test(p.ctx);
      res = await playerCall("play", inContext ? { context_uri: p.ctx, offset: { uri: p.uri }, position_ms: 0 } : { uris: [p.uri], position_ms: 0 });
      if (!res.ok && inContext) res = await playerCall("play", { uris: [p.uri], position_ms: 0 });
    } else {
      await api("https://api.spotify.com/v1/me/player/seek?position_ms=0", { method: "PUT" });
      res = await playerCall("play");
    }
  } catch { setStatus("couldn't reach Spotify"); return; }
  if (!res.ok) {
    setStatus(res.status === 403 ? "Heardle needs Spotify Premium to start and stop songs"
      : res.status === 404 ? "no active Spotify player — press play in Spotify first"
      : "couldn't play the snippet (" + res.status + ")");
    return;
  }
  if (hd.key !== key || state.revealed) return;
  hd.playingSecs = secs;
  renderHeardle();
  hd.timer = setTimeout(() => {
    hd.playingSecs = 0;
    renderHeardle();
    if (hd.key === key && !state.revealed) playerCall("pause").catch(() => {});
  }, secs * 1000);
}

function heardleCheck() {
  const t = state.track;
  const both = game.heardle.guess === "both";
  if (!els.song.value.trim() && !(both && els.artist.value.trim())) { heardleMore(); return; } // empty guess = "+ more"
  const sOk = fuzzyMatch(els.song.value, [t.song]);
  const aOk = !both || fuzzyMatch(els.artist.value, t.artists);
  setVerdict(els.fSong, sOk ? "ok" : "bad");
  if (both) setVerdict(els.fArtist, aOk ? "ok" : "bad");
  if (sOk && aOk) {
    const ladder = hdLadder();
    const earned = ladder.length - hd.stage;
    state.rounds += 1; state.points += earned; state.streak += 1;
    finish(hd.stage === 0 ? "first try! unreal ears" : "got it in " + fmtSecs(ladder[hd.stage]) + " — +" + earned, true, "+" + earned);
    popPoints(earned);
    burst();
    return;
  }
  fields.filter((f) => f.classList.contains("bad")).forEach(shake);
  heardleMore(true);
}

function heardleMore(wrong) {
  if (!state.track || state.revealed || activeGame() !== "heardle") return;
  const ladder = hdLadder();
  if (hd.stage >= ladder.length - 1) {
    state.rounds += 1; state.streak = 0;
    finish("out of snippets — 0 points", false, "0");
    return;
  }
  hd.stage += 1;
  setStatus((wrong ? "nope — " : "") + "here's " + fmtSecs(ladder[hd.stage]));
  heardleSnippet();
}

function renderHeardle() {
  if (activeGame() !== "heardle") return;
  const ladder = hdLadder();
  const max = ladder[ladder.length - 1];
  const stage = Math.min(hd.stage, ladder.length - 1);
  const open = state.revealed ? 1 : ladder[stage] / max;
  els.hdOpen.style.width = (open * 100).toFixed(2) + "%";
  els.hdBar.querySelectorAll("s").forEach((t) => t.remove());
  ladder.slice(0, -1).forEach((n) => {
    const tick = document.createElement("s");
    tick.style.left = (n / max * 100).toFixed(2) + "%";
    els.hdBar.append(tick);
  });
  // the fill runs across the snippet while it plays
  const fill = els.hdFill;
  fill.style.transition = "none";
  fill.style.width = "0";
  if (hd.playingSecs && !reduceMotion.matches) {
    void fill.offsetWidth;
    fill.style.transition = "width " + hd.playingSecs + "s linear";
    fill.style.width = (hd.playingSecs / max * 100).toFixed(2) + "%";
  }
  const left = ladder.length - stage;
  els.hdInfo.textContent = state.revealed ? "" : fmtSecs(ladder[stage]) + " · worth " + left + (left === 1 ? " point" : " points");
  els.hdMore.disabled = els.hdPlay.disabled = !state.track || state.revealed;
  els.hdMore.textContent = stage >= ladder.length - 1 ? "give up" : "+ more";
}

els.hdPlay.onclick = () => { if (state.track && !state.revealed) heardleSnippet(); };
els.hdMore.onclick = () => heardleMore(false);

// ----- Hitster: one free starter card, then place every song before, between or after the ones you have
let hs = { cards: [], lives: game.hitster.lives, maxLives: game.hitster.lives, target: game.hitster.target, over: false, last: null };
try {
  const saved = JSON.parse(localStorage.getItem("gtt_hitster"));
  if (saved && Array.isArray(saved.cards)) hs = { ...hs, ...saved, last: null };
} catch {}
let restartArmedAt = 0;

function hsSave() {
  try { localStorage.setItem("gtt_hitster", JSON.stringify({ cards: hs.cards, lives: hs.lives, maxLives: hs.maxLives, target: hs.target, over: hs.over })); } catch {}
}

function hsWon() {
  return hs.cards.length >= hs.target;
}

function hsCard() {
  const t = state.track;
  return { key: state.trackKey, year: t.third.answer, song: t.song, artist: t.artists[0] || "" };
}

function hitsterNewGame() {
  hs = { cards: [], lives: game.hitster.lives, maxLives: game.hitster.lives, target: game.hitster.target, over: false, last: null };
  hsSave();
  if (!replayRound()) { renderTimeline(); setStatus("new timeline — the next song is your free starter card"); }
  renderModes();
}

function hitsterStart() {
  hs.last = null;
  if (hs.over || hsWon()) {
    renderTimeline();
    setStatus(hsWon() ? "you won this timeline — hit New game for another" : "game over — hit New game to go again");
    return;
  }
  if (!hs.cards.length) {
    hs.cards.push(hsCard());
    hs.last = { key: state.trackKey, ok: true };
    hsSave();
    state.rounds += 1;
    finish("your starter card: " + state.track.third.answer + " — now place the next one", true, "starter");
    return;
  }
  renderTimeline();
  setStatus("where does this one go? tap a ＋");
}

function hitsterPlace(i) {
  if (!state.track || state.revealed || hs.over || hsWon()) return;
  const card = hsCard();
  const before = hs.cards[i - 1], after = hs.cards[i];
  const ok = (!before || before.year <= card.year) && (!after || card.year <= after.year);
  state.rounds += 1;
  if (ok) {
    hs.cards.splice(i, 0, card);
    hs.last = { key: card.key, ok: true };
    state.points += 1; state.streak += 1;
    if (hsWon()) { finish("you won! " + hs.cards.length + " cards on the timeline", true, "+1"); burst(); }
    else finish(card.year + " — spot on! " + hs.cards.length + "/" + hs.target, true, "+1");
    popPoints(1);
  } else {
    hs.lives -= 1; state.streak = 0;
    hs.last = { key: card.key, ok: false, card };
    if (hs.lives <= 0) { hs.over = true; finish("it was " + card.year + " — game over at " + hs.cards.length + " cards", false, "✗"); }
    else finish("nope, it was " + card.year + " — " + hs.lives + (hs.lives === 1 ? " life" : " lives") + " left", false, "✗");
  }
  hsSave();
  renderTimeline();
  renderModes();
}

// card colour by decade, oldest plum through to the 2020s
const DECADE_COLORS = [[1960, "#b65aa5"], [1970, "#ff4f81"], [1980, "#ff7a2f"], [1990, "#ffc23d"], [2000, "#a8e063"], [2010, "#4fc3d8"], [Infinity, "#b38cff"]];

function decadeColor(year) {
  return DECADE_COLORS.find(([until]) => year < until)[1];
}

function renderTimeline() {
  if (activeGame() !== "hitster") return;
  const open = !!state.track && !state.revealed && !hs.over && !hsWon() && hs.cards.length > 0;
  const lost = Math.max(0, hs.maxLives - hs.lives);
  els.tlInfo.textContent = hs.cards.length + "/" + hs.target + " cards · " + "❤️".repeat(Math.max(0, hs.lives)) + "🖤".repeat(Math.min(lost, 5));
  els.tlNew.textContent = hs.over || hsWon() ? "New game" : "Restart";
  const scroller = els.tlCards;
  const keepLeft = scroller.scrollLeft;
  const items = [];
  if (!hs.cards.length) {
    // an empty board still looks like a board: this is where the starter card lands
    const spot = document.createElement("div");
    spot.className = "tl-card ghosty";
    const q = document.createElement("b");
    q.textContent = "?";
    const t = document.createElement("span");
    t.textContent = "next song is your free starter card";
    spot.append(q, t);
    items.push(spot);
  }
  const miss = hs.last && !hs.last.ok && hs.last.key === state.trackKey ? hs.last.card : null;
  const missAt = miss ? hs.cards.filter((c) => c.year <= miss.year).length : -1;
  hs.cards.forEach((c, i) => {
    if (i === missAt) items.push(tlChip(miss, "bad"));
    items.push(tlSlot(i, open));
    items.push(tlChip(c, hs.last && hs.last.ok && hs.last.key === c.key && c.key === state.trackKey ? "fresh" : ""));
  });
  if (hs.cards.length) {
    if (missAt === hs.cards.length) items.push(tlChip(miss, "bad"));
    items.push(tlSlot(hs.cards.length, open));
  }
  scroller.replaceChildren(...items);
  // follow the action: centre the card that just landed (or missed), otherwise stay where you were
  const focus = scroller.querySelector(".fresh, .bad");
  scroller.scrollLeft = keepLeft;
  if (focus) {
    const left = focus.offsetLeft - scroller.clientWidth / 2 + focus.offsetWidth / 2;
    scroller.scrollTo({ left, behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
}

function tlSlot(i, open) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "slot";
  b.textContent = "＋";
  b.disabled = !open;
  b.style.animationDelay = (i * 30) + "ms";
  b.setAttribute("aria-label", i === 0 ? "Place before everything" : i === hs.cards.length ? "Place after everything" : "Place between " + hs.cards[i - 1].year + " and " + hs.cards[i].year);
  b.onclick = () => hitsterPlace(i);
  return b;
}

function tlChip(c, cls) {
  const d = document.createElement("div");
  d.className = "tl-card" + (cls ? " " + cls : "");
  if (cls !== "bad") d.style.setProperty("--c", decadeColor(c.year)); // a miss stays red
  d.title = c.song + " — " + c.artist + " (" + c.year + ")";
  const y = document.createElement("b");
  y.textContent = c.year;
  const t = document.createElement("span");
  t.textContent = c.song;
  const a = document.createElement("small");
  a.textContent = c.artist;
  d.append(y, t, a);
  return d;
}

// a mouse wheel scrolls the board sideways when it's wider than the card
els.tlCards.addEventListener("wheel", (e) => {
  const sc = els.tlCards;
  if (sc.scrollWidth <= sc.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  sc.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });

els.tlNew.onclick = () => {
  if (!hs.over && !hsWon() && hs.cards.length > 1 && Date.now() - restartArmedAt > 4000) {
    restartArmedAt = Date.now();
    setStatus("tap Restart again — this timeline will be gone");
    return;
  }
  hitsterNewGame();
};

// ----- the mode button on the card and the bubble on its left
function renderModeBtn() {
  const g = GAMES[activeGame()];
  els.modeIcon.textContent = g.icon;
  els.modeName.textContent = g.name;
  els.modeDesc.textContent = net.role === "guest" ? "the host's pick" : "◂ game mode";
  els.modeBtn.title = net.role === "guest" ? "The host picks the mode" : g.name + " — " + g.short;
  els.modeBtn.disabled = net.role === "guest";
  els.modeBtn.setAttribute("aria-expanded", String(modes.open));
}

function confRow(label, options, current, pick) {
  const row = document.createElement("div");
  row.className = "conf";
  const name = document.createElement("span");
  name.textContent = label;
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", label);
  for (const [value, text] of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-pressed", String(value === current));
    b.onclick = () => {
      for (const o of seg.children) o.setAttribute("aria-pressed", String(o === b));
      morph(els.app, appKids, () => pick(value)); // e.g. Heardle's artist field coming or going
      saveGame();
      renderModes();
    };
    seg.append(b);
  }
  row.append(name, seg);
  return row;
}

function renderModes() {
  renderModeBtn();
  if (!modes.open) return;
  const cur = activeGame();
  if (!els.modeList.children.length) {
    els.modeList.append(...Object.entries(GAMES).map(([id, g]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mode-card";
      b.dataset.game = id;
      b.setAttribute("role", "radio");
      const icon = document.createElement("i");
      icon.textContent = g.icon;
      const name = document.createElement("b");
      name.textContent = g.name;
      b.append(icon, name, document.createElement("span"));
      b.onclick = () => setGame(id);
      return b;
    }));
  }
  [...els.modeList.children].forEach((b, i) => {
    const id = b.dataset.game;
    const locked = (vs.on || !!net.role) && SOLO_GAMES.includes(id);
    b.setAttribute("aria-checked", String(id === cur));
    b.disabled = locked || net.role === "guest";
    b.lastChild.textContent = locked ? "solo only — turn off VS to play" : GAMES[id].desc;
    if (modes.animate) {
      b.classList.remove("in");
      void b.offsetWidth; // restart the slide-in
      b.style.setProperty("--i", i);
      b.classList.add("in");
    }
  });
  modes.animate = false;
  renderModesNote(cur);
  if (modes.confFor === cur) return;
  modes.confFor = cur;
  const conf = [];
  if (cur === "heardle") {
    conf.push(confRow("Snippets", [["classic", "1 → 16s"], ["hard", "½ → 8s"], ["chill", "2 → 30s"]], game.heardle.ladder, (v) => {
      game.heardle.ladder = v;
      hd.stage = Math.min(hd.stage, hdLadder().length - 1);
      renderHeardle();
    }));
    conf.push(confRow("Guess", [["song", "Song"], ["both", "Artist + song"]], game.heardle.guess, (v) => { game.heardle.guess = v; applyInputUI(); }));
  } else if (cur === "hitster") {
    conf.push(confRow("Cards to win", [[5, "5"], [10, "10"], [15, "15"]], game.hitster.target, (v) => {
      game.hitster.target = v;
      if (!hs.over && hs.cards.length < v) { hs.target = v; hsSave(); renderTimeline(); }
    }));
    conf.push(confRow("Lives (from the next game)", [[1, "1"], [3, "3"], [5, "5"]], game.hitster.lives, (v) => { game.hitster.lives = v; }));
    const again = document.createElement("button");
    again.type = "button";
    again.id = "modesNew";
    again.textContent = "New game";
    again.onclick = hitsterNewGame;
    conf.push(again);
  } else {
    conf.push(confRow("Lyric hint 🎤", [[false, "Off"], [true, "On"]], lyricsOn, (v) => setLyricsOn(v)));
  }
  els.modeConf.replaceChildren(...conf);
}

function renderModesNote(cur) {
  els.modesNote.textContent = net.role === "guest" ? "the host picks the mode for the room"
    : cur === "heardle" ? "Heardle starts and pauses Spotify for you, so it needs Premium. Skip = next song, from second zero."
    : cur === "hitster" ? "Now: " + hs.cards.length + "/" + hs.target + " cards, " + hs.lives + (hs.lives === 1 ? " life" : " lives") + " left. Years come from Spotify's album dates, so remasters can fool you."
    : vs.on ? "Heardle and Hitster are solo for now — versus plays Quiz or Pick 6."
    : "";
}

function setModesOpen(open) {
  if (open === modes.open) return;
  modes.open = open;
  modes.animate = open;
  modes.confFor = null;
  if (open && crampedScreen()) setRadarOpen(false);
  renderModes();
  bubbleMotion(els.modes, els.modeBtn, open);
  if (!open && els.modes.contains(els.modes.ownerDocument.activeElement)) els.modeBtn.focus();
}

els.modeBtn.onclick = () => setModesOpen(!modes.open);
els.modesClose.onclick = () => setModesOpen(false);
applyInputUI();
renderModeBtn();
renderHeardle();
renderTimeline();
renderFlames();
