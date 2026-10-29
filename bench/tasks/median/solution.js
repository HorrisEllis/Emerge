exports.median = function median(xs) {
  if (xs.length === 0) throw new Error('empty list');
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length, mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
