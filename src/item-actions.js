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
import { savedFields, setItemSaved } from "./item-state.js";
import { motionToken, prefersReducedMotion } from "./motion.js";
import { showToast, update } from "./state.js";

/** @typedef {import('./db.js').ItemRow} ItemRow */

/**
 * The Save pop: the bookmark dips to .86 and springs back past its own size
 * before settling, on `--dur-pop` and `--ease-pop`. The only overshoot in the
 * app, and only under the finger.
 *
 * Repeated taps re-pop rather than queue. Nothing is cancelled and nothing is
 * awaited: `composite: 'replace'` means the newest animation replaces every
 * earlier one on `transform` outright, and the browser then drops the ones it
 * has replaced. The demo's prose says a tap continues "from the current scale";
 * its code replays .86 → 1, and that is what ships — the dip is the feedback,
 * so a second tap that barely dips reads as a tap that did not register.
 *
 * @param {EventTarget | null | undefined} button The tapped control.
 * @returns {void}
 */
function popSave(button) {
  const el = /** @type {HTMLElement | null} */ (button);
  // Reduced motion needs its own branch here: styles.css zeroes every
  // `transition-duration` under the media query, and a WAAPI animation ignores
  // that rule entirely. The state still flips, it just does not spring.
  if (!el?.animate || prefersReducedMotion()) return;
  el.animate([{ transform: "scale(.86)" }, { transform: "scale(1)" }], {
    duration: Number.parseFloat(motionToken("--dur-pop")) * 1000,
    easing: motionToken("--ease-pop"),
    composite: "replace",
  });
}

/**
 * Flip `saved` on one Item and say so. A Saved Item and its Article are never
 * Evicted (CONTEXT.md), which is why the toast says what changed rather than
 * only confirming the tap.
 *
 * The flip is optimistic: the icon changes and the spring starts before the
 * write is attempted, because a bookmark that waits on IndexedDB pops a frame
 * after the finger has already left it. If the write fails the icon returns on
 * the same curve and the failure toast still says so, so the animation is
 * never a promise the store has not kept.
 *
 * Redrawing belongs here rather than to the two callers: the redraw has to
 * happen before the write is awaited, which is not something a caller writing
 * `await toggleItemSaved(item)` can do.
 *
 * @param {ItemRow | { id: string, saved: unknown }} item The stored row; its
 *   `saved` and `savedAt` fields are updated in place.
 * @param {EventTarget | null} [button] The tapped control, to pop.
 * @returns {Promise<void>}
 */
export async function toggleItemSaved(item, button) {
  if (!item) return;
  const next = !item.saved;
  const before = {
    saved: item.saved,
    savedAt: /** @type {any} */ (item).savedAt,
  };
  Object.assign(item, savedFields(next));
  popSave(button);
  update();
  try {
    const written = await setItemSaved(getDatabase(), item.id, next);
    Object.assign(item, written);
    showToast(t(next ? "reader.savedToast" : "reader.unsavedToast"));
  } catch (error) {
    console.warn("Saved could not be written:", error);
    Object.assign(item, before);
    popSave(button);
    showToast(t("reader.saveFailed"));
  }
  update();
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
