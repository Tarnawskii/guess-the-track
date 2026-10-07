// ---------- Just listen: the retro TV (its own pop-out window, or a full-page overlay where there's no PiP) ----------
const tv = { clean: false, open: false, ch: 1, pip: null, key: null, queue: [], queueAt: 0, queueBusy: false, radarAsked: false, timer: 0, osdTimer: 0, fx: false };
// the picture tube: a soft, warm, ghosty 70s set, the 80s one, or a sharp, vivid, flat 90s one
const TV_ERAS = { 70: { lines: 180, gap: 0.42 }, 80: { lines: 220, gap: 0.4 }, 90: { lines: 300, gap: 0.34 } };
tv.era = 80;
try { const e = Number(localStorage.getItem("gtt_tv_era")); if (TV_ERAS[e]) tv.era = e; } catch {}
try { tv.fx = localStorage.getItem("gtt_tv_fx") === "1"; tv.clean = localStorage.getItem("gtt_tv_clean") === "1"; } catch {}
const TV_CHANNELS = { 1: "NOW", 2: "TEXT", 3: "QUEUE", 4: "COVER" };
try { const c = Number(localStorage.getItem("gtt_tv_ch")); if (TV_CHANNELS[c]) tv.ch = c; } catch {} // the TV remembers its channel
// grabbed once: after the TV moves into its pop-out window, document.getElementById can't find it any more
const T = {
  layer: $("tvLayer"), box: $("tv"), screen: $("tvScreen"), now: $("tvNow"), fresh: $("tvNew"), queue: $("tvQueue"), cover: $("tvCover"), art: $("tvArt"), cap: $("tvCap"),
  snow: $("tvStatic"), osd: $("tvOsd"), led: $("tvLed"), lines: $("tvLines"),
};

function copyStylesTo(doc) {
  for (const sheet of document.styleSheets) {
    try {
      const style = doc.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      doc.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = doc.createElement("link");
      link.rel = "stylesheet"; link.href = sheet.href;
      doc.head.appendChild(link);
    }
  }
}

async function openTV() {
  setMenuOpen(false);
  if (tv.open || state.mode !== "spotify") return;
  if (activeGame() === "heardle") setGame("quiz"); // Heardle would keep pausing the music
  tv.open = true;
  const box = T.box;
  tvShowChannel();
  box.classList.toggle("strong", tv.fx);
  box.querySelector('[data-tv="fx"]').setAttribute("aria-pressed", String(tv.fx));
  // a pop-out window needs a click to open; from the home screen shortcut there isn't one, so that's the full-page TV
  const tapped = !navigator.userActivation || navigator.userActivation.isActive;
  if ("documentPictureInPicture" in window && tapped) {
    try {
      if (documentPictureInPicture.window) documentPictureInPicture.window.close(); // one pop-out at a time
      const w = await documentPictureInPicture.requestWindow({ width: 440, height: 400 });
      copyStylesTo(w.document);
      w.document.title = "Groovtron";
      w.document.body.classList.add("tv-pip");
      w.document.body.append(box);
      w.addEventListener("resize", tvScanlines);
      w.document.addEventListener("keydown", tvKeys);
      tv.pip = w;
      w.addEventListener("pagehide", () => { T.layer.append(box); tv.pip = null; tvStopped(); });
    } catch (e) {
      console.error("[gtt] tv pip", e);
      tv.pip = null;
    }
  }
  if (!tv.pip) {
    T.layer.classList.add("show"); T.layer.setAttribute("aria-hidden", "false");
    vpipPrepare(); // no Document PiP here (iPhone, Safari): offer video PiP instead
    T.box.querySelector('[data-tv="pip"]').hidden = !vpip.video;
  }
  tvScanlines();
  setTimeout(tvScanlines, 800); // again once the power-on and fonts have settled
  tv.key = null;
  tv.forYouAsked = tv.chartsAsked = false; // stale pages reload when the TV comes back on
  tvPower(true);
  tvTick();
  tvStartTicker();
  tvLoadQueue();
}

function closeTV() {
  if (!tv.open) return;
  tvPower(false);
  setTimeout(() => {
    if (tv.pip) tv.pip.close(); // its pagehide puts the TV back and stops it
    else { T.layer.classList.remove("show"); T.layer.setAttribute("aria-hidden", "true"); tvStopped(); }
  }, reduceMotion.matches ? 0 : 430);
}

function tvStartTicker() {
  if (tv.timer) (tv.timerWin || window).clearInterval(tv.timer);
  tv.timerWin = tvWin();
  tv.timer = tv.timerWin.setInterval(tvTick, 250);
}

function tvStopped() {
  tv.open = false;
  try { (tv.timerWin || window).clearInterval(tv.timer); } catch {}
  tv.timer = 0;
  vpipStop();
}

// scanlines, one canvas row per physical pixel and nudged onto the pixel grid, so they stay crisp lines at any
// display scaling (100%, 125%, 150%, retina) instead of smearing into grey or flicker
function tvScanlines() {
  const win = T.screen.ownerDocument.defaultView;
  const dpr = win.devicePixelRatio || 1;
  const r = T.screen.getBoundingClientRect();
  if (!r.height) return;
  const H = Math.round(r.height * dpr) + 2;
  const look = TV_ERAS[tv.era];
  const pitch = Math.max(dpr < 1.5 || tv.era === 90 ? 2 : 3, Math.round((r.height * dpr) / look.lines)); // device pixels per line
  const gap = Math.max(1, Math.round(pitch * look.gap));
  const c = T.lines;
  c.width = 1;
  c.height = H;
  c.style.height = H / dpr + "px";
  const ctx = c.getContext("2d");
  for (let y = 0; y < H; y++) {
    const i = y % pitch;
    // lit rows, a softer row either side of the gap when there's room for one, then the dark gap
    const v = i >= pitch - gap ? 58 : pitch >= 4 && (i === 0 || i === pitch - gap - 1) ? 190 : 255;
    ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
    ctx.fillRect(0, y, 1, 1);
  }
  const frac = (r.top * dpr) % 1; // the screen can sit between physical pixels; line the rows up anyway
  c.style.transform = frac > 0.001 ? "translateY(" + (-frac / dpr).toFixed(4) + "px)" : "";
  T.screen.style.setProperty("--gap", gap / dpr + "px");
}

function tvPower(on) {
  const screen = T.screen;
  const led = T.led;
  led.classList.toggle("standby", !on);
  screen.classList.remove("power-on", "power-off");
  void screen.offsetWidth;
  if (!reduceMotion.matches) {
    screen.classList.add(on ? "power-on" : "power-off");
    if (on) {
      const done = () => { screen.classList.remove("power-on"); tvPlaceArt(); };
      screen.querySelector(".tv-content").addEventListener("animationend", done, { once: true });
      tvWin().setTimeout(done, 900);
    }
  }
  if (on) tvOsd("CH " + tv.ch + " " + TV_CHANNELS[tv.ch]);
}

function tvOsd(text) {
  const osd = T.osd;
  osd.textContent = text;
  osd.classList.remove("show");
  void osd.offsetWidth; // restart the fade
  osd.classList.add("show");
}

// a burst of snow, drawn on a tiny canvas and blown up pixelated
// The deadline is measured on the TV window's own clock: in the pop-out window, rAF timestamps count from when
// that window opened, so mixing them with the main page's clock kept the snow (and the hidden cover) up for
// as long as the page had been open before the TV popped out. A safety timer ends it regardless.
function tvStatic(ms = 320) {
  if (tv.era === 90) { tvBlank(Math.min(ms, 280)); return; }
  if (tv.era === 70) ms = Math.max(ms, 450); // an old tuner takes its time
  if (reduceMotion.matches) return;
  const c = T.snow;
  const win = c.ownerDocument.defaultView;
  if (!win || c.ownerDocument.hidden) return; // rAF doesn't run in a hidden window, so the snow couldn't stop
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(c.width, c.height);
  const end = win.performance.now() + ms;
  const id = (tv.snowId = (tv.snowId || 0) + 1);
  const stop = () => { if (tv.snowId !== id) return; c.classList.remove("burst"); T.screen.classList.remove("snowing"); };
  c.classList.add("burst");
  T.screen.classList.add("snowing");
  const frame = () => {
    if (tv.snowId !== id) return; // a newer burst took over
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (win.performance.now() < end) win.requestAnimationFrame(frame);
    else stop();
  };
  win.requestAnimationFrame(frame);
  win.setTimeout(stop, ms + 400);
}

// timers on the TV's own window: a background tab gets its timers throttled (to once a minute after a while),
// but the pop-out window is on screen
function tvWin() {
  return T.box.ownerDocument.defaultView || window;
}

// a 90s set mutes the picture to black between channels and songs instead of showing snow
function tvBlank(ms) {
  const s = T.screen;
  const id = (tv.blankId = (tv.blankId || 0) + 1);
  s.classList.add("blanking");
  tvWin().setTimeout(() => { if (tv.blankId === id) s.classList.remove("blanking"); }, ms);
}

// a 70s set loses vertical hold for a moment when you change channel
function tvRoll() {
  if (reduceMotion.matches) return;
  const s = T.screen;
  s.classList.remove("rolling");
  void s.offsetWidth;
  s.classList.add("rolling");
  tvWin().setTimeout(() => s.classList.remove("rolling"), 600);
}

function tvSetEra(era) {
  tv.era = era;
  try { localStorage.setItem("gtt_tv_era", String(era)); } catch {}
  tvShowEra();
  tvScanlines();
  tvStatic(300);
  tvOsd(era + "s");
  tvTick(true);
}

function tvShowEra() {
  T.box.dataset.era = String(tv.era);
  const b = T.box.querySelector('[data-tv="era"]');
  if (!b) return;
  b.textContent = "'" + tv.era;
  b.title = "Picture tube: " + tv.era + "s (tap for the next decade)";
}

function tvSetChannel(ch) {
  if (tv.ch === ch) return;
  tv.ch = ch;
  try { localStorage.setItem("gtt_tv_ch", String(ch)); } catch {}
  tvShowChannel();
  tvStatic(260);
  if (tv.era === 70) tvRoll();
  tvOsd("CH " + ch + " " + TV_CHANNELS[ch]);
  if ((ch === 3 || (ch === 2 && tv.page === 400)) && Date.now() - tv.queueAt > 5000) tvLoadQueue();
  tvTick(true);
  tvPlaceArt();
}

function tvShowChannel() {
  T.box.dataset.ch = String(tv.ch);
  T.box.querySelectorAll(".tv-btn[data-ch]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.ch) === tv.ch)));
}

function tvTick(force) {
  if (!tv.open) return;
  // the main page's poll gets throttled when its tab is in the background; the TV fetches for itself then
  if (state.mode === "spotify" && Date.now() - state.lastPoll > CONFIG.pollMs + 1500 && Date.now() - (tv.pollAt || 0) > CONFIG.pollMs) {
    tv.pollAt = Date.now();
    pollSpotify();
  }
  const t = state.track;
  if (state.trackKey !== tv.key) {
    const first = tv.key === null;
    tv.key = state.trackKey;
    if (!first) { tvStatic(); setTimeout(tvLoadQueue, 900); }
    tvRenderNow(true);
    if (tv.ch === 3) tvRenderQueue();
    if (tv.ch === 2) tvRenderText(true);
    if (tv.ch === 4) tvRenderCover(true);
  }
  if (tv.ch === 1) tvRenderNow(force);
  if (tv.ch === 4) tvRenderCover(force);
  if (tv.ch === 2) tvRenderText(force);
  if ((tv.ch === 3 || (tv.ch === 2 && tv.page === 400)) && Date.now() - tv.queueAt > 20000) tvLoadQueue();
  if (!t && (tv.ch === 1 || tv.ch === 4)) { T.art.classList.remove("has"); tvNoSignal(tv.ch === 1 ? T.now : T.cover, "NO SIGNAL"); }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function tvNoSignal(box, label) {
  if (box.dataset.view === "nosignal:" + label + tv.era) return;
  box.dataset.view = "nosignal:" + label + tv.era;
  if (tv.era === 90) { // the 90s answer to nothing on: a blue screen
    const blue = el("div", "bluescreen");
    blue.append(el("b", "", label));
    box.replaceChildren(blue);
    return;
  }
  const card = el("div", "testcard");
  const bars = el("div", "bars");
  for (let i = 0; i < 7; i++) bars.append(el("i"));
  card.append(bars, el("span"), el("b", "", label));
  box.replaceChildren(card);
}

function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

// CH1: the cover, the names, and a VHS counter
function tvRenderNow(force) {
  const box = T.now;
  const t = state.track;
  if (!t) return;
  if (force || box.dataset.view !== "now:" + tv.key) {
    box.dataset.view = "now:" + tv.key;
    const top = el("div", "vhs-top");
    top.append(el("span", "vhs-state"), el("span", "", "SP"));
    const main = el("div", "now-main");
    const art = el("div", "now-slot");
    const text = el("div", "now-text");
    text.append(el("div", "now-song", t.song), el("div", "now-artist", t.artists.join(", ")), el("div", "now-album", t.album || ""));
    main.append(art, text);
    const bottom = el("div", "vhs-bottom");
    bottom.append(el("span", "vhs-time"), el("span", "vhs-bar"));
    if (t.url) {
      // content from Spotify, credited and linked back to it
      const credit = el("a", "", "SPOTIFY ↗");
      credit.href = t.url; credit.target = "_blank"; credit.rel = "noopener noreferrer";
      credit.title = "Listen on Spotify";
      bottom.append(credit);
    }
    box.replaceChildren(top, main, bottom);
    if (t.artUrl) { T.art.src = t.artUrl; T.art.classList.add("has"); } else T.art.classList.remove("has");
    tvPlaceArt();
  }
  const playing = els.stage.classList.contains("playing");
  const stateEl = box.querySelector(".vhs-state");
  stateEl.textContent = playing ? "▶ PLAY" : "❚❚ PAUSE";
  stateEl.classList.toggle("pause", !playing);
  const at = Math.min(currentElapsed(), state.trackDuration || 0);
  box.querySelector(".vhs-time").textContent = hms(at);
  box.querySelector(".vhs-bar").style.setProperty("--p", (state.trackDuration ? Math.min(100, (at / state.trackDuration) * 100) : 0).toFixed(1) + "%");
}

// the cover lives outside the effects layer, over the empty slot CH1 leaves for it
function tvPlaceArt() {
  if (tv.ch === 4) return; // CSS stretches it over the whole screen there
  const slot = T.now.querySelector(".now-slot");
  if (!slot || !T.screen.clientWidth) return;
  // in % of the screen, so it stays put when the pop-out window is resized
  const w = T.screen.clientWidth, h = T.screen.clientHeight;
  T.art.style.left = (slot.offsetLeft / w * 100).toFixed(2) + "%";
  T.art.style.top = (slot.offsetTop / h * 100).toFixed(2) + "%";
  T.art.style.width = (slot.offsetWidth / w * 100).toFixed(2) + "%";
}

// CH4: the cover over the whole screen, on a glow of its own two main colours, with a lower third:
// the song, the artist and a line that shows how far into the song we are
function mss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function tvRenderCover(force) {
  const box = T.cover;
  const cap = T.cap;
  const t = state.track;
  if (!t) { cap.classList.remove("has"); return; }
  if (force || box.dataset.view !== "cover:" + tv.key) {
    const fresh = box.dataset.view !== "cover:" + tv.key;
    box.dataset.view = "cover:" + tv.key;
    box.dataset.colors = "";
    box.replaceChildren();
    const prog = el("div", "cap-prog");
    prog.append(el("span", "cap-at"), el("i", "cap-bar"), el("span", "cap-len"));
    cap.replaceChildren(el("div", "cap-song", t.song), el("div", "cap-artist", t.artists.join(", ")), prog);
    cap.classList.add("has");
    cap.classList.toggle("clean", tv.clean);
    if (fresh && !reduceMotion.matches) { cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in"); }
    if (t.artUrl) { T.art.src = t.artUrl; T.art.classList.add("has"); } else T.art.classList.remove("has");
  }
  const dur = state.trackDuration || t.duration || 0;
  const at = Math.min(currentElapsed(), dur);
  cap.classList.toggle("paused", !els.stage.classList.contains("playing"));
  cap.querySelector(".cap-at").textContent = mss(at);
  cap.querySelector(".cap-len").textContent = mss(dur);
  cap.querySelector(".cap-bar").style.setProperty("--p", (dur ? Math.min(100, (at / dur) * 100) : 0).toFixed(2) + "%");
  const cols = state.colors && state.colors.key === tv.key ? state.colors.colors : null;
  if (box.dataset.colors !== String(cols)) {
    box.dataset.colors = String(cols);
    if (cols) { box.style.setProperty("--c1", cols[0]); box.style.setProperty("--c2", cols[1]); }
    else { box.style.removeProperty("--c1"); box.style.removeProperty("--c2"); }
  }
}

function tvToggleClean() {
  tv.clean = !tv.clean;
  try { localStorage.setItem("gtt_tv_clean", tv.clean ? "1" : "0"); } catch {}
  T.cap.classList.toggle("clean", tv.clean);
  tvOsd(tv.clean ? "INFO OFF" : "INFO ON");
}

// CH3: the queue as a teletext page — tap a row to jump there
async function tvLoadQueue() {
  if (!tv.open || tv.queueBusy) return;
  tv.queueBusy = true;
  try {
    const q = await spotifyJson("https://api.spotify.com/v1/me/player/queue");
    tv.queue = (q.queue || []).filter((x) => x && x.uri).slice(0, 8);
  } catch (e) {
    tv.queue = null;
  }
  tv.queueAt = Date.now();
  tv.queueBusy = false;
  tvRenderQueue();
}

function tvRenderQueue() {
  const box = T.queue;
  const head = el("div", "tt-head");
  const now = new Date();
  head.append(el("b", "", "P333"), el("span", "", "GROOVTEXT"), el("span", "", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })));
  const title = el("div", "tt-title", "UP NEXT");
  const list = el("div", "tt-list");
  if (!tv.queue) list.append(el("div", "tt-empty", "PAGE NOT FOUND — couldn't read the queue"));
  else if (!tv.queue.length) list.append(el("div", "tt-empty", "NOTHING QUEUED"));
  else tv.queue.forEach((item, i) => {
    const row = el("button", "tt-row");
    row.type = "button";
    const name = el("span");
    const by = (item.artists || []).map((a) => a.name).join(", ") || (item.show && item.show.name) || "";
    name.append(item.name + " ", el("em", "", by));
    row.append(el("i", "", String(i + 1)), name);
    row.title = "Play " + item.name + " now";
    row.onclick = () => tvJump(i, item);
    list.append(row);
  });
  const fast = el("div", "fastext");
  [["PREV", "prev"], ["PLAY", "play"], ["NEXT", "next"], ["REFRESH", "refresh"]].forEach(([label, act]) => {
    const b = el("button", "", label);
    b.type = "button";
    b.onclick = () => (act === "refresh" ? tvLoadQueue() : tvAction(act));
    fast.append(b);
  });
  box.dataset.view = "queue";
  box.replaceChildren(head, title, list, fast);
}

async function tvJump(i, item) {
  tvStatic(500);
  tvOsd("▶▶ " + (i + 1));
  const ctx = state.context;
  let res = null;
  // jump straight there when the song is part of what's playing; otherwise skip ahead one by one
  if (ctx && !/:artist:/.test(ctx)) { try { res = await playerCall("play", { context_uri: ctx, offset: { uri: item.uri } }); } catch {} }
  if (!res || !res.ok) {
    for (let k = 0; k <= i; k++) {
      try { res = await api("https://api.spotify.com/v1/me/player/next", { method: "POST" }); } catch { res = null; }
      if (!res || !res.ok) break;
      await wait(350);
    }
  }
  if (res && !res.ok) tvOsd(res.status === 403 ? "PREMIUM ONLY" : "ERR " + res.status);
  setTimeout(pollSpotify, 600);
  setTimeout(tvLoadQueue, 1200);
}

async function tvAction(act) {
  if (act === "play") { toggleVinyl(); tvOsd(els.stage.classList.contains("playing") ? "▶" : "❚❚"); return; }
  if (act === "fx") {
    tv.fx = !tv.fx;
    try { localStorage.setItem("gtt_tv_fx", tv.fx ? "1" : "0"); } catch {}
    T.box.classList.toggle("strong", tv.fx);
    T.box.querySelector('[data-tv="fx"]').setAttribute("aria-pressed", String(tv.fx));
    tvOsd(tv.fx ? "FX STRONG" : "FX SOFT");
    return;
  }
  if (act === "power") { closeTV(); return; }
  if (act === "era") { tvSetEra(tv.era === 70 ? 80 : tv.era === 80 ? 90 : 70); return; }
  if (act === "pip") { vpipEnter(); return; }
  if (act !== "prev" && act !== "next") return; // a button this version doesn't know does nothing, not "next song"
  const path = act === "prev" ? "previous" : "next";
  tvOsd(act === "prev" ? "⏮" : "⏭");
  let res = null;
  try { res = await api("https://api.spotify.com/v1/me/player/" + path, { method: "POST" }); } catch {}
  if (!res || !res.ok) { tvOsd(!res ? "NO SIGNAL" : res.status === 403 ? "PREMIUM ONLY" : res.status === 404 ? "NO PLAYER" : "ERR " + res.status); return; }
  setTimeout(pollSpotify, 500);
}

function tvKeys(e) {
  if (!tv.open || e.target.closest && e.target.closest("input")) return;
  if (["1", "2", "3", "4"].includes(e.key)) tvSetChannel(Number(e.key));
  else if (e.key === " ") { e.preventDefault(); tvAction("play"); }
  else if (e.key === "ArrowRight") tvAction("next");
  else if (e.key === "ArrowLeft") tvAction("prev");
  else if (e.key === "Escape") closeTV();
  else if (e.key === "e" || e.key === "E") tvAction("era");
  else if ((e.key === "i" || e.key === "I") && tv.ch === 4) tvToggleClean();
}

tvShowEra();
T.box.querySelectorAll(".tv-btn[data-ch]").forEach((b) => { b.onclick = () => tvSetChannel(Number(b.dataset.ch)); });
T.box.querySelectorAll("[data-tv]").forEach((b) => { b.onclick = () => tvAction(b.dataset.tv); });
T.layer.addEventListener("click", (e) => { if (e.target.id === "tvLayer") closeTV(); });
T.screen.addEventListener("click", () => { if (tv.ch === 4) tvToggleClean(); });
document.addEventListener("keydown", tvKeys);
addEventListener("resize", () => { if (tv.open && !tv.pip) tvScanlines(); });
$("tvBtn").onclick = openTV;
