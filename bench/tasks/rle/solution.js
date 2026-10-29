exports.rle = function rle(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += s[i] + (j - i);
    i = j;
  }
  return out;
};
