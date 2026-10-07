// ---------- the pop-out widget, the settings menu, Add to Home Screen, reconnect ----------
async function togglePip() {
  if (!("documentPictureInPicture" in window)) {
    setStatus("Chrome/Edge only — no Document PiP here");
    return;
  }
  if (documentPictureInPicture.window) {
    documentPictureInPicture.window.close();
    return;
  }
  const height = Math.min(screen.availHeight, Math.ceil(els.app.getBoundingClientRect().height) + 24);
  const pipWindow = await documentPictureInPicture.requestWindow({ width: 360, height });
  for (const sheet of document.styleSheets) {
    try {
      const style = pipWindow.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      pipWindow.document.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = pipWindow.document.createElement("link");
      link.rel = "stylesheet"; link.href = sheet.href;
      pipWindow.document.head.appendChild(link);
    }
  }
  pipWindow.document.body.append(els.live, els.app, els.radarScrim, els.modes, els.radar);
  pipWindow.document.addEventListener("keydown", radarEscape);
  pipWindow.addEventListener("pagehide", () => {
    els.shell.prepend(els.live);
    els.shell.append(els.app, els.radarScrim, els.modes, els.radar);
  });
}
els.pipBtn.onclick = () => { setMenuOpen(false); togglePip(); };

function setMenuOpen(open) {
  els.menu.classList.toggle("open", open);
  els.menuBtn.setAttribute("aria-expanded", String(open));
}

// a dot on the settings button when lyrics or versus is on, so a closed menu still tells you
function syncMenuBtn() {
  els.menuBtn.classList.toggle("on", lyricsOn || vs.on);
}

els.menuBtn.onclick = () => setMenuOpen(!els.menu.classList.contains("open"));
document.addEventListener("pointerdown", (e) => { if (!e.target.closest || !e.target.closest(".menu-wrap")) setMenuOpen(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && els.menu.classList.contains("open")) { setMenuOpen(false); els.menuBtn.focus(); } });

// Add to Home Screen: Chrome/Android hands us an install prompt; iPhone/iPad only does it from the Share sheet,
// so there the button explains how. Already running from the home screen → no button
const install = { prompt: null, btn: $("installBtn") };
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function syncInstall() { install.btn.hidden = standalone() || !(install.prompt || isIOS); }
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); install.prompt = e; syncInstall(); });
addEventListener("appinstalled", () => { install.prompt = null; syncInstall(); });
install.btn.onclick = async () => {
  if (install.prompt) {
    setMenuOpen(false);
    const p = install.prompt;
    install.prompt = null;
    p.prompt();
    try { await p.userChoice; } catch {}
    syncInstall();
    return;
  }
  // iOS: say how, in the button itself (Safari's Share button, then "Add to Home Screen")
  install.btn.classList.add("howto");
  install.btn.querySelector("small").textContent = "tap Share ⬆︎ below, then “Add to Home Screen”";
};
syncInstall();

// full re-login; a page reload wipes the scoreboard, so ask twice if there's anything to lose
let reconnectArmedAt = 0;
els.reconnect.onclick = async () => {
  const stakes = state.rounds > 0 || vs.players.some((p) => p.points || p.wins);
  if (stakes && Date.now() - reconnectArmedAt > 4000) {
    reconnectArmedAt = Date.now();
    setStatus("tap again to log in — scores will reset");
    return;
  }
  if (state.pollTimer) clearInterval(state.pollTimer);
  try { localStorage.removeItem("pip_widget_auth"); } catch {}
  setConn("wait", "reconnecting…");
  setStatus("heading to Spotify login…");
  if ("documentPictureInPicture" in window && documentPictureInPicture.window) documentPictureInPicture.window.close();
  await redirectToSpotify();
};
$("record").addEventListener("click", toggleVinyl);
els.liveBtn.onclick = () => { clearTimeout(liveFlash); setLiveOpen(!els.live.classList.contains("open")); };
document.addEventListener("pointerdown", (e) => { if (!els.live.contains(e.target)) setLiveOpen(false); });

els.vsBtn.onclick = () => {
  const was = activeGame();
  morph(els.app, appKids, () => setVersus(!vs.on));
  if (activeGame() !== was) popModeBtn();
};
