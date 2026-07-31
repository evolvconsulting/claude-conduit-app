# macOS

Path: `~/Library/Application Support/Claude-3p/configLibrary/`

Analyzed directly: Claude.app 1.24012.9 was installed on the dev machine used for this research
(see `../FINDINGS.md` for the full static-analysis writeup — the `app.asar` bundle was extracted
and its `configLibrary` read/write logic read directly). No live sample existed on this machine
since 3P gateway had never been configured here, so the fixtures in `../fixtures/` are
reconstructed from that logic rather than copied from a real run.
