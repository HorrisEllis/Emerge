spec:

  # ════════════════════════════════════════════════════════════════════════════
  # learn.spec — lessons that break themselves down
  # James, 2026-10-31: "dynamically breaks lessons down to help comprehention and reduce overwhlem"
  # His earlier words this stands on:
  #   2026-10-13: "everything can be broken down into smaller pieces, with gates between. dynamic chunking for smaller
  #     agents or if the agent is struggling?"
  #   2026-10-02: "need increments of zoom. like each system is a node, which zooming in has the components as nodes."
  #   2026-10-28: "stub: just the notes from the input. chunked: decomposed pieces of the component, dynamically
  #     recursive chunking."
  #   his framework (docs/innovation-toolkit.framework, Nexus): "The liminal/interstitial space flattens overwhelm."
  #   2026-10-31: "only using hardcoded when neccarry, using external node files for data, options, etc."
  # The design (zoom levels stub / chunked / full, then lines, then words; a reader who zooms in twice in a row gets
  # smaller steps from then on, one who moves easily gets them larger again) is the coder's reading of those words.
  # ════════════════════════════════════════════════════════════════════════════

  meta:
    name:        learn
    version:     0.1.0
    author:      james-brooks
    created_at:  2026-10-31T00:00:00Z
    status:      built (emerge 1.12.0)
    uuid:        emerge-learn-v0-1-0-2026-1031-jamesbrooks-001
    language_stack: [emerge]
    purpose: >
      Any lesson in docs/learn, shown at the size the reader can take: the idea alone, one small step at a time, or
      whole; any step opened into its lines and any line into its words, each word said plainly and then exactly.
      When the reader keeps asking for smaller, the steps get smaller on their own; when the reader moves easily,
      they grow back. No model; the same keys always give the same view.
    tagline: "Zoom in until it is small enough. Never more than you can hold."

  modules:

    - id:    MOD-LEARN-BREAK
      name:  breakdown
      uuid:  emerge-learn-breakdown-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        lang/learn/learn.eg. Reads a lesson (docs/learn/<n>-*.md) and the glossary (docs/learn/words.md) and builds the
        zoom tree: the stub (the idea in one line and the first thing to try), the steps (the idea; each code block cut
        into chunks of at most chunk_lines lines, each chunk with the explanations that name what is in it; the
        remaining explanations; the system view; each "your turn" item), each step's lines (a code line, or a sentence),
        and each line's words (every glossary word found in it, plainly then exactly).
      exports:
        - "tree(lesson_text, words_text, opts) → { title, stub: list, steps: list of { kind, text, lines: list of { text, words } } }"
        - "glossary(words_text) → list of { word, plain, exact }"
      gate_pipeline:
        - "GATE-LB-001: sections split on '## '; code blocks kept whole as text, never reflowed"
        - "GATE-LB-002: a code block is cut at blank lines, then into chunks of at most chunk_lines lines"
        - "GATE-LB-003: an explanation joins the first chunk that holds a word it puts in backticks; the rest stand alone"
        - "GATE-LB-004: a word is found in a line only as a whole word (or through the keyword map in learn.node)"
      behavioral_contracts:
        - "Nothing of the lesson is lost: every line of every section is in some step."
        - "The same lesson and node file always give the same tree."
      error_paths:
        - "no lesson with that number → a named error listing the lessons"

    - id:    MOD-LEARN-VIEW
      name:  view
      uuid:  emerge-learn-view-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        lang/learn/learn.eg. The view after a list of keys, from the start: n (next), b (back), m (more: zoom in),
        l (less: zoom out), s (stub), f (full). Zoom 0 is the stub, 1 a step, 2 a step's lines one by one, 3 a line's
        words. Dynamic: after struggle_after zoom-ins in a row the reader's base zoom goes one deeper, so the next steps
        open already broken down, and it says so; after easy_after nexts without zooming it comes back up. The
        thresholds and the chunk size are levers in lang/learn/learn.node.
      deps:
        - { name: breakdown }
      exports:
        - "view(tree, keys, opts) → { text, zoom, base, step, at, said }"
      gate_pipeline:
        - "GATE-LV-001: keys are replayed from the start, so the view is a pure function of the keys"
        - "GATE-LV-002: a change of base zoom is announced in the view, never silent"
      behavioral_contracts:
        - "Every view shows where the reader is (step k of n, zoom name) and what each key does."
        - "No view holds more than one step, one line or one word, except full."
      error_paths:
        - "an unknown key → named in the view, the view unchanged"

    - id:    MOD-LEARN-CLI
      name:  cli
      uuid:  emerge-learn-cli-v0-1-0-2026-1031-jamesbrooks-001
      description: >
        eg learn: the list of lessons. eg learn <n> [--stub | --full] [--keys <keys>]: one view, printed. On a terminal,
        eg learn <n> waits for a key after each view and shows the next. The reading and the deciding are in Emerge;
        the command only passes keys and prints.
      deps:
        - { name: view }
        - { name: breakdown }
      exports:
        - "eg learn → the lessons, numbered"
        - "eg learn <n> [--stub | --full] [--keys <keys>] → a view"
      gate_pipeline:
        - "GATE-LC-001: a lesson number that does not exist → the list, exit 1"
      behavioral_contracts:
        - "Not on a terminal (a pipe, a test), it prints the view for the given keys and exits."
      error_paths:
        - "the docs/learn folder missing → a named error"
