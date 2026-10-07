// ---------- versus: turns on one device, or everyone at once online; scoring head to head ----------
function pname(i) {
  return (vs.players[i] && vs.players[i].name.trim()) || "Player " + (i + 1);
}

const STAGE_POINTS = [1, 1, 2]; // artist, song, year

function markPoints(marks) {
  return marks.reduce((sum, m, i) => sum + (m === "ok" ? STAGE_POINTS[i] : m === "close" ? 1 : 0), 0);
}

function setTurnHighlight(i) {
  els.rows.forEach((r, j) => r.stat.classList.toggle("turn", j === i));
}

// online: this device's seat
function myIndex() {
  return net.role === "guest" ? (net.seat ?? -1) : 0;
}

// online: has this device's player already locked in this round?
function vsMeLocked() {
  return net.role === "guest" ? net.myLocked : net.role === "host" ? !!vs.guesses[0] : false;
}

// still in the room (online, a guest who left keeps their seat and points but isn't waited for)
function present(i) {
  return !!vs.players[i] && !vs.players[i].away;
}

// seats that guessed this song
function vsEntrants() {
  return vs.players.map((_, i) => i).filter((i) => vs.guesses[i]);
}

// seats still to lock in
function vsWaitingOn() {
  return vs.players.map((_, i) => i).filter((i) => present(i) && !vs.guesses[i]);
}

function nameList(seats) {
  return seats.length <= 2 ? seats.map(pname).join(" & ") : seats.length + " players";
}

// restart the current song under new rules, unless its answer is already out
function replayRound() {
  if (!state.track || state.revealed) return false;
  const t = state.track; state.track = null; newRound(t, state.trackKey);
  return true;
}

function setVersus(on) {
  if (!on && net.role === "host") stopHosting(true);
  if (on && SOLO_GAMES.includes(game.id)) setGame("quiz");
  vs.on = on;
  vs.players = localPlayers();
  vs.guesses = [];
  vs.next = 0;
  els.app.classList.toggle("vs", on);
  els.vsBtn.setAttribute("aria-pressed", String(on));
  syncMenuBtn();
  updateScore();
  renderNet();
  applyInputUI();
  renderModes();
  if (replayRound()) return;
  setTurnHighlight(-1);
  setStatus(on ? "versus on — first song up next" : "solo mode");
}

// clear the board for whoever guesses now; the other player shouldn't see anything
function vsTurnUI(prefix) {
  els.artist.value = ""; els.song.value = ""; els.year.value = "";
  fields.forEach((f) => setVerdict(f, null));
  setTurnHighlight(vs.turn);
  setStatus((prefix ? prefix + " · " : "") + pname(vs.turn) + "'s turn — " + pname(1 - vs.turn) + ", eyes off");
  const c = state.choice;
  if (usingPick() && c.opts) { c.stage = 0; c.results = []; c.picks = []; renderStage(); }
  else if (!usingPick() && els.app.ownerDocument.hasFocus()) els.artist.focus();
}

// online: no turns, everyone guesses at the same time
function vsOnlineUI(prefix) {
  els.artist.value = ""; els.song.value = ""; els.year.value = "";
  fields.forEach((f) => setVerdict(f, null));
  setTurnHighlight(-1);
  const here = vs.players.filter((p, i) => present(i)).length;
  const go = net.role === "host" && here < 2 ? "waiting for friends — invite your Jam"
    : here === 2 ? "go — you're both guessing" : "go — everyone's guessing";
  setStatus((prefix ? prefix + " · " : "") + go);
  if (!usingPick() && els.app.ownerDocument.hasFocus()) els.artist.focus();
}

function gradeTyped(artist, song, year) {
  const t = state.track;
  const yv = parseInt(year, 10);
  const diff = isNaN(yv) ? Infinity : Math.abs(yv - t.third.answer);
  return [
    fuzzyMatch(artist, t.artists) ? "ok" : "bad",
    fuzzyMatch(song, [t.song]) ? "ok" : "bad",
    diff === 0 ? "ok" : diff <= 2 ? "close" : "bad",
  ];
}

function vsLockTyped() {
  if (vsMeLocked()) return;
  const a = els.artist.value, s = els.song.value, y = els.year.value;
  if (!a.trim() && !s.trim() && !y.trim()) {
    setStatus("type something — or Pass");
    return;
  }
  if (net.role === "guest") guestLock({ kind: "type", a, s, y });
  else vsLock(gradeTyped(a, s, y));
}

function vsLock(marks, verb = "locked in", who = net.role ? myIndex() : vs.turn) {
  vs.guesses[who] = { marks, earned: markPoints(marks) };
  statOf(who).classList.add("locked");
  if (!vsWaitingOn().length) { vsResolve(); return; }
  if (net.role) {
    netSend({ t: "locked", key: state.trackKey, who, verb });
    showLocked(who, verb);
    return;
  }
  vs.turn = 1 - who; vsTurnUI(pname(who) + " " + verb);
}

// host: someone left mid-song — if they were the last one we waited on, settle it
function vsMaybeResolve() {
  if (vs.on && state.track && !state.revealed && vsEntrants().length && !vsWaitingOn().length) vsResolve();
}

// online: someone's in, others are still guessing
function showLocked(who, verb) {
  vs.guesses[who] ||= { marks: null, earned: 0 }; // guests only learn that a seat is in, not what it guessed
  statOf(who).classList.add("locked");
  const left = vsWaitingOn();
  const waiting = left.length ? " — waiting for " + nameList(left) : "";
  if (who === myIndex()) {
    fields.forEach((f) => { f.querySelector("input").readOnly = true; });
    if (usingPick()) { els.choiceList.replaceChildren(); els.choiceLabel.textContent = verb; }
    setStatus(verb + waiting);
  } else if (!vsMeLocked()) setStatus(pname(who) + " " + verb + " — your move");
  else setStatus(pname(who) + " " + verb + waiting);
}

// bank everyone's points for this song; returns the winner's seat, or -1 for a tie / nobody scoring
function vsScoreSong() {
  vsEntrants().forEach((i) => { vs.players[i].points += vs.guesses[i].earned; });
  const w = vsWinner();
  if (w >= 0) vs.players[w].wins += 1;
  updateScore();
  return w;
}

function vsBest() {
  return Math.max(0, ...vsEntrants().map((i) => vs.guesses[i].earned));
}

function vsWinner() {
  const best = vsBest();
  const top = vsEntrants().filter((i) => vs.guesses[i].earned === best);
  return best > 0 && top.length === 1 ? top[0] : -1;
}

function vsResultText(w) {
  const seats = vsEntrants(), pts = seats.map((i) => vs.guesses[i].earned), best = vsBest();
  if (seats.length === 2) {
    const [a, b] = pts;
    return w < 0 ? `dead heat ${a}–${b}` : `${pname(w)} takes it ${Math.max(a, b)}–${Math.min(a, b)}`;
  }
  if (w >= 0) return seats.length === 1 ? `${pname(w)} scores ${best}` : `${pname(w)} takes it with ${best}`;
  if (best === 0) return "nobody scored";
  const top = seats.filter((i) => vs.guesses[i].earned === best);
  return top.length > 3 ? `${top.length}-way tie at ${best}` : `dead heat at ${best} — ` + top.map(pname).join(", ");
}

// answer key note: the score line head to head, otherwise how this device did
function vsNote(w) {
  const seats = vsEntrants();
  if (seats.length === 2) return seats.map((i) => vs.guesses[i].earned).join("–");
  const me = vs.guesses[myIndex()];
  if (!net.role || !me) return w >= 0 ? "👑 " + pname(w) : "tie";
  return (w === myIndex() ? "👑 " : "") + (me.earned ? "+" + me.earned : "0");
}

function vsResolve() {
  if (!net.role) { els.artist.value = ""; els.song.value = ""; els.year.value = ""; }
  const w = vsScoreSong();
  const msg = w < 0 ? vsResultText(w) : "far out — " + vsResultText(w);
  if (net.role === "host") {
    const t = state.track;
    net.lastResult = {
      t: "result", key: state.trackKey, w, msg, guesses: vs.players.map((_, i) => vs.guesses[i] || null), players: vs.players,
      track: { artists: t.artists, song: t.song, third: t.third, artUrl: t.artUrl, album: t.album, duration: t.duration },
    };
    netSend(net.lastResult);
  }
  vsShowResult(w, msg);
}

function vsShowResult(w, msg) {
  setTurnHighlight(-1);
  els.rows.forEach((r) => r.stat.classList.remove("locked"));
  finish(msg, w >= 0, vsNote(w));
  renderVsResult(w);
  vsEntrants().forEach((i) => { if (vs.guesses[i].earned) popPoints(vs.guesses[i].earned, statOf(i)); });
  if (w >= 0) burst();
  if (usingPick()) els.choiceLabel.textContent = "next track inbound…";
}

// the song changed before everyone locked in: whoever's still here and didn't scores 0
function vsTimeUp() {
  if (!state.track || state.revealed || !vsEntrants().length) return "";
  vsWaitingOn().forEach((i) => { vs.guesses[i] = { marks: BAD3, earned: 0 }; });
  return "time's up, " + vsResultText(vsScoreSong());
}

function renderVsResult(w) {
  let seats = vsEntrants();
  if (seats.length > 2) seats = seats.sort((a, b) => vs.guesses[b].earned - vs.guesses[a].earned);
  const rows = seats.map((i) => {
    const g = vs.guesses[i];
    const row = document.createElement("div");
    row.className = "vsrow" + (i === w ? " won" : "") + (net.role && i === myIndex() ? " me" : "");
    const name = document.createElement("span");
    name.textContent = (i === w ? "👑 " : "") + pname(i) + (net.role && i === myIndex() && seats.length > 2 ? " (you)" : "");
    const chips = document.createElement("span");
    chips.className = "chips";
    ["artist", "song", "year"].forEach((label, k) => {
      const c = document.createElement("i");
      c.className = "chip " + g.marks[k];
      c.textContent = label[0].toUpperCase();
      c.title = label;
      chips.appendChild(c);
    });
    const pts = document.createElement("b");
    pts.textContent = "+" + g.earned;
    row.append(name, chips, pts);
    return row;
  });
  els.vsResult.replaceChildren(...rows);
  els.vsResult.style.display = "grid";
  els.vsResult.classList.add("pop");
}
