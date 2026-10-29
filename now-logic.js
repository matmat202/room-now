/* now-logic.js — "what is happening in every room right now?"
 *
 * The inverse of rooms-logic.js, on the same data/meetings.json, and it reuses that
 * module rather than restating it: campus time, the building name, the term in session
 * and the no-class calendar are all decided there, and two copies of a timezone rule is
 * how the two pages come to disagree about what day it is.
 *
 * What it adds is the thing free-rooms throws away. `status()` keeps `cur[0].course` and
 * calls the room busy; this keeps every meeting in the room, with its title, component,
 * instructors and end time, so the page can answer "where is CS 106B" and "what is in
 * Hewlett 200 at 2pm" as well as "what is on now".
 *
 * ON EXAMS, because the page is asked about midterms and must not imply it knows:
 * ExploreCourses lists no exam of any kind. Probed 2026-10-29 on the Autumn fetch — all
 * 20 components are instructional (LEC, SEM, DIS, LAB, …) and a search for exam/midterm/
 * final across 3,953 meetings returns ZERO. Stanford's own Bulletin explains why: a class
 * giving a midterm outside regular class hours "must announce the date and time during
 * the first week of the academic quarter", i.e. in class, not to a central schedule. So:
 *   - a midterm held IN class hours is, correctly, the class this page already shows;
 *   - a midterm held outside them is not knowable from any public feed, and the page says
 *     so rather than leaving a quiet gap that reads as "nothing is happening".
 */
(function (root, factory) {
  const R = (typeof module !== "undefined" && module.exports)
    ? require("./rooms-logic.js")
    : root.RoomsLogic;
  const api = factory(R);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NowLogic = api;
})(typeof self !== "undefined" ? self : this, function (R) {
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  /** "1:30 pm" from "13:30". */
  function clock(hhmm) {
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  }

  /** "12:30–1:20 pm" — the meridiem once, unless the range crosses it ("11:30 am–1:20 pm").
   *  Two "pm"s in one range is noise on every row of a timeline. */
  function range(start, end) {
    const half = (hhmm) => (Number(hhmm.split(":")[0]) >= 12 ? "pm" : "am");
    if (half(start) !== half(end)) return `${clock(start)}–${clock(end)}`;
    return `${clock(start).replace(/ [ap]m$/, "")}–${clock(end)}`;
  }

  /** Readable names for the registrar's component codes. Unknown codes pass through, so a
   *  new one shows as itself rather than vanishing. */
  const COMPONENT = {
    LEC: "Lecture", SEM: "Seminar", DIS: "Discussion", LAB: "Lab", LBS: "Lab section",
    LNG: "Language", PRA: "Practicum", WKS: "Workshop", COL: "Colloquium", ACT: "Activity",
    CAS: "Case study", ISF: "Independent study", ISS: "Independent study", RES: "Research",
    TUT: "Tutorial", ITR: "Internship", INS: "Instruction", SIM: "Simulation",
    "T/D": "Thesis", RSC: "Research colloquium",
  };
  const componentName = (c) => COMPONENT[c] || c || "Class";

  /** Every meeting of `room` on the campus date of `date`, sorted by start.
   *  Returns [{start, end, course, title, who, component, state}] where state is
   *  "now" | "next" | "done" relative to the moment. A no-class day returns []. */
  function roomDay(meetings, room, date, noClass) {
    const now = R.campusNow(date);
    if (noClass && noClass[now.date]) return [];
    const out = [];
    for (const m of meetings) {
      if (m.room !== room) continue;
      if (!m.days.includes(now.day)) continue;
      if ((m.from && now.date < m.from) || (m.to && now.date > m.to)) continue;
      const s = toMin(m.start), e = toMin(m.end);
      out.push({
        start: m.start, end: m.end, course: m.course, title: m.title || "",
        who: m.who || [], component: m.component || "",
        state: (s <= now.min && now.min < e) ? "now" : (s > now.min ? "next" : "done"),
      });
    }
    out.sort((a, b) => toMin(a.start) - toMin(b.start) || a.course.localeCompare(b.course));
    return out;
  }

  /**
   * Every room with a class in it at `date`, and what that class is.
   * -> [{room, building, course, title, who, component, start, end, endsInMin, alsoNow}]
   * sorted by building then room. `alsoNow` is the other meetings sharing the room at the
   * same moment — rare, but real in the data (cross-listed sections and joint seminars),
   * and dropping them is how a page quietly tells you only half of what is in a room.
   */
  function inUse(meetings, date, noClass) {
    const now = R.campusNow(date);
    if (noClass && noClass[now.date]) return [];
    const byRoom = new Map();
    for (const m of meetings) {
      if (!R.isRoom(m.room)) continue;
      if (!m.days.includes(now.day)) continue;
      if ((m.from && now.date < m.from) || (m.to && now.date > m.to)) continue;
      const s = toMin(m.start), e = toMin(m.end);
      if (!(s <= now.min && now.min < e)) continue;
      if (!byRoom.has(m.room)) byRoom.set(m.room, []);
      byRoom.get(m.room).push(m);
    }
    const out = [];
    for (const [room, list] of byRoom) {
      // Longest-running first, so the lecture leads and a short section is the "also".
      list.sort((a, b) => (toMin(b.end) - toMin(b.start)) - (toMin(a.end) - toMin(a.start))
        || a.course.localeCompare(b.course));
      const m = list[0];
      out.push({
        room, building: R.building(room), course: m.course, title: m.title || "",
        who: m.who || [], component: m.component || "", start: m.start, end: m.end,
        endsInMin: toMin(m.end) - now.min,
        alsoNow: list.slice(1).map((x) => x.course),
      });
    }
    out.sort((a, b) => a.building.localeCompare(b.building) || a.room.localeCompare(b.room));
    return out;
  }

  /** Does `row` match the typed query? Matches room, building, course code, title and
   *  instructor surname, so "hewlett", "cs 106", "programming" and "gregg" all work.
   *  Spaces inside a course code are optional: "cs106b" finds "CS 106B". */
  function matches(row, q) {
    if (!q) return true;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const squash = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
    const hay = [row.room, row.building, row.course, row.title, (row.who || []).join(" ")]
      .map((s) => String(s || "").toLowerCase());
    if (hay.some((h) => h.includes(needle))) return true;
    return squash(row.course).includes(squash(needle));
  }

  /** Group rows by building, preserving the row order inside each. -> [[building, rows]] */
  function byBuilding(rows) {
    const g = new Map();
    for (const r of rows) {
      if (!g.has(r.building)) g.set(r.building, []);
      g.get(r.building).push(r);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /** "ends in 12 min", "ends at 2:50 pm" past the hour mark. Under a minute reads as
   *  "ending now" rather than "ends in 0 min", which looks like a bug. */
  function endsLabel(row) {
    if (row.endsInMin <= 1) return "ending now";
    if (row.endsInMin <= 60) return `ends in ${row.endsInMin} min`;
    return `ends at ${clock(row.end)}`;
  }

  /** One line naming the class, without the room: "CS 106B · Programming Abstractions". */
  function courseLabel(row) {
    return row.title ? `${row.course} · ${row.title}` : row.course;
  }

  /** The count line: "41 rooms in use · 333 with nothing booked". `total` is every known
   *  room, which the caller gets from RoomsLogic.status(), so the two pages cannot
   *  disagree about how many rooms exist. */
  function summary(inUseRows, total) {
    const n = inUseRows.length;
    const free = Math.max(0, total - n);
    return `${n} room${n === 1 ? "" : "s"} in use · ${free} with nothing booked`;
  }

  return { inUse, roomDay, matches, byBuilding, endsLabel, courseLabel, summary,
           componentName, clock, range, COMPONENT };
});
