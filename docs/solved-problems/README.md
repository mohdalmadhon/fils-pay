# Solved problems

Records of implemented fixes: the symptom, root cause, evidence, changed
code, validation, and remaining limitations. An entry means a code fix
exists in the working tree; it does not imply deployment or historical
data repair.

| Problem | Fix | Remaining work |
|---|---|---|
| [001 — Scheme export rounding mismatch](001-scheme-export-rounding.md) | Derive both scheme amount columns from the same truncated integer fils value | Reconcile historical exports, confirm the acquirer's conversion rule, resolve the separate migration failure |

For future entries, use the next number and a descriptive filename. Include
before/after examples and links to the affected code. Line numbers reflect
the code when the entry was written; use function names if lines move.

