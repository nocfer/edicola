---
status: accepted
---
# No telemetry, no error reporting, no data leaves the device

Edicola sends nothing anywhere except the Feed and Original requests the reader
asked for (and their Proxy fallback). No analytics, no crash reporting, no
remote config. This is a product boundary, not an omission: the app's pitch is
that reading habits stay on the reader's device. Reopening this requires a new
ADR and an opt-in.
