// Erzeugt kalender.ics aus den Daten in index.html.
// Aufruf nach jeder Änderung am Kalender:  node build-ics.js
// Die Datei kalender.ics kann in Google/Apple/Outlook abonniert werden:
//   https://nakspace.github.io/kalender/kalender.ics
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const dataPart = script.split("let filter =")[0]; // nur Daten + Hilfsfunktionen
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dataPart + "\nthis.D={FEASTS,EVENTS,ORGEL,BLUMEN,tuerFor,reinFor,iso};", ctx);
const { FEASTS, EVENTS, ORGEL, BLUMEN, tuerFor, reinFor } = ctx.D;

const CAT = { gd: "Gottesdienst", gem: "Gemeinde", jug: "Jugend & Kinder", amt: "Ämter & Bezirk", off: "entfällt" };
const escTxt = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = line => {
  // RFC 5545: Zeilen max. 75 Bytes, Fortsetzung mit Leerzeichen
  const out = []; let cur = ""; let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
};
const ymd = k => k.replace(/-/g, "");
const slug = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const nextDay = k => { const [y, m, d] = k.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return x.toISOString().slice(0, 10); };
const addMin = (hhmm, min) => { let [h, m] = hhmm.split(":").map(Number); m += min; h += Math.floor(m / 60); m %= 60; return String(h).padStart(2, "0") + String(m).padStart(2, "0") + "00"; };
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

const L = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//nakspace//Gemeindekalender Wolfenbuettel//DE",
  "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:Gemeindekalender Wolfenbüttel", "X-WR-TIMEZONE:Europe/Berlin",
  "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
  "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE"
];
const ev = (uid, k, time, summary, desc, cat) => {
  L.push("BEGIN:VEVENT", "UID:" + uid + "@nakspace.github.io", "DTSTAMP:" + stamp);
  if (time) {
    const dur = cat === "gd" ? 75 : 90;
    L.push("DTSTART;TZID=Europe/Berlin:" + ymd(k) + "T" + time.replace(":", "") + "00");
    L.push("DTEND;TZID=Europe/Berlin:" + ymd(k) + "T" + addMin(time, dur));
  } else {
    L.push("DTSTART;VALUE=DATE:" + ymd(k), "DTEND;VALUE=DATE:" + ymd(nextDay(k)), "TRANSP:TRANSPARENT");
  }
  L.push(fold("SUMMARY:" + escTxt(summary)));
  if (desc) L.push(fold("DESCRIPTION:" + escTxt(desc)));
  if (cat) L.push("CATEGORIES:" + escTxt(CAT[cat] || cat));
  L.push("END:VEVENT");
};

// Feiertage als ganztägige Einträge
for (const [k, name] of Object.entries(FEASTS)) ev("feast-" + k, k, "", name, "", "");

// Termine; Dienste beim ersten eigenen Gottesdienst des Tages
const seen = {};
const byDay = {};
EVENTS.forEach(e => (byDay[e[0]] = byDay[e[0]] || []).push(e));
for (const [k, list] of Object.entries(byDay)) {
  const [y, m, d] = k.split("-").map(Number);
  const date = new Date(y, m - 1, d), dow = date.getDay();
  const cancelled = list.some(e => e[2] === "off");
  const dienste = [];
  if ((dow === 0 || dow === 3) && !cancelled) {
    const t = tuerFor(date);
    if (t) dienste.push(`Türdienst: Gruppe ${t[1]} – ${(dow === 3 && t[4]) || (dow === 0 && t[5]) || t[2]}${t[3] ? " (getauscht)" : ""}`);
  }
  const rg = reinFor(date); if (rg) dienste.push("Reinigung: Gruppe " + rg);
  if (!cancelled && BLUMEN[k]) dienste.push("Blumen: " + BLUMEN[k]);
  if (ORGEL[k]) dienste.push("Orgel: " + ORGEL[k]);
  const main = list.find(e => e[2] === "gd" && !String(e[3]).startsWith("Info:"));
  list.forEach(e => {
    const parts = [e[4], ...(e[5] || []), e[6]].filter(Boolean);
    if (e === main && dienste.length) parts.push("", ...dienste);
    let uid = k + "-" + slug(e[3]); seen[uid] = (seen[uid] || 0) + 1; if (seen[uid] > 1) uid += "-" + seen[uid];
    ev(uid, k, e[1], e[3], parts.join("\n"), e[2]);
  });
}
L.push("END:VCALENDAR");
fs.writeFileSync(path.join(__dirname, "kalender.ics"), L.join("\r\n") + "\r\n");
console.log("kalender.ics geschrieben:", L.filter(l => l === "BEGIN:VEVENT").length, "Einträge");
