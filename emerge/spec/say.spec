spec:

  # ════════════════════════════════════════════════════════════════════════════
  # say.spec — coding in his own language
  # James, 2026-10-31: "Also it's meant for me. To make coding easy for me using my own language. Ai is additive. Also
  # it's working towards removing the dependency of ai." · on what his quote index was for: "that was the point of the
  # quotes from mne" · on the coder's reading (his words → their meaning → Emerge, deterministically; a model only for a
  # gap, and each gap closed once): "yes, im trying to remove as much friction from me and the code as possibel"
  # Earlier, 2026-07-09: "emerge is meant to cut down 90% of tokens, warp some and speed it up and compound it".
  # His decisions: section 0 of cie-eg.spec (for_its_author, ai_is_additive, toward_no_ai_dependency). The design below
  # (a vocabulary of his words with their evidence, a deterministic reader, teach to close a gap) is the coder's,
  # built on his toolkit's crystal-memory rule: "verify, test, crystalized."
  # ════════════════════════════════════════════════════════════════════════════

  meta:
    name:        say
    version:     0.1.0
    author:      james-brooks
    created_at:  2026-10-31T00:00:00Z
    status:      building
    uuid:        emerge-say-v0-1-0-2026-1031-jamesbrooks-001
    language_stack: [emerge]
    purpose: >
      A sentence in his own words becomes Emerge code that checks clean, with no model. Every word understood is shown
      with the quote of his it came from; every word not understood is a gap, named, never guessed. A gap closes once,
      by eg teach, and never needs anything again.
    tagline: "His words in, his code out. No model in between."

  modules:

    - id:    MOD-SAY-WORDS
      name:  words
      uuid:  emerge-say-words-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        lang/say/words.eg. His vocabulary as Emerge data (literal only, like core/primitives.eg). Each entry: the forms
        he uses (his spellings), what it means in his words, what it does in Emerge (one of the reader's acts), and the
        evidence: his quote, its date and where it is recorded (Nexus docs/his-words). lang/say/taught.eg holds what eg
        teach added: a new phrase as another form of an existing word.
      exports:
        - "words → list of { forms: list of string, means: string, does: string, from: list of { said, date, where } }"
        - "filler → list of string   (his words that carry no instruction: like, maybe, need, want, make, …)"
        - "taught → list of { form, as }   (lang/say/taught.eg)"
      gate_pipeline:
        - "GATE-SW-001: every entry has at least one form, a meaning, an act the reader knows, and at least one quote with a date"
        - "GATE-SW-002: no form belongs to two entries"
      behavioral_contracts:
        - "A word enters only with his quote behind it; a taught form names the existing word it means."
      error_paths:
        - "an entry without evidence → the reader refuses to load and names it"

    - id:    MOD-SAY
      name:  reader
      uuid:  emerge-say-reader-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        lang/say/say.eg. Reads a sentence against the vocabulary, longest phrase first, and builds the meaning: what it
        is (compartment, component, test, program), its name, its intent (his end state), its state fields, its gates
        (never negative, at most N), its events (when X, add to Y), its door (one way in, one way out), whether each
        change is recorded on the ledger, and whether it is proven by a test. Then writes the Emerge source.
      deps:
        - { name: words }
      exports:
        - "understand(sentence) → { kind, name, intent, fields, gates, events, door, record, test, used, gaps }"
        - "source(meaning) → string   (Emerge source)"
        - "report(meaning) → string   (what was understood, with his quotes; the gaps)"
      gate_pipeline:
        - "GATE-SAY-001: split into clauses (. ; ,) and words; longest form first"
        - "GATE-SAY-002: each content word is a known form, a name, a number, or a gap"
        - "GATE-SAY-003: the meaning has a kind and a name, or each missing part is a gap"
        - "GATE-SAY-004: the source is written only from the meaning, never from guesses"
      behavioral_contracts:
        - "The same sentence always gives the same source, byte for byte."
        - "No model is called. Nothing is guessed: an unknown word is reported as a gap with the command that would teach it."
      error_paths:
        - "no kind → a gap: say what it is (compartment, component, test, program)"
        - "no name → a gap: say what it is called (called <Name>)"

    - id:    MOD-SAY-CLI
      name:  cli
      uuid:  emerge-say-cli-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        eg say "<sentence>" [folder]: run the reader, check the source with the Emerge checker, write it to
        emerge/output (or folder) only when it checks clean, and print the report. eg teach "<phrase>" as <word>:
        add the phrase as a form of a known word. eg words: list his vocabulary with its evidence.
      deps:
        - { name: reader }
        - { name: words }
      exports:
        - "eg say \"<sentence>\" [folder] → exit 0 and the file, or exit 1 and the gaps / checker errors"
        - "eg teach \"<phrase>\" as <word> → the phrase added to lang/say/taught.eg"
        - "eg words → the vocabulary, each word with its quote"
      gate_pipeline:
        - "GATE-SC-001: the source passes the checker before it is written"
        - "GATE-SC-002: a file that exists is never overwritten"
        - "GATE-SC-003: teach refuses a phrase that is already a form, or a word that does not exist"
      behavioral_contracts:
        - "Gaps make no file: the report says what to say or teach."
      error_paths:
        - "checker errors → printed, no file, exit 1"
