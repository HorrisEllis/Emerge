def median(xs):
    if not xs:
        raise ValueError("empty list")
    s = sorted(xs)
    n, mid = len(s), len(s) // 2
    return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2
