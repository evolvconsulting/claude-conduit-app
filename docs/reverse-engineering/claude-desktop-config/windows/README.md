# Windows

Path: `%LOCALAPPDATA%\Claude-3p\configLibrary\`

Not independently verified on Windows hardware — no Windows machine was available for this
research. Confidence that the schema matches macOS/Linux is high because Electron ships one
identical JS bundle across all three platforms; the only platform-specific branch found in the
decompiled code was the base-directory path resolution itself (an explicit
`process.platform !== "win32"` / `process.env.LOCALAPPDATA` check sitting right next to the
`configLibrary` path builder — see `../FINDINGS.md`), not anything schema-related. Still, this is
an assumption, not a direct observation — a real Windows run (either by decompiling a Windows
Claude Desktop install, or by clicking through the real UI once) would be worth doing before
fully trusting the automated writer on that platform.
