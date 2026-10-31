def top_word(text):
    words = [w for w in text.lower().split(" ") if w]
    if not words:
        return None
    counts = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    return min(counts, key=lambda w: (-counts[w], w))
