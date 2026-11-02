// Voice input for apps: speech from the microphone, as text. An app imports it:
//   import voice from "/voice/voice.js";
//   await voice.start(onText, opts)  start listening; onText(text) gets each finished piece of speech, in order
//                                    opts: language ("en", optional), onState(state, detail) with state one of
//                                    "listening", "speech", "sending", "off", "error" (detail: the message)
//   voice.stop()                     stop listening; a piece still being spoken is sent first
//   voice.mode()                     "api" or "browser", known after start
// "api" (the server has STT_BASE_URL: the voice extension's index.ts): the mic is cut into pieces at pauses
// (2 to 10 s), each sent as a complete audio file to /voice/transcribe; silent pieces aren't sent.
// "browser": the browser's own speech recognition (Chrome, Edge, Safari; audio goes to their vendor).
const shot = new URLSearchParams(window.top.location.search).has("shot");  // a screenshot: don't listen
let mode = null, stopNow = null;

async function start(onText, { language = "", onState = () => {} } = {}) {
  if (shot || stopNow) return;
  const config = await fetch("/voice/config").then((r) => r.json()).catch(() => ({ api: false }));
  mode = config.api ? "api" : "browser";
  stopNow = mode === "api" ? await startApi(onText, language, onState) : startBrowser(onText, language, onState);
}

function stop() {
  if (stopNow) stopNow();
  stopNow = null;
}

// ---------- api: pauses by loudness, one complete file per piece ----------
const QUIET_MS = 700, MIN_MS = 2000, MAX_MS = 10000;

async function startApi(onText, language, onState) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { onState("error", "microphone: " + e.message); return null; }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  let floor = 0.005;          // the room's quiet level, learned as it goes
  let recorder = null, began = 0, spoke = false, quietSince = null;
  let lastText = "", queue = Promise.resolve();

  // A recorder makes one complete file from start() to stop(); timeslice chunks would lack the file header.
  function newPiece() {
    const old = recorder, hadSpeech = spoke;
    recorder = new MediaRecorder(stream);
    recorder.start();          // start the next piece before stopping this one: no gap between them
    began = Date.now(); spoke = false; quietSince = null;
    if (!old) return;
    old.ondataavailable = (e) => { if (hadSpeech) queue = queue.then(() => send(e.data)); };
    old.stop();
  }

  async function send(blob) {  // one at a time, in order: each gets the text before it as its prompt
    const form = new FormData();
    form.append("file", blob, "chunk." + (blob.type.split(/[/;]/)[1] || "webm"));
    if (language) form.append("language", language);
    if (lastText) form.append("prompt", lastText.slice(-200));
    onState("sending");
    try {
      const r = await fetch("/voice/transcribe", { method: "POST", body: form });
      const data = await r.json();
      if (data.error) return onState("error", data.error);
      if (data.text.trim()) { lastText = data.text; onText(data.text.trim()); }
      onState("listening");
    } catch (e) { onState("error", "transcribe: " + e.message); }
  }

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
    const speaking = rms > Math.max(0.008, floor * 3);
    floor += (rms - floor) * (speaking ? 0.001 : 0.05);  // follows the room, slowly while someone speaks
    const now = Date.now(), age = now - began;
    if (speaking) { if (!spoke) onState("speech"); spoke = true; quietSince = null; }
    else quietSince ??= now;
    if (spoke && quietSince && now - quietSince > QUIET_MS && age > MIN_MS) newPiece();
    else if (age > MAX_MS) newPiece();  // a long speech is cut anyway; silence just starts over
  }, 50);

  newPiece();
  onState("listening");
  return () => {
    clearInterval(timer);
    newPiece();                // send what was being said
    recorder.ondataavailable = null;
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    onState("off");
  };
}

// ---------- browser: its speech recognition, restarted when it ends by itself ----------
function startBrowser(onText, language, onState) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onState("error", "no speech recognition in this browser, and no STT_BASE_URL in the sandbox"); return null; }
  const rec = new SR();
  let on = true;
  rec.continuous = true;
  rec.interimResults = false;
  if (language) rec.lang = language;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++)
      if (e.results[i].isFinal && e.results[i][0].transcript.trim()) onText(e.results[i][0].transcript.trim());
  };
  rec.onspeechstart = () => onState("speech");
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") onState("error", e.error); };
  rec.onend = () => { if (on) setTimeout(() => on && rec.start(), 300); };  // it stops after silence or minutes
  rec.start();
  onState("listening");
  return () => { on = false; rec.stop(); onState("off"); };
}

export default { start, stop, mode: () => mode };
