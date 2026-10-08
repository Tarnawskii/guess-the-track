// ---------- Spotify: login (PKCE), token refresh, polling what's playing, skip ----------
// progress bar ticker; interpolates from last known spotify position
setInterval(() => {
  if (state.pos && state.trackDuration) {
    const elapsed = state.pos.position_ms + (Date.now() - state.pos.timestamp_ms) * (state.pos.speed || 0);
    setProgress(elapsed, state.trackDuration);
    syncKaraoke(elapsed);
  }
}, 250);

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: "Bearer " + state.token } });
  if (res.status === 401 && await refreshAccessToken()) return api(url, opts);
  return res;
}

function trackFromItem(item) {
  return {
    artists: item.artists.map((a) => a.name),
    song: item.name,
    third: { label: "year", answer: parseInt(((item.album && item.album.release_date) || "0").slice(0, 4), 10) },
    artUrl: (item.album && item.album.images && item.album.images[0]) ? item.album.images[0].url : null,
    albumId: item.album ? item.album.id : null,
    url: item.external_urls ? item.external_urls.spotify : "",
    uri: item.uri || "",
    album: item.album ? item.album.name : "",
    duration: item.duration_ms || 0,
  };
}

async function pollSpotify() {
  try {
    const res = await api("https://api.spotify.com/v1/me/player/currently-playing");
    if (res.status === 204) { setStatus("nothing playing — start a song in Spotify"); setPlaying(false); state.lastPoll = Date.now(); return; }
    if (!res.ok) {
      setConn("off", "error " + res.status);
      if (res.status === 401) setStatus("Spotify login expired — hit reconnect");
      return;
    }
    state.lastPoll = Date.now();
    const data = await res.json();
    if (!data || !data.item) { console.log("[gtt] poll ok, no item"); return; }
    console.log("[gtt] poll ok, item:", data.item.id, "playing:", !!data.is_playing);
    const item = data.item;
    const key = item.id;
    state.context = data.context ? data.context.uri : null;
    // Heardle just asked Spotify for a new song; until it's actually on, the old one is stale news
    if (state.expect) {
      if (key === state.expect.key || Date.now() > state.expect.until) state.expect = null;
      else return;
    }
    if (key !== state.trackKey) newRound(trackFromItem(item), key);
    state.trackDuration = item.duration_ms || 0;
    // right after a tap on the record, Spotify may not have caught up yet: trust the tap for a moment
    if (Date.now() > (state.tapHold || 0)) {
      setPlaying(!!data.is_playing);
      state.pos = { position_ms: data.progress_ms || 0, timestamp_ms: Date.now(), speed: data.is_playing ? 1 : 0 };
    }
    netSendPos();
  } catch (e) {
    setStatus("connection glitch — retrying");
    setConn("off", "offline");
  }
}

async function startSpotify() {
  if (!CONFIG.spotifyClientId) {
    setStatus("set spotifyClientId in CONFIG (top of file)");
    console.error("[gtt] no client id configured");
    return;
  }
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  console.log("[gtt] startSpotify: code on url:", !!code, "storage url:", localStorage.getItem("pip_widget_auth") ? "token cached" : "no token");
  if (code) {
    history.replaceState(null, "", location.pathname);
    console.log("[gtt] exchanging code for token…");
    if (!await exchangeCode(code)) return;
  } else if (!loadToken()) {
    console.log("[gtt] no token, redirecting to spotify login");
    setStatus("heading to Spotify login…");
    await redirectToSpotify();
    return;
  }
  state.mode = "spotify";
  applyInputUI();
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pos = null; state.trackDuration = 0;
  setConn("wait", "connecting…");
  try {
    const me = await api("https://api.spotify.com/v1/me");
    if (me.ok) { const u = await me.json(); state.userName = u.display_name || u.id; }
  } catch {}
  console.log("[gtt] spotify mode starting");
  if (sessionStorage.getItem("gtt_radar_login")) { sessionStorage.removeItem("gtt_radar_login"); setRadarOpen(true); }
  setStatus("listening…");
  pollSpotify();
  state.pollTimer = setInterval(pollSpotify, CONFIG.pollMs);
  setPollRate();
}

function loadToken() {
  try {
    const raw = localStorage.getItem("pip_widget_auth");
    if (!raw) return false;
    const auth = JSON.parse(raw);
    if (auth.expiresAt && Date.now() > auth.expiresAt - 30000) return false;
    if (auth.scope === undefined) return false; // saved before Skip needed playback control
    state.token = auth.access;
    return true;
  } catch { return false; }
}

async function saveAuth(auth) {
  state.token = auth.access_token;
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem("pip_widget_auth")) || {}; } catch {}
  localStorage.setItem("pip_widget_auth", JSON.stringify({
    scope: auth.scope || prev.scope || "",
    access: auth.access_token,
    refresh: auth.refresh_token || prev.refresh,
    expiresAt: Date.now() + (auth.expires_in || 3600) * 1000,
  }));
}

async function redirectToSpotify() {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(64))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  sessionStorage.setItem("pip_widget_verifier", verifier);
  const q = new URLSearchParams({
    client_id: CONFIG.spotifyClientId,
    response_type: "code",
    redirect_uri: CONFIG.redirectUri,
    scope: CONFIG.scopes,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  location.href = "https://accounts.spotify.com/authorize?" + q.toString();
}

async function exchangeCode(code) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CONFIG.redirectUri,
      client_id: CONFIG.spotifyClientId,
      code_verifier: sessionStorage.getItem("pip_widget_verifier") || "",
    }),
  });
  if (res.ok) { await saveAuth(await res.json()); return true; }
  const body = await res.text();
  console.error("[gtt] token exchange failed:", res.status, body);
  setStatus("auth failed (" + res.status + ") — hit reconnect to retry");
  return false;
}

async function refreshAccessToken() {
  try {
    const raw = localStorage.getItem("pip_widget_auth");
    if (!raw) return false;
    const auth = JSON.parse(raw);
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
        client_id: CONFIG.spotifyClientId,
      }),
    });
    if (!res.ok) return false;
    await saveAuth(await res.json());
    return true;
  } catch { return false; }
}

els.check.onclick = check;
els.reveal.onclick = reveal;
// skip = give up on this song (if it's still open) and jump to the next one in Spotify
els.skip.onclick = () => {
  if (net.role === "guest" || state.mode !== "spotify") return;
  if (activeGame() === "heardle") { heardleNext(); return; }
  if (state.track && !state.revealed) {
    if (vs.on) {
      setTurnHighlight(-1);
      finish("skipped — no contest", false, "skipped");
      if (net.role === "host") netSend({ t: "skip", key: state.trackKey, track: state.track });
    } else { state.rounds += 1; state.streak = 0; finish("skipped", false, "skipped"); }
  }
  skipTrack();
};

async function skipTrack() {
  if (els.skip.disabled) return;
  els.skip.disabled = true;
  try {
    const res = await api("https://api.spotify.com/v1/me/player/next", { method: "POST" });
    if (res.ok) {
      // Spotify takes a beat to report the new song
      setTimeout(pollSpotify, 500); setTimeout(pollSpotify, 1500);
      return;
    }
    let err = {};
    try { err = (await res.json()).error || {}; } catch {}
    console.error("[gtt] skip failed:", res.status, err);
    if (res.status === 401 || /scope/i.test(err.message || "")) setStatus("can't skip — hit reconnect to give it permission");
    else if (res.status === 403) setStatus("skipping needs Spotify Premium — skip in Spotify instead");
    else if (res.status === 404) setStatus("no active Spotify player — press play in Spotify first");
    else if (res.status === 429) setStatus("easy there — Spotify says slow down");
    else setStatus("couldn't skip (" + res.status + ")");
  } catch {
    setStatus("couldn't reach Spotify to skip");
  } finally {
    setTimeout(() => { els.skip.disabled = false; }, 800);
  }
}
[els.artist, els.song, els.year].forEach((input, i, all) => {
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = all.slice(i + 1).find((n) => !n.readOnly && n.offsetParent !== null); // Heardle hides the year
    if (next) next.focus(); else check();
  });
});
els.app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); }
});
