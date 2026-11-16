// استيراد ملف XML من برنامج aSc Timetables (صيغة «Oman XML» التي ترفعها المدارس للوزارة، أو تصدير aSc العادي)
// يقرأ: الفترات وأوقاتها، المعلمين، المواد، الصفوف والشعب، ومكان كل حصة في الجدول
import { norm } from "./app.js?v=202611151929";

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const GRADE_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c", "#65a30d", "#475569", "#9333ea", "#0d9488", "#b45309", "#e11d48", "#1d4ed8", "#15803d", "#a21caf", "#c2410c"];

// رقم الصف من اسمه: «الحادي عشر  المسار المهني» → 11
function gradeCode(name) {
  const s = norm(name);
  const d = s.match(/\d+/); if (d && +d[0] <= 12) return +d[0];
  const hit = GRADE_NAMES.map((g, i) => [norm(g), i + 1]).filter(([g]) => s.includes(g)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}
const pad = t => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };
const mode = a => { const m = new Map(); a.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0]; };

export async function parseAscXml(file, current = {}) {
  const buf = await file.arrayBuffer();
  const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
  let enc = (head.match(/encoding=["']([^"']+)/i)?.[1] || "utf-8").toLowerCase();
  let text;
  try { text = new TextDecoder(enc).decode(buf); } catch { text = new TextDecoder("utf-8").decode(buf); }
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) return { error: "xml" };
  const root = xml.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "timetable") return { error: "format" };
  const all = tag => [...xml.getElementsByTagName(tag)];
  const at = (el, ...ks) => { for (const k of ks) { const v = el.getAttribute(k); if (v != null && v !== "") return v; } return ""; };
  const warnings = [];

  // ---- القوائم الأساسية ----
  const teachers = new Map(all("teacher").map(e => [at(e, "id"), (at(e, "name") || at(e, "short")).replace(/\s+/g, " ").trim()]).filter(([id, n]) => id && n));
  const subjects = new Map(all("subject").map(e => [at(e, "id"), (at(e, "name") || at(e, "short")).replace(/\s+/g, " ").trim()]).filter(([id, n]) => id && n));
  const gradeName = new Map(all("grade").map(e => [at(e, "id"), (at(e, "name") || "").replace(/\s+/g, " ").trim()]));
  const classes = new Map();
  for (const e of all("class")) {
    const id = at(e, "id"), name = (at(e, "name") || at(e, "short")).replace(/\s+/g, " ").trim();
    if (!id) continue;
    const gname = gradeName.get(at(e, "gradeid")) || name;
    const code = gradeCode(gname) ?? gradeCode(name);
    const numM = name.match(/[\/\\-]\s*(\d+)\s*$/) || name.match(/(\d+)\s*$/);
    classes.set(id, { id, name, gradeId: at(e, "gradeid") || "g" + code, gradeName: gname, code, num: numM ? numM[1] : String(classes.size + 1) });
  }
  // الفترات
  const periodEls = all("period").filter(e => at(e, "period"));
  const periods = periodEls.map(e => ({ n: +at(e, "period"), start: pad(at(e, "starttime")), end: pad(at(e, "endtime")) })).sort((a, b) => a.n - b.n);
  const dayBase = /daynumbering1/i.test(root.getAttribute("options") || "") ? 1 : 0;

  // ---- الحصص الموزعة ----
  const placed = []; // {t, s, c, d, p}
  const sched = all("TimeTableSchedule");
  if (sched.length) {
    // صيغة الوزارة: DayID من 1 (الأحد) وPeriod من 1
    for (const e of sched) placed.push({ t: at(e, "TeacherID"), s: at(e, "SubjectGradeID"), c: at(e, "ClassID"), d: +at(e, "DayID") - 1, p: +at(e, "Period") - 1 });
  } else {
    // تصدير aSc العادي: بطاقات card
    const lessonById = new Map(all("lesson").map(e => [at(e, "id"), e]));
    for (const e of all("card")) {
      const ls = lessonById.get(at(e, "lessonid"));
      const s = at(e, "subjectid") || (ls && at(ls, "subjectid"));
      const ts = (at(e, "teacherid", "teacherids") || (ls && at(ls, "teacherids", "teacherid")) || "").split(",").filter(Boolean);
      const cs = (at(e, "classids") || (ls && at(ls, "classids")) || "").split(",").filter(Boolean);
      let d = at(e, "day"); const days = at(e, "days");
      if (days && /^[01]+$/.test(days)) d = days.indexOf("1"); else d = +d - dayBase;
      const p = +at(e, "period") - (periods[0]?.n === 0 ? 0 : 1);
      if (!ts.length || !cs.length || !s || isNaN(d) || isNaN(p)) continue;
      if (ts.length > 1) warnings.push(`حصة مشتركة لعدة معلمين (${ts.map(x => teachers.get(x)).join("، ")}) — أُخذ الأول`);
      for (const c of cs) placed.push({ t: ts[0], s, c, d, p });
    }
  }
  // تجاهل ما لا نعرفه، ثم حذف التعارضات
  let unknown = 0;
  const known = placed.filter(x => { const ok = teachers.has(x.t) && subjects.has(x.s) && classes.has(x.c) && x.d >= 0 && x.p >= 0; if (!ok) unknown++; return ok; });
  if (unknown) warnings.push(`${unknown} حصة لمعلم أو مادة أو شعبة غير معروفة لم تُستورد`);
  const tS = new Set(), cS = new Set(), kept = []; let dupC = 0, dupT = 0;
  for (const x of known) {
    const a = `${x.t}@${x.d}.${x.p}`, b = `${x.c}@${x.d}.${x.p}`;
    if (tS.has(a)) { dupT++; continue; }
    if (cS.has(b)) { dupC++; continue; }
    tS.add(a); cS.add(b); kept.push(x);
  }
  if (dupC) warnings.push(`${dupC} حصة مشتركة بين معلمَين لنفس الشعبة في نفس الوقت (مثل مجموعات المواد الاختيارية) — بقيت لمعلم واحد`);
  if (dupT) warnings.push(`${dupT} حصة مكررة للمعلم في نفس الوقت — أُخذت الأولى فقط`);

  // الإسناد: من الحصص الموزعة، ومن جداول الإسناد (لحصص غير موزعة)
  const asg = new Map(); // "t|s|c" -> periods
  for (const x of kept) { const k = `${x.t}|${x.s}|${x.c}`; asg.set(k, (asg.get(k) || 0) + 1); }
  const addPlan = (t, s, c, n) => { const k = `${t}|${s}|${c}`; if (!asg.has(k) && teachers.has(t) && subjects.has(s) && classes.has(c)) asg.set(k, n); };
  for (const e of all("lesson")) {
    const n = Math.round(parseFloat(at(e, "periodsperweek")) || 0); if (!n) continue;
    const ts = at(e, "teacherid", "teacherids").split(","), cs = at(e, "classids").split(",");
    for (const c of cs) addPlan(ts[0], at(e, "subjectid"), c, n);
  }
  for (const e of all("TeacherSubjectClass")) addPlan(at(e, "TeacherID"), at(e, "SubjectGradeID"), at(e, "ClassID"), 0);
  const usedClasses = new Set([...asg.keys()].map(k => k.split("|")[2]));
  if (!usedClasses.size) return { error: "empty", warnings };
  if (classes.size > usedClasses.size) warnings.push(`${classes.size - usedClasses.size} شعبة بدون حصص في الملف لم تُستورد`);

  // ---- البناء بصيغة الاستيراد ----
  const secs = [...usedClasses].map(id => classes.get(id)).sort((a, b) => (a.code || 0) - (b.code || 0) || +a.num - +b.num);
  const gradeIds = [...new Set(secs.map(s => s.gradeId))];
  const subjIds = [...new Set([...asg.keys()].map(k => k.split("|")[1]))];
  const subjLoad = new Map(); for (const [k, n] of asg) { const s = k.split("|")[1]; subjLoad.set(s, (subjLoad.get(s) || 0) + (n || 1)); }
  subjIds.sort((a, b) => subjLoad.get(b) - subjLoad.get(a));
  const per = new Map(); for (const [k, n] of asg) { const [, s, c] = k.split("|"); per.set(s + "|" + c, Math.max(per.get(s + "|" + c) || 0, n)); }
  const maxD = Math.max(4, ...kept.map(x => x.d)), maxP = Math.max(periods.length, ...kept.map(x => x.p + 1));
  const days = DAY_NAMES.slice(0, Math.min(7, maxD + 1));
  const okTimes = periods.length >= maxP && periods.every(x => x.start && x.end);
  const teacherIds = [...teachers.keys()];

  const data = {
    format: "monasiq-import", version: 1, source: "aSc XML",
    settings: okTimes ? { days, periods: periods.slice(0, maxP).map(x => ({ start: x.start, end: x.end })) } : { days, periodsCount: maxP },
    grades: gradeIds.map(g => { const s = secs.find(x => x.gradeId === g); return { key: "g" + g, ext: g, name: (s.gradeName || "").trim() || GRADE_NAMES[(s.code || 1) - 1], code: s.code || "" }; }),
    sections: secs.map(s => {
      // يوم كامل لمعلم واحد في الشعبة (مثل السفر والسياحة) → قيد «يوم مخصص لمعلم»
      const own = [];
      for (let d = 0; d <= maxD; d++) {
        const dl = kept.filter(x => x.c === s.id && x.d === d);
        const ts = new Set(dl.map(x => x.t));
        if (dl.length >= maxP - 1 && ts.size === 1) own.push({ d, t: "t" + [...ts][0], rest: "free" });
      }
      return { key: "c" + s.id, ext: s.id, grade: "g" + s.gradeId, num: s.num, ...(own.length ? { rules: { free: [], days: own } } : {}) };
    }),
    subjects: subjIds.map((id, i) => {
      const periodsBy = {};
      for (const g of gradeIds) {
        const gs = secs.filter(s => s.gradeId === g);
        const vals = gs.map(s => per.get(id + "|" + s.id) || 0);
        if (vals.every(v => v > 0)) periodsBy["g" + g] = mode(vals);
      }
      return { key: "s" + id, ext: id, name: subjects.get(id), color: COLORS[i % COLORS.length], periods: periodsBy };
    }),
    teachers: teacherIds.map(id => {
      const mine = [...asg].filter(([k]) => k.startsWith(id + "|"));
      const total = mine.reduce((a, [, n]) => a + n, 0);
      const sc = new Map(); mine.forEach(([k, n]) => { const s = k.split("|")[1]; sc.set(s, (sc.get(s) || 0) + (n || 1)); });
      const main = [...sc].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        key: "t" + id, ext: id, name: teachers.get(id), subject: main ? "s" + main : "", maxLoad: total || "",
        assignments: mine.map(([k, n]) => { const [, s, c] = k.split("|"); return { subject: "s" + s, section: "c" + c, periods: n }; })
      };
    }),
    timetable: kept.map(x => ({ teacher: "t" + x.t, subject: "s" + x.s, section: "c" + x.c, d: x.d, p: x.p }))
  };
  const withLessons = data.teachers.filter(t => t.assignments.length).length;
  if (withLessons < data.teachers.length) warnings.push(`${data.teachers.length - withLessons} معلم بدون حصص في هذا الملف — أُضيفوا للمدرسة بدون إسناد`);
  if (sched.length) data.noorSource = { text, name: file.name, encoding: enc };
  return { data, warnings: [...new Set(warnings)].slice(0, 30), stats: { lessons: kept.length, sections: secs.length, teachers: data.teachers.length } };
}
