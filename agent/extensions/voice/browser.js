// The page side of the voice extension: a microphone button left of the send button. Click to dictate, click again
// to stop; each finished piece of speech is added to the input (to read, fix and send). /voice/voice.js does the
// listening: the server's speech to text when it has STT_BASE_URL, else the browser's own recognition.
// While dictating, the icon is a sound wave whose bars follow the microphone's loudness (its own AnalyserNode, so
// it works in both modes).
import voice from "/voice/voice.js";

const SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" ' +
  'stroke-linejoin="round">';
const MIC = SVG + '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const WAVE = SVG + [4, 8, 12, 16, 20].map((x) => `<line x1="${x}" x2="${x}" y1="10" y2="14"/>`).join("") + "</svg>";
const SHAPE = [0.45, 0.8, 1, 0.75, 0.5];  // the middle bars reach higher

export default function (page) {
  const input = document.getElementById("text");
  const button = document.createElement("button");
  button.type = "button";  // in the form: not a send
  button.className = "mic";
  button.dataset.name = "dictate";
  button.title = "Dictate";
  button.innerHTML = MIC;
  input.after(button);
  const style = document.createElement("style");
  style.textContent = "#f button.mic.on { color: #fff; background: #e5484d; border-color: #e5484d; }";
  document.head.append(style);

  let on = false, stopWave = null;

  // the wave: loudness (RMS of the mic's samples) sets the bars' height, each wobbling a little on its own
  async function startWave() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    button.innerHTML = WAVE;
    const bars = button.querySelectorAll("line");
    let level = 0, frame;
    const draw = (t) => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
      level += (Math.min(1, rms * 8) - level) * 0.3;  // smoothed: rises and falls over a few frames
      bars.forEach((bar, i) => {
        const half = 1 + 8 * level * SHAPE[i] * (0.7 + 0.3 * Math.sin(t / 90 + i * 1.7));
        bar.setAttribute("y1", 12 - half);
        bar.setAttribute("y2", 12 + half);
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); stream.getTracks().forEach((tr) => tr.stop()); ctx.close(); button.innerHTML = MIC; };
  }

  const set = (state) => {
    on = state;
    button.classList.toggle("on", on);
    button.title = on ? "Stop dictating" : "Dictate";
    if (!on && stopWave) { stopWave(); stopWave = null; }
  };
  button.addEventListener("click", async () => {
    if (on) return voice.stop();
    set(true);
    startWave().then((stop) => { if (on) stopWave = stop; else stop(); }).catch(() => {});  // no wave: still dictates
    await voice.start((text) => {
      input.value = input.value.trim() ? `${input.value.trimEnd()} ${text}` : text;
      input.focus();
    }, { onState: (state, detail) => {
      if (state === "error") { page.note(`voice: ${detail}`); voice.stop(); set(false); }
      if (state === "off") set(false);
    } });
  });
}
