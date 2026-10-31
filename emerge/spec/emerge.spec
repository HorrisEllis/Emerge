# emerge — the living spec. Built from the nexus-system skeleton (COS archetype nexus-system), whose architecture
# is genesis (idearium/spec-engine/templates/genesis.spec). The registry and the nodes are the system; this spec says
# what it is for and grows with it.
spec:
  identity:
    system: emerge
    name: emerge
    owns: [data/nodes, data/node-index, data/ledger, schemas, interaction-contract.json, emerge.config.json]
    heartbeat: "emerge.heartbeat — uptime, node counts, problems (lib/heartbeat.js)"
  context:
    purpose: >-
      Emerge: his language and its compiler, as a sovereign system
    axioms:
      - every component connects only to the registry
      - each component has at least one capability; each capability at least one command; each command its events — each a node
      - every node type has its own folder, its own schema and its own JAA index
      - the system owns its data, schemas, contract, config, heartbeat and pulse
      - hardcoded has to earn its place
  file_structure: >-
    server.js · cli.js · config.js · emerge.config.json · compartment.json · registry-components.js ·
    interaction-contract.json · event-taxonomy.js · jaa-store.js · contracts/ · schemas/ · data/ · lib/ · spec/ · tests/
  modules:
    - id: emerge.core
      file: lib/core.js
      capabilities:
        - id: emerge.core.observe
          commands: [emerge.status, emerge.nodes]
  components: []   # the idea's components, as they are added to registry-components.js
  generated: [interaction-contract (GET /contract), event-taxonomy, node-index, bundles]
