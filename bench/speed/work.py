def rle(s):
    if not s: return ""
    out, cur, run = [], s[0], 0
    for ch in s:
        if ch == cur: run += 1
        else: out.append(cur + str(run)); cur, run = ch, 1
    out.append(cur + str(run)); return "".join(out)
def median(xs):
    s = sorted(xs); n = len(s); mid = n // 2
    return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2
N, seed, chars, nums = 200000, 12345, [], []
for i in range(N):
    seed = (seed * 1664525 + 1013904223) % 4294967296; hi = seed // 65536
    chars.append("a" if hi % 4 == 0 else "b"); nums.append(hi % 1000)
r = rle("".join(chars)); print(len(r)); x = median(nums); print(int(x) if x == int(x) else x)
