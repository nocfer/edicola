# Fixture corpus

Real feed and article documents checked in verbatim. Every parser or extraction
bug found in the wild becomes a fixture here before it is fixed. Planned set
(one per format and per failure mode): RSS 2.0, Atom, RSS 1.0/RDF, JSON Feed,
a feed with `content:encoded`, a truncated feed, a feed with malformed XML, an
article Readability extracts well, an article that yields under 200 words, and
an article with inline images at absolute and relative URLs.
