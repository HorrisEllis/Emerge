function rle(s) {
  if (s.length === 0) return '';
  const out = []; let cur = s[0], run = 0;
  for (const ch of s) { if (ch === cur) run++; else { out.push(cur + run); cur = ch; run = 1; } }
  out.push(cur + run); return out.join('');
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b), n = s.length, mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const N = 200000; let seed = 12345; const chars = [], nums = [];
for (let i = 0; i < N; i++) { seed = (seed * 1664525 + 1013904223) % 4294967296; const hi = Math.floor(seed / 65536); chars.push(hi % 4 === 0 ? 'a' : 'b'); nums.push(hi % 1000); }
const r = rle(chars.join('')); console.log(r.length); console.log(median(nums));
