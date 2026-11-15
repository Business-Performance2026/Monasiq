// استيراد بيانات المدرسة من ملف Excel (أو CSV) — سطر لكل (معلم، مادة، شعبة)
import { norm } from "./app.js?v=202611151431";

const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const GRADE_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c", "#65a30d", "#475569", "#9333ea", "#0d9488", "#b45309", "#e11d48", "#1d4ed8", "#15803d", "#a21caf", "#c2410c"];
export const HEAD = ["المعلم", "المادة", "الشعبة", "عدد الحصص", "رقم الجوال", "النصاب"];

let loading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return loading ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = XLSX_URL; s.onload = () => res(window.XLSX); s.onerror = () => { loading = null; rej(new Error("xlsx")); };
    document.head.appendChild(s);
  });
}

// ---------- النموذج ----------
// rows: [[المعلم, المادة, الشعبة, الحصص, الجوال, النصاب], ...]
export async function downloadTemplate(rows, filename = "نموذج بيانات المدرسة") {
  const X = await loadXlsx();
  const sample = rows?.length ? rows : [
    ["أحمد سالم الكندي", "الرياضيات", "1/10", 5, "9xxxxxxx", 20],
    ["أحمد سالم الكندي", "الرياضيات", "2/10", 5, "", ""],
    ["سالم محمد الهنائي", "الفيزياء", "5/12", 4, "", 18]
  ];
  const ws = X.utils.aoa_to_sheet([HEAD, ...sample.map(r => r.map((v, i) => i === 2 || i === 4 ? String(v ?? "") : v))]);
  // عمود الشعبة والجوال نص، حتى لا يحوّل Excel «5/12» إلى تاريخ
  for (let r = 1; r <= 400; r++) for (const c of [2, 4]) {
    const a = X.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { t: "s", v: "" };
    ws[a].t = "s"; ws[a].z = "@";
  }
  ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 400, c: HEAD.length - 1 } });
  ws["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 11 }, { wch: 14 }, { wch: 9 }];
  const help = X.utils.aoa_to_sheet([
    ["طريقة التعبئة"],
    ["• سطر واحد لكل معلم ومادة وشعبة."],
    ["• الشعبة تُكتب: رقم الشعبة/رقم الصف، مثل 5/12 = الصف الثاني عشر الشعبة 5."],
    ["• عدد الحصص: حصص هذه المادة في هذه الشعبة أسبوعيًا."],
    ["• رقم الجوال والنصاب يكفي كتابتهما في أول سطر للمعلم (اختياري)."],
    ["• إذا تُرك اسم المعلم فارغًا يُعتبر نفس معلم السطر السابق."],
    ["• بعد الاستيراد اضغط «توزيع تلقائي» في صفحة الجدول."]
  ]);
  help["!cols"] = [{ wch: 80 }];
  const wb = X.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  X.utils.book_append_sheet(wb, ws, "البيانات");
  X.utils.book_append_sheet(wb, help, "طريقة التعبئة");
  X.writeFile(wb, filename.replace(/[\\/:*?"<>|]+/g, "-") + ".xlsx");
}

// ---------- القراءة ----------
const COLS = [
  ["phone", /جوال|هاتف|موبايل|phone|mobile|whatsapp|واتس/],
  ["maxLoad", /نصاب|load/],
  ["periods", /حصص|حصه|عدد|periods|lessons/],
  ["teacher", /معلم|مدرس|teacher|الاسم|name/],
  ["subject", /ماده|مقرر|subject/],
  ["section", /شعبه|فصل|section|class/],
  ["grade", /^الصف$|^صف$|grade/]
];
function mapHeader(row) {
  const m = {};
  row.forEach((c, i) => {
    const h = norm(c);
    if (!h) return;
    for (const [k, re] of COLS) if (m[k] == null && re.test(h)) { m[k] = i; break; }
  });
  return m.teacher != null && m.subject != null && (m.section != null || m.grade != null) ? m : null;
}
function gradeNum(v) {
  const s = norm(v); if (!s) return null;
  const d = s.match(/\d+/); if (d) return +d[0];
  const i = GRADE_NAMES.map(norm).findIndex(g => s.includes(g));
  // "الحادي عشر" يحتوي "عشر" فقط؛ نبحث عن الأطول أولًا
  const best = GRADE_NAMES.map((g, k) => [norm(g), k]).filter(([g]) => s.includes(g)).sort((a, b) => b[0].length - a[0].length)[0];
  return best ? best[1] + 1 : (i >= 0 ? i + 1 : null);
}
// "5/12" → {num:5, grade:12}
function parseSection(sec, grade) {
  const s = norm(sec);
  const m = s.match(/(\d+)\s*[\/\\\-_.]\s*(\d+)/);
  if (m) return { num: +m[1], grade: +m[2] };
  const g = grade != null ? gradeNum(grade) : null;
  const n = s.match(/\d+/);
  if (g && n) return { num: +n[0], grade: g };
  return null;
}
const modeOf = a => { const m = new Map(); a.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0]; };

export async function parseExcel(file) {
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  let rows = null, map = null, sheetName = "";
  for (const name of wb.SheetNames) {
    const r = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
    for (let i = 0; i < Math.min(r.length, 15); i++) {
      const m = mapHeader(r[i]);
      if (m) { rows = r.slice(i + 1); map = m; sheetName = name; break; }
    }
    if (rows) break;
  }
  if (!rows) return { error: "header" };

  const warnings = [];
  // Excel قد يحوّل «5/12» إلى تاريخ. نحدد اتجاه القراءة (يوم/شهر أو شهر/يوم) للملف كله:
  // الاتجاه الصحيح يعطي عددًا أقل من الصفوف المختلفة
  const dates = rows.map(r => r[map.section]).filter(v => v instanceof Date);
  let dayIsNum = true;
  if (dates.length) {
    const gA = new Set(dates.map(d => d.getMonth() + 1)), gB = new Set(dates.map(d => d.getDate()));
    dayIsNum = gA.size <= gB.size;
  }
  const secText = v => v instanceof Date ? (dayIsNum ? `${v.getDate()}/${v.getMonth() + 1}` : `${v.getMonth() + 1}/${v.getDate()}`) : String(v ?? "");
  const items = []; // {teacher, subject, num, grade, periods}
  const tInfo = new Map(); // name → {phone, maxLoad}
  let last = null, skipped = 0, badSec = [];
  const cell = (r, k) => map[k] == null ? "" : (k === "section" ? secText(r[map[k]]) : String(r[map[k]] ?? "")).trim();
  rows.forEach((r, i) => {
    if (!r.some(c => c instanceof Date || String(c).trim())) return;
    let teacher = cell(r, "teacher").replace(/\s+/g, " ");
    if (!teacher) teacher = last; else last = teacher;
    const subject = cell(r, "subject").replace(/\s+/g, " ");
    const sec = parseSection(cell(r, "section"), cell(r, "grade"));
    if (!teacher || !subject || !(cell(r, "section") || cell(r, "grade"))) { skipped++; return; }
    if (!sec) { badSec.push(cell(r, "section") || cell(r, "grade")); return; }
    const p = parseInt(norm(cell(r, "periods"))) || 0;
    const info = tInfo.get(teacher) || {};
    const ph = cell(r, "phone").replace(/[^\d+]/g, ""), ml = parseInt(norm(cell(r, "maxLoad")));
    if (ph && !info.phone) info.phone = ph;
    if (ml && !info.maxLoad) info.maxLoad = ml;
    tInfo.set(teacher, info);
    items.push({ teacher, subject, num: sec.num, grade: sec.grade, periods: p, row: i });
  });
  if (skipped) warnings.push(`${skipped} سطر ناقص (بدون معلم أو مادة أو شعبة) لم يُستورد`);
  if (badSec.length) warnings.push(`لم نفهم الشعبة في ${badSec.length} سطر (مثل: ${[...new Set(badSec)].slice(0, 4).join("، ")}) — اكتبها هكذا 5/12`);
  if (!items.length) return { error: "empty", warnings };

  // دمج السطور المكررة لنفس المعلم والمادة والشعبة
  const merged = new Map();
  for (const x of items) {
    const k = `${x.teacher}|${x.subject}|${x.num}/${x.grade}`;
    const o = merged.get(k);
    if (o) o.periods += x.periods; else merged.set(k, { ...x });
  }
  const list = [...merged.values()];
  const noP = list.filter(x => !x.periods).length;
  if (noP) warnings.push(`${noP} إسناد بدون عدد حصص — عدّلها من صفحة المعلمين`);

  const secKeys = [...new Set(list.map(x => `${x.num}/${x.grade}`))].sort((a, b) => (+a.split("/")[1] - +b.split("/")[1]) || (+a.split("/")[0] - +b.split("/")[0]));
  const grades = [...new Set(secKeys.map(s => +s.split("/")[1]))].sort((a, b) => a - b);
  const subjCount = new Map(); list.forEach(x => subjCount.set(x.subject, (subjCount.get(x.subject) || 0) + (x.periods || 1)));
  const subjects = [...subjCount.keys()].sort((a, b) => subjCount.get(b) - subjCount.get(a));
  const teachers = [...new Set(list.map(x => x.teacher))];

  const data = {
    format: "monasiq-import", version: 1, source: "Excel",
    grades: grades.map(g => ({ key: "g" + g, name: GRADE_NAMES[g - 1] || `الصف ${g}`, code: g })),
    sections: secKeys.map(s => ({ key: s, grade: "g" + s.split("/")[1], num: s.split("/")[0] })),
    subjects: subjects.map((name, i) => {
      const periods = {};
      for (const g of grades) {
        const vals = list.filter(x => x.subject === name && x.grade === g && x.periods).map(x => x.periods);
        if (vals.length) periods["g" + g] = modeOf(vals);
      }
      return { key: "s" + i, name, color: COLORS[i % COLORS.length], periods };
    }),
    teachers: teachers.map((name, i) => {
      const mine = list.filter(x => x.teacher === name);
      const sc = new Map(); mine.forEach(x => sc.set(x.subject, (sc.get(x.subject) || 0) + (x.periods || 1)));
      const main = [...sc].sort((a, b) => b[1] - a[1])[0]?.[0];
      const total = mine.reduce((a, x) => a + x.periods, 0);
      const info = tInfo.get(name) || {};
      return {
        key: "t" + i, name, phone: info.phone || "", subject: "s" + subjects.indexOf(main), maxLoad: info.maxLoad || total,
        assignments: mine.map(x => ({ subject: "s" + subjects.indexOf(x.subject), section: `${x.num}/${x.grade}`, periods: x.periods }))
      };
    }),
    timetable: []
  };
  return { data, warnings, stats: { rows: items.length, sheet: sheetName } };
}
