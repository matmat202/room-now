/* rooms-logic.js — "which classrooms have no class in them right now?"
 *
 * Input is data/meetings.json from fetch.py: every Autumn meeting ExploreCourses lists
 * with a room, days and a time. A room is "free" when none of its meetings covers the
 * moment asked about, and it is free *until* its next meeting that day.
 *
 * The registrar's no-class days (recesses and holidays, data.noClass from the year
 * calendar) clear every booking: ExploreCourses dates a meeting's first and last day only.
 *
 * What this cannot see, and so never claims: exams, events, office hours, review
 * sessions, and locked doors. The registrar's calendar is the only schedule
 * here, so "free" means "no class booked", which is all the page says.
 *
 * Times are campus time (America/Los_Angeles) whatever the viewer's clock says.
 */
(function (root) {
  const TZ = "America/Los_Angeles";
  // Locations that name no bookable room. Probed on the 2026-10-24 Autumn fetch.
  // "School of Medicine Room" is the medical school's "Departmental Room": 62 Autumn
  // meetings pooled under one name, so it read as a single room hosting BIO 230 and
  // BIOC 205 at once (found 2026-10-29 by diffing against sql-course-db).
  const NOT_A_ROOM = /^(departmental room|school of medicine room|tba|tbd|online|zoom|remote|off campus|to be announced|see department)/i;
  // Teaching spaces that are no place to sit down and study: PE classes meet in gyms,
  // on courts and at the stables; music in concert and rehearsal halls. 27 of 372 rooms.
  const VENUE = /\bgym(nasium)?\b|\baoerc\b|\bcourts?\b|stables|climbing|\bpool\b|driving range|concert hall|recital hall|rehearsal hall|\bfarm\b|^acsr\b/i;
  // Registrar abbreviations for buildings that elsewhere appear spelled out.
  const ALIAS = { LATHRO: "Lathrop", DINK: "Dinkelspiel Auditorium", EDWRDS: "E.D. Stone Edwards Bldg", Packrd: "Packard", Memaud: "Memorial Auditorium" };
  const SOON = 30; // minutes: a room free for less than this is shown as "class soon"

  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

  /** Campus-time parts of a Date: {date:"2026-10-27", day:"Tuesday", min:690}. */
  function campusNow(d) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, day: p.weekday, min: Number(p.hour) * 60 + Number(p.minute) };
  }

  function isRoom(name) { return !!name && !NOT_A_ROOM.test(name.trim()) && !VENUE.test(name); }

  /** Building part of a room name: "Thornton 207" -> "Thornton", "160-322" -> "Building 160",
   *  "Gates100" -> "Gates", "Li Ka Shing Center, room 306" -> "Li Ka Shing Center". */
  function building(room) {
    const m = room.match(/^(\d{2,3})-/);
    if (m) return `Building ${m[1]}`;
    const b = room.replace(/\s*\(.*\)$/, "")
      .replace(/(,\s*|\s+)(rooms?|rms?)\.?\s*[A-Z]?\d.*$/i, "")
      // Case-sensitive on purpose: /i would let [A-Z]? eat the "s" of "Gates100".
      .replace(/\s*[A-Z]?\d+[A-Z]?(\s*\/\s*[A-Z]?\d*[A-Z]?)*\/?$/, "")
      .trim() || room;
    return ALIAS[b] || b;
  }

  /** The registrar's name for a no-class campus date ("Thanksgiving Recess"), or null. */
  function noClassDay(noClass, date) {
    return (noClass && noClass[campusNow(date).date]) || null;
  }

  /** Meetings on the given campus date, grouped by room, sorted by start. */
  function todaysMeetings(meetings, now, noClass) {
    const byRoom = new Map();
    const off = !!(noClass && noClass[now.date]);
    for (const m of meetings) {
      if (!isRoom(m.room)) continue;
      if (!byRoom.has(m.room)) byRoom.set(m.room, []);
      if (off || !m.days.includes(now.day)) continue;
      if ((m.from && now.date < m.from) || (m.to && now.date > m.to)) continue;
      byRoom.get(m.room).push({ s: toMin(m.start), e: toMin(m.end), course: m.course });
    }
    for (const list of byRoom.values()) list.sort((a, b) => a.s - b.s);
    return byRoom;
  }

  /**
   * Status of every known room at `date` (a Date). `noClass` is data.noClass.
   * Returns [{room, building, state, until, course}] where state is
   *   "busy"  — a class is meeting; until = its end, course = which
   *   "soon"  — free, but a class starts within SOON minutes; until = that start
   *   "free"  — free until `until` (null = no more classes today)
   * Free rooms first, longest-free first; then soon; then busy, soonest-free first.
   */
  function status(meetings, date, noClass) {
    const now = campusNow(date);
    const out = [];
    for (const [room, list] of todaysMeetings(meetings, now, noClass)) {
      const cur = list.filter((x) => x.s <= now.min && now.min < x.e);
      let row;
      if (cur.length) {
        // Back-to-back classes: busy until the last one that chains on.
        let end = Math.max(...cur.map((x) => x.e));
        for (const x of list) if (x.s <= end && x.e > end) end = x.e;
        row = { state: "busy", until: fromMin(end), course: cur[0].course };
      } else {
        const next = list.find((x) => x.s > now.min);
        if (!next) row = { state: "free", until: null, course: null };
        else row = { state: next.s - now.min < SOON ? "soon" : "free", until: fromMin(next.s), course: next.course };
      }
      out.push({ room, building: building(room), ...row });
    }
    const rank = { free: 0, soon: 1, busy: 2 };
    const key = (r) => (r.until === null ? 24 * 60 : toMin(r.until));
    out.sort((a, b) => rank[a.state] - rank[b.state]
      || (a.state === "busy" ? key(a) - key(b) : key(b) - key(a))
      || a.room.localeCompare(b.room));
    return out;
  }

  /** True once the campus date is past the last date any meeting runs: the data is for a
   *  finished term, and "free" would be a guess. 94% of Autumn meetings end 2026-12-04, so
   *  the latest end stands in for the end of classes. */
  function termOver(meetings, date) {
    let last = "";
    for (const m of meetings) if (m.to && m.to > last) last = m.to;
    return !!last && campusNow(date).date > last;
  }

  /** Every meeting in the file, across all terms — for questions about the whole
   *  schedule rather than today, such as "does places.json have a point for every
   *  building we ever list?". Reads single-term files too. */
  function allMeetings(data) {
    if (data.terms && data.terms.length) return data.terms.flatMap((t) => t.meetings || []);
    return data.meetings || [];
  }

  /** The term whose classes are in session on `date`, out of a multi-term data file
   *  (data.terms, each {term, first, last, noClass, meetings}). A single-term file —
   *  every build before 2026-10-24 — has no `terms`, so the top level is the only term.
   *
   *  Returns {term, meetings, noClass, first, last, state, next} where state is:
   *    "in"      — classes meet in this term; render normally
   *    "between" — before the first term or in a gap between two; `next` is the term
   *                that starts later, so the page can name the date classes resume
   *    "after"   — past the last day of every term on file: the schedule is stale and
   *                calling a room "free" would be a guess
   *
   *  `term` is always the most useful term to name: the one in session, the one about
   *  to start, or the one that just ended.
   */
  function pickTerm(data, date) {
    const today = campusNow(date).date;
    const list = (data.terms && data.terms.length ? data.terms : [{
      term: data.term, noClass: data.noClass, meetings: data.meetings || [],
      first: null, last: null,
    }]).map((t) => {
      // Single-term files carry no range; derive it the way termOver did, from the meetings.
      let first = t.first, last = t.last;
      if (!first || !last) {
        for (const m of t.meetings) {
          if (m.from && (!first || m.from < first)) first = m.from;
          if (m.to && (!last || m.to > last)) last = m.to;
        }
      }
      return { ...t, first, last };
    }).sort((a, b) => String(a.first).localeCompare(String(b.first)));

    for (const t of list) {
      if (t.first && today < t.first) return { ...t, state: "between", next: t };
      if (!t.last || today <= t.last) return { ...t, state: "in", next: null };
      // Past this term's end: roll over to the next one that has not finished.
    }
    return { ...list[list.length - 1], state: "after", next: null };
  }

  /** "until 2:30 pm", or "rest of the day". */
  function untilLabel(hhmm) {
    if (hhmm === null) return "rest of the day";
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `until ${h}${m ? ":" + String(m).padStart(2, "0") : ""} ${ap}`;
  }

  const api = { status, pickTerm, allMeetings, termOver, noClassDay, campusNow, isRoom, building, untilLabel, SOON };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RoomsLogic = api;
})(typeof self !== "undefined" ? self : this);
