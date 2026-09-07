---
status: accepted
---
# Parsing and Extraction are tested in Node with an injected DOM and real fixtures

Feed parsing and Extraction need a DOM, and the repo has no committed
`node_modules` or browser driver. So both take their DOM implementation as a
parameter: the browser passes `DOMParser` and `document`, tests pass jsdom,
installed on demand into the gitignored `node_modules` by `npm test` (never
committed, never a `package.json` dependency). Tests run under `node --test`
against a corpus of real Feed and Original documents checked into
`test/fixtures/`; every parser bug found later becomes a fixture first. Screens
are verified visually over Chrome DevTools Protocol as in SkyHue, not by unit
tests.

## Considered options

- Browser-only testing over CDP: truthful to production but slow and fragile.
- Mocking the DOM: rejected because Readability's behaviour on real markup is
  the thing under test.
- linkedom instead of jsdom: rejected because DOMPurify silently returns its
  input unsanitized on a DOM it does not support, which would make every
  sanitizer test pass vacuously. The test helper asserts `isSupported` so this
  can never regress quietly.
