---
status: accepted
---
# Parsing and Extraction are tested in Node with an injected DOM and real fixtures

Feed parsing and Extraction need a DOM, and the repo has no `node_modules` or
browser driver. So both take their DOM implementation as a parameter: the
browser passes `DOMParser` and `document`, tests pass linkedom fetched on
demand. Tests run under `node --test` against a corpus of real Feed and Original
documents checked into `test/fixtures/`; every parser bug found later becomes a
fixture first. Screens are verified visually over Chrome DevTools Protocol as in
SkyHue, not by unit tests. We rejected browser-only testing because it is slow
and fragile, and we rejected mocking the DOM because Readability's behaviour on
real markup is the thing under test.
