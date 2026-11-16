// Outer Control: the meaningful words of a text, for checks that compare two texts by what they say (does a step rest on the person's
// situation; does a result use the person's context; is every part of a request answered). Pure, no dependencies.

const STOP = new Set(("about above after again also among because been before being below between both could does doing down during each from further have having " +
  "here into itself just more most other over same should some such than that their them then there these they this those through under until very what when " +
  "where which while will with would your yours you're they're it's isn't aren't don't doesn't didn't won't can't cannot").split(" "));

/** The words that carry meaning: numbers, and words of 4 or more letters that are not common function words. Lower case. */
export const contentWords = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter((w) => /\d/.test(w) || (w.length >= 4 && !STOP.has(w)));

/** A word's first five letters: "candles" and "candle", "budgeting" and "budget" match. */
export const stem = (w: string) => w.slice(0, 5);

/** The stems of the meaningful words of a text, once each. */
export const stems = (s: string): Set<string> => new Set(contentWords(s).map(stem));
