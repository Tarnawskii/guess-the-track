// ---------- online play (PeerJS / WebRTC) ----------
const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js";
let peerLib = null;
function loadPeerJs() {
  return peerLib ||= new Promise((resolve, reject) => {
    if (window.Peer) return resolve();
    const s = document.createElement("script");
    s.src = PEERJS_URL;
    s.onload = () => resolve();
    s.onerror = () => { peerLib = null; reject(new Error("couldn't load PeerJS")); };
    document.head.appendChild(s);
  });
}
const peerOptions = () => window.GTT_PEER_OPTIONS || {}; // override for a self-hosted PeerJS server

// guests still connected (host), or the link to the host (guest)
function netGuests() {
  return net.conns.filter((c) => c && c.open).length;
}

function netLinked() {
  return net.role === "guest" ? !!(net.conn && net.conn.open) : netGuests() > 0;
}

function sendTo(conn, msg) {
  if (conn && conn.open) conn.send(msg);
}

// guest: to the host · host: to every guest in the room
function netSend(msg) {
  if (net.role === "guest") sendTo(net.conn, msg);
  else if (net.role === "host") net.conns.forEach((c) => sendTo(c, msg));
}

function netSendPos(conn) {
  if (net.role !== "host" || !state.pos) return;
  const p = state.pos;
  const msg = { t: "pos", pos: p.position_ms + (Date.now() - p.timestamp_ms) * p.speed, dur: state.trackDuration, playing: !!p.speed };
  if (conn) sendTo(conn, msg); else netSend(msg);
}

function inviteUrl() {
  return location.origin + location.pathname + "?join=" + net.code + (net.jam ? "&jam=" + encodeURIComponent(net.jam) : "");
}

// only pass along real Spotify links (open.spotify.com/socialsession/…, spotify.link/…)
function jamUrl(v) {
  try {
    const u = new URL(String(v || "").trim());
    return u.protocol === "https:" && /(^|\.)spotify\.(com|link)$|^spotify\.app\.link$/.test(u.hostname) ? u.href : "";
  } catch { return ""; }
}

function renderJam() {
  const host = net.role === "host", guest = net.role === "guest";
  const hostName = vs.players[0].name.trim() || "the host";
  els.jam.classList.toggle("show", host || guest);
  els.jamLink.hidden = !host;
  els.jamJoin.hidden = !(guest && net.jam);
  els.jamJoin.href = net.jam || "#";
  els.jamJoin.textContent = "🎧 Join " + (vs.players[0].name.trim() ? hostName + "'s" : "the host's") + " Spotify Jam";
  els.jamHint.hidden = !(guest && !net.jam);
  els.jamHint.textContent = "no Jam link yet — ask " + hostName + " to start a Spotify Jam so you hear the music";
  els.pubBtn.hidden = !host;
  els.pubBtn.disabled = !(net.peer && net.peer.open);
  els.pubBtn.setAttribute("aria-pressed", String(pub.on));
  els.pubBtn.textContent = pub.on ? (pub.slot >= 0 ? "🌍 Public — anyone can find this room" : "🌍 Listing…") : "🌍 List this room publicly";
  els.pubHint.hidden = !(host && pub.on && pub.slot >= 0);
  els.pubHint.textContent = net.jam ? "heads up: strangers can join your Jam too — check who can add songs in its settings"
    : "listed — add a Jam link above, or the people who join won't hear the music";
}

function renderNet() {
  const host = net.role === "host", guest = net.role === "guest", linked = netLinked();
  const open = host && net.peer && net.peer.open, friends = netGuests();
  els.netBtn.textContent = guest ? "Leave" : host ? "Stop" : "Host";
  els.netBtn.title = net.role ? "" : "Host an online room — up to " + MAX_PLAYERS + " players";
  els.roomsBtn.hidden = !!net.role;
  els.netInvite.hidden = !open;
  els.netLed.className = "led " + (linked ? "on" : net.role ? "wait" : "");
  els.netText.textContent =
    guest ? (linked ? "online · " + pname(0) + "'s room" + (vs.players.length > 2 ? " · " + vs.players.filter((p, i) => present(i)).length + " here" : "") : "joining room " + net.code + "…")
    : host ? (!open ? "opening a room…" : "room " + net.code + " · " + (friends ? friends + (friends === 1 ? " friend" : " friends") + " in" : "invite the Jam"))
    : "same device — or online";
  renderPlayers();
  renderJam();
}

function makeCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => abc[b % abc.length]).join("");
}

async function startHosting() {
  if (net.role) return;
  net.role = "host";
  renderNet();
  try { await loadPeerJs(); } catch (e) { net.role = null; renderNet(); setStatus("online play unavailable — " + e.message); return; }
  if (net.role !== "host") return;
  net.code = makeCode();
  net.jam = jamUrl(els.jamLink.value);
  // a new room is a new game: the host on seat 0, everyone else pulls up a chair as they join
  net.conns = [null]; net.seatOf = new Map();
  vs.players = [{ name: localPlayers()[0].name, points: 0, wins: 0 }];
  vs.guesses = [];
  updateScore();
  const peer = new Peer("gtt-" + net.code, peerOptions());
  net.peer = peer;
  peer.on("open", () => { console.log("[gtt] hosting room", net.code); renderNet(); });
  peer.on("connection", (conn) => {
    conn.on("data", (msg) => { try { onHostData(conn, msg); } catch (e) { console.error("[gtt] bad message", e); } });
    conn.on("close", () => hostDrop(conn));
  });
  peer.on("disconnected", () => { if (net.peer === peer && !peer.destroyed) peer.reconnect(); });
  peer.on("error", (e) => {
    console.error("[gtt] peer error", e.type, e);
    if (net.peer !== peer) return;
    if (e.type === "unavailable-id") { stopHosting(true); startHosting(); return; }
    if (e.type === "network" || e.type === "server-error" || e.type === "socket-error" || e.type === "browser-incompatible") {
      stopHosting(true); setStatus("couldn't open a room (" + e.type + ")");
    }
  });
  replayRound();
}

function stopHosting(quiet) {
  if (net.role !== "host") return;
  setPublic(false);
  netSend({ t: "bye" });
  const peer = net.peer;
  Object.assign(net, { role: null, peer: null, conns: [], seatOf: new Map(), code: null, lastResult: null, jam: "" });
  if (peer) setTimeout(() => peer.destroy(), 200);
  vs.players = localPlayers(); vs.guesses = [];
  updateScore();
  renderNet();
  if (!quiet) replayRound();
}

// a guest says hi (and again after every reload): give them a seat — their old one if they had one
function hostSeat(conn, msg) {
  const id = str(conn.metadata && conn.metadata.id, 40) || conn.peer;
  let seat = net.seatOf.get(id);
  if (seat === undefined) {
    if (vs.players.length >= MAX_PLAYERS) { sendTo(conn, { t: "full" }); setTimeout(() => conn.close(), 500); return; }
    seat = vs.players.push({ name: "", points: 0, wins: 0 }) - 1;
    net.seatOf.set(id, seat);
  }
  const old = net.conns[seat];
  net.conns[seat] = conn;
  if (old && old !== conn) old.close();
  const fresh = vs.players[seat].away !== false;
  vs.players[seat].name = str(msg.name, 12);
  vs.players[seat].away = false;
  netSync(conn, seat);
  netSend({ t: "players", players: vs.players });
  updateScore(); renderNet();
  if (fresh) setStatus(pname(seat) + " joined" + (state.track && !state.revealed && !vsMeLocked() ? " — go" : ""));
}

// a guest's link dropped: keep their seat and points for a rejoin, stop waiting on them
function hostDrop(conn) {
  const seat = net.conns.indexOf(conn);
  if (seat < 1) return;
  net.conns[seat] = null;
  vs.players[seat].away = true;
  netSend({ t: "players", players: vs.players });
  updateScore(); renderNet();
  setStatus(pname(seat) + " left — the invite still works");
  vsMaybeResolve();
}

// bring a (re)joining guest up to date
function netSync(conn, seat) {
  const send = (msg) => sendTo(conn, msg);
  send({ t: "hello", seat, players: vs.players, imode: state.imode, jam: net.jam });
  if (!state.track) return;
  const key = state.trackKey;
  if (state.revealed) {
    if (net.lastResult && net.lastResult.key === key) send(net.lastResult);
    return;
  }
  send({ t: "round", key, carry: "", players: vs.players });
  if (state.imode === "pick") {
    if (state.choicesFailed) send({ t: "choices", key, failed: true });
    else if (state.choice.opts) send({ t: "choices", key, opts: state.choice.opts });
  }
  vs.guesses.forEach((g, who) => { if (g) send({ t: "locked", key, who, verb: "locked in" }); });
  if (state.colors && state.colors.key === key) send({ t: "colors", key, colors: state.colors.colors });
  netSendPos(conn);
}

const BAD3 = ["bad", "bad", "bad"];
const str = (v, max = 200) => String(v == null ? "" : v).slice(0, max);

function onHostData(conn, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "sync") { hostSeat(conn, msg); return; }
  const seat = net.conns.indexOf(conn);
  if (seat < 1) return;
  if (msg.t === "bye") { conn.close(); return; }
  if (msg.t === "name") {
    vs.players[seat].name = str(msg.name, 12);
    netSend({ t: "players", players: vs.players });
    updateScore(); renderNet();
    return;
  }
  if (msg.t !== "guess" || msg.key !== state.trackKey || !state.track || state.revealed || vs.guesses[seat]) return;
  let marks = BAD3;
  if (msg.kind === "type") marks = gradeTyped(str(msg.a), str(msg.s), str(msg.y, 8));
  else if (msg.kind === "pick" && state.choice.accepted && Array.isArray(msg.picks)) {
    marks = state.choice.accepted.map((acc, i) => (acc.includes(str(msg.picks[i])) ? "ok" : "bad"));
  }
  vsLock(marks, msg.kind === "pass" ? "passed" : "locked in", seat);
}

function guestLock(guess) {
  net.myLocked = true;
  netSend({ t: "guess", key: state.trackKey, ...guess });
  showLocked(net.seat, guess.kind === "pass" ? "passed" : "locked in");
}

// guest: the host's roster is the truth, except for my own name
function setPlayers(players) {
  if (!Array.isArray(players) || !players.length) return;
  vs.players = players.slice(0, MAX_PLAYERS).map((p, i) => ({
    name: i === net.seat ? net.myName : str(p && p.name, 12),
    points: Number(p && p.points) || 0,
    wins: Number(p && p.wins) || 0,
    away: !!(p && p.away),
  }));
  updateScore();
}

function seatOk(v) {
  return Number.isInteger(v) && v >= 0 && v < vs.players.length;
}

function cleanTrack(t) {
  t = t || {};
  const art = str(t.artUrl, 500);
  return {
    artists: Array.isArray(t.artists) ? t.artists.map((a) => str(a)) : [],
    song: str(t.song),
    third: { label: "year", answer: Number(t.third && t.third.answer) || 0 },
    artUrl: art.startsWith("https://") ? art : null,
    album: str(t.album),
    duration: Number(t.duration) || 0,
  };
}

function onGuestData(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "hello":
      if (!Number.isInteger(msg.seat) || msg.seat < 1 || msg.seat >= MAX_PLAYERS) break;
      net.synced = true;
      net.seat = msg.seat;
      if (jamUrl(msg.jam)) net.jam = jamUrl(msg.jam);
      setPlayers(msg.players);
      if (msg.imode === "type" || msg.imode === "pick") setImode(msg.imode);
      renderNet();
      break;
    case "players":
      setPlayers(msg.players);
      renderNet();
      break;
    case "jam":
      net.jam = jamUrl(msg.url);
      renderJam();
      break;
    case "imode":
      if (msg.imode === "type" || msg.imode === "pick") setImode(msg.imode);
      break;
    case "round":
      setPlayers(msg.players);
      newRound({ pending: true }, str(msg.key), str(msg.carry));
      break;
    case "choices":
      if (msg.key !== state.trackKey || state.revealed) break;
      if (msg.failed || !Array.isArray(msg.opts)) { state.choicesFailed = true; applyInputUI(); break; }
      state.choice = { stage: 0, opts: msg.opts.slice(0, 3).map((o) => (Array.isArray(o) ? o.slice(0, 6).map((x) => str(x)) : [])), accepted: null, results: [], picks: [] };
      applyInputUI();
      if (!net.myLocked) renderStage();
      break;
    case "locked":
      if (msg.key !== state.trackKey || state.revealed || !seatOk(msg.who)) break;
      if (msg.who === net.seat) net.myLocked = true;
      showLocked(msg.who, msg.verb === "passed" ? "passed" : "locked in");
      break;
    case "colors":
      if (msg.key !== state.trackKey || !Array.isArray(msg.colors)) break;
      if (msg.colors.length === 2 && msg.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))) setLabelColors(msg.colors);
      break;
    case "pos":
      state.trackDuration = Number(msg.dur) || 0;
      state.pos = { position_ms: Number(msg.pos) || 0, timestamp_ms: Date.now(), speed: msg.playing ? 1 : 0 };
      setPlaying(!!msg.playing);
      break;
    case "result": {
      if (msg.key !== state.trackKey || state.revealed) break;
      state.track = cleanTrack(msg.track);
      setPlayers(msg.players);
      vs.guesses = [];
      (Array.isArray(msg.guesses) ? msg.guesses : []).slice(0, vs.players.length).forEach((g, i) => {
        if (!g || typeof g !== "object") return;
        vs.guesses[i] = { marks: [0, 1, 2].map((k) => (["ok", "close", "bad"].includes(g.marks && g.marks[k]) ? g.marks[k] : "bad")), earned: Number(g.earned) || 0 };
      });
      vsShowResult(seatOk(msg.w) && vs.guesses[msg.w] ? msg.w : -1, str(msg.msg));
      break;
    }
    case "skip":
      if (msg.key !== state.trackKey || state.revealed) break;
      state.track = cleanTrack(msg.track);
      finish("skipped — no contest", false, "skipped");
      break;
    case "full":
      net.synced = net.closedByHost = true;
      setStatus("that room's full — " + MAX_PLAYERS + " players max");
      break;
    case "bye":
      net.closedByHost = true;
      setStatus(pname(0) + " closed the room");
      break;
  }
}

async function startGuest(code, jam) {
  net.role = "guest"; net.code = code; net.jam = jamUrl(jam);
  net.myName = localPlayers()[1].name;
  state.mode = "guest";
  vs.on = true;
  vs.players = [{ name: "", points: 0, wins: 0 }]; // the host's seat, until they say hello
  els.app.classList.add("vs", "guest");
  renderModeBtn();
  setConn("wait", "no Spotify needed — the host is playing");
  setStatus("joining room " + code + "…");
  renderNet();
  try { await loadPeerJs(); } catch (e) { setStatus("can't go online — " + e.message); return; }
  const peer = new Peer(undefined, peerOptions());
  net.peer = peer;
  peer.on("open", () => {
    const conn = peer.connect("gtt-" + code, { reliable: true, metadata: { id: deviceId() } });
    net.conn = conn;
    conn.on("open", () => {
      setConn("on", "listening along with the host");
      setStatus("joined — waiting for the next song");
      const askSync = () => { if (!net.synced && net.conn === conn && conn.open) { netSend({ t: "sync", name: net.myName }); setTimeout(askSync, 2500); } };
      askSync();
      renderNet();
    });
    conn.on("data", (msg) => { try { onGuestData(msg); } catch (e) { console.error("[gtt] bad message", e); } });
    conn.on("close", () => {
      setConn("off", "disconnected"); renderNet();
      if (!net.closedByHost) setStatus("lost the room — reload the invite to rejoin");
    });
  });
  peer.on("error", (e) => {
    console.error("[gtt] peer error", e.type, e);
    if (e.type === "peer-unavailable") setStatus("no room " + code + " — check the invite");
    else setStatus("connection problem (" + e.type + ") — reload to retry");
    renderNet();
  });
}

let tabId = null;
function deviceId() {
  try {
    let id = localStorage.getItem("gtt_device");
    if (!id) { id = makeCode() + makeCode(); localStorage.setItem("gtt_device", id); }
    return id;
  } catch { return tabId ||= "t" + makeCode() + makeCode(); } // no storage: still unique, so nobody steals a seat
}

// WebRTC can take ~30s to notice a closed tab, so say goodbye explicitly
addEventListener("pagehide", () => netSend({ t: "bye" }));

function leaveRoom() {
  if (net.peer) net.peer.destroy();
  location.href = location.pathname;
}

els.jamLink.addEventListener("input", () => {
  const v = els.jamLink.value.trim(), url = jamUrl(v);
  els.jamLink.classList.toggle("ok", !!url);
  els.jamLink.classList.toggle("bad", !!v && !url);
  if (net.role !== "host" || url === net.jam || (v && !url)) return;
  net.jam = url;
  netSend({ t: "jam", url });
  if (url) setStatus(netLinked() ? "Jam link sent to everyone in the room" : "Jam link added to the invite");
});

els.netBtn.onclick = () => {
  if (net.role === "guest") leaveRoom();
  else if (net.role === "host") stopHosting();
  else startHosting();
};
els.netInvite.onclick = async () => {
  const url = inviteUrl();
  const nav = els.app.ownerDocument.defaultView.navigator;
  try {
    if (nav.share && matchMedia("(pointer: coarse)").matches) await nav.share({ title: "Guess the Track", text: "Join my Guess the Track room" + (net.jam ? " — the Spotify Jam button is inside" : ""), url });
    else { await nav.clipboard.writeText(url); setStatus("invite link copied — drop it in the Jam chat, up to " + (MAX_PLAYERS - 1) + " friends can join"); }
  } catch {
    setStatus("invite: " + url);
  }
};
