// Inicialització global
let audioCtx;
let isPlaying = true;
let analyser;
let transpose = 0; // en semitons

// Elements del DOM
const waveformSelect = document.getElementById("waveform");
const gainSlider = document.getElementById("gain");

const attackSlider = document.getElementById("attack");
const decaySlider = document.getElementById("decay");
const sustainSlider = document.getElementById("sustain");
const releaseSlider = document.getElementById("release");

const filterTypeSelect = document.getElementById("filterType");
const filterFreqSlider = document.getElementById("filterFreq");

const panSlider = document.getElementById("pan");
const delayTimeSlider = document.getElementById("delayTime");
const feedbackSlider = document.getElementById("feedback");

const canvas = document.getElementById("oscilloscope");
const canvasCtx = canvas.getContext("2d");

const upOctaveBtn = document.getElementById("upOctave");
const downOctaveBtn = document.getElementById("downOctave");
const upSemitoneBtn = document.getElementById("upSemitone");
const downSemitoneBtn = document.getElementById("downSemitone");

// Mapa de notes amb freqüències
const baseNoteFreq = {
  "C": 261.63,
  "C#": 277.18,
  "D": 293.66,
  "D#": 311.13,
  "E": 329.63,
  "F": 349.23,
  "F#": 369.99,
  "G": 392.00,
  "G#": 415.30,
  "A": 440.00,
  "A#": 466.16,
  "B": 493.88
};

const noteOrder = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function getTransposedFreq(note) {
  const index = noteOrder.indexOf(note);
  if (index === -1) return null;
  const midi = 60 + index + transpose;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Oscil·loscopi
function drawOscilloscope() {
  requestAnimationFrame(drawOscilloscope);

  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  canvasCtx.fillStyle = "#1a002b";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = "#ff8ae2";
  canvasCtx.beginPath();

  const sliceWidth = canvas.width / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;
    i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y);
    x += sliceWidth;
  }

  canvasCtx.lineTo(canvas.width, canvas.height / 2);
  canvasCtx.stroke();
}

function clearCanvas() {
  canvasCtx.fillStyle = "#1a002b";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
}

// Funció per tocar una nota
function playNote(note) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  const freq = getTransposedFreq(note);
  if (!freq) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const pan = audioCtx.createStereoPanner();
  const delay = audioCtx.createDelay();
  const feedback = audioCtx.createGain();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  const now = audioCtx.currentTime;

  const attack = parseFloat(attackSlider.value);
  const decay = parseFloat(decaySlider.value);
  const sustain = parseFloat(sustainSlider.value);
  const release = parseFloat(releaseSlider.value);

  const delayTime = parseFloat(delayTimeSlider.value);
  const feedbackGain = parseFloat(feedbackSlider.value);

  const filterFreq = parseFloat(filterFreqSlider.value);
  const filterType = filterTypeSelect.value;
  const panVal = parseFloat(panSlider.value);

  osc.type = waveformSelect.value;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + attack);
  gain.gain.linearRampToValueAtTime(sustain, now + attack + decay);
  gain.gain.setTargetAtTime(0, now + attack + decay + 0.1, release);

  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreq, now);
  pan.pan.setValueAtTime(panVal, now);

  delay.delayTime.value = delayTime;
  feedback.gain.setValueAtTime(feedbackGain, now);

  osc.connect(filter);
  filter.connect(pan);
  pan.connect(gain);
  gain.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(analyser);
  analyser.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + attack + decay + release + 0.2);

  drawOscilloscope();

  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

// --- Suport MIDI via Web MIDI API ---

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess()
    .then(onMIDISuccess, onMIDIFailure);
} else {
  console.warn("Web MIDI API no està suportada en aquest navegador.");
}

function onMIDISuccess(midiAccess) {
  console.log("MIDI ready!");
  // Assigna handler per a totes les entrades MIDI
  for (let input of midiAccess.inputs.values()) {
    input.onmidimessage = handleMIDIMessage;
  }

  // Detecta dispositius connectats/desconnectats
  midiAccess.onstatechange = (event) => {
    console.log(event.port.name, event.port.manufacturer, event.port.state);
    if(event.port.state === "connected" && event.port.type === "input") {
      event.port.onmidimessage = handleMIDIMessage;
    }
  };
}

function onMIDIFailure() {
  console.error("No s'ha pogut accedir al dispositiu MIDI.");
}

// Conversió MIDI note number a nota musical (nom simple)
const midiNotes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiNoteToName(noteNumber) {
  // Opcionalment pots ajustar per octava, ara només retorna nota
  return midiNotes[noteNumber % 12];
}

// Control de notes MIDI
function handleMIDIMessage(event) {
  const [status, noteNumber, velocity] = event.data;

  const command = status & 0xf0;
  // 144 = note on, 128 = note off
  if (command === 144 && velocity > 0) {
    const noteName = midiNoteToName(noteNumber);
    if (noteName) {
      playNote(noteName);
      highlightKey(noteName, true);
    }
  } else if (command === 128 || (command === 144 && velocity === 0)) {
    const noteName = midiNoteToName(noteNumber);
    if (noteName) {
      highlightKey(noteName, false);
    }
  }
}

// Transposició
upOctaveBtn.addEventListener("click", () => (transpose += 12));
downOctaveBtn.addEventListener("click", () => (transpose -= 12));
upSemitoneBtn.addEventListener("click", () => (transpose += 1));
downSemitoneBtn.addEventListener("click", () => (transpose -= 1));

// Mapa de tecles del teclat
const keyMap = {
  "a": "C",  "w": "C#", "s": "D",  "e": "D#", "d": "E",
  "f": "F",  "t": "F#", "g": "G",  "y": "G#", "h": "A",
  "u": "A#", "j": "B"
};

// Per evitar repeticions
const activeKeys = new Set();

// Teclat físic
document.addEventListener("keydown", e => {
  if (!isPlaying) return;
  const note = keyMap[e.key];
  if (note && !activeKeys.has(e.key)) {
    activeKeys.add(e.key);
    playNote(note);
    highlightKey(note);
  }
});

document.addEventListener("keyup", e => {
  const note = keyMap[e.key];
  if (note) {
    activeKeys.delete(e.key);
    unhighlightKey(note);
  }
});

// Click al piano virtual
const pressedKeys = new Set();

document.addEventListener("keydown", e => {
  if (!isPlaying || pressedKeys.has(e.key)) return;

  const note = keyMap[e.key];
  if (note) {
    playNote(note);
    highlightKey(note, true);
    pressedKeys.add(e.key);
  }
});

document.addEventListener("keyup", e => {
  const note = keyMap[e.key];
  if (note) {
    highlightKey(note, false);
    pressedKeys.delete(e.key);
  }
});

// Funció per ressaltar visualment la tecla
function highlightKey(note, isActive) {
  const key = document.querySelector(`.key[data-note="${note}"]`);
  if (!key) return;
  if (isActive) {
    key.classList.add("active");
  } else {
    key.classList.remove("active");
  }
}

// Mostrar valors dels sliders
const sliderMap = [
  { slider: attackSlider, valueEl: "attackValue" },
  { slider: decaySlider, valueEl: "decayValue" },
  { slider: sustainSlider, valueEl: "sustainValue" },
  { slider: releaseSlider, valueEl: "releaseValue" },
  { slider: filterFreqSlider, valueEl: "filterFreqValue" },
  { slider: panSlider, valueEl: "panValue" },
  { slider: delayTimeSlider, valueEl: "delayTimeValue" },
  { slider: feedbackSlider, valueEl: "feedbackValue" },
  { slider: gainSlider, valueEl: "gainValue" },
  { slider: document.getElementById("filterQ"), valueEl: "filterQValue" }
];

sliderMap.forEach(({ slider, valueEl }) => {
  const el = document.getElementById(valueEl);
  const update = () => el.textContent = parseFloat(slider.value).toFixed(2);
  slider.addEventListener("input", update);
  update(); // inicialitza
});

// Inicialització
clearCanvas();
