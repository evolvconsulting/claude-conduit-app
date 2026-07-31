# Reconstructed example fixtures

These are **reconstructed from Claude Desktop's own decompiled write logic** (see
`../FINDINGS.md`), not copied from a real, empirically-observed run — this dev machine's Claude
Desktop install had never been configured for 3P gateway, so there was nothing real to capture.
Confidence is high (the exact functions that produce these files are quoted in FINDINGS.md), but
they should be treated as "derived from source," not "observed," until a real click-through
confirms them.

- `meta.initial.json` — `_meta.json` immediately after Claude Desktop's own `LZ()` lazily creates
  a "Default" entry on first-ever access (before any user configuration).
- `default-entry.example.json` — the corresponding `configLibrary/<Default's id>.json`, which
  `LZ()` writes as `{}` initially.
- `meta.after-apply.json` — `_meta.json` after this app's planned NCOW-1.7 writer creates and
  applies its own dedicated "NIM Proxy Manager" entry, per the revised approach in FINDINGS.md
  (never touching the pre-existing "Default" entry).
- `nim-proxy-entry.example.json` — the corresponding gateway config content for that entry.
- `meta.after-revert.json` — `_meta.json` after reverting, mirroring Claude Desktop's own `vPt()`:
  since no existing entry already had `inferenceProvider: "anthropic"` in this scenario, a new
  `"Claude API"` entry was created and applied.
