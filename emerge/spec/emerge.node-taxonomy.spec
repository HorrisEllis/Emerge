# emerge — node types

Every node is one file at `data/nodes/<type>/<id>.<type>`, checked against `schemas/schema.<type>` and indexed in the
JAA table `nodes_<type>` (history in `nodes_<type>_ledger`).

| type | what it is | required |
|---|---|---|
| component | a unit of code; connects only to the registry | file, intent, version, status, capabilities, hooks |
| capability | what a component can do | component, summary, commands |
| command | one way to invoke a capability (CLI and route) | capability, cli, events |
| event | what a command emits | command, payload |
| route | an HTTP path that runs a command | method, path, command |
| hook | a component's end point | component, direction, kind |
| wire | a connection between two hooks | from, to |
| bundle | references to every node related to one capability (written by the listener) | capability, members |

A new node type is a new folder plus its schema; the listener picks it up.
