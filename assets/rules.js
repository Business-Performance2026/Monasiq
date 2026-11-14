// قيود الجدول: الأقسام، اجتماعات الأقسام، الحصص الفارغة للجميع، حدود الحصص، الحصص المتتالية
// الخانة (slot) = رقم اليوم × عدد الحصص + رقم الحصة

export const MODES = ["none", "double", "noConsec", "spread"];

// أقسام المعلم: المحددة يدويًا، أو تلقائيًا حسب مواده
export function teacherDepts(t, departments) {
  if (Array.isArray(t.deptIds)) return departments.filter(d => t.deptIds.includes(d.id));
  const subs = new Set([t.subjectId, ...(t.assignments || []).map(a => a.subjectId)].filter(Boolean));
  return departments.filter(d => (d.subjectIds || []).some(s => subs.has(s)));
}

// القيود الفعلية لكل معلم بعد دمج إعدادات المدرسة مع استثناءات المعلم
export function buildRules({ settings, departments = [], teachers = [] }) {
  const D = settings.days.length, P = settings.periods.length, N = D * P;
  const ok = x => x && x.d >= 0 && x.d < D && x.p >= 0 && x.p < P;
  const globalBlocked = new Set((settings.freeAll || []).filter(ok).map(x => x.d * P + x.p));
  const defMax = settings.periodMax || {};
  const defRun = +settings.maxRun || 0;
  const out = {};
  for (const t of teachers) {
    const depts = teacherDepts(t, departments);
    const meetings = new Map(); // slot -> اسم القسم
    for (const d of depts) for (const m of d.meetings || []) if (ok(m)) meetings.set(m.d * P + m.p, d.name);
    const r = t.rules || {};
    const periodMax = {};
    for (let p = 0; p < P; p++) {
      const own = r.periodMax?.[p], def = defMax[p];
      const v = own !== undefined && own !== null && own !== "" ? +own : (def !== undefined && def !== null && def !== "" ? +def : null);
      if (v !== null && !isNaN(v)) periodMax[p] = v;
    }
    const mode = MODES.includes(r.mode) ? r.mode : "none";
    let maxRun = r.maxRun !== undefined && r.maxRun !== null && r.maxRun !== "" ? +r.maxRun : defRun;
    if (mode === "noConsec") maxRun = 1;
    out[t.id] = { meetings, periodMax, maxRun: maxRun > 0 ? maxRun : 0, mode, doubles: mode === "double" ? Math.max(1, +r.doubles || 1) : 0, depts: depts.map(d => d.id) };
  }
  return { D, P, N, globalBlocked, teachers: out };
}

// هل يمكن وضع حصة للمعلم في هذه الخانة؟ (للنقل اليدوي) — يرجع null أو سبب الرفض
// mySlots: خانات المعلم الأخرى (بدون الحصة التي ننقلها)
export function slotViolation(rules, teacherId, d, p, mySlots, L) {
  const { P, globalBlocked } = rules;
  const s = d * P + p;
  if (globalBlocked.has(s)) return L("هذه الحصة فارغة لجميع المعلمين");
  const r = rules.teachers[teacherId];
  if (!r) return null;
  if (r.meetings.has(s)) return L("المعلم لديه اجتماع قسم {0} في هذا الوقت", r.meetings.get(s));
  if (r.periodMax[p] !== undefined) {
    const n = [...mySlots].filter(x => x % P === p).length;
    if (n + 1 > r.periodMax[p]) return L("تجاوز الحد: الحصة {0} مسموح {1} مرة في الأسبوع لهذا المعلم", p + 1, r.periodMax[p]);
  }
  if (r.maxRun > 0) {
    let run = 1;
    for (let q = p - 1; q >= 0 && mySlots.has(d * P + q); q--) run++;
    for (let q = p + 1; q < P && mySlots.has(d * P + q); q++) run++;
    if (run > r.maxRun) return r.maxRun === 1 ? L("هذا المعلم لا تُوضع له حصص متتالية") : L("تجاوز الحد: أقصى {0} حصص متتالية لهذا المعلم", r.maxRun);
  }
  return null;
}

// فحص قبل التوزيع: قيود لا يمكن تحقيقها
export function precheck(rules, lessons, names) {
  const { D, P, N, globalBlocked } = rules;
  const issues = [];
  const tLoad = new Map(), cLoad = new Map();
  for (const x of lessons) { tLoad.set(x.t, (tLoad.get(x.t) || 0) + 1); cLoad.set(x.c, (cLoad.get(x.c) || 0) + 1); }
  const freeN = N - globalBlocked.size;
  for (const [c, n] of cLoad) if (n > freeN) issues.push({ k: "section", id: c, need: n, have: freeN });
  for (const [t, n] of tLoad) {
    const r = rules.teachers[t];
    let have = 0;
    for (let s = 0; s < N; s++) if (!globalBlocked.has(s) && !(r && r.meetings.has(s))) have++;
    if (r) {
      // سقف حسب حدود الحصص
      let cap = 0;
      for (let p = 0; p < P; p++) {
        let free = 0;
        for (let d = 0; d < D; d++) { const s = d * P + p; if (!globalBlocked.has(s) && !r.meetings.has(s)) free++; }
        cap += r.periodMax[p] !== undefined ? Math.min(free, r.periodMax[p]) : free;
      }
      // سقف حسب الحصص المتتالية
      if (r.maxRun > 0) cap = Math.min(cap, D * (P - Math.floor(P / (r.maxRun + 1))));
      have = Math.min(have, cap);
    }
    if (n > have) issues.push({ k: "teacher", id: t, need: n, have });
  }
  return issues;
}
