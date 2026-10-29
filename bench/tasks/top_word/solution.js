exports.top_word = function top_word(text) {
  const words = text.toLowerCase().split(' ').filter(w => w !== '');
  if (words.length === 0) return null;
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  let best = null, bestN = 0;
  for (const w of [...counts.keys()].sort()) if (counts.get(w) > bestN) { best = w; bestN = counts.get(w); }
  return best;
};
