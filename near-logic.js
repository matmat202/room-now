/* near-logic.js — "which free room is closest to me?"
 *
 * Each building has a point in data/places.json (OpenStreetMap centres, built by
 * projects/rooms-near/build_places.mjs). Main Quad buildings share the Quad's centre,
 * so within the Quad the order is by free rooms, not by metres.
 * Walking minutes use the dining site's model (walk-logic.js): straight-line metres
 * times DETOUR at SPEED m/min, with DETOUR measured on campus paths (projects/walk-detour).
 */
(function (root) {
  const DETOUR = 1.40;   // path length over crow-fly distance
  const SPEED = 80;      // m/min, about 4.8 km/h
  const WALKABLE = 2000; // beyond this, show km

  /** Haversine metres between [lat, lon] points. */
  function metres(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function minutes(m) { return Math.max(1, Math.ceil(m * DETOUR / SPEED)); }

  function label(m) {
    return m > WALKABLE ? `${(m / 1000).toFixed(1)} km` : `${minutes(m)} min walk`;
  }

  /** Order building groups [[name, rows], ...] by walking minutes from `here`,
   *  then by free-room count. Buildings with no point go last, in their old order.
   *  Returns [[name, rows, metres|null], ...]. */
  function order(groups, places, here) {
    const free = (rs) => rs.filter((r) => r.state === "free").length;
    return groups
      .map(([b, rs], i) => [b, rs, places[b] ? metres(here, places[b]) : null, i])
      .sort((x, y) => {
        if ((x[2] === null) !== (y[2] === null)) return x[2] === null ? 1 : -1;
        if (x[2] === null) return x[3] - y[3];
        return minutes(x[2]) - minutes(y[2]) || free(y[1]) - free(x[1]) || x[3] - y[3];
      })
      .map(([b, rs, m]) => [b, rs, m]);
  }

  const api = { metres, minutes, label, order, DETOUR, SPEED, WALKABLE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NearLogic = api;
})(typeof self !== "undefined" ? self : this);
