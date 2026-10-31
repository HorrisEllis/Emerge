# data-nexus-export-2026-09 — archived 2026-10-31 (EAS1, Nexus docs/2026-10-31-emerge-as-a-system-phasemap.spec)

What it is: a node export of the old IDE server's routes (emerge.check, .codegen, .compile, .files, .health, .hot.load,
.models, .seams, .snapshot) and an `emerge` system record, written by Nexus's node-export on 2026-09-12 in the old envelope
shape (`payload` with namespace/name/route). Its index (node-index/) held the same nodes with paths from the machine that
exported them (/home/claude/work/merged/...).

Why it moved: genesis's skeleton owns data/nodes/ and data/node-index/ now, and indexes every node there against its own
schemas; these nodes are in another shape and would be refused. Nothing in Emerge read them. The same routes live on in
ide-registry.js (the IDE server's registry, emerge-ide.js). Kept, not deleted (§0.3).
