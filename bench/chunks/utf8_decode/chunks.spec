spec:
  meta:
    name:    utf8-decode-chunks
    version: 1.0.0
    date:    2026-10-28
    source:  "cie-eg.spec s02_text_model.strict_decoding (2.2) and s15_chunks"
    purpose: >
      Strict UTF-8 decoding, written two ways for the chunk benchmark: as one monolith task, and as minimal units, each
      with its boundary declared at every edge. A unit sees only its own boundary and the signatures of the units it
      may call (its edges), never their code. Prompts are built from this file, nothing else.
    representation: "bytes are a list of numbers 0..255; code points are numbers"

  # The minimal reducible units, in build order. Each still executes alone and has its own tests.
  units:
    - id: seq_len
      signature: "fn seq_len(b0: num): num"
      does: "Given the first byte of a UTF-8 sequence, return how many bytes the sequence has (1 to 4), or 0 if this byte can never start a valid sequence."
      boundary:
        in:  { b0: "number 0..255" }
        out: "1, 2, 3, 4 or 0"
        invariants:
          - "0x00..0x7F → 1"
          - "0xC2..0xDF → 2   (0xC0 and 0xC1 → 0: they could only start overlong forms)"
          - "0xE0..0xEF → 3"
          - "0xF0..0xF4 → 4   (0xF5..0xFF → 0: beyond U+10FFFF)"
          - "0x80..0xBF → 0   (continuation bytes cannot start a sequence)"
      examples: ["seq_len(0x41) == 1", "seq_len(0xC3) == 2", "seq_len(0xE2) == 3", "seq_len(0xF0) == 4", "seq_len(0x80) == 0"]
      deps: []
      tests: |
        test "seq_len" {
          expect seq_len(0x00) == 1
          expect seq_len(0x7F) == 1
          expect seq_len(0x80) == 0
          expect seq_len(0xBF) == 0
          expect seq_len(0xC0) == 0
          expect seq_len(0xC1) == 0
          expect seq_len(0xC2) == 2
          expect seq_len(0xDF) == 2
          expect seq_len(0xE0) == 3
          expect seq_len(0xEF) == 3
          expect seq_len(0xF0) == 4
          expect seq_len(0xF4) == 4
          expect seq_len(0xF5) == 0
          expect seq_len(0xFF) == 0
        }

    - id: is_cont
      signature: "fn is_cont(b: num): bool"
      does: "True if b is a UTF-8 continuation byte."
      boundary:
        in:  { b: "number 0..255" }
        out: bool
        invariants: ["true exactly for 0x80..0xBF"]
      examples: ["is_cont(0x80) == true", "is_cont(0x41) == false"]
      deps: []
      tests: |
        test "is_cont" {
          expect is_cont(0x80) == true
          expect is_cont(0xBF) == true
          expect is_cont(0x7F) == false
          expect is_cont(0xC0) == false
          expect is_cont(0x00) == false
          expect is_cont(0xFF) == false
        }

    - id: lead_bits
      signature: "fn lead_bits(b0: num, n: num): num"
      does: "The payload bits of a first byte, for a sequence of n bytes."
      boundary:
        in:  { b0: "number 0..255", n: "1..4, from seq_len(b0)" }
        out: "number"
        invariants:
          - "n == 1 → b0 unchanged"
          - "n == 2 → b0 & 0x1F"
          - "n == 3 → b0 & 0x0F"
          - "n == 4 → b0 & 0x07"
      examples: ["lead_bits(0x41, 1) == 0x41", "lead_bits(0xC3, 2) == 0x03", "lead_bits(0xE2, 3) == 0x02", "lead_bits(0xF0, 4) == 0"]
      deps: []
      tests: |
        test "lead_bits" {
          expect lead_bits(0x41, 1) == 0x41
          expect lead_bits(0xC3, 2) == 0x03
          expect lead_bits(0xDF, 2) == 0x1F
          expect lead_bits(0xE2, 3) == 0x02
          expect lead_bits(0xEF, 3) == 0x0F
          expect lead_bits(0xF4, 4) == 0x04
          expect lead_bits(0xF0, 4) == 0x00
        }

    - id: add_cont
      signature: "fn add_cont(acc: num, b: num): num"
      does: "Append the 6 payload bits of continuation byte b to the code point built so far."
      boundary:
        in:  { acc: "number, the code point so far", b: "a continuation byte 0x80..0xBF" }
        out: "number"
        invariants: ["result == (acc << 6) | (b & 0x3F)"]
      examples: ["add_cont(0x03, 0xA9) == 0xE9", "add_cont(0x02, 0x82) == 0x82"]
      deps: []
      tests: |
        test "add_cont" {
          expect add_cont(0x03, 0xA9) == 0xE9
          expect add_cont(0x02, 0x82) == 0x82
          expect add_cont(0x82, 0xAC) == 0x20AC
          expect add_cont(0, 0x80) == 0
          expect add_cont(1, 0xBF) == 0x7F
        }

    - id: valid_scalar
      signature: "fn valid_scalar(cp: num, n: num): bool"
      does: "True if code point cp, decoded from n bytes, is allowed: not overlong, not a surrogate, not above U+10FFFF."
      boundary:
        in:  { cp: "number", n: "1..4, the number of bytes it was decoded from" }
        out: bool
        invariants:
          - "overlong → false: n == 2 and cp < 0x80, n == 3 and cp < 0x800, n == 4 and cp < 0x10000"
          - "surrogate → false: 0xD800 <= cp <= 0xDFFF"
          - "too large → false: cp > 0x10FFFF"
          - "otherwise true"
      examples: ["valid_scalar(0xE9, 2) == true", "valid_scalar(0x41, 2) == false", "valid_scalar(0xD800, 3) == false"]
      deps: []
      tests: |
        test "valid_scalar" {
          expect valid_scalar(0x41, 1) == true
          expect valid_scalar(0xE9, 2) == true
          expect valid_scalar(0x7F, 2) == false
          expect valid_scalar(0x800, 3) == true
          expect valid_scalar(0x7FF, 3) == false
          expect valid_scalar(0xD7FF, 3) == true
          expect valid_scalar(0xD800, 3) == false
          expect valid_scalar(0xDFFF, 3) == false
          expect valid_scalar(0xE000, 3) == true
          expect valid_scalar(0xFFFF, 4) == false
          expect valid_scalar(0x10000, 4) == true
          expect valid_scalar(0x10FFFF, 4) == true
          expect valid_scalar(0x110000, 4) == false
        }

    - id: decode
      signature: "fn decode(bs: list): map"
      does: "Strictly decode a list of bytes. Return { ok: true, cps: [code points] }, or { ok: false, offset: i } where i is the index of the first byte of the first bad sequence. Never replace or skip a bad byte."
      boundary:
        in:  { bs: "list of numbers 0..255" }
        out: "{ ok: true, cps: list } or { ok: false, offset: number }"
        invariants:
          - "walk from index 0; n = seq_len(byte); n == 0 → fail at this index"
          - "a sequence that runs past the end → fail at its first byte"
          - "every following byte must pass is_cont, else fail at the sequence's first byte"
          - "cp starts as lead_bits, then add_cont for each following byte"
          - "valid_scalar(cp, n) false → fail at the sequence's first byte"
          - "empty list → { ok: true, cps: [] }"
      examples:
        - "decode([0x41, 0xC3, 0xA9]) == { ok: true, cps: [0x41, 0xE9] }"
        - "decode([0x41, 0xFF]) == { ok: false, offset: 1 }"
      deps: [seq_len, is_cont, lead_bits, add_cont, valid_scalar]
      tests: &decode_tests |
        test "decode valid" {
          expect decode([]) == { ok: true, cps: [] }
          expect decode([0x41, 0x42]) == { ok: true, cps: [0x41, 0x42] }
          expect decode([0xC3, 0xA9]) == { ok: true, cps: [0xE9] }
          expect decode([0xE2, 0x82, 0xAC]) == { ok: true, cps: [0x20AC] }
          expect decode([0xF0, 0x9F, 0x98, 0x80]) == { ok: true, cps: [0x1F600] }
          expect decode([0x41, 0xE2, 0x82, 0xAC, 0x42]) == { ok: true, cps: [0x41, 0x20AC, 0x42] }
          expect decode([0xF4, 0x8F, 0xBF, 0xBF]) == { ok: true, cps: [0x10FFFF] }
        }
        test "decode refuses with the offset" {
          expect decode([0x80]) == { ok: false, offset: 0 }
          expect decode([0x41, 0xFF]) == { ok: false, offset: 1 }
          expect decode([0xC0, 0x80]) == { ok: false, offset: 0 }
          expect decode([0xE0, 0x80, 0x80]) == { ok: false, offset: 0 }
          expect decode([0xED, 0xA0, 0x80]) == { ok: false, offset: 0 }
          expect decode([0xF4, 0x90, 0x80, 0x80]) == { ok: false, offset: 0 }
          expect decode([0x41, 0xE2, 0x82]) == { ok: false, offset: 1 }
          expect decode([0x41, 0x42, 0xC3, 0x41]) == { ok: false, offset: 2 }
          expect decode([0xF0, 0x9F, 0x98]) == { ok: false, offset: 0 }
          expect decode([0xC3, 0xC3]) == { ok: false, offset: 0 }
          expect decode([0x41, 0xE2, 0x82, 0xFF]) == { ok: false, offset: 1 }
          expect decode([0xF0, 0x9F, 0xC0, 0x80]) == { ok: false, offset: 0 }
        }

  # The same job as one task: one prompt, no boundaries declared, tested by the same decode tests.
  monolith:
    signature: "fn decode(bs: list): map"
    task: >
      Write a strict UTF-8 decoder. Input: a list of byte values 0..255. Return { ok: true, cps: [code points] } if the whole
      list is valid UTF-8, otherwise { ok: false, offset: i } where i is the index of the first byte of the first invalid
      sequence. Reject overlong encodings, surrogates (U+D800..U+DFFF), code points above U+10FFFF, bad continuation bytes and
      truncated sequences. Never replace or skip a bad byte.
    tests: *decode_tests
