// ---------- the TV as a video, for picture-in-picture where there's no Document PiP (iPhone, Safari) ----------
// The whole set is drawn on a canvas and streamed into a <video>; video PiP floats over other apps on iOS.
// It's a picture, so its only controls are the system's: play/pause and ⏮ ⏭ are wired to Spotify.
const vpip = { canvas: null, ctx: null, video: null, timer: 0, imgs: new Map(), active: false, snow: 0, key: null };
const VW = 640, VH = 560;

function videoPipSupported() {
  const v = document.createElement("video");
  const canStream = typeof HTMLCanvasElement.prototype.captureStream === "function";
  const pip = document.pictureInPictureEnabled || (typeof v.webkitSupportsPresentationMode === "function" && v.webkitSupportsPresentationMode("picture-in-picture"));
  return canStream && !!pip;
}

function vpipImage(url) {
  if (!url) return null;
  if (!vpip.imgs.has(url)) {
    const img = new Image();
    img.crossOrigin = "anonymous"; // a cover from another origin would otherwise taint the canvas and blank the stream
    img.src = url;
    vpip.imgs.set(url, img);
    if (vpip.imgs.size > 12) vpip.imgs.delete(vpip.imgs.keys().next().value);
  }
  const img = vpip.imgs.get(url);
  return img.complete && img.naturalWidth ? img : null;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function vpipText(ctx, text, x, y, size, color, maxW, lines = 1) {
  ctx.font = size + "px VT323, ui-monospace, Menlo, monospace";
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.25;
  const words = String(text || "").split(" ");
  let line = "", n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      if (n === lines - 1) { line += "…"; break; }
      ctx.fillText(line, x, y + n * size * 1.02);
      n++;
      line = words[i];
    } else line = test;
  }
  while (ctx.measureText(line).width > maxW && line.length > 1) line = line.slice(0, -2) + "…";
  ctx.fillText(line, x, y + n * size * 1.02);
  ctx.shadowBlur = 0;
}

function drawTvFrame() {
  const ctx = vpip.ctx;
  if (!ctx) return;
  const t = state.track;
  if (state.trackKey !== vpip.key) { if (vpip.key !== null) vpip.snow = 4; vpip.key = state.trackKey; vpipMeta(); }
  ctx.fillStyle = "#0c090b";
  ctx.fillRect(0, 0, VW, VH);
  // cabinet, feet, bezel
  ctx.fillStyle = "#141317";
  ctx.fillRect(120, 528, 90, 16);
  ctx.fillRect(430, 528, 90, 16);
  const cab = ctx.createLinearGradient(0, 12, 0, 532);
  cab.addColorStop(0, "#55525c"); cab.addColorStop(0.06, "#34323a"); cab.addColorStop(0.55, "#29272e"); cab.addColorStop(1, "#1e1d22");
  ctx.fillStyle = cab; rrect(ctx, 16, 12, 608, 520, 34); ctx.fill();
  ctx.fillStyle = "#121114"; rrect(ctx, 40, 36, 560, 440, 26); ctx.fill();
  // the screen
  const S = { x: 58, y: 52, w: 524, h: 393 };
  ctx.save();
  const era = tv.era;
  rrect(ctx, S.x, S.y, S.w, S.h, era === 70 ? 66 : era === 90 ? 14 : 44); ctx.clip(); // a rounder or flatter tube
  const cols = state.colors && state.colors.key === state.trackKey ? state.colors.colors : null;
  const bg = ctx.createRadialGradient(S.x + S.w / 2, S.y + S.h * 0.45, 10, S.x + S.w / 2, S.y + S.h / 2, S.w * 0.7);
  bg.addColorStop(0, cols ? cols[0] + "55" : "#1a3027"); bg.addColorStop(0.7, "#0d1a14"); bg.addColorStop(1, "#070e0b");
  ctx.fillStyle = bg; ctx.fillRect(S.x, S.y, S.w, S.h);
  if (tv.fx) ctx.globalAlpha = 0.93 + Math.random() * 0.07;
  if (!t && era === 90) {
    ctx.fillStyle = "#0a22d8"; ctx.fillRect(S.x, S.y, S.w, S.h);
    vpipText(ctx, "NO SIGNAL", S.x + S.w / 2 - 80, S.y + S.h / 2 + 12, 36, "#fff", 200);
  } else if (!t) {
    const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
    bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(S.x + (S.w / 7) * i, S.y, S.w / 7 + 1, S.h * 0.8); });
    ctx.fillStyle = "#000"; ctx.fillRect(S.x + S.w / 2 - 110, S.y + S.h * 0.36, 220, 46);
    vpipText(ctx, "NO SIGNAL", S.x + S.w / 2 - 80, S.y + S.h * 0.36 + 34, 36, "#fff", 200);
  } else if (tv.ch === 4 && vpipImage(t.artUrl)) {
    // CH4: the cover over the whole screen, cropped to 4:3, with a lower third for the first seconds of a song
    const art = vpipImage(t.artUrl);
    const sw = art.naturalWidth, sh = sw * (S.h / S.w);
    ctx.drawImage(art, 0, (art.naturalHeight - sh) / 2, sw, sh, S.x, S.y, S.w, S.h);
    // the same lower third as the TV: song, artist, and the line showing where in the song we are
    const sh2 = ctx.createLinearGradient(0, S.y + S.h * 0.5, 0, S.y + S.h);
    sh2.addColorStop(0, "rgba(0,0,0,0)"); sh2.addColorStop(0.45, "rgba(0,0,0,0.66)"); sh2.addColorStop(1, "rgba(0,0,0,0.86)");
    const L = S.x + 48, R = S.x + S.w - 48;
    if (!tv.clean) {
      ctx.fillStyle = sh2; ctx.fillRect(S.x, S.y + S.h * 0.5, S.w, S.h * 0.5);
      vpipText(ctx, t.song, L, S.y + S.h - 104, 40, "#ffe95c", R - L);
      vpipText(ctx, t.artists.join(", "), L, S.y + S.h - 72, 28, "#7ff6ff", R - L);
    }
    const dur = state.trackDuration || t.duration || 0;
    const at = Math.min(currentElapsed(), dur), p = dur ? at / dur : 0;
    const y = S.y + S.h - 42;
    vpipText(ctx, mss(at), L, y + 8, 24, "#ffffff", 70);
    vpipText(ctx, mss(dur), R - 52, y + 8, 24, "#ffffff", 60);
    const bx = L + 66, bw = R - 62 - bx;
    ctx.fillStyle = "rgba(255,255,255,0.24)"; rrect(ctx, bx, y - 2, bw, 5, 2.5); ctx.fill();
    ctx.fillStyle = "#ffffff"; rrect(ctx, bx, y - 2, Math.max(5, bw * p), 5, 2.5); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bw * p, y + 0.5, 7, 0, Math.PI * 2); ctx.fill();
  } else {
    const playing = els.stage.classList.contains("playing");
    vpipText(ctx, playing ? "▶ PLAY" : "❚❚ PAUSE", S.x + 34, S.y + 50, 30, "#ffffff", 200);
    vpipText(ctx, "SP", S.x + S.w - 66, S.y + 50, 30, "#ffffff", 60);
    const art = vpipImage(t.artUrl);
    const A = { x: S.x + 34, y: S.y + 78, s: 186 };
    if (art) {
      ctx.save(); rrect(ctx, A.x, A.y, A.s, A.s, 8); ctx.clip();
      ctx.drawImage(art, A.x, A.y, A.s, A.s);
      ctx.restore();
    } else { ctx.fillStyle = "#1a2a22"; rrect(ctx, A.x, A.y, A.s, A.s, 8); ctx.fill(); }
    const tx = A.x + A.s + 22, tw = S.x + S.w - 34 - tx;
    vpipText(ctx, t.song, tx, A.y + 46, 40, "#ffe95c", tw, 2);
    vpipText(ctx, t.artists.join(", "), tx, A.y + 132, 30, "#7ff6ff", tw);
    vpipText(ctx, t.album || "", tx, A.y + 168, 24, "#9fb7aa", tw);
    if (likes.key === state.trackKey && likes.on) vpipText(ctx, "♥ LIKED", tx, A.y + 202, 24, "#ff3d7f", tw);
    const next = tv.queue && tv.queue.find((q) => q.id !== state.trackKey); // the queue can lag a song behind
    if (next) vpipText(ctx, "NEXT ▸ " + next.name, S.x + 34, S.y + 312, 24, "#4dff86", S.w - 68);
    const at = Math.min(currentElapsed(), state.trackDuration || 0);
    vpipText(ctx, hms(at), S.x + 34, S.y + 356, 30, "#ffffff", 140);
    const bx = S.x + 170, bw = S.w - 34 - 170, blocks = 16, p = state.trackDuration ? at / state.trackDuration : 0;
    for (let i = 0; i < blocks; i++) {
      ctx.fillStyle = i < Math.round(p * blocks) ? "#4dff86" : "rgba(77, 255, 134, 0.22)";
      ctx.fillRect(bx + (bw / blocks) * i, S.y + 336, bw / blocks - 5, 20);
    }
  }
  ctx.globalAlpha = 1;
  // the decade's colour: faded and warm with lifted blacks in the 70s; 90s damper wires
  if (era === 70) {
    ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(255, 214, 165, 0.75)"; ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.globalCompositeOperation = "screen"; ctx.fillStyle = "rgba(48, 32, 18, 0.6)"; ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.globalCompositeOperation = "source-over";
  }
  if (era === 90) { ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; ctx.fillRect(S.x, S.y + S.h / 3, S.w, 1); ctx.fillRect(S.x, S.y + S.h * 2 / 3, S.w, 1); }
  // tearing: bands of the picture copied back onto itself, shifted sideways
  if (Date.now() < (tv.tearUntil || 0)) {
    for (let i = 0; i < 5; i++) {
      const y = S.y + Math.random() * S.h, h = 6 + Math.random() * 30, off = (Math.random() - 0.5) * 50;
      ctx.drawImage(vpip.canvas, S.x, y, S.w, h, S.x + off, y, S.w, h);
    }
  }
  // VHS: grain everywhere, and on the 80s set (or with FX) the tracking band crawling along the bottom
  if (vhsNoise && !reduceMotion.matches) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = ({ 70: 0.12, 80: 0.1, 90: 0.04 }[era] || 0.1) * (tv.fx ? 1.8 : 1);
    const ox = Math.floor(Math.random() * 128), oy = Math.floor(Math.random() * 128);
    for (let y = S.y - oy; y < S.y + S.h; y += 128) for (let x = S.x - ox; x < S.x + S.w; x += 128) ctx.drawImage(vhsNoise, x, y);
    if (era === 80 || tv.fx) {
      const h = S.h * 0.05, y = S.y + S.h * 0.9 + [0, -3, 2, -5, 1][Math.floor(Date.now() / 480) % 5];
      ctx.globalAlpha = tv.fx ? 0.34 : 0.22;
      ctx.drawImage(vhsStreak, Math.floor(Math.random() * 170), 0, 86, 6, S.x, y, S.w, h);
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)"; ctx.fillRect(S.x, y, S.w, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  // between songs: snow, or a cut to black on a 90s set
  if (vpip.snow > 0 && era === 90) { vpip.snow--; ctx.fillStyle = "#000"; ctx.fillRect(S.x, S.y, S.w, S.h); }
  else if (vpip.snow > 0 && !reduceMotion.matches) {
    vpip.snow--;
    const n = ctx.createImageData(131, 98);
    for (let i = 0; i < n.data.length; i += 4) { const v = Math.random() * 255; n.data[i] = n.data[i + 1] = n.data[i + 2] = v; n.data[i + 3] = 230; }
    const tmp = vpipSnowCanvas(); tmp.getContext("2d").putImageData(n, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, S.x, S.y, S.w, S.h); ctx.imageSmoothingEnabled = true;
  }
  // scanlines, vignette, glare
  const L = era === 70 ? { pitch: 5, dark: 2.5, a: 0.3, vin: 0.3, vout: 0.68 } : era === 90 ? { pitch: 3, dark: 1, a: 0.22, vin: 0.45, vout: 0.32 } : { pitch: 4, dark: 2, a: 0.3, vin: 0.35, vout: 0.6 };
  ctx.fillStyle = "rgba(0, 0, 0, " + (tv.fx ? L.a + 0.12 : L.a) + ")";
  for (let y = S.y; y < S.y + S.h; y += L.pitch) ctx.fillRect(S.x, y + L.pitch - L.dark, S.w, L.dark);
  const vig = ctx.createRadialGradient(S.x + S.w / 2, S.y + S.h / 2, S.h * L.vin, S.x + S.w / 2, S.y + S.h / 2, S.w * 0.62);
  vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0," + L.vout + ")");
  ctx.fillStyle = vig; ctx.fillRect(S.x, S.y, S.w, S.h);
  const gl = ctx.createLinearGradient(S.x, S.y, S.x + S.w * 0.45, S.y + S.h * 0.55);
  gl.addColorStop(0, "rgba(255,255,255,0.12)"); gl.addColorStop(0.6, "rgba(255,255,255,0.03)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gl; ctx.fillRect(S.x, S.y, S.w, S.h);
  ctx.restore();
  // badge and the control strip
  ctx.font = "800 13px -apple-system, Segoe UI, Arial, sans-serif";
  ctx.fillStyle = "#c9c4cf";
  const brand = "GROOVTRON";
  let bx0 = VW / 2 - 76;
  for (const ch of brand) { ctx.fillText(ch, bx0, 466); bx0 += 17; }
  ctx.fillStyle = "#121114";
  for (let i = 0; i < 12; i++) ctx.fillRect(52 + i * 10, 492, 5, 22);
  ["1", "2", "3", "4", "⏮", "⏯", "⏭", "FX"].forEach((label, i) => {
    const x = 196 + i * 42;
    const g = ctx.createLinearGradient(0, 490, 0, 516);
    g.addColorStop(0, "#4d4a54"); g.addColorStop(1, "#2a292f");
    ctx.fillStyle = "#111013"; rrect(ctx, x, 493, 34, 24, 5); ctx.fill();
    ctx.fillStyle = g; rrect(ctx, x, 490, 34, 24, 5); ctx.fill();
    ctx.fillStyle = String(tv.ch) === label ? "#ffc23d" : "#d8d3dc";
    ctx.font = "700 13px -apple-system, Segoe UI, Arial, sans-serif";
    ctx.fillText(label, x + 17 - ctx.measureText(label).width / 2, 507);
  });
  ctx.fillStyle = "#3dff7a"; ctx.shadowColor = "#3dff7a"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(546, 502, 5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  const pw = ctx.createRadialGradient(584, 498, 2, 588, 502, 16);
  pw.addColorStop(0, "#5a5762"); pw.addColorStop(1, "#232227");
  ctx.fillStyle = pw; ctx.beginPath(); ctx.arc(588, 502, 15, 0, Math.PI * 2); ctx.fill();
  if (navigator.mediaSession) navigator.mediaSession.playbackState = t && els.stage.classList.contains("playing") ? "playing" : "paused";
}

function vpipSnowCanvas() {
  if (!vpip.snowCanvas) { vpip.snowCanvas = document.createElement("canvas"); vpip.snowCanvas.width = 131; vpip.snowCanvas.height = 98; }
  return vpip.snowCanvas;
}

// lock screen / PiP: the song and its cover, plus Spotify on the system play, pause, next and previous
function vpipMeta() {
  if (!navigator.mediaSession || !vpip.video) return;
  const t = state.track;
  try {
    navigator.mediaSession.metadata = t ? new MediaMetadata({
      title: t.song, artist: t.artists.join(", "), album: t.album || "",
      artwork: t.artUrl ? [{ src: t.artUrl, sizes: "640x640", type: "image/jpeg" }] : [],
    }) : null;
  } catch {}
}

function vpipActions(on) {
  if (!navigator.mediaSession) return;
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, on ? fn : null); } catch {} };
  set("play", () => { if (!els.stage.classList.contains("playing")) tvAction("play"); });
  set("pause", () => { if (els.stage.classList.contains("playing")) tvAction("play"); });
  set("nexttrack", () => tvAction("next"));
  set("previoustrack", () => tvAction("prev"));
}

// the stream is set up when the TV opens, so the PiP button can switch over within the tap itself
function vpipPrepare() {
  if (vpip.video || !videoPipSupported()) return;
  const c = document.createElement("canvas");
  c.width = VW; c.height = VH;
  vpip.canvas = c;
  vpip.ctx = c.getContext("2d");
  if (document.fonts && document.fonts.load) document.fonts.load("30px VT323").catch(() => {});
  drawTvFrame();
  const v = document.createElement("video");
  v.className = "tv-video";
  v.muted = true; v.playsInline = true; v.autoplay = true;
  v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.setAttribute("autopictureinpicture", "");
  v.srcObject = c.captureStream(12);
  v.addEventListener("enterpictureinpicture", () => vpipOn(true));
  v.addEventListener("leavepictureinpicture", () => vpipOn(false));
  v.addEventListener("webkitpresentationmodechanged", () => vpipOn(v.webkitPresentationMode === "picture-in-picture"));
  // a pause/play from the PiP window itself goes to Spotify too
  v.addEventListener("pause", () => { if (vpip.active && els.stage.classList.contains("playing")) tvAction("play"); });
  v.addEventListener("play", () => { if (vpip.active && !els.stage.classList.contains("playing")) tvAction("play"); });
  T.layer.append(v);
  vpip.video = v;
  v.play().catch(() => {});
  vpip.timer = setInterval(drawTvFrame, 100);
}

function vpipOn(on) {
  vpip.active = on;
  vpipActions(on);
  if (on) vpipMeta();
  T.layer.classList.toggle("vpip", on);
  tvOsd(on ? "PIP ON" : "PIP OFF");
}

function vpipEnter() {
  const v = vpip.video;
  if (!v) { tvOsd("NO PIP HERE"); return; }
  if (vpip.active) { vpipExit(); return; }
  if (v.paused) v.play().catch(() => {});
  // straight from the tap: browsers only allow PiP during a user gesture
  if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
    v.requestPictureInPicture().catch((e) => {
      if (typeof v.webkitSetPresentationMode === "function") v.webkitSetPresentationMode("picture-in-picture");
      else { console.error("[gtt] video pip", e); tvOsd("PIP BLOCKED"); }
    });
  } else if (typeof v.webkitSetPresentationMode === "function") v.webkitSetPresentationMode("picture-in-picture");
}

function vpipExit() {
  const v = vpip.video;
  if (!v) return;
  try {
    if (document.pictureInPictureElement === v) document.exitPictureInPicture();
    else if (v.webkitPresentationMode === "picture-in-picture") v.webkitSetPresentationMode("inline");
  } catch {}
}

function vpipStop() {
  vpipExit();
  vpipOn(false);
  clearInterval(vpip.timer);
  if (vpip.video) {
    const s = vpip.video.srcObject;
    if (s) s.getTracks().forEach((tr) => tr.stop());
    vpip.video.remove();
  }
  vpip.video = null; vpip.canvas = null; vpip.ctx = null; vpip.key = null;
  if (navigator.mediaSession) try { navigator.mediaSession.metadata = null; } catch {}
}
