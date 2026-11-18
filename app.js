const syllables = {
  si: [
    { id: 1, icon: "ˉ", jyutping: "si1", yale: "sī",  char: "詩", gloss: "poetry" },
    { id: 2, icon: "ˊ", jyutping: "si2", yale: "sí",  char: "史", gloss: "history" },
    { id: 3, icon: "˗", jyutping: "si3", yale: "si",  char: "試", gloss: "test" },
    { id: 4, icon: "ˋ", jyutping: "si4", yale: "sìh", char: "時", gloss: "time" },
    { id: 5, icon: "ˏ", jyutping: "si5", yale: "síh", char: "市", gloss: "market" },
    { id: 6, icon: "ˍ", jyutping: "si6", yale: "sih", char: "是", gloss: "to be" },
  ],
  fu: [
    { id: 1, icon: "ˉ", jyutping: "fu1", yale: "fū",  char: "夫", gloss: "husband" },
    { id: 2, icon: "ˊ", jyutping: "fu2", yale: "fú",  char: "虎", gloss: "tiger" },
    { id: 3, icon: "˗", jyutping: "fu3", yale: "fu",  char: "富", gloss: "rich" },
    { id: 4, icon: "ˋ", jyutping: "fu4", yale: "fùh", char: "符", gloss: "symbol" },
    { id: 5, icon: "ˏ", jyutping: "fu5", yale: "fúh", char: "婦", gloss: "woman" },
    { id: 6, icon: "ˍ", jyutping: "fu6", yale: "fuh", char: "父", gloss: "father" },
  ],
};

let currentSyllable = "si";
let currentToneId = null;
let systemMode = "jyutping";
let currentAudio = null;
let feedbackLocked = false;
let feedbackTimeout = null;

function setMode(mode) {
  systemMode = mode;
  document.getElementById("btn-jyutping").classList.toggle("active", mode === "jyutping");
  document.getElementById("btn-yale").classList.toggle("active", mode === "yale");
  renderGrid();
}

function setSyllable(name) {
  currentSyllable = name;
  document.querySelectorAll(".syllable-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.syllable === name);
  });
  cancelFeedback();
  renderGrid();
}

function renderSyllableSelector() {
  const row = document.getElementById("syllable-selector");
  row.innerHTML = "";
  Object.keys(syllables).forEach(name => {
    const btn = document.createElement("button");
    btn.className = "toggle-btn syllable-btn" + (name === currentSyllable ? " active" : "");
    btn.dataset.syllable = name;
    btn.textContent = name;
    btn.onclick = () => setSyllable(name);
    row.appendChild(btn);
  });
}

function renderGrid() {
  const tones = syllables[currentSyllable];
  const grid = document.getElementById("tone-grid");
  grid.innerHTML = "";
  tones.forEach(tone => {
    const btn = document.createElement("button");
    btn.className = "tone-btn";
    btn.id = `tone-btn-${tone.id}`;
    btn.disabled = currentToneId === null;
    btn.onclick = () => handleGuess(tone.id);
    btn.innerHTML = `
      <span class="tone-number">${tone.id}</span>
      <span class="tone-icon">${tone.icon}</span>
      <span class="tone-label">${systemMode === "jyutping" ? tone.jyutping : tone.yale}</span>
      <span class="tone-example">${tone.char}</span>
    `;
    grid.appendChild(btn);
  });
}

function playAudio(toneId) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  currentAudio = new Audio(`audio/${currentSyllable}${toneId}.mp3`);
  currentAudio.play().catch(() => {
    setInstruction("⚠ Audio file not found. Run generate_audio.py first.");
  });
}

function playRandom() {
  cancelFeedback();
  currentToneId = Math.floor(Math.random() * 6) + 1;
  clearFeedback();
  playAudio(currentToneId);
  document.getElementById("replay-btn").disabled = false;
  setGridEnabled(true);
  setInstruction("Which tone did you hear?");
}

function replay() {
  if (currentToneId !== null) playAudio(currentToneId);
}

function handleGuess(guessedId) {
  if (currentToneId === null || feedbackLocked) return;
  feedbackLocked = true;

  const guessedBtn = document.getElementById(`tone-btn-${guessedId}`);
  const correctBtn = document.getElementById(`tone-btn-${currentToneId}`);

  if (guessedId === currentToneId) {
    guessedBtn.classList.add("correct");
    setInstruction("✓ Correct!");
  } else {
    guessedBtn.classList.add("incorrect");
    correctBtn.classList.add("reveal");
    setInstruction(`✗ That was tone ${currentToneId}.`);
  }

  feedbackTimeout = setTimeout(() => {
    feedbackTimeout = null;
    feedbackLocked = false;
    clearFeedback();
    setGridEnabled(false);
    currentToneId = null;
    document.getElementById("replay-btn").disabled = true;
    setInstruction("Press Play to hear a tone, then select the matching button.");
  }, 700);
}

function cancelFeedback() {
  if (feedbackTimeout) {
    clearTimeout(feedbackTimeout);
    feedbackTimeout = null;
  }
  feedbackLocked = false;
}

function clearFeedback() {
  document.querySelectorAll(".tone-btn").forEach(btn => {
    btn.classList.remove("correct", "incorrect", "reveal");
  });
}

function setGridEnabled(enabled) {
  document.querySelectorAll(".tone-btn").forEach(btn => {
    btn.disabled = !enabled;
  });
}

function setInstruction(text) {
  document.getElementById("instruction").textContent = text;
}

renderSyllableSelector();
renderGrid();
