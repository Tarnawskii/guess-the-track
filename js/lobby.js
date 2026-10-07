// ---------- public rooms: a serverless lobby on well-known PeerJS ids ----------
// a public room also claims one of LOBBY_SLOTS lobby ids and answers anyone who knocks with
// what's on; the room browser knocks on every slot and lists whoever answers

function setPublic(on) {
  pub.on = on && net.role === "host";
  if (pub.on) claimSlot(0, Math.floor(Math.random() * LOBBY_SLOTS)); else dropSlot();
  renderJam();
}

function dropSlot() {
  if (pub.peer) pub.peer.destroy();
  pub.peer = null; pub.slot = -1;
}

// try slots from a random start so two hosts don't fight over slot 0
function claimSlot(tries, start) {
  dropSlot();
  if (!pub.on || net.role !== "host") return;
  if (tries >= LOBBY_SLOTS) {
    pub.on = false; renderJam();
    setStatus("the public lobby is full — share the invite link instead");
    return;
  }
  const slot = (start + tries) % LOBBY_SLOTS;
  const peer = new Peer(lobbyId(slot), peerOptions());
  pub.peer = peer;
  peer.on("open", () => {
    if (pub.peer !== peer) return;
    pub.slot = slot; renderJam();
    console.log("[gtt] listed publicly in slot", slot);
    setStatus("room listed — anyone can find it under VS → 🌍 Find");
  });
  // a message sent the instant a channel opens can get lost, so the browser keeps asking until it hears back
  peer.on("connection", (conn) => {
    conn.on("open", () => { sendTo(conn, roomInfo()); setTimeout(() => conn.close(), 4000); });
    conn.on("data", (m) => { if (m && m.t === "who") sendTo(conn, roomInfo()); });
  });
  peer.on("disconnected", () => { if (pub.peer === peer && !peer.destroyed) peer.reconnect(); });
  peer.on("error", (e) => {
    if (pub.peer !== peer) return;
    if (e.type === "unavailable-id") { claimSlot(tries + 1, start); return; }
    console.error("[gtt] lobby error", e.type, e);
    if (e.type === "network" || e.type === "server-error" || e.type === "socket-error" || e.type === "browser-incompatible") {
      pub.on = false; dropSlot(); renderJam();
      setStatus("couldn't list the room (" + e.type + ")");
    }
  });
}

function roomInfo() {
  return {
    t: "room", v: 1, code: net.code, name: pname(0), imode: state.imode, jam: net.jam,
    players: vs.players.filter((p, i) => present(i)).length, full: vs.players.length >= MAX_PLAYERS,
  };
}

function cleanRoom(m) {
  if (!m || typeof m !== "object" || m.t !== "room") return null;
  const code = str(m.code, 8).toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return null;
  return {
    code, name: str(m.name, 12).trim() || "someone", jam: jamUrl(m.jam), imode: m.imode === "pick" ? "pick" : "type",
    players: Math.max(1, Math.min(MAX_PLAYERS, Math.floor(Number(m.players)) || 1)), full: !!m.full,
  };
}

async function scanRooms() {
  if (lobby.scanning) return;
  lobby.rooms.clear(); lobby.error = ""; lobby.scanning = true;
  renderLobby();
  try { await loadPeerJs(); } catch (e) { lobby.scanning = false; lobby.error = "can't look for rooms — " + e.message; renderLobby(); return; }
  const peer = new Peer(undefined, peerOptions());
  lobby.peer = peer;
  const pending = new Set();
  let timer = 0;
  const done = () => {
    if (lobby.peer !== peer) return;
    clearTimeout(timer);
    lobby.peer = null; lobby.scanning = false;
    setTimeout(() => peer.destroy(), 500);
    renderLobby();
  };
  const settle = (i) => { pending.delete(i); if (!pending.size) done(); };
  peer.on("open", () => {
    for (let i = 0; i < LOBBY_SLOTS; i++) {
      pending.add(i);
      const conn = peer.connect(lobbyId(i), { reliable: true });
      let ask = 0;
      conn.on("open", () => {
        const who = () => { if (conn.open && pending.has(i)) { sendTo(conn, { t: "who" }); ask = setTimeout(who, 600); } };
        who();
      });
      conn.on("data", (m) => {
        const room = cleanRoom(m);
        if (!room) return;
        clearTimeout(ask);
        if (lobby.peer === peer) { lobby.rooms.set(room.code, room); renderLobby(); }
        settle(i); conn.close();
      });
      conn.on("close", () => { clearTimeout(ask); settle(i); });
    }
    // empty slots report back once the PeerJS server gives up on them (~5s); this catches a slot whose WebRTC never connects
    timer = setTimeout(done, 8000);
  });
  peer.on("error", (e) => {
    const m = /gtt-lobby-v1-(\d+)/.exec(e.message || "");
    if (e.type === "peer-unavailable") { if (m) settle(Number(m[1])); return; } // empty slot
    console.error("[gtt] lobby scan error", e.type, e);
    lobby.error = "couldn't reach the lobby (" + e.type + ")";
    done();
  });
}

function joinUrl(code, jam) {
  return location.pathname + "?join=" + code + (jam ? "&jam=" + encodeURIComponent(jam) : "");
}

function renderLobby() {
  els.lobby.classList.toggle("show", lobby.open);
  els.roomsBtn.setAttribute("aria-pressed", String(lobby.open));
  if (!lobby.open) return;
  els.lobbyRefresh.disabled = lobby.scanning;
  els.lobbyLogin.hidden = state.mode !== "lobby";
  els.lobbyClose.hidden = state.mode === "lobby"; // nothing else to do here without Spotify
  const rooms = [...lobby.rooms.values()].sort((a, b) => b.players - a.players);
  els.lobbyList.replaceChildren(...rooms.map((r) => {
    const row = document.createElement("div");
    row.className = "room";
    const txt = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = r.name + "'s room";
    const meta = document.createElement("span");
    meta.textContent = r.players + (r.players === 1 ? " player" : " playing") + " · " + (r.imode === "pick" ? "Pick 6" : "Type")
      + " · " + (r.jam ? "🎧 Jam" : "no Jam yet");
    txt.append(name, meta);
    const b = document.createElement("button");
    b.type = "button";
    const mine = net.role === "host" && r.code === net.code;
    b.textContent = mine ? "Yours" : r.full ? "Full" : "Join";
    b.disabled = mine || r.full;
    b.onclick = () => { if (net.peer) net.peer.destroy(); location.href = joinUrl(r.code, r.jam); };
    row.append(txt, b);
    return row;
  }));
  els.lobbyNote.textContent = lobby.scanning ? "looking for rooms…" : lobby.error
    || (rooms.length ? "" : "no public rooms right now — host one: VS → Host → 🌍");
  els.lobbyNote.hidden = !els.lobbyNote.textContent;
}

function setLobbyOpen(open) {
  lobby.open = open;
  renderLobby();
  if (open) scanRooms();
}

els.pubBtn.onclick = () => setPublic(!pub.on);
els.roomsBtn.onclick = () => setLobbyOpen(!lobby.open);
els.lobbyRefresh.onclick = scanRooms;
els.lobbyClose.onclick = () => setLobbyOpen(false);
els.lobbyLogin.onclick = () => { location.href = location.pathname; };
