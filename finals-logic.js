/* finals-logic.js — "when is my final?", from data/finals.json.
 *
 * The registrar publishes the final-exam grid as RULES ("classes starting at 1:30 on M, W,
 * and/or F"), not as a list of courses. room-finals/build_finals.py applies those rules to
 * every course's lecture time once, offline, so this file only looks things up.
 *
 * It says WHEN, never WHERE: no public source names an exam room (Bulletin, End-Quarter
 * Examinations; probed 2026-10-29), and a final is often not in the lecture room. And a
 * course the grid cannot place ("off") is said as "ask your instructor", never rounded to
 * the nearest slot.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FinalsLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9&]/g, "");

  const CODE = /([A-Z&]+(?:\s[A-Z&]+)?)\s*(\d+[A-Z]*)/g;

  /** Course codes in free text: "cs106b, EE 102A ms&e319" -> matching keys of data.courses. */
  function find(data, text) {
    return scan(data, text).found;
  }

  /** Both halves: the codes found, and the code-shaped words that are not in the file —
   *  a course with no timed lecture (a seminar, directed reading) must be SAID to be
   *  missing, not dropped, or the list reads as complete. */
  function scan(data, text) {
    const byNorm = new Map(Object.keys(data.courses).map((k) => [norm(k), k]));
    const found = [], unknown = [];
    for (const m of String(text).toUpperCase().matchAll(CODE)) {
      const k = byNorm.get(norm(m[1] + m[2]));
      const label = `${m[1]} ${m[2]}`.replace(/\s+/g, " ");
      if (k) { if (!found.includes(k)) found.push(k); }
      else if (!unknown.includes(label)) unknown.push(label);
    }
    return { found, unknown };
  }

  /** One row per course: its slots, or why there is none. */
  function rows(data, codes) {
    // chronological by first slot; "sections" sort by their earliest, then off, then none
    const rank = (r) => (r.slots.length ? r.slots[0].i : r.state === "off" ? 1e3 : 2e3);
    return codes.map((code) => {
      const [title, st] = data.courses[code];
      if (!Array.isArray(st)) return { code, title, state: st, slots: [] };
      const idx = st.filter((x) => x !== "off");
      return {
        code, title, state: idx.length > 1 || st.includes("off") ? "sections" : "slot",
        slots: idx.map((i) => slotOf(data, i)),
      };
    }).sort((x, y) => rank(x) - rank(y));
  }

  const slotOf = (data, i) => { const [date, start, end] = data.slots[i]; return { i, date, start, end }; };

  /** Days with more than one of these finals on them — the one thing worth warning about.
   *  Only courses with a single known slot count: a multi-section course's day is not known. */
  function crowded(rs) {
    const by = {};
    for (const r of rs) if (r.state === "slot") (by[r.slots[0].date] ||= []).push(r);
    return Object.entries(by).filter(([, l]) => l.length > 1).sort(([a], [b]) => (a < b ? -1 : 1));
  }

  /** The slot in progress at campus {date, min}, or null. */
  function slotNow(data, campus) {
    const toMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
    const i = data.slots.findIndex(([d, s, e]) => d === campus.date && campus.min >= toMin(s) && campus.min < toMin(e));
    return i < 0 ? null : slotOf(data, i);
  }

  /** Every course whose final is in slot i (any of its sections). */
  function inSlot(data, i) {
    return Object.entries(data.courses)
      .filter(([, [, st]]) => Array.isArray(st) && st.includes(i))
      .map(([code, [title]]) => ({ code, title }));
  }

  /** First and last exam day, for the "Finals · Dec 7–11" label. */
  const span = (data) => [data.slots[0][0], data.slots[data.slots.length - 1][0]];

  return { find, scan, rows, crowded, slotNow, inSlot, span, norm };
});
