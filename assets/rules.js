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
export function buildRules({ settings, departments = [], teachers = [], sections = [] }) {
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
    // أوقات تفريغ المعلم (مثل الدراسة): يوم كامل أو من حصة إلى حصة
    const unavail = new Set();
    for (const f of r.free || []) {
      if (!(f.d >= 0 && f.d < D)) continue;
      const a = Math.max(0, +f.from || 0), b = Math.min(P - 1, f.to === undefined || f.to === null ? P - 1 : +f.to);
      for (let p = a; p <= b; p++) unavail.add(f.d * P + p);
    }
    const periodMax = {};
    for (let p = 0; p < P; p++) {
      const own = r.periodMax?.[p], def = defMax[p];
      const v = own !== undefined && own !== null && own !== "" ? +own : (def !== undefined && def !== null && def !== "" ? +def : null);
      if (v !== null && !isNaN(v)) periodMax[p] = v;
    }
    const mode = MODES.includes(r.mode) ? r.mode : "none";
    let maxRun = r.maxRun !== undefined && r.maxRun !== null && r.maxRun !== "" ? +r.maxRun : defRun;
    if (mode === "noConsec") maxRun = 1;
    out[t.id] = { meetings, unavail, periodMax, maxRun: maxRun > 0 ? maxRun : 0, mode, doubles: mode === "double" ? Math.max(1, +r.doubles || 1) : 0, depts: depts.map(d => d.id) };
  }
  // قيود الشعب: أوقات فارغة، وأيام مخصصة لمعلم واحد
  const secOut = {};
  for (const c of sections) {
    const r = c.rules || {};
    const blocked = new Map(); // slot -> سبب
    for (const f of r.free || []) {
      if (!(f.d >= 0 && f.d < D)) continue;
      if (f.p === -1 || f.p === undefined || f.p === null) for (let p = 0; p < P; p++) blocked.set(f.d * P + p, "free");
      else if (f.p >= 0 && f.p < P) blocked.set(f.d * P + f.p, "free");
    }
    const owners = [];
    for (const o of r.days || []) {
      if (!(o.d >= 0 && o.d < D) || !o.t) continue;
      const t = teachers.find(x => x.id === o.t);
      const n = (t?.assignments || []).filter(a => a.sectionId === c.id).reduce((x, a) => x + (+a.periods || 0), 0);
      const quota = Math.min(n, P);
      const rest = o.rest === "others" ? "others" : "free";
      owners.push({ d: o.d, t: o.t, rest, quota, n });
      // ينصرف الطلاب بعد حصص المعلم: الحصص بعدها فارغة
      if (rest === "free") for (let p = quota; p < P; p++) if (!blocked.has(o.d * P + p)) blocked.set(o.d * P + p, "dismiss");
    }
    if (blocked.size || owners.length) secOut[c.id] = { blocked, owners };
  }
  return { D, P, N, globalBlocked, teachers: out, sections: secOut };
}

// هل يمكن وضع حصة للمعلم في هذه الخانة؟ (للنقل اليدوي) — يرجع null أو سبب الرفض
// mySlots: خانات المعلم الأخرى (بدون الحصة التي ننقلها)
export function slotViolation(rules, teacherId, d, p, mySlots, L) {
  const { P, globalBlocked } = rules;
  const s = d * P + p;
  if (globalBlocked.has(s)) return L("هذه الحصة فارغة لجميع المعلمين");
  const r = rules.teachers[teacherId];
  if (!r) return null;
  if (r.unavail?.has(s)) return L("المعلم متفرّغ (غير متاح) في هذا الوقت");
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

// عدد الأيام المتاحة للشعبة لحصص المعلمين العاديين (بعد الأيام الفارغة والأيام المخصصة لمعلم مع انصراف الطلاب)
export function sectionDays(rules, cid) {
  const sr = rules.sections?.[cid]; if (!sr) return rules.D;
  let lost = 0;
  for (let d = 0; d < rules.D; d++) {
    let all = true; for (let p = 0; p < rules.P; p++) if (!sr.blocked.has(d * rules.P + p)) { all = false; break; }
    if (all || sr.owners.some(o => o.d === d && (o.rest === "free" || o.quota >= rules.P))) lost++;
  }
  return Math.max(1, rules.D - lost);
}

// قيود الشعبة للنقل اليدوي. counts: { ownerCount(c,d), nonOwnerCount(c,d) } بدون الحصة المنقولة
export function sectionViolation(rules, lesson, d, p, counts, L, names) {
  const sr = rules.sections?.[lesson.c];
  if (!sr) return null;
  const s = d * rules.P + p;
  if (sr.blocked.has(s)) return sr.blocked.get(s) === "dismiss" ? L("الشعبة {0} تنصرف في هذا الوقت (بعد حصص {1})", names.section(lesson.c), names.teacher(sr.owners.find(o => o.d === d)?.t)) : L("الشعبة {0} فارغة في هذا الوقت", names.section(lesson.c));
  const own = sr.owners.find(o => o.d === d);
  if (own && own.t !== lesson.t) {
    if (own.rest === "free") return L("يوم {0} مخصص للمعلم {1} مع الشعبة {2}", names.day(d), names.teacher(own.t), names.section(lesson.c));
    if (counts.nonOwner(lesson.c, d) + 1 > rules.P - own.quota) return L("يوم {0} محجوز معظمه للمعلم {1} مع الشعبة {2}", names.day(d), names.teacher(own.t), names.section(lesson.c));
  }
  const mine = sr.owners.find(o => o.t === lesson.t);
  if (mine && mine.d !== d && counts.owner(lesson.c, mine.d) < mine.quota) return L("حصص هذا المعلم مع الشعبة {0} يجب أن تكون يوم {1} أولًا", names.section(lesson.c), names.day(mine.d));
  return null;
}

// فحص قبل التوزيع: قيود لا يمكن تحقيقها
export function precheck(rules, lessons, names) {
  const { D, P, N, globalBlocked } = rules;
  const issues = [];
  const tLoad = new Map(), cLoad = new Map();
  for (const x of lessons) { tLoad.set(x.t, (tLoad.get(x.t) || 0) + 1); cLoad.set(x.c, (cLoad.get(x.c) || 0) + 1); }
  for (const [c, n] of cLoad) {
    const sb = rules.sections?.[c]?.blocked;
    let have = 0;
    for (let s = 0; s < N; s++) if (!globalBlocked.has(s) && !(sb && sb.has(s))) have++;
    if (n > have) issues.push({ k: "section", id: c, need: n, have });
  }
  for (const [t, n] of tLoad) {
    const r = rules.teachers[t];
    let have = 0;
    for (let s = 0; s < N; s++) if (!globalBlocked.has(s) && !(r && (r.meetings.has(s) || r.unavail?.has(s)))) have++;
    if (r) {
      // سقف حسب حدود الحصص
      let cap = 0;
      for (let p = 0; p < P; p++) {
        let free = 0;
        for (let d = 0; d < D; d++) { const s = d * P + p; if (!globalBlocked.has(s) && !r.meetings.has(s) && !r.unavail?.has(s)) free++; }
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
