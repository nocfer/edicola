// The three things a reader can do to an Item from a template: Save it, Share
// its Original, and open its Original. Written once because two screens offer
// them — the Reader's header and Feed mode's action bar — and a second copy of
// the Web Share call with its clipboard fallback is a second place for the
// fallback to rot.
//
// These take the stored row itself and mutate the field they wrote, the way
// `reader.js` already did: the screens hold their Items in module state and
// mutate in place so `repeat`'s keys and the list's height do not move. The
// database write itself belongs to `item-state.js`, which owns the `0 | 1`
// rule and the `savedAt` stamp.
//
// The copy is deliberately the Reader's `reader.*` keys rather than a second
// set: the messages are the same messages, and the reader who sees "Saved" from
// a card should read exactly what they read from the Reader.

import { getDatabase } from "./db.js";
import { t } from "./i18n.js";
import { setItemSaved } from "./item-state.js";
import { showToast } from "./state.js";

/** @typedef {import('./db.js').ItemRow} ItemRow */

/**
 * Flip `saved` on one Item and say so. A Saved Item and its Article are never
 * Evicted (CONTEXT.md), which is why the toast says what changed rather than
 * only confirming the tap.
 *
 * @param {ItemRow | { id: string, saved: unknown }} item The stored row; its
 *   `saved` field is updated in place on success.
 * @returns {Promise<void>}
 */
export async function toggleItemSaved(item) {
  if (!item) return;
  const next = !item.saved;
  try {
    const written = await setItemSaved(getDatabase(), item.id, next);
    item.saved = written.saved;
    showToast(t(next ? "reader.savedToast" : "reader.unsavedToast"));
  } catch (error) {
    console.warn("Saved could not be written:", error);
    showToast(t("reader.saveFailed"));
  }
}

/**
 * Share the Original through the system sheet, falling back to copying the
 * link. A dismissed sheet is not a failure and says nothing.
 *
 * @param {{ title?: string, link?: string | null }} item
 * @returns {Promise<void>}
 */
export async function shareItem(item) {
  const link = item?.link;
  if (!link) return;
  const payload = { title: item.title || t("reader.title"), url: link };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      if (/** @type {any} */ (error)?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    showToast(t("reader.shareCopied"));
  } catch (error) {
    console.warn("The link could not be shared:", error);
    showToast(t("reader.shareFailed"));
  }
}
