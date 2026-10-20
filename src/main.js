import "./style.css";
import {
  CameraExposure,
  exposureTimes,
  formatExposureTime,
} from "./camera-exposure.js";
import StabilizationWorker from "./stabilization-worker.js?worker&inline";
import { identity, completeMotions } from "./stabilization.js";
const paths = {
  mountain: "m3 19 7-13 5 8 3-5 4 10M7 13l3-2 3 3",
  camera: "M14 5l-2-2H8L6 5H3v14h18V5z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  grid: "M3 3h18v18H3z M3 9h18M3 15h18M9 3v18M15 3v18",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  film: "M3 3h18v18H3zM7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4",
  folder: "M3 6V4h6l2 2h10v14H3z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  help: "M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  switch: "M4 8h15l-4-4M20 16H5l4 4",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z",
  play: "m9 5 11 7-11 7z",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  pause: "M8 5v14M16 5v14",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const $ = (s) => document.querySelector(s);
const base = import.meta.env.BASE_URL;
let stream = null,
  recording = false,
  busy = false,
  session = null,
  timer = null,
  started = 0,
  wake = null,
  installPrompt = null,
  front = false,
  exporting = false,
  exposureController = null,
  exposureApplying = false;
let settings = {
  interval: 5,
  duration: 30,
  fps: 24,
  quality: 1920,
  grid: false,
  handheld: false,
  ...JSON.parse(localStorage.getItem("aurora-settings") || "{}"),
};
const saveSettings = () =>
  localStorage.setItem("aurora-settings", JSON.stringify(settings));
document.body.classList.add("dimmed");
$("#app").innerHTML = `
<main class="viewfinder" aria-label="Aurora camera">
  <picture>
    <source media="(orientation: landscape)" srcset="${base}aurora-landscape.jpg">
    <img class="sample-scene" src="${base}aurora.jpg" alt="Aurora sample preview">
  </picture>
  <video id="camera" autoplay muted playsinline></video>
  <div class="preview-shade"></div>
  <header class="view-top">
    <span class="app-name">Aurora <span id="camera-state">Sample preview</span></span>
    <div class="view-tools">
      <button class="glass-btn on" id="night-mode" title="Brighten screen" aria-label="Brighten screen" aria-pressed="true">${icon("moon")}</button>
      <button class="glass-btn" id="switch" title="Switch camera" aria-label="Switch camera">${icon("switch")}</button>
      <button class="glass-btn" id="fullscreen" title="Full screen" aria-label="Full screen">${icon("expand")}</button>
    </div>
  </header>
  <div class="framing-grid" hidden></div>
  <div class="camera-invite" id="camera-invite">
    <button class="light-btn" id="enable-camera">${icon("camera")} Enable camera</button>
  </div>
  <div class="recording-status" role="status" aria-live="polite">
    <div class="live-recording" hidden><i></i><span id="live-time">00:00</span></div>
    <span id="stabilization-status" hidden>${icon("shield")}<span id="stabilization-label">Stabilization ON</span></span>
  </div>
  <div class="capture-hud">
    <div class="capture-status"><span id="view-label">Ready</span><span id="view-detail">5 sec interval</span><span id="resolution">1080p</span></div>
    <div class="capture-actions">
      <button class="tool-btn" id="library-tab" aria-label="Open timelapse library">${icon("film")}<span>Library <span id="library-count">0</span></span></button>
      <button class="capture-btn" id="record" aria-label="Start capturing"><span class="record-circle"></span><span id="record-label">Start capturing</span></button>
      <button class="tool-btn" id="settings-open" aria-label="Open capture settings">${icon("settings")}<span>Settings</span></button>
    </div>
    <div id="capture-note">Keep phone steady</div>
  </div>
</main>
<dialog id="settings-dialog" aria-labelledby="settings-title">
  <button class="icon-btn settings-close" aria-label="Close settings">${icon("close")}</button>
  <div class="controls"><h2 id="settings-title">Settings</h2>
  <div class="presets"><button class="preset selected" data-preset="aurora">${icon("mountain")} Aurora</button><button class="preset" data-preset="stars">${icon("spark")} Stars</button><button class="preset" data-preset="custom">${icon("sun")} Custom</button></div><div class="setting"><label for="interval">${icon("clock")} Photo interval <span>Time between photos</span></label><select id="interval">${[1, 2, 3, 5, 10, 15, 30, 60].map((n) => `<option value="${n}">Every ${n} second${n > 1 ? "s" : ""}</option>`).join("")}</select></div><div class="setting"><label for="duration">${icon("camera")} Capture duration <span>How long to watch the sky</span></label><select id="duration">${[1, 5, 10, 15, 30, 60, 120, 0].map((n) => `<option value="${n}">${n ? n + " minutes" : "Until I stop"}</option>`).join("")}</select></div><div class="setting exposure-setting">
  <label for="exposure-time">${icon("clock")} Exposure time <span id="shutter-value">Auto</span></label>
  <select id="exposure-time" disabled><option value="auto">Auto</option></select>
  <p class="control-hint" id="shutter-hint">Connect camera to check shutter control.</p>
  <div id="exposure-bias">
    <label for="exposure">${icon("sun")} Auto exposure bias <span id="exposure-value">Camera auto</span></label>
    <input id="exposure" type="range" min="-2" max="2" value="0" step="0.5" disabled>
    <div class="range-labels"><span id="exposure-min">−2</span><span id="exposure-hint">EV bias · not shutter time</span><span id="exposure-max">+2</span></div>
  </div>
  <p class="control-hint" id="camera-exposure-readout"></p>
</div><div class="output-row"><label>Video quality<select id="quality"><option value="1920">1080p HD</option><option value="1280">720p HD</option></select></label><label>Playback<select id="fps"><option value="24">24 fps · cinematic</option><option value="30">30 fps · smooth</option><option value="12">12 fps · longer</option></select></label></div><div class="estimate">${icon("film")}<span><strong id="estimate-length">15 sec</strong> video <span class="estimate-dot">·</span> <span id="estimate-frames">360 photos</span></span></div>
  <div class="settings-switches">
    <button class="option-button" id="grid" aria-pressed="false">${icon("grid")} Grid <span id="grid-state">Off</span></button>
    <button class="option-button" id="handheld" aria-pressed="false">${icon("camera")} Handheld <span id="handheld-state">Off</span></button>
  </div>
  <p class="handheld-hint">Handheld: stabilize and crop frames when creating the video.</p>
  <div class="settings-tools">
    <button class="text-btn" id="help">${icon("help")} Help</button>
    <button class="text-btn" id="install">${icon("download")} Install</button>
  </div>
  </div>
</dialog>
<div id="toast" role="status"></div><dialog id="modal"><div id="modal-content"></div></dialog>`;
$("#settings-open").onclick = () => $("#settings-dialog").showModal();
$(".settings-close").onclick = () => $("#settings-dialog").close();
$("#settings-dialog").addEventListener("click", (e) => {
  if (e.target === $("#settings-dialog")) $("#settings-dialog").close();
});
const dbp = new Promise((resolve, reject) => {
  const r = indexedDB.open("aurora-local", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("sessions", { keyPath: "id" });
    const f = r.result.createObjectStore("frames", {
      keyPath: "id",
      autoIncrement: true,
    });
    f.createIndex("session", "session");
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function db(store, mode, fn) {
  const d = await dbp;
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const putSession = (s) => db("sessions", "readwrite", (o) => o.put(s));
const sessions = () => db("sessions", "readonly", (o) => o.getAll());
const frames = (id) =>
  db("frames", "readonly", (o) => o.index("session").getAll(id));
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
function modal(html) {
  $("#settings-dialog").close();
  $("#modal-content").innerHTML =
    `<button class="icon-btn modal-close" aria-label="Close">${icon("close")}</button>${html}`;
  $("#modal").showModal();
  $(".modal-close").onclick = () => $("#modal").close();
}
function estimate() {
  const n = settings.duration
    ? Math.ceil((settings.duration * 60) / settings.interval)
    : 0;
  $("#estimate-length").textContent = n
    ? `${(n / settings.fps).toFixed(1).replace(".0", "")} sec`
    : "Open-ended";
  $("#estimate-frames").textContent = n ? `${n} photos` : "Stop anytime";
  $("#resolution").textContent = settings.quality === 1920 ? "1080p" : "720p";
  if (!recording)
    $("#view-detail").textContent = `${settings.interval} sec interval`;
}
for (const key of ["interval", "duration", "quality", "fps"]) {
  $("#" + key).value = settings[key];
  $("#" + key).onchange = (e) => {
    settings[key] = +e.target.value;
    saveSettings();
    estimate();
    $$(".preset").forEach((b) =>
      b.classList.toggle("selected", b.dataset.preset === "custom"),
    );
  };
}
function $$(s) {
  return [...document.querySelectorAll(s)];
}
estimate();
$$(".preset").forEach(
  (b) =>
    (b.onclick = () => {
      if (recording) return;
      $$(".preset").forEach((x) => x.classList.toggle("selected", x === b));
      if (b.dataset.preset !== "custom") {
        settings.interval = b.dataset.preset === "stars" ? 15 : 5;
        settings.duration = b.dataset.preset === "stars" ? 60 : 30;
        $("#interval").value = settings.interval;
        $("#duration").value = settings.duration;
        saveSettings();
        estimate();
      }
    }),
);
async function connect() {
  if (recording) return false;
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Camera needs HTTPS or localhost and a supported browser.",
      );
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: front ? "user" : "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    stream?.getTracks().forEach((t) => t.stop());
    stream = next;
    const v = $("#camera");
    v.srcObject = stream;
    await v.play();
    v.classList.add("connected");
    $("#camera-invite").hidden = true;
    $("#camera-state").textContent = "Live";
    $("#view-label").textContent = "Ready";
    $("#view-detail").textContent = `${settings.interval} sec interval`;
    const track = stream.getVideoTracks()[0];
    track.onended = () => {
      if (recording) stop();
      toast("Camera disconnected. Reconnect to keep capturing.");
      v.classList.remove("connected");
      $("#camera-invite").hidden = false;
      $("#camera-state").textContent = "Disconnected";
    };
    exposureController = new CameraExposure(track);
    updateExposureUI();
    return true;
  } catch (e) {
    toast(
      e.name === "NotAllowedError"
        ? "Camera access was declined. Allow camera access in your browser settings."
        : e.message,
    );
    return false;
  }
}
$("#enable-camera").onclick = connect;
$("#switch").onclick = async () => {
  if (recording) return toast("Stop capturing before switching cameras.");
  front = !front;
  await connect();
};
function formatBias(value) {
  return `${value > 0 ? "+" : ""}${Number(value.toFixed(2))} EV`;
}
function updateExposureUI() {
  const controller = exposureController;
  const state = controller?.state || {};
  const manual = state.exposureMode === "manual";
  const select = $("#exposure-time");
  const choices = controller?.manualSupported
    ? exposureTimes(controller.capabilities.exposureTime, state.exposureTime)
    : [];
  select.innerHTML =
    `<option value="auto">${state.exposureMode === "none" || state.exposureMode === "fixed" ? "Camera-controlled" : "Auto"}</option>` +
    choices
      .map(
        (time) =>
          `<option value="${time}">${formatExposureTime(time)}</option>`,
      )
      .join("");
  if (controller?.manualSupported && !controller.autoMode)
    select.options[0].disabled = true;
  select.value =
    manual && choices.length
      ? String(
          choices.reduce(
            (best, time) =>
              Math.abs(time - state.exposureTime) <
              Math.abs(best - state.exposureTime)
                ? time
                : best,
            choices[0],
          ),
        )
      : "auto";
  select.disabled =
    recording || exposureApplying || !controller?.manualSupported;
  $("#shutter-value").textContent = manual
    ? formatExposureTime(state.exposureTime)
    : state.exposureMode === "none" || state.exposureMode === "fixed"
      ? "Camera-controlled"
      : "Auto";
  $("#shutter-hint").textContent = exposureApplying
    ? "Applying camera setting…"
    : !controller
      ? "Connect camera to check shutter control."
      : controller.manualSupported
        ? `Camera range: ${formatExposureTime(choices[0])} – ${formatExposureTime(controller.capabilities.exposureTime.max)}`
        : "Manual shutter control is unavailable in this browser.";
  $("#exposure-bias").hidden = manual;
  const range = $("#exposure");
  range.disabled =
    recording || exposureApplying || !controller?.biasSupported || manual;
  if (controller?.biasSupported) {
    const cap = controller.capabilities.exposureCompensation;
    range.min = cap.min;
    range.max = cap.max;
    range.step = cap.step > 0 ? cap.step : "any";
    range.value = Number.isFinite(state.exposureCompensation)
      ? state.exposureCompensation
      : 0;
    $("#exposure-min").textContent = formatBias(cap.min);
    $("#exposure-max").textContent = formatBias(cap.max);
  }
  $("#exposure-value").textContent = Number.isFinite(state.exposureCompensation)
    ? formatBias(state.exposureCompensation)
    : "Not reported";
  $("#exposure-hint").textContent =
    controller && !controller.biasSupported
      ? "EV bias unavailable"
      : "EV bias · not shutter time";
  const reported = [];
  if (Number.isFinite(state.exposureTime) && state.exposureTime > 0)
    reported.push(`Shutter ${formatExposureTime(state.exposureTime)}`);
  if (Number.isFinite(state.iso) && state.iso > 0)
    reported.push(`ISO ${Math.round(state.iso)}`);
  $("#camera-exposure-readout").textContent = reported.length
    ? `Camera reports: ${reported.join(" · ")}`
    : "";
}
async function applyExposure(change) {
  if (!exposureController || exposureApplying || recording) return;
  exposureApplying = true;
  $("#record").disabled = true;
  $("#switch").disabled = true;
  updateExposureUI();
  try {
    await change(exposureController);
  } catch (error) {
    toast(error.message);
  } finally {
    exposureApplying = false;
    $("#record").disabled = false;
    $("#switch").disabled = recording;
    updateExposureUI();
  }
}
$("#exposure-time").onchange = (event) => {
  const value = event.target.value;
  applyExposure((controller) => controller.setTime(value));
};
$("#exposure").onchange = (event) => {
  const value = Number(event.target.value);
  applyExposure((controller) => controller.setBias(value));
};
function updateToggle(id, on) {
  const button = $("#" + id);
  button.classList.toggle("selected", on);
  button.setAttribute("aria-pressed", String(on));
  $("#" + id + "-state").textContent = on ? "On" : "Off";
}
function updateCaptureOptions() {
  $(".framing-grid").hidden = !settings.grid;
  updateToggle("grid", settings.grid);
  updateToggle("handheld", settings.handheld);
  const enabled = Boolean(recording ? session?.handheld : settings.handheld);
  const badge = $("#stabilization-status");
  badge.hidden = !enabled && !recording;
  badge.classList.toggle("enabled", enabled);
  badge.title = enabled
    ? "Handheld stabilization will be applied during video export"
    : "Handheld stabilization is off for this recording";
  $("#stabilization-label").textContent =
    `Stabilization ${enabled ? "ON" : "OFF"}`;
}
$("#grid").onclick = () => {
  settings.grid = !settings.grid;
  saveSettings();
  updateCaptureOptions();
};
$("#handheld").onclick = () => {
  if (recording) return;
  settings.handheld = !settings.handheld;
  saveSettings();
  updateCaptureOptions();
};
updateCaptureOptions();
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    else toast("Use Add to Home Screen for a full screen experience.");
  } catch {
    toast("Full screen is unavailable in this browser.");
  }
};
$("#night-mode").onclick = () => {
  const dim = document.body.classList.toggle("dimmed");
  $("#night-mode").classList.toggle("on", dim);
  $("#night-mode").setAttribute("aria-pressed", String(dim));
  $("#night-mode").setAttribute(
    "aria-label",
    dim ? "Brighten screen" : "Dim screen",
  );
  $("#night-mode").title = dim ? "Brighten screen" : "Dim screen";
};
async function lock() {
  try {
    wake = await navigator.wakeLock?.request("screen");
  } catch {}
}
function setCaptureUI(on) {
  updateCaptureOptions();
  $("#record-label").textContent = on ? "Finish capture" : "Start capturing";
  $("#record").classList.toggle("recording", on);
  $("#record").setAttribute(
    "aria-label",
    on ? "Finish capture" : "Start capturing",
  );
  $(".live-recording").hidden = !on;
  $$(".controls select,.preset").forEach((e) => (e.disabled = on));
  $("#switch").disabled = on;
  $("#handheld").disabled = on;
  updateExposureUI();
  $("#capture-note").innerHTML = on
    ? "Keep this app open and your screen unlocked."
    : "Keep phone steady";
}
async function photograph() {
  const track = stream?.getVideoTracks()[0];
  if (!track || track.readyState !== "live")
    throw new Error("Camera disconnected.");
  if ("ImageCapture" in window) {
    try {
      return await new ImageCapture(track).takePhoto();
    } catch {}
  }
  const v = $("#camera");
  if (!v.videoWidth) throw new Error("Camera is not ready.");
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  return new Promise((res, rej) =>
    c.toBlob(
      (b) => (b ? res(b) : rej(new Error("Photo capture failed."))),
      "image/jpeg",
      0.94,
    ),
  );
}
async function captureFrame() {
  if (!recording || busy) return;
  busy = true;
  const begin = Date.now();
  try {
    const blob = await photograph();
    await db("frames", "readwrite", (o) =>
      o.add({ session: session.id, blob, time: Date.now() }),
    );
    session.count++;
    if (!session.thumb) {
      const bitmap = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = 480;
      c.height = (480 * bitmap.height) / bitmap.width;
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      session.thumb = c.toDataURL("image/jpeg", 0.7);
      bitmap.close();
    }
    session.elapsed = Date.now() - started;
    await putSession(session);
    $("#view-label").textContent =
      `${session.count} PHOTO${session.count === 1 ? "" : "S"} CAPTURED`;
    $("#view-detail").textContent =
      `${(session.count / settings.fps).toFixed(1)} seconds of timelapse`;
    if (
      settings.duration &&
      Date.now() - started >= settings.duration * 60000
    ) {
      busy = false;
      await stop();
      return;
    }
  } catch (e) {
    toast("Capture paused: " + e.message);
    busy = false;
    await stop();
    return;
  } finally {
    busy = false;
  }
  if (recording)
    timer = setTimeout(
      captureFrame,
      Math.max(0, settings.interval * 1000 - (Date.now() - begin)),
    );
}
async function start() {
  if (exporting) return toast("Wait for the video export to finish.");
  if (!stream && !(await connect())) return;
  if (!stream?.active) return toast("Reconnect your camera first.");
  try {
    await dbp;
    session = {
      id: crypto.randomUUID(),
      created: Date.now(),
      count: 0,
      fps: settings.fps,
      quality: settings.quality,
      interval: settings.interval,
      handheld: settings.handheld,
      elapsed: 0,
    };
    await putSession(session);
    started = Date.now();
    recording = true;
    $("#view-label").textContent = "Capturing";
    setCaptureUI(true);
    navigator.storage?.persist?.().catch(() => {});
    await lock();
    captureFrame();
  } catch (e) {
    toast("Local storage is unavailable: " + e.message);
  }
}
async function stop() {
  recording = false;
  clearTimeout(timer);
  while (busy) await new Promise((r) => setTimeout(r, 50));
  await wake?.release().catch(() => {});
  wake = null;
  setCaptureUI(false);
  if (session) {
    session.elapsed = Date.now() - started;
    await putSession(session);
    toast(`${session.count} photos saved on this device.`);
    await renderLibrary();
    if (session.count) openSession(session.id);
  }
}
$("#record").onclick = async () => {
  if ($("#record").disabled) return;
  $("#record").disabled = true;
  try {
    if (recording) await stop();
    else await start();
  } finally {
    $("#record").disabled = false;
  }
};
setInterval(() => {
  if (recording) {
    const s = Math.floor((Date.now() - started) / 1000);
    $("#live-time").textContent = `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }
}, 500);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && recording) {
    stop();
    toast("Capture stopped safely when the app went into the background.");
  } else if (recording) lock();
});
window.addEventListener("beforeunload", (e) => {
  if (recording || exporting) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function card(s) {
  return `<button class="story-card" data-session="${s.id}"><img src="${s.thumb || base + "aurora.jpg"}" alt="Session thumbnail"><span class="story-play">${icon("play")}</span><div><strong>${new Date(s.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${new Date(s.created).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</strong><span>${s.count} photos · ${(s.count / s.fps).toFixed(1)} sec</span></div></button>`;
}
async function renderLibrary() {
  try {
    const list = (await sessions())
      .filter((s) => s.count)
      .sort((a, b) => b.created - a.created);
    $("#library-count").textContent = list.length;
  } catch {
    toast(
      "Device storage is unavailable. Allow site storage to save captures.",
    );
  }
}
async function library() {
  const list = (await sessions())
    .filter((s) => s.count)
    .sort((a, b) => b.created - a.created);
  modal(
    `<h2>Timelapses</h2><div class="library-grid">${list.length ? list.map(card).join("") : '<div class="library-empty">No timelapses yet.</div>'}</div>`,
  );
  $$("[data-session]").forEach(
    (b) => (b.onclick = () => openSession(b.dataset.session)),
  );
}
$("#library-tab").onclick = library;
async function openSession(id) {
  const s = (await sessions()).find((x) => x.id === id);
  if (!s) return;
  modal(
    `<h2>Timelapse</h2><img class="session-cover" src="${s.thumb}" alt="First captured frame"><div class="session-stats"><span><strong>${s.count}</strong> photos</span><span><strong>${(s.count / s.fps).toFixed(1)}s</strong> at ${s.fps} fps</span><span><strong>${s.quality === 1920 ? "1080p" : "720p"}</strong> video</span></div><p id="export-status">${s.handheld ? "Handheld stabilization enabled. Corrections are applied where possible." : "Create a timelapse right here on your device."}</p><video id="export-preview" playsinline controls hidden></video><button class="light-btn wide" id="export">${icon("film")} Create timelapse</button>${s.handheld ? `<button class="text-btn wide" id="export-original">Create without stabilization</button>` : ""}<button class="text-btn wide" id="save-photo">${icon("download")} Save first photo</button><button class="text-btn danger wide" id="delete-session">${icon("trash")} Delete this session</button>`,
  );
  $("#export").onclick = () => exportVideo(s);
  if ($("#export-original"))
    $("#export-original").onclick = () =>
      exportVideo({ ...s, handheld: false });
  $("#save-photo").onclick = async () => {
    const f = await frames(id);
    if (f.length) download(f[0].blob, `aurora-${id.slice(0, 8)}.jpg`);
  };
  $("#delete-session").onclick = async () => {
    if (recording && session?.id === id)
      return toast("Finish the active session before deleting it.");
    if (exporting) return toast("Wait until export finishes.");
    if (!confirm("Delete this session and all its photos from this device?"))
      return;
    await db("frames", "readwrite", (o) => {
      const r = o.index("session").openCursor(id);
      r.onsuccess = () => {
        const c = r.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
    });
    await db("sessions", "readwrite", (o) => o.delete(id));
    $("#modal").close();
    await renderLibrary();
    toast("Session deleted.");
  };
}
function videoFilename(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${[date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join("-")}.mp4`;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportVideo(s) {
  if (recording) return toast("Finish capturing before creating a video.");
  if (exporting) return;
  const button = $("#export"),
    status = $("#export-status");
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    status.textContent =
      "Video export is unavailable in this browser. Try a recent Chrome or Safari browser. Your photos are safe.";
    return;
  }
  exporting = true;
  button.disabled = true;
  if ($("#export-original")) $("#export-original").disabled = true;
  $(".modal-close").disabled = true;
  let recorder, canvasStream, stabilizer, first;
  try {
    const data = await frames(s.id);
    if (!data.length) throw new Error("No photos found.");
    const mime = ["video/mp4;codecs=avc1.42E01E", "video/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mime)
      throw new Error(
        "MP4 encoding is unavailable in this browser. Open Aurora in a recent Chrome or Safari browser. Your photos are saved.",
      );
    await lock();
    first = await createImageBitmap(data[0].blob);
    const c = document.createElement("canvas");
    const ratio = first.width / first.height;
    c.width = ratio >= 1 ? s.quality : Math.round((s.quality * ratio) / 2) * 2;
    c.height = ratio >= 1 ? Math.round(s.quality / ratio / 2) * 2 : s.quality;
    const ctx = c.getContext("2d");
    const analysis = document.createElement("canvas");
    const factor = Math.min(1, 384 / Math.max(first.width, first.height));
    analysis.width = Math.max(1, Math.round(first.width * factor));
    analysis.height = Math.max(1, Math.round(first.height * factor));
    const analysisCtx = analysis.getContext("2d", { willReadFrequently: true });
    let motions = null,
      zoom = 1;
    const grayscale = (image) => {
      analysisCtx.drawImage(image, 0, 0, analysis.width, analysis.height);
      const rgba = analysisCtx.getImageData(
        0,
        0,
        analysis.width,
        analysis.height,
      ).data;
      const pixels = new Uint8Array(analysis.width * analysis.height);
      for (let i = 0; i < pixels.length; i++)
        pixels[i] =
          (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >>
          8;
      return { width: analysis.width, height: analysis.height, pixels };
    };
    let alignedFrames = 0;
    if (s.handheld && data.length > 1) {
      const samples = Array(data.length).fill(null);
      let referenceIndex = 0;
      try {
        stabilizer = new StabilizationWorker();
        const analyze = (type, image) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Frame alignment timed out.")),
              30000,
            );
            stabilizer.onmessage = ({ data }) => {
              clearTimeout(timeout);
              data.error ? reject(new Error(data.error)) : resolve(data);
            };
            stabilizer.onerror = () => {
              clearTimeout(timeout);
              reject(new Error("Frame alignment is unavailable."));
            };
            stabilizer.postMessage({ type, image }, [image.pixels.buffer]);
          });
        status.textContent = "Finding stable scene details…";
        let reference = await analyze("reference", grayscale(first));
        while (reference.features < 6 && referenceIndex < data.length - 1) {
          referenceIndex++;
          const image = await createImageBitmap(data[referenceIndex].blob);
          try {
            reference = await analyze("reference", grayscale(image));
          } finally {
            image.close();
          }
          status.textContent = `Finding stable scene details… ${Math.round(((referenceIndex + 1) / data.length) * 100)}%`;
        }
        if (reference.features >= 6) {
          samples[referenceIndex] = identity();
          for (let i = referenceIndex + 1; i < data.length; i++) {
            const image = await createImageBitmap(data[i].blob);
            try {
              const result = await analyze("align", grayscale(image));
              samples[i] = result.motion || null;
            } finally {
              image.close();
            }
            status.textContent = `Stabilizing frames… ${Math.round(((i + 1) / data.length) * 100)}%`;
          }
        }
      } catch {
        // Analysis is optional. Keep reliable results already collected and
        // continue encoding every original frame if the worker cannot continue.
      } finally {
        stabilizer?.terminate();
        stabilizer = null;
      }
      const result = completeMotions(
        samples,
        analysis.width,
        analysis.height,
        referenceIndex,
      );
      motions = result.motions;
      zoom = result.zoom;
      alignedFrames = result.aligned;
    }
    const draw = (image, index) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.save();
      if (motions) {
        const m = motions[index];
        // Invert reference -> current motion, then apply a constant center crop.
        const sx = c.width / analysis.width,
          sy = c.height / analysis.height;
        ctx.translate(c.width / 2, c.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-c.width / 2, -c.height / 2);
        ctx.transform(
          m.a,
          (-m.b * sy) / sx,
          (m.b * sx) / sy,
          m.a,
          (-m.a * m.x - m.b * m.y) * sx,
          (m.b * m.x - m.a * m.y) * sy,
        );
      }
      ctx.drawImage(image, 0, 0, c.width, c.height);
      ctx.restore();
    };
    draw(first, 0);
    first.close();
    canvasStream = c.captureStream(s.fps);
    recorder = new MediaRecorder(canvasStream, {
      mimeType: mime,
      videoBitsPerSecond: 8000000,
    });
    const chunks = [];
    const done = new Promise((res, rej) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () =>
        res(new Blob(chunks, { type: recorder.mimeType }));
      recorder.onerror = () => rej(new Error("Video encoding failed."));
    });
    recorder.start();
    const exportStarted = performance.now();
    for (let i = 0; i < data.length; i++) {
      const image = await createImageBitmap(data[i].blob);
      draw(image, i);
      image.close();
      status.textContent = `Creating your timelapse… ${Math.round(((i + 1) / data.length) * 100)}%`;
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(
            0,
            exportStarted + ((i + 1) * 1000) / s.fps - performance.now(),
          ),
        ),
      );
    }
    recorder.stop();
    const blob = await done;
    if (!blob.size) throw new Error("The browser returned an empty video.");
    const player = $("#export-preview");
    player.src = URL.createObjectURL(blob);
    player.hidden = false;
    $(".session-cover").hidden = true;
    status.textContent =
      !s.handheld || data.length < 2 || alignedFrames === data.length - 1
        ? "Your timelapse is ready to save."
        : alignedFrames
          ? "Your timelapse is ready. Stabilization was applied where possible."
          : "Your timelapse is ready. These frames could not be stabilized.";
    button.innerHTML = `${icon("download")} Save video`;
    button.onclick = () => download(blob, videoFilename(s.created));
  } catch (e) {
    status.textContent = "Export failed: " + e.message;
    button.innerHTML = "Try export again";
    button.onclick = () => exportVideo(s);
  } finally {
    first?.close();
    stabilizer?.terminate();
    if (recorder?.state === "recording") recorder.stop();
    canvasStream?.getTracks().forEach((t) => t.stop());
    await wake?.release().catch(() => {});
    wake = null;
    exporting = false;
    button.disabled = false;
    if ($("#export-original")) $("#export-original").disabled = false;
    $(".modal-close").disabled = false;
  }
}
function tips() {
  modal(
    `<h2>Capture help</h2><div class="guide"><article>${icon("mountain")}<div><h3>Find your dark corner</h3><p>Leave city lights behind. Find a clear northern horizon and check your local aurora forecast.</p></div></article><article>${icon("camera")}<div><h3>Keep it steady</h3><p>Use a tripod, clean your lens, and turn off nearby lights. A power bank helps on long, cold nights.</p></div></article><article>${icon("clock")}<div><h3>Give the sky some time</h3><p>Start with a 5-second interval and 30 minutes. Fast auroras look better at 1–3 seconds; stars need 10–15 seconds.</p></div></article><article>${icon("moon")}<div><h3>Know your camera</h3><p>This app uses the camera controls your browser provides. Native night mode and long exposures may be unavailable. Check a saved photo before a long session.</p></div></article><article>${icon("shield")}<div><h3>Stay with the night</h3><p>Keep the app visible and your screen unlocked. Capture stops safely in the background. Photos stay in this browser; save your video before clearing site data.</p></div></article></div>`,
  );
}
$("#help").onclick = tips;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
$("#install").onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
  } else
    modal(
      `<h2>Install Aurora</h2><p>Install Aurora for a full screen experience and offline access after your first visit.</p><div class="install-guide"><h3>iPhone or iPad</h3><p>Open in Safari, tap Share, then choose <strong>Add to Home Screen</strong>.</p><h3>Android</h3><p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><h3>Desktop</h3><p>Use the install icon in your browser address bar when available.</p></div>`,
    );
};
$("#modal").addEventListener("cancel", (e) => {
  if (exporting) e.preventDefault();
});
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal") && !exporting) $("#modal").close();
});
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register(base + "sw.js").catch(() => {}),
  );
renderLibrary();
