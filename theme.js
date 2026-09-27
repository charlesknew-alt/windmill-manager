/**
 * Varlo day / night / auto theme
 * Pattern: data-theme + localStorage (same approach as villa-famille / tfh-theme),
 * extended with Auto that follows UK sunrise→sunset (Europe/London, SE England).
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'varlo-theme';
  var PREFS = ['day', 'night', 'auto'];
  // The Windmill / Eight Bells sit in Sussex — close enough for UK civil day/night.
  var UK_LAT = 51.03;
  var UK_LON = -0.20;

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  /** Julian day (UTC noon-ish) for astronomical formulae. */
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  /**
   * Approximate sunrise / sunset (UTC Date) for lat/lon on the UK calendar day
   * containing `date`, using a compact NOAA-style solar equation.
   * Returns { rise: Date, set: Date } or null near polar edge cases (N/A for UK).
   */
  function ukSunTimes(date) {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    var y = +parts.find(function (p) { return p.type === 'year'; }).value;
    var m = +parts.find(function (p) { return p.type === 'month'; }).value;
    var d = +parts.find(function (p) { return p.type === 'day'; }).value;

    // Approximate UTC midnight for that London calendar date (ignore DST for JD step).
    var noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    var jd = julianDay(noonUtc);
    var n = Math.round(jd - 2451545.0 - 0.0009 - UK_LON / 360);
    var jStar = 2451545.0 + 0.0009 + UK_LON / 360 + n;
    var M = (357.5291 + 0.98560028 * (jStar - 2451545.0)) % 360;
    var Mrad = M * Math.PI / 180;
    var C = 1.9148 * Math.sin(Mrad) + 0.02 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
    var lambda = (M + 102.9372 + C + 180) % 360;
    var lamRad = lambda * Math.PI / 180;
    var jTransit = jStar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lamRad);
    var sinDec = Math.sin(lamRad) * Math.sin(23.4397 * Math.PI / 180);
    var cosDec = Math.cos(Math.asin(sinDec));
    var latRad = UK_LAT * Math.PI / 180;
    // Civil twilight-ish horizon (-0.83°) for visible day/night.
    var cosH = (Math.sin(-0.83 * Math.PI / 180) - Math.sin(latRad) * sinDec) / (Math.cos(latRad) * cosDec);
    if (cosH < -1 || cosH > 1) return null;
    var H = Math.acos(clamp(cosH, -1, 1)) * 180 / Math.PI / 360;
    var jSet = jTransit + H;
    var jRise = jTransit - H;
    function fromJd(j) {
      return new Date((j - 2440587.5) * 86400000);
    }
    return { rise: fromJd(jRise), set: fromJd(jSet) };
  }

  /** True when Europe/London local time is between UK sunrise and sunset. */
  function isUkDaytime(date) {
    date = date || new Date();
    var sun = ukSunTimes(date);
    if (!sun) {
      // Fallback: 06:00–20:00 Europe/London if solar math fails.
      var hour = +new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: 'numeric',
        hour12: false
      }).format(date);
      return hour >= 6 && hour < 20;
    }
    var t = date.getTime();
    return t >= sun.rise.getTime() && t < sun.set.getTime();
  }

  function readPref() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (PREFS.indexOf(v) !== -1) return v;
    } catch (_) {}
    return 'auto';
  }

  function writePref(pref) {
    try { localStorage.setItem(STORAGE_KEY, pref); } catch (_) {}
  }

  function resolveMode(pref) {
    pref = pref || readPref();
    if (pref === 'day') return 'light';
    if (pref === 'night') return 'dark';
    return isUkDaytime() ? 'light' : 'dark';
  }

  function apply(pref) {
    pref = PREFS.indexOf(pref) !== -1 ? pref : readPref();
    writePref(pref);
    var mode = resolveMode(pref);
    var root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-theme-pref', pref);
    root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#121816' : '#24362c');
    syncToggles(pref, mode);
    return mode;
  }

  function syncToggles(pref, mode) {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (group) {
      group.querySelectorAll('[data-theme-set]').forEach(function (btn) {
        var on = btn.getAttribute('data-theme-set') === pref;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      group.setAttribute('data-resolved', mode);
    });
  }

  function setPref(pref) {
    return apply(pref);
  }

  function cycle() {
    var cur = readPref();
    var next = PREFS[(PREFS.indexOf(cur) + 1) % PREFS.length];
    return apply(next);
  }

  function bind() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (group) {
      if (group.getAttribute('data-theme-bound')) return;
      group.setAttribute('data-theme-bound', '1');
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-theme-set]');
        if (!btn || !group.contains(btn)) return;
        apply(btn.getAttribute('data-theme-set'));
      });
    });
  }

  function boot() {
    apply(readPref());
    function afterDom() {
      bind();
      syncToggles(readPref(), resolveMode());
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', afterDom);
    } else {
      afterDom();
    }
    // Re-evaluate Auto around dawn/dusk without a reload.
    setInterval(function () {
      if (readPref() === 'auto') apply('auto');
    }, 60 * 1000);
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    readPref: readPref,
    setPref: setPref,
    apply: apply,
    cycle: cycle,
    resolveMode: resolveMode,
    isUkDaytime: isUkDaytime,
    ukSunTimes: ukSunTimes,
    bind: bind,
    boot: boot
  };

  global.VarloTheme = api;
  boot();
})(typeof window !== 'undefined' ? window : globalThis);
