// ---------- start: a guest joining a room, the lobby, or (normally) Spotify ----------
const params = new URL(location.href).searchParams;
const joinCode = params.get("join");
if (joinCode) startGuest(joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8), params.get("jam"));
else if (params.has("rooms")) {
  // browse without logging in to Spotify: joining a room doesn't need it
  state.mode = "lobby";
  els.app.classList.add("lobby");
  setConn("off", "not logged in — joining doesn't need Spotify");
  setStatus("pick a room to join");
  setLobbyOpen(true);
} else {
  if (params.has("tv")) { // ?tv=1 turns the TV on, ?tv=big straight onto the big screen
    try { sessionStorage.setItem("gtt_open_tv", params.get("tv") === "big" ? "big" : "1"); } catch {}
    history.replaceState(null, "", location.pathname);
  }
  startSpotify().then(() => {
    let want = null;
    try { want = sessionStorage.getItem("gtt_open_tv"); } catch {}
    if (!want || state.mode !== "spotify") return;
    try { sessionStorage.removeItem("gtt_open_tv"); } catch {}
    openTV({ big: want === "big" });
  });
}
renderNet();
