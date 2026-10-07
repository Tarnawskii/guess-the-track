// ---------- config, shared state, layout morphing, element refs, the connection light ----------
// Plain scripts, loaded in order by index.html and sharing one global scope (no build step). A file can call
// anything at any time from inside a function, but code that runs while a file loads only sees earlier files.
const CONFIG = {
  spotifyClientId: "fb91c824fe804c50a8b4b244288ebc6f",
  redirectUri: location.origin + location.pathname,
  scopes: "user-read-currently-playing user-read-playback-state user-modify-playback-state user-top-read",
  pollMs: 5000,
};

const state = {
  mode: "idle",
  imode: "type", choicesFailed: false,
  choice: { stage: 0, opts: null, accepted: null, results: [], picks: [] },
  track: null,
  trackKey: null,
  revealed: false,
  rounds: 0, points: 0, streak: 0,
  token: null, lastPoll: 0, userName: null,
  pos: null, trackDuration: 0,
  paid: [false, false, false], // pick mode: stages already paid out this song
  colors: null,                // { key, colors } of the current song's label
  lyrics: null,                // { key, status, synced, plain } from lrclib.net
  hint: null,                  // the lyric hint bought for this song
};

// versus: two players taking turns on one device, or a whole room online; one round per song
const vs = {
  on: false,
  players: localPlayers(), // { name, points, wins, away } — index = seat
  next: 0,                 // same device: who guesses first on the next song (alternates)
  turn: 0,
  guesses: [],             // by seat: { marks: [artist, song, year], earned } once locked in
};

// online versus: the host (Spotify logged in) is seat 0 and grades everything; guests
// (seat 1 and up, one per person in the Jam) never see the answer before the round resolves
const MAX_PLAYERS = 32; // a Spotify Jam holds 32 people
const net = {
  role: null,        // null | "host" | "guest"
  peer: null, code: null,
  conn: null,        // guest: the link to the host
  conns: [],         // host: guest links by seat (seat 0, the host, is always null)
  seatOf: new Map(), // host: device id -> seat, so a reload takes the seat back
  seat: null,        // guest: my seat, once the host says hello
  myName: "",        // guest: my name — mine to type, the host only echoes it
  myLocked: false,   // guest: locked in this round
  lastResult: null,  // host: last result message, resent to a guest who rejoins
  jam: "",           // the host's Spotify Jam invite, so guests can hear the music
};

// public rooms (see the lobby section at the bottom)
const LOBBY_SLOTS = 16;
const lobbyId = (i) => "gtt-lobby-v1-" + i;
const pub = { on: false, peer: null, slot: -1 };
const lobby = { open: false, peer: null, rooms: new Map(), scanning: false, error: "" };

function storedNames() {
  try { const n = JSON.parse(localStorage.getItem("gtt_players") || "[]"); return Array.isArray(n) ? n : []; } catch { return []; }
}

function localPlayers() {
  const names = storedNames();
  return [0, 1].map((i) => ({ name: typeof names[i] === "string" ? names[i] : "", points: 0, wins: 0 }));
}

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// smooth layout changes (switching modes, versus, choices arriving): the box eases to its new height,
// what stays glides to its new spot, what leaves fades out where it was, what arrives fades in after it
const MORPH_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const shown = (el) => el.getClientRects().length > 0;
const appKids = () => [...els.app.children].filter((el) => !el.classList.contains("lava") && !el.classList.contains("ghost") && !el.classList.contains("sprite"));
const modesKids = () => [...els.modeConf.children, els.modesNote];

// an element counts as "the same" only if what's visible inside it is the same
function morphSig(el) {
  if (el.classList.contains("actions")) return [...el.children].filter(shown).map((b) => b.id).join();
  if (el.id === "choices") return String(els.choiceList.children.length);
  return "";
}

function morphAnim(el, frames, duration, delay = 0) {
  const a = el.animate(frames, { duration, delay, easing: MORPH_EASE, fill: "backwards" });
  a.id = "morph";
  return a;
}

// a frozen copy of something that just left, fading out where it stood
function morphGhost(box, c0, el, r0, displays) {
  const g = el.cloneNode(true);
  [g, ...g.querySelectorAll("*")].forEach((n, i) => { if (displays[i]) n.style.display = displays[i]; });
  g.classList.add("ghost");
  g.setAttribute("aria-hidden", "true");
  g.inert = true;
  Object.assign(g.style, {
    position: "absolute", margin: "0", zIndex: "2",
    left: (r0.left - c0.left - box.clientLeft) + "px", top: (r0.top - c0.top - box.clientTop) + "px",
    width: r0.width + "px", height: r0.height + "px",
  });
  box.append(g);
  const a = g.animate([{ opacity: 1 }, { opacity: 0, scale: "0.97" }], { duration: 200, easing: "ease-out", fill: "forwards" });
  a.id = "morph";
  a.onfinish = a.oncancel = () => g.remove();
}

const morphing = new Set(); // boxes mid-change: a nested switch (VS turning Hitster into Quiz) rides along

function morph(box, kids, change) {
  if (reduceMotion.matches || !box.animate || !shown(box) || morphing.has(box)) { change(); return; }
  // a second switch mid-animation starts from wherever things are now
  [box, ...kids()].forEach((el) => el.getAnimations().forEach((a) => { if (a.id === "morph") a.finish(); }));
  box.querySelectorAll(":scope > .ghost").forEach((g) => g.remove());
  const c0 = box.getBoundingClientRect();
  const before = new Map();
  for (const el of kids()) {
    if (!shown(el)) continue;
    const displays = [el, ...el.querySelectorAll("*")].map((n) => getComputedStyle(n).display);
    before.set(el, { r: el.getBoundingClientRect(), sig: morphSig(el), displays });
  }
  morphing.add(box);
  try { change(); } finally { morphing.delete(box); }
  // measure the new layout completely before any animation pulls it back toward the old one
  const c1 = box.getBoundingClientRect();
  const after = kids().filter(shown).map((el) => [el, el.getBoundingClientRect()]);
  const stays = new Set(after.map(([el]) => el));
  if (Math.abs(c1.height - c0.height) > 0.5) morphAnim(box, [{ height: c0.height + "px" }, { height: c1.height + "px" }], 480);
  for (const [el, b] of before) {
    if (!stays.has(el) || morphSig(el) !== b.sig) morphGhost(box, c0, el, b.r, b.displays);
  }
  let n = 0;
  for (const [el, r1] of after) {
    const b = before.get(el);
    if (b && morphSig(el) === b.sig) {
      const dx = (b.r.left - c0.left) - (r1.left - c1.left), dy = (b.r.top - c0.top) - (r1.top - c1.top);
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) morphAnim(el, [{ translate: dx + "px " + dy + "px" }, { translate: "0 0" }], 480);
    } else {
      morphAnim(el, [{ opacity: 0, translate: "0 0.5rem", scale: "0.97" }, { opacity: 1, translate: "0 0", scale: "1" }], 380, 110 + 45 * n++);
    }
  }
}

window.addEventListener("error", (e) => {
  console.error("[gtt] JS error:", e.message, "at", e.filename + ":" + e.lineno);
  const s = $("status"); if (s) s.textContent = "error: " + e.message;
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[gtt] unhandled promise:", e.reason);
  const s = $("status"); if (s) s.textContent = "error: " + (e.reason && e.reason.message ? e.reason.message : e.reason);
});
console.log("[gtt] script loaded, protocol:", location.protocol);
const els = {
  app: $("app"), stage: $("stage"), cover: $("cover"), coverBack: $("coverBack"), discLabel: $("discLabel"),
  progress: $("progress"), tNow: $("tNow"), tTotal: $("tTotal"),
  status: $("status"), answer: $("answer"),
  artist: $("gArtist"), song: $("gSong"), year: $("gYear"),
  fArtist: $("fArtist"), fSong: $("fSong"), fYear: $("fYear"),
  sPoints: $("sPoints"), sStreak: $("sStreak"), sRounds: $("sRounds"),
  stPoints: $("stPoints"), stStreak: $("stStreak"),
  check: $("check"), reveal: $("reveal"), skip: $("skip"),
  menuBtn: $("menuBtn"), menu: $("menu"), pipBtn: $("pipBtn"), vsBtn: $("vsBtn"), vsResult: $("vsResult"), lyrBtn: $("lyrBtn"), lyrics: $("lyrics"),
  vsScore: $("vsScore"), songsRow: $("stSongs"), sWins: $("sWins"), rows: [], // rows: { stat, name, pts } by seat
  modeBtn: $("modeBtn"), modeIcon: $("modeIcon"), modeName: $("modeName"), modeDesc: $("modeDesc"),
  modes: $("modes"), modesClose: $("modesClose"), modeList: $("modeList"), modeConf: $("modeConf"), modesNote: $("modesNote"),
  hdOpen: $("hdOpen"), hdFill: $("hdFill"), hdBar: $("hdBar"), hdInfo: $("hdInfo"), hdMore: $("hdMore"), hdPlay: $("hdPlay"),
  tlInfo: $("tlInfo"), tlNew: $("tlNew"), tlCards: $("tlCards"),
  choiceLabel: $("choiceLabel"), choiceList: $("choiceList"),
  led: $("led"), connText: $("connText"), reconnect: $("reconnect"), live: $("live"), liveBtn: $("liveBtn"),
  jam: $("jam"), jamLink: $("jamLink"), jamJoin: $("jamJoin"), jamHint: $("jamHint"), pubBtn: $("pubBtn"), pubHint: $("pubHint"),
  roomsBtn: $("roomsBtn"), lobby: $("lobby"), lobbyList: $("lobbyList"), lobbyNote: $("lobbyNote"),
  lobbyRefresh: $("lobbyRefresh"), lobbyClose: $("lobbyClose"), lobbyLogin: $("lobbyLogin"),
  radarBtn: $("radarBtn"), radar: $("radar"), radarList: $("radarList"), radarNote: $("radarNote"),
  shell: $("shell"), radarScrim: $("radarScrim"), radarRefresh: $("radarRefresh"), radarClose: $("radarClose"), radarLogin: $("radarLogin"),
  radarSeg: $("radarSeg"), radarRanges: document.querySelectorAll("[data-range]"),
  net: $("net"), netLed: $("netLed"), netText: $("netText"), netInvite: $("netInvite"), netBtn: $("netBtn"),
};
const fields = [els.fArtist, els.fSong, els.fYear];

// the light shows the state; the words come out on hover/tap, and on their own for a moment when it changes
let liveFlash = 0;
function setConn(cls, text) {
  const changed = !els.led.classList.contains(cls);
  els.led.className = "led " + cls;
  if (text) els.connText.textContent = text;
  els.liveBtn.setAttribute("aria-label", "Spotify: " + els.connText.textContent);
  if (changed && cls !== "wait") {
    setLiveOpen(true);
    clearTimeout(liveFlash);
    liveFlash = setTimeout(() => setLiveOpen(false), cls === "off" ? 5000 : 2600);
  }
}

function setLiveOpen(open) {
  els.live.classList.toggle("open", open);
  els.liveBtn.setAttribute("aria-expanded", String(open));
}
