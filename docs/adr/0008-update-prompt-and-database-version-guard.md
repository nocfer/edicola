---
status: accepted
---
# New versions are applied on the reader's confirmation, guarded by a database version

When a new service worker is installed, the app shows an update prompt rather
than switching silently; on confirmation it activates and reloads every tab
together. The app version is also stamped into the database on each migration,
and a Shell older than the database forces a reload instead of running old code
against newer data. Dexie migrations are additive only: never rename or drop a
table, add a new one and copy. We accepted the extra step because the failure
we are preventing is losing a reader's Saved Articles, which no amount of
convenience justifies.
