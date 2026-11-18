// Pure game logic: no DOM, no audio. Easy to test and to reuse server-side later.

export const TONES = [1, 2, 3, 4, 5, 6];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A shuffled draw pile that cycles through every word before repeating. */
export function createDeck(words, rng = Math.random) {
  if (!words.length) throw new Error("createDeck: no words");
  return { words, rng, pile: [], last: null };
}

export function drawWord(deck) {
  if (deck.pile.length === 0) {
    deck.pile = shuffle([...deck.words], deck.rng);
    // Pile is drawn from the end; avoid repeating the previous word across reshuffles.
    const top = deck.pile.length - 1;
    if (deck.pile.length > 1 && deck.pile[top] === deck.last) {
      [deck.pile[0], deck.pile[top]] = [deck.pile[top], deck.pile[0]];
    }
  }
  deck.last = deck.pile.pop();
  return deck.last;
}

export function scoreGuess(word, guesses) {
  if (guesses.length !== word.syllables.length || guesses.some((g) => g == null)) {
    throw new Error("scoreGuess: need a guess for every syllable");
  }
  const perSyllable = word.syllables.map((s, i) => s.tone === guesses[i]);
  return { perSyllable, allCorrect: perSyllable.every(Boolean) };
}

export function emptyStats() {
  const confusion = {};
  for (const a of TONES) {
    confusion[a] = {};
    for (const g of TONES) confusion[a][g] = 0;
  }
  return { words: 0, wordsCorrect: 0, syllables: 0, syllablesCorrect: 0, streak: 0, bestStreak: 0, confusion };
}

/** Returns new stats; does not mutate the input. */
export function recordResult(stats, word, guesses) {
  const { perSyllable, allCorrect } = scoreGuess(word, guesses);
  const confusion = structuredClone(stats.confusion);
  word.syllables.forEach((s, i) => confusion[s.tone][guesses[i]]++);
  const streak = allCorrect ? stats.streak + 1 : 0;
  return {
    words: stats.words + 1,
    wordsCorrect: stats.wordsCorrect + (allCorrect ? 1 : 0),
    syllables: stats.syllables + perSyllable.length,
    syllablesCorrect: stats.syllablesCorrect + perSyllable.filter(Boolean).length,
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    confusion,
  };
}
