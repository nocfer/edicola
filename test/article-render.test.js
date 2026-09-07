// Mapping an Article's images to the blobs a Sync stored. This is the seam the
// Reader depends on for "the Article is complete offline": given this stored
// markup and these rows in the `images` table, this markup goes to the page,
// and these object URLs must be revoked afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowFor } from "../tools/testing/dom.js";
import { prepareArticle, revokeObjectUrls } from "../src/article-render.js";

/** The same rule `imageKeyFor` follows — a key derived from the URL alone. */
async function fakeKeyFor(url) {
  return `key:${url}`;
}

/**
 * A stand-in for the `images` table: `bulkGet` over a Map, exactly the one
 * call `prepareArticle` makes.
 * @param {Record<string, Blob>} byUrl
 */
function fakeDb(byUrl) {
  const rows = new Map(
    Object.entries(byUrl).map(([url, blob]) => [
      `key:${url}`,
      { key: `key:${url}`, url, blob, bytes: blob.size, itemId: "i" },
    ]),
  );
  return {
    images: {
      bulkGet: async (keys) => keys.map((key) => rows.get(key)),
    },
  };
}

/** Object URLs that count how often they were handed out and revoked. */
function fakeUrls() {
  const created = [];
  const revoked = [];
  return {
    created,
    revoked,
    createObjectURL(blob) {
      const url = `blob:fake/${created.length}`;
      created.push({ url, blob });
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
}

/** @param {string} html @param {Record<string, Blob>} images */
function prepare(html, images, urls = fakeUrls()) {
  return prepareArticle(html, {
    db: fakeDb(images),
    imageKeyFor: fakeKeyFor,
    windowFor,
    createObjectURL: urls.createObjectURL,
  });
}

const PHOTO = "https://pub.test/photo.jpg";
const MISSING = "https://pub.test/missing.jpg";

test("a stored image is served from its blob, not the network", async () => {
  const blob = new Blob(["bytes"], { type: "image/jpeg" });
  const result = await prepare(
    `<p>Text</p><figure><img src="${PHOTO}" alt="A photo"><figcaption>Caption</figcaption></figure>`,
    { [PHOTO]: blob },
  );
  assert.equal(result.fromStorage, 1);
  assert.equal(result.fromNetwork, 0);
  assert.equal(result.objectUrls.length, 1);
  assert.match(result.html, /src="blob:fake\/0"/);
  assert.ok(!result.html.includes(PHOTO), "the network URL is gone");
  assert.match(result.html, /alt="A photo"/);
  assert.match(result.html, /<figcaption>Caption<\/figcaption>/);
});

test("an image with no stored blob falls back to its URL, lazily", async () => {
  const result = await prepare(`<img src="${MISSING}">`, {});
  assert.equal(result.fromStorage, 0);
  assert.equal(result.fromNetwork, 1);
  assert.deepEqual(result.objectUrls, []);
  assert.match(result.html, new RegExp(`src="${MISSING}"`));
  assert.match(result.html, /loading="lazy"/);
  assert.match(result.html, /referrerpolicy="no-referrer"/);
});

test("every image is lazy, decoded off-thread and referrer-free", async () => {
  const blob = new Blob(["bytes"], { type: "image/png" });
  const result = await prepare(`<img src="${PHOTO}">`, { [PHOTO]: blob });
  assert.match(result.html, /loading="lazy"/);
  assert.match(result.html, /decoding="async"/);
  assert.match(result.html, /referrerpolicy="no-referrer"/);
});

test("one object URL per image, however often it is referenced", async () => {
  const blob = new Blob(["bytes"], { type: "image/jpeg" });
  const urls = fakeUrls();
  const result = await prepare(
    `<img src="${PHOTO}"><p>Between</p><img src="${PHOTO}">`,
    { [PHOTO]: blob },
    urls,
  );
  assert.equal(urls.created.length, 1);
  assert.equal(result.objectUrls.length, 1);
  assert.equal(result.html.match(/blob:fake\/0/g)?.length, 2);
});

test("a data-URI image is left alone and looked up nowhere", async () => {
  const inline = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const result = await prepare(`<img src="${inline}">`, {});
  assert.equal(result.fromStorage, 0);
  assert.equal(result.fromNetwork, 0);
  assert.match(result.html, new RegExp(`src="${inline}"`));
});

test("an Article with no images needs no database round trip", async () => {
  const db = {
    images: {
      bulkGet: async () => {
        throw new Error("bulkGet must not be called");
      },
    },
  };
  const result = await prepareArticle("<p>Just words.</p>", {
    db,
    imageKeyFor: fakeKeyFor,
    windowFor,
    createObjectURL: () => "blob:never",
  });
  assert.deepEqual(result.objectUrls, []);
  assert.match(result.html, /<p>Just words\.<\/p>/);
});

test("an unreadable images table still renders the Article", async () => {
  const db = {
    images: {
      bulkGet: async () => {
        throw new Error("IndexedDB is gone");
      },
    },
  };
  const result = await prepareArticle(`<img src="${PHOTO}">`, {
    db,
    imageKeyFor: fakeKeyFor,
    windowFor,
    createObjectURL: () => "blob:never",
  });
  assert.equal(result.fromStorage, 0);
  assert.equal(result.fromNetwork, 1);
  assert.match(result.html, new RegExp(`src="${PHOTO}"`));
});

test("revoking hands every object URL back, and survives a bad one", () => {
  const urls = fakeUrls();
  const revoked = revokeObjectUrls(["blob:a", "blob:b"], urls);
  assert.equal(revoked, 2);
  assert.deepEqual(urls.revoked, ["blob:a", "blob:b"]);
  assert.equal(
    revokeObjectUrls(["blob:c"], {
      revokeObjectURL: () => {
        throw new Error("already forgotten");
      },
    }),
    0,
  );
});
