// قراءة جداول المعلمين (أو الشعب) من ملف PDF وتحويلها إلى بيانات استيراد المنصة
// يعمل مع جداول aSc Timetables ومع جداول هذه المنصة المطبوعة، ومع أي PDF نصي مشابه:
// شبكة صفوفها أيام الأسبوع (أو أعمدتها) وأعمدتها أرقام الحصص، وكل خانة فيها المادة ورقم الشعبة (مثل 5/12).

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/";

const DAY_WORDS = [
  ["الأحد", ["احد", "الاحد", "الأحد", "أحد", "sun", "sunday"]],
  ["الاثنين", ["اثنين", "الاثنين", "الإثنين", "إثنين", "الأثنين", "mon", "monday"]],
  ["الثلاثاء", ["ثلاثاء", "الثلاثاء", "الثلاثا", "tue", "tuesday"]],
  ["الأربعاء", ["اربعاء", "الاربعاء", "الأربعاء", "أربعاء", "wed", "wednesday"]],
  ["الخميس", ["خميس", "الخميس", "thu", "thursday"]],
  ["الجمعة", ["جمعة", "الجمعة", "جمعه", "الجمعه", "fri", "friday"]],
  ["السبت", ["سبت", "السبت", "sat", "saturday"]]
];
const DAY_MAP = new Map();
DAY_WORDS.forEach(([name, ws], i) => ws.forEach(w => DAY_MAP.set(w, i)));
export const DAY_NAMES = DAY_WORDS.map(d => d[0]);
const GRADE_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c", "#65a30d", "#475569", "#9333ea", "#0d9488", "#b45309", "#e11d48", "#1d4ed8", "#15803d", "#a21caf", "#c2410c"];

const toAsciiDigits = s => s.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const clean = s => toAsciiDigits(String(s || "").normalize("NFKC")).replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
const SEC_RE = /^(\d{1,2})\s*\/\s*(\d{1,2})$/;
const dayOf = s => { const k = clean(s).toLowerCase().replace(/[.:،,]/g, ""); return DAY_MAP.has(k) ? DAY_MAP.get(k) : -1; };
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };

// ---------- قراءة الملف ----------
export async function readPdfPages(file, onProgress) {
  const pdfjs = await import(PDFJS + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const s = clean(it.str);
      if (!s) continue;
      const h = Math.abs(it.transform[3]) || it.height || 8;
      const x0 = it.transform[4], x1 = x0 + (it.width || 0);
      const yb = vp.height - it.transform[5];
      items.push({ s, x0, x1, cx: (x0 + x1) / 2, cy: yb - h * 0.35, h, dir: it.dir });
    }
    pages.push({ w: vp.width, h: vp.height, items });
    onProgress?.(n / doc.numPages);
  }
  return pages;
}

// ---------- تحليل الشبكات ----------
export function parseTimetablePages(pages) {
  const owners = []; // { name, kind: teacher|section, cells: [{d,p,texts:[], secs:[]}] }
  const warnings = [];
  let maxP = 0; const daysSeen = new Set();

  pages.forEach((pg, pi) => {
    const items = pg.items;
    const days = items.map(it => ({ it, d: dayOf(it.s) })).filter(x => x.d >= 0);
    if (days.length < 3) return;
    const used = new Set();
    // اتجاه الشبكة: الأيام صفوف (نفس x تقريبًا) أو أعمدة (نفس y)
    const clusters = [];
    for (const a of days) {
      if (used.has(a)) continue;
      const colGroup = days.filter(b => !used.has(b) && Math.abs(b.it.cx - a.it.cx) < 12);
      const rowGroup = days.filter(b => !used.has(b) && Math.abs(b.it.cy - a.it.cy) < 4);
      const g = colGroup.length >= rowGroup.length ? { o: "rows", list: colGroup } : { o: "cols", list: rowGroup };
      // تقسيم المجموعة إلى شبكات متتالية (قد توجد عدة شبكات في نفس العمود)
      g.list.sort((x, y) => g.o === "rows" ? x.it.cy - y.it.cy : x.it.cx - y.it.cx);
      let cur = [];
      const flush = () => { if (cur.length >= 3) clusters.push({ o: g.o, list: cur }); cur = []; };
      for (const x of g.list) {
        if (cur.length && cur.some(c => c.d === x.d)) flush();
        else if (cur.length >= 2) {
          const pos = v => g.o === "rows" ? v.it.cy : v.it.cx;
          const step = pos(cur[1]) - pos(cur[0]);
          if (pos(x) - pos(cur[cur.length - 1]) > step * 1.6) flush();
        }
        cur.push(x); used.add(x);
      }
      flush();
    }

    for (const cl of clusters) {
      const g = cl.o === "rows" ? gridRows(items, cl.list) : gridCols(items, cl.list);
      if (!g) { warnings.push(`صفحة ${pi + 1}: تعذّر قراءة جدول`); continue; }
      cl.list.forEach(x => daysSeen.add(x.d));
      maxP = Math.max(maxP, g.nP);
      owners.push({ ...g, page: pi + 1 });
    }
  });
  return { owners, warnings, days: [...daysSeen].sort((a, b) => a - b), maxP };
}

// الأيام صفوف، أرقام الحصص في سطر أعلى الشبكة
function gridRows(items, dayList) {
  const ys = dayList.map(x => x.it.cy);
  const rowH = median(ys.slice(1).map((y, i) => y - ys[i])) || 40;
  const dayX = median(dayList.map(x => x.it.cx));
  const top = ys[0] - rowH / 2, bottom = ys[ys.length - 1] + rowH / 2;
  // أرقام الحصص: أعداد صغيرة على سطر واحد فوق أول صف
  const nums = items.filter(it => /^\d{1,2}$/.test(it.s) && it.cy < top + 2 && it.cy > top - rowH * 1.6 && Math.abs(it.cx - dayX) > 10);
  const byLine = groupBy(nums, it => Math.round(it.cy / 4));
  // لكل سطر: نأخذ الأرقام بدءًا من الأقرب لعمود الأيام حتى أول تكرار أو فجوة كبيرة (قد توجد شبكة مجاورة على نفس السطر)
  let cols = null;
  for (const line of byLine.values()) for (const side of [-1, 1]) {
    const seq = line.filter(it => Math.sign(it.cx - dayX) === side).sort((a, b) => Math.abs(a.cx - dayX) - Math.abs(b.cx - dayX));
    const take = [], seen = new Set();
    for (const it of seq) {
      if (seen.has(it.s)) break;
      if (take.length >= 2) {
        const gaps = take.slice(1).map((x, i) => Math.abs(x.cx - take[i].cx));
        if (Math.abs(it.cx - take[take.length - 1].cx) > median(gaps) * 1.8) break;
      }
      take.push(it); seen.add(it.s);
    }
    if (take.length >= 3 && (!cols || take.length > cols.length)) cols = take;
  }
  if (!cols) return null;
  const best = cols;
  cols = cols.map(it => ({ n: +it.s, x: it.cx })).sort((a, b) => a.n - b.n);
  const base = cols[0].n; // قد تبدأ من 0 أو 1
  const xs = cols.map(c => c.x);
  const colW = median(xs.slice(1).map((x, i) => Math.abs(x - xs[i]))) || 50;
  const headerY = median(best.map(it => it.cy));
  const minX = Math.min(...xs) - colW / 2, maxX = Math.max(...xs) + colW / 2;
  // اسم صاحب الجدول: أكبر نص فوق رأس الجدول ضمن عرضه
  const owner = ownerName(items, Math.min(minX, dayX), Math.max(maxX, dayX), headerY, rowH);
  // أوقات الحصص أسفل الأرقام إن وجدت
  const times = cols.map(c => {
    const t = items.filter(it => /^\d{1,2}:\d{2}/.test(it.s) && Math.abs(it.cx - c.x) < colW / 2 && it.cy > headerY - 2 && it.cy < top + 2);
    const all = t.flatMap(x => x.s.match(/\d{1,2}:\d{2}/g)).filter(Boolean);
    return all.length ? { start: pad(all[0]), end: all[1] ? pad(all[1]) : null } : null;
  });
  const cells = new Map();
  for (const it of items) {
    if (it.cy < top || it.cy > bottom || it.cx < minX || it.cx > maxX) continue;
    if (dayOf(it.s) >= 0 && Math.abs(it.cx - dayX) < 15) continue;
    const ci = nearest(xs, it.cx), ri = nearest(ys, it.cy);
    if (Math.abs(xs[ci] - it.cx) > colW * 0.62 || Math.abs(ys[ri] - it.cy) > rowH * 0.62) continue;
    addCell(cells, dayList[ri].d, cols[ci].n - base, it);
  }
  return finish(owner, cells, cols.length, times);
}

// الأيام أعمدة، أرقام الحصص في عمود جانبي
function gridCols(items, dayList) {
  const xs = dayList.map(x => x.it.cx);
  const colW = median(xs.slice(1).map((x, i) => Math.abs(x - xs[i]))) || 60;
  const dayY = median(dayList.map(x => x.it.cy));
  const minX = Math.min(...xs) - colW / 2, maxX = Math.max(...xs) + colW / 2;
  const nums = items.filter(it => /^\d{1,2}$/.test(it.s) && it.cy > dayY + 4 && (it.cx < minX + 4 || it.cx > maxX - 4) && (it.cx > minX - colW * 1.5 && it.cx < maxX + colW * 1.5));
  const byCol = groupBy(nums, it => Math.round(it.cx / 8));
  let best = null;
  for (const c of byCol.values()) { const u = new Set(c.map(x => x.s)); if (u.size >= 3 && u.size === c.length && (!best || c.length > best.length)) best = c; }
  if (!best) return null;
  const rows = best.map(it => ({ n: +it.s, y: it.cy })).sort((a, b) => a.n - b.n);
  const base = rows[0].n;
  const ys = rows.map(r => r.y);
  const rowH = median(ys.slice(1).map((y, i) => y - ys[i])) || 40;
  const owner = ownerName(items, minX, maxX, dayY, rowH);
  const cells = new Map();
  const top = ys[0] - rowH / 2, bottom = ys[ys.length - 1] + rowH / 2;
  for (const it of items) {
    if (it.cy < top || it.cy > bottom || it.cx < minX || it.cx > maxX) continue;
    const ci = nearest(xs, it.cx), ri = nearest(ys, it.cy);
    if (Math.abs(xs[ci] - it.cx) > colW * 0.62 || Math.abs(ys[ri] - it.cy) > rowH * 0.62) continue;
    if (/^\d{1,2}$/.test(it.s) && Math.abs(it.cx - best[0].cx) < 10) continue;
    addCell(cells, dayList[ci].d, rows[ri].n - base, it);
  }
  return finish(owner, cells, rows.length, rows.map(() => null));
}

function ownerName(items, minX, maxX, headerY, rowH) {
  const cand = items.filter(it => it.cy < headerY - 3 && it.cy > headerY - rowH * 3 && it.cx > minX - 20 && it.cx < maxX + 20 && /[؀-ۿA-Za-z]/.test(it.s) && dayOf(it.s) < 0);
  if (!cand.length) return "";
  const maxH = Math.max(...cand.map(c => c.h));
  const big = cand.filter(c => c.h >= maxH * 0.9);
  // أقرب سطر كبير إلى رأس الجدول
  const lineY = Math.max(...big.map(c => c.cy));
  const line = big.filter(c => Math.abs(c.cy - lineY) < 4).sort((a, b) => b.cx - a.cx);
  return line.map(c => c.s).join(" ").replace(/^(جدول|المعلم|المعلمة|الشعبة|الصف)\s*[:：]?\s*/, "").trim();
}

function addCell(cells, d, p, it) {
  const k = d + "." + p;
  if (!cells.has(k)) cells.set(k, { d, p, items: [] });
  cells.get(k).items.push(it);
}
function finish(owner, cells, nP, times) {
  const out = [];
  for (const c of cells.values()) {
    const secs = [], texts = [];
    const lines = groupBy(c.items, it => Math.round(it.cy / 3));
    [...lines.values()].sort((a, b) => a[0].cy - b[0].cy).forEach(line => {
      const parts = line.sort((a, b) => b.cx - a.cx).map(x => x.s);
      const txt = parts.join(" ").trim();
      const m = txt.replace(/\s+/g, "").match(SEC_RE);
      if (m) secs.push(`${+m[1]}/${+m[2]}`);
      else if (!/^\d{1,2}:\d{2}/.test(txt)) {
        // قد يأتي رقم الشعبة داخل نفس السطر
        const inner = txt.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (inner) { secs.push(`${+inner[1]}/${+inner[2]}`); const rest = txt.replace(inner[0], "").trim(); if (rest) texts.push(rest); }
        else if (txt) texts.push(txt);
      }
    });
    if (secs.length || texts.length) out.push({ d: c.d, p: c.p, secs, texts });
  }
  const ownerSec = clean(owner).replace(/\s+/g, "").match(/(\d{1,2})\/(\d{1,2})/);
  const kind = ownerSec ? "section" : "teacher";
  return { name: owner, kind, section: ownerSec ? `${+ownerSec[1]}/${+ownerSec[2]}` : null, cells: out, nP, times };
}
function groupBy(a, f) { const m = new Map(); for (const x of a) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function nearest(arr, v) { let bi = 0; arr.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(arr[bi] - v)) bi = i; }); return bi; }
function pad(t) { const [h, m] = t.split(":"); return `${h.padStart(2, "0")}:${m}`; }

// ---------- تحويل إلى بيانات استيراد ----------
const baseSubject = s => clean(s)
  .replace(/\s*(مختبر|قاعة|غرفة|معمل)\s+\S+.*$/, "")
  .replace(/\s*\d+$/, "")
  .replace(/الانجليزية/g, "الإنجليزية").replace(/الاسلامية/g, "الإسلامية").replace(/الاحياء/g, "الأحياء")
  .trim();

export function buildImport(parsed, current = {}) {
  const warnings = [...parsed.warnings];
  const teacherOwners = parsed.owners.filter(o => o.kind === "teacher" && o.name);
  const sectionOwners = parsed.owners.filter(o => o.kind === "section");
  const lessons = []; // {teacher, subject, section, d, p}
  let noSec = 0;
  if (teacherOwners.length) {
    for (const o of teacherOwners) for (const c of o.cells) {
      if (!c.secs.length) { noSec++; continue; }
      const subject = baseSubject(c.texts.join(" ")) || "؟";
      lessons.push({ teacher: o.name, subject, section: c.secs[0], d: c.d, p: c.p });
      if (c.secs.length > 1) warnings.push(`${o.name}: حصة مشتركة لعدة شعب (${c.secs.join("، ")}) — أُخذت الأولى فقط`);
    }
  } else {
    // جداول الشعب: الخانة فيها المادة ثم اسم المعلم
    for (const o of sectionOwners) for (const c of o.cells) {
      if (!c.texts.length) continue;
      const subject = baseSubject(c.texts.length > 1 ? c.texts.slice(0, -1).join(" ") : c.texts[0]);
      const teacher = c.texts.length > 1 ? c.texts[c.texts.length - 1] : `معلم ${subject}`;
      lessons.push({ teacher, subject, section: o.section, d: c.d, p: c.p });
    }
  }
  if (noSec) warnings.push(`${noSec} حصة بدون رقم شعبة لم تُستورد`);

  // حذف التعارضات: الشعبة أو المعلم في نفس الوقت مرتين
  // الأولوية للمعلم الذي تكون هذه المادة تخصصه الأساسي
  const tSub = new Map();
  for (const l of lessons) { if (!tSub.has(l.teacher)) tSub.set(l.teacher, new Map()); const m = tSub.get(l.teacher); m.set(l.subject, (m.get(l.subject) || 0) + 1); }
  const mainOf = t => [...(tSub.get(t) || new Map())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const tLoad = new Map(); lessons.forEach(l => tLoad.set(l.teacher, (tLoad.get(l.teacher) || 0) + 1));
  const ordered = lessons.map((l, i) => ({ l, i, pr: (mainOf(l.teacher) === l.subject ? 0 : 1) }))
    .sort((a, b) => a.pr - b.pr || tLoad.get(a.l.teacher) - tLoad.get(b.l.teacher) || a.i - b.i).map(x => x.l);
  const tS = new Set(), cS = new Set(); let dupSec = 0, dupT = 0;
  const kept = [];
  for (const l of ordered) {
    const a = `${l.teacher}@${l.d}.${l.p}`, b = `${l.section}@${l.d}.${l.p}`;
    if (tS.has(a)) { dupT++; continue; }
    if (cS.has(b)) { dupSec++; continue; }
    tS.add(a); cS.add(b); kept.push(l);
  }
  if (dupSec) warnings.push(`${dupSec} حصة مشتركة بين معلمَين لنفس الشعبة في نفس الوقت — بقيت لمعلم واحد`);
  if (dupT) warnings.push(`${dupT} حصة مكررة للمعلم في نفس الوقت — أُخذت الأولى فقط`);

  const secs = [...new Set(kept.map(l => l.section))].sort((a, b) => (+a.split("/")[1] - +b.split("/")[1]) || (+a.split("/")[0] - +b.split("/")[0]));
  const grades = [...new Set(secs.map(s => s.split("/")[1]))].sort((a, b) => +a - +b);
  const subjCount = new Map(); kept.forEach(l => subjCount.set(l.subject, (subjCount.get(l.subject) || 0) + 1));
  const subjects = [...subjCount.keys()].sort((a, b) => subjCount.get(b) - subjCount.get(a));
  const per = new Map(); kept.forEach(l => { const k = l.subject + "|" + l.section; per.set(k, (per.get(k) || 0) + 1); });
  const teachers = [...new Set(kept.map(l => l.teacher))];

  const days = parsed.days.length ? parsed.days.map(i => DAY_NAMES[i]) : (current.days || DAY_NAMES.slice(0, 5));
  const P = parsed.maxP || current.periods?.length || 8;
  let periods = null;
  const timed = parsed.owners.find(o => o.times?.some(t => t?.start));
  if (timed) periods = Array.from({ length: P }, (_, i) => timed.times[i]?.start ? { start: timed.times[i].start, end: timed.times[i].end || timed.times[i].start } : null);
  if (!periods || periods.some(x => !x)) periods = current.periods?.length === P ? current.periods : null;

  return {
    data: {
      format: "monasiq-import", version: 1, source: "PDF",
      settings: periods ? { days, periods } : { days, periodsCount: P },
      grades: grades.map(g => ({ key: "g" + g, name: GRADE_NAMES[+g - 1] || `الصف ${g}`, code: g })),
      sections: secs.map(s => ({ key: s, grade: "g" + s.split("/")[1], num: s.split("/")[0] })),
      subjects: subjects.map((name, i) => {
        const periods = {};
        for (const g of grades) {
          const gs = secs.filter(s => s.endsWith("/" + g));
          const vals = gs.map(s => per.get(name + "|" + s) || 0);
          if (vals.every(v => v > 0)) periods["g" + g] = mode(vals);
        }
        return { key: "s" + i, name, color: COLORS[i % COLORS.length], periods };
      }),
      teachers: teachers.map((name, i) => {
        const mine = kept.filter(l => l.teacher === name);
        const asg = new Map(); mine.forEach(l => { const k = l.subject + "|" + l.section; asg.set(k, (asg.get(k) || 0) + 1); });
        const sc = new Map(); mine.forEach(l => sc.set(l.subject, (sc.get(l.subject) || 0) + 1));
        const main = [...sc].sort((a, b) => b[1] - a[1])[0]?.[0];
        return {
          key: "t" + i, name, subject: "s" + subjects.indexOf(main), maxLoad: mine.length,
          assignments: [...asg].map(([k, n]) => { const [s, c] = k.split("|"); return { subject: "s" + subjects.indexOf(s), section: c, periods: n }; })
        };
      }),
      timetable: kept.map(l => ({ teacher: "t" + teachers.indexOf(l.teacher), subject: "s" + subjects.indexOf(l.subject), section: l.section, d: days.indexOf(DAY_NAMES[l.d]), p: l.p }))
    },
    warnings: [...new Set(warnings)].slice(0, 30),
    stats: { pages: new Set(parsed.owners.map(o => o.page)).size, grids: parsed.owners.length, kind: teacherOwners.length ? "teacher" : "section" }
  };
}
function mode(a) { const m = new Map(); a.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((x, y) => y[1] - x[1])[0][0]; }
