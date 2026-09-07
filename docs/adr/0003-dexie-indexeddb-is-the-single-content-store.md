---
status: accepted
---
# IndexedDB via Dexie is the single store for content, including image blobs

Items, Articles, image blobs, read state and settings all live in one IndexedDB
database accessed through Dexie. The Cache API is used only for the Shell and
CDN modules, never for content. We chose one store so Retention, Eviction, and
"how much space am I using" are one query, and a delete cannot leave orphans in
a second system. Image blobs go into IndexedDB rather than the Cache API for the
same reason. We chose Dexie over raw IndexedDB because the schema has several
related tables with cascading deletes and versioned migrations, which is a lot
of boilerplate to get subtly wrong without it.

## Consequences

- Persistent storage is requested on first Sync (`navigator.storage.persist`),
  otherwise the browser may evict the database and silently break offline.
- Schema changes are additive only (see ADR-0008).
- Article HTML rewrites `<img src>` to point at the stored blob at render time.
