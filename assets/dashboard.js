// لوحة تحكم المدرسة
import { db, applyBranding, waitUser, getRole, logout, esc, toast, confirmBox, errMsg, DAYS_ALL, defaultPeriods, t as tf, tr } from "./app.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

applyBranding();


// ---------- الحالة ----------
let SID;
const loaded = new Set();
const NEED = 5; // school, grades, sections, subjects, teachers
const S = { school: null, grades: [], sections: [], subjects: [], teachers: [] };
const $ = id => document.getElementById(id);
const col = name => collection(db, "schools", SID, name);
const dref = (name, id) => doc(db, "schools", SID, name, id);
const num = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

const GRADE_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c", "#65a30d", "#475569"];

const grade = id => S.grades.find(g => g.id === id);
const section = id => S.sections.find(s => s.id === id);
const subject = id => S.subjects.find(s => s.id === id);
const secLabel = s => { if (!s) return "؟"; const g = grade(s.gradeId); return `${s.num}/${g ? g.code : "?"}`; };
const load = t => (t.assignments || []).reduce((a, x) => a + num(x.periods), 0);
const settings = () => S.school?.settings || { days: DAYS_ALL.slice(0, 5), periods: defaultPeriods(8) };
const capacity = () => settings().days.length * settings().periods.length;

function init(user) {
  SID = user.uid;
  $("loading").classList.add("hidden");
  $("appRoot").classList.remove("hidden");
  $("logoutBtn").onclick = logout;
  const side = $("side"), shade = $("shade");
  const closeSide = () => { side.classList.remove("open"); shade.classList.remove("show"); };
  $("menuBtn").onclick = () => { side.classList.add("open"); shade.classList.add("show"); };
  shade.onclick = closeSide;
  $("nav").onclick = closeSide;
  window.addEventListener("hashchange", render);
  $("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack") closeModal(); });

  const mark = k => { loaded.add(k); render(); };

  onSnapshot(doc(db, "schools", SID), d => {
    S.school = { id: d.id, ...d.data() };
    if (S.school.status !== "active") return location.replace("login.html?s=" + S.school.status);
    $("schoolName").textContent = S.school.name;
    loaded.has("school") ? render() : mark("school");
  }, e => toast(errMsg(e), "error"));

  const sorters = {
    grades: (a, b) => num(a.code) - num(b.code) || a.name.localeCompare(b.name, "ar"),
    sections: (a, b) => (num(grade(a.gradeId)?.code) - num(grade(b.gradeId)?.code)) || num(a.num) - num(b.num),
    subjects: (a, b) => a.name.localeCompare(b.name, "ar"),
    teachers: (a, b) => a.name.localeCompare(b.name, "ar")
  };
  for (const k of ["grades", "sections", "subjects", "teachers"]) {
    onSnapshot(col(k), snap => {
      S[k] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      S[k].sort(sorters[k]);
      if (k === "grades") S.sections.sort(sorters.sections);
      loaded.has(k) ? render() : mark(k);
    }, e => toast(errMsg(e), "error"));
  }
}

// ---------- التوجيه ----------
const VIEWS = { overview: vOverview, settings: vSettings, grades: vGrades, subjects: vSubjects, teachers: vTeachers, timetable: vTimetable };
function render() {
  if (loaded.size < NEED) return;
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.v === v));
  const view = $("view");
  view.onclick = null;
  view.innerHTML = VIEWS[v]();
  BIND[v]?.(view);
}
const BIND = {};

// ---------- نافذة منبثقة ----------
function openModal(html) { $("modal").innerHTML = html; $("modalBack").classList.add("show"); }
function closeModal() { $("modalBack").classList.remove("show"); $("modal").innerHTML = ""; }
const modalHead = t => `<div class="modal-head"><h3>${t}</h3><button class="x" data-close>×</button></div>`;
document.addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(); });

// =====================================================
//  الرئيسية
// =====================================================
function vOverview() {
  const totalAssigned = S.teachers.reduce((a, t) => a + load(t), 0);
  const steps = [
    [S.school.settings?.periods?.length, "#settings", "حدّد أيام الدوام وعدد الحصص"],
    [S.grades.length && S.sections.length, "#grades", "أضف الصفوف والشعب"],
    [S.subjects.length, "#subjects", "أضف المواد وعدد حصصها لكل صف"],
    [S.teachers.length, "#teachers", "أضف المعلمين وأسند لهم الشعب"]
  ];
  const showSteps = steps.some(s => !s[0]);

  const tRows = S.teachers.map(t => {
    const l = load(t), max = num(t.maxLoad) || 0, pct = max ? Math.min(100, (l / max) * 100) : 0;
    const st = !max ? "" : l > max ? `<span class="badge bad">زائد ${l - max}</span>` : l < max ? `<span class="badge warn">ناقص ${max - l}</span>` : `<span class="badge ok">مكتمل</span>`;
    return `<tr><td><b>${esc(t.name)}</b></td><td>${esc(subject(t.subjectId)?.name || "—")}</td>
      <td style="min-width:140px"><div style="display:flex;align-items:center;gap:.5rem"><div class="load-bar ${l > max && max ? "over" : ""}" style="flex:1"><i style="width:${pct}%"></i></div><b>${l}/${max || "-"}</b></div></td><td>${st}</td></tr>`;
  }).join("");

  const cap = capacity();
  const sRows = S.sections.map(sec => {
    const req = S.subjects.reduce((a, s) => a + num(s.periods?.[sec.gradeId]), 0);
    const asg = assignedFor(sec.id);
    const missing = S.subjects.filter(s => num(s.periods?.[sec.gradeId]) > 0)
      .map(s => ({ s, need: num(s.periods[sec.gradeId]), have: asg.bySub[s.id] || 0 }))
      .filter(x => x.have < x.need);
    const st = asg.total > cap ? `<span class="badge bad">يتجاوز ${cap}</span>` : missing.length ? `<span class="badge warn">ناقص</span>` : req ? `<span class="badge ok">مكتمل</span>` : `<span class="badge info">—</span>`;
    return `<tr><td><b>${esc(secLabel(sec))}</b></td><td>${asg.total} / ${req}</td><td>${st}</td>
      <td>${missing.map(m => `<span class="chip"><span class="dot" style="background:${m.s.color}"></span>${esc(m.s.name)} ${m.have}/${m.need}</span>`).join("") || "<span class='muted'>—</span>"}</td></tr>`;
  }).join("");

  return `
  <div class="page-title"><h1>${esc(tf("أهلًا، {0}", S.school.principal || S.school.name))} 👋</h1></div>
  <div class="stats">
    <div class="stat"><div class="n">${S.teachers.length}</div><div class="l">معلم</div></div>
    <div class="stat"><div class="n">${S.sections.length}</div><div class="l">شعبة</div></div>
    <div class="stat"><div class="n">${S.subjects.length}</div><div class="l">مادة</div></div>
    <div class="stat"><div class="n">${totalAssigned}</div><div class="l">حصة مُسندة أسبوعيًا</div></div>
  </div>
  ${showSteps ? `<div class="card"><h3>ابدأ من هنا</h3>
    ${steps.map((s, i) => `<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0">
      <span class="badge ${s[0] ? "ok" : "warn"}">${s[0] ? "✔" : i + 1}</span>
      <a href="${s[1]}">${s[2]}</a></div>`).join("")}</div>` : ""}
  <div class="card">
    <div class="card-head"><h3>نصاب المعلمين</h3><span class="muted">${tf("{0} أيام × {1} حصص = {2} حصة أسبوعيًا لكل شعبة", settings().days.length, settings().periods.length, cap)}</span></div>
    ${S.teachers.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>المعلم</th><th>المادة</th><th>النصاب</th><th>الحالة</th></tr></thead><tbody>${tRows}</tbody></table></div>` : `<div class="empty">لم يتم إضافة معلمين بعد</div>`}
  </div>
  <div class="card">
    <div class="card-head"><h3>تغطية الشعب</h3><span class="muted">هل كل مواد الشعبة مُسندة لمعلمين؟</span></div>
    ${S.sections.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الشعبة</th><th>مُسند / مطلوب</th><th>الحالة</th><th>مواد غير مكتملة</th></tr></thead><tbody>${sRows}</tbody></table></div>` : `<div class="empty">لم يتم إضافة شعب بعد</div>`}
  </div>`;
}
function assignedFor(sectionId) {
  const bySub = {}; let total = 0;
  for (const t of S.teachers) for (const a of t.assignments || []) {
    if (a.sectionId !== sectionId) continue;
    bySub[a.subjectId] = (bySub[a.subjectId] || 0) + num(a.periods);
    total += num(a.periods);
  }
  return { bySub, total };
}

// =====================================================
//  الإعدادات
// =====================================================
let draftPeriods = null;
function vSettings() {
  const st = settings(), s = S.school;
  draftPeriods = (st.periods || []).map(p => ({ ...p }));
  return `
  <div class="page-title"><h1>إعدادات الدوام</h1></div>
  <div class="card">
    <h3>أيام الدوام</h3>
    <div style="display:flex;flex-wrap:wrap;gap:.6rem 1.4rem" id="daysBox">
      ${DAYS_ALL.map(d => `<label class="check"><input type="checkbox" value="${d}" ${st.days.includes(d) ? "checked" : ""}> ${d}</label>`).join("")}
    </div>
  </div>
  <div class="card">
    <h3>الحصص اليومية</h3>
    <p class="muted" style="margin-top:0">أنشئ الحصص تلقائيًا ثم عدّل أوقات أي حصة إذا احتجت.</p>
    <div class="grid-3" style="grid-template-columns:repeat(4,1fr)">
      <div class="field"><label>عدد الحصص</label><input type="number" id="gCount" min="1" max="12" value="${draftPeriods.length || 8}"></div>
      <div class="field"><label>بداية أول حصة</label><input type="time" id="gStart" value="${draftPeriods[0]?.start || "08:00"}"></div>
      <div class="field"><label>مدة الحصة (دقيقة)</label><input type="number" id="gDur" min="10" value="45"></div>
      <div class="field"><label>الفاصل بين الحصص (دقيقة)</label><input type="number" id="gGap" min="0" value="15"></div>
    </div>
    <button class="btn" id="genBtn">🔄 توليد الحصص</button>
    <div class="table-wrap" style="margin-top:1rem"><table class="tbl periods-tbl"><thead><tr><th>الحصة</th><th>من</th><th>إلى</th></tr></thead><tbody id="pBody"></tbody></table></div>
    <div class="modal-actions"><button class="btn primary" id="saveSettings">💾 حفظ إعدادات الدوام</button></div>
  </div>
  <div class="card">
    <h3>بيانات المدرسة</h3>
    <form id="infoForm">
      <div class="field"><label>اسم المدرسة</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="grid-2">
        <div class="field"><label>المحافظة / المنطقة</label><input name="region" value="${esc(s.region)}"></div>
        <div class="field"><label>الولاية / المدينة</label><input name="wilayah" value="${esc(s.wilayah)}"></div>
        <div class="field"><label>اسم المسؤول</label><input name="principal" value="${esc(s.principal)}"></div>
        <div class="field"><label>رقم الهاتف</label><input name="phone" dir="ltr" value="${esc(s.phone)}"></div>
      </div>
      <div class="field"><label>المراحل الدراسية</label><input name="stages" value="${esc(s.stages)}"></div>
      <button class="btn primary">💾 حفظ بيانات المدرسة</button>
    </form>
  </div>`;
}
BIND.settings = v => {
  const drawP = () => {
    $("pBody").innerHTML = draftPeriods.map((p, i) => `<tr><td><b>${i + 1}</b></td>
      <td><input type="time" data-i="${i}" data-k="start" value="${p.start}"></td>
      <td><input type="time" data-i="${i}" data-k="end" value="${p.end}"></td></tr>`).join("");
  };
  drawP();
  $("pBody").oninput = e => { const t = e.target; if (t.dataset.k) draftPeriods[t.dataset.i][t.dataset.k] = t.value; };
  $("genBtn").onclick = () => {
    const c = Math.min(12, Math.max(1, num($("gCount").value)));
    draftPeriods = defaultPeriods(c, $("gStart").value || "08:00", num($("gDur").value) || 45, num($("gGap").value));
    drawP();
  };
  $("saveSettings").onclick = async () => {
    const days = [...v.querySelectorAll("#daysBox input:checked")].map(i => i.value);
    if (!days.length) return toast("اختر يومًا واحدًا على الأقل", "error");
    if (!draftPeriods.length) return toast("أضف حصة واحدة على الأقل", "error");
    try {
      await updateDoc(doc(db, "schools", SID), { settings: { days, periods: draftPeriods }, updatedAt: serverTimestamp() });
      toast("تم حفظ إعدادات الدوام", "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
  $("infoForm").onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    for (const k in d) d[k] = d[k].trim();
    if (!d.name) return toast("اسم المدرسة مطلوب", "error");
    try { await updateDoc(doc(db, "schools", SID), { ...d, updatedAt: serverTimestamp() }); toast("تم الحفظ", "success"); }
    catch (ex) { toast(errMsg(ex), "error"); }
  };
};

// =====================================================
//  الصفوف والشعب
// =====================================================
function vGrades() {
  return `
  <div class="page-title"><h1>الصفوف والشعب</h1></div>
  <div class="card">
    <h3>إضافة صف</h3>
    <form id="gradeForm" class="grid-3" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end">
      <div class="field"><label>اسم الصف</label><input name="name" list="gradeNames" placeholder="مثال: العاشر" required></div>
      <div class="field"><label>الرمز (يظهر في الشعبة)</label><input name="code" placeholder="10" required></div>
      <div class="field"><label>عدد الشعب</label><input name="count" type="number" min="0" max="40" value="1"></div>
      <div class="field"><button class="btn primary">+ إضافة</button></div>
    </form>
    <datalist id="gradeNames">${GRADE_NAMES.map(n => `<option value="${n}">`).join("")}</datalist>
    <p class="muted" style="margin:0">الشعبة تظهر بالشكل <b>رقم الشعبة/رمز الصف</b>، مثل <b>5/12</b> = الصف الثاني عشر الشعبة 5.</p>
  </div>
  ${S.grades.length ? S.grades.map(g => {
    const secs = S.sections.filter(s => s.gradeId === g.id);
    return `<div class="grade-block" data-g="${g.id}">
      <div class="gh"><h3>${esc(g.name)} <span class="badge info">${esc(g.code)}</span> <span class="muted" style="font-size:.9rem">${secs.length} شعبة</span></h3>
        <div class="row-actions">
          <button class="btn sm primary" data-act="addSec">+ شعبة</button>
          <button class="btn sm" data-act="editGrade">تعديل</button>
          <button class="btn sm danger" data-act="delGrade">حذف</button>
        </div></div>
      <div>${secs.map(s => `<span class="sec-chip">${esc(secLabel(s))}<button title="حذف" data-act="delSec" data-s="${s.id}">×</button></span>`).join("") || "<span class='muted'>لا توجد شعب</span>"}</div>
    </div>`;
  }).join("") : `<div class="card empty"><div class="big">🏷️</div>أضف أول صف من النموذج أعلاه</div>`}`;
}
BIND.grades = v => {
  const f = $("gradeForm");
  f.name.oninput = () => { const i = GRADE_NAMES.indexOf(f.name.value.trim()); if (i >= 0) f.code.value = i + 1; };
  f.onsubmit = async e => {
    e.preventDefault();
    const name = f.name.value.trim(), code = f.code.value.trim(), count = Math.min(40, num(f.count.value));
    if (!name || !code) return;
    if (S.grades.some(g => g.code === code)) return toast("يوجد صف بنفس الرمز", "error");
    try {
      const gref = doc(col("grades"));
      const b = writeBatch(db);
      b.set(gref, { name, code, createdAt: serverTimestamp() });
      for (let i = 1; i <= count; i++) b.set(doc(col("sections")), { gradeId: gref.id, num: String(i) });
      await b.commit();
      toast("تمت إضافة الصف", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
  v.onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const gid = b.closest("[data-g]")?.dataset.g, g = grade(gid);
    const act = b.dataset.act;
    try {
      if (act === "addSec") {
        const nums = S.sections.filter(s => s.gradeId === gid).map(s => num(s.num));
        const next = (nums.length ? Math.max(...nums) : 0) + 1;
        await addDoc(col("sections"), { gradeId: gid, num: String(next) });
      } else if (act === "delSec") {
        const s = section(b.dataset.s);
        if (!(await confirmBox(tf("حذف الشعبة {0}؟ سيتم حذف إسنادها من المعلمين.", secLabel(s)), "حذف"))) return;
        await removeSections([s.id]);
        toast("تم حذف الشعبة", "success");
      } else if (act === "delGrade") {
        if (!(await confirmBox(tf("حذف صف «{0}» وكل شعبه؟", g.name), "حذف"))) return;
        await removeSections(S.sections.filter(s => s.gradeId === gid).map(s => s.id), gid);
        toast("تم حذف الصف", "success");
      } else if (act === "editGrade") {
        openModal(`${modalHead("تعديل الصف")}
          <form id="egForm"><div class="grid-2">
            <div class="field"><label>اسم الصف</label><input name="name" value="${esc(g.name)}" required></div>
            <div class="field"><label>الرمز</label><input name="code" value="${esc(g.code)}" required></div></div>
            <div class="modal-actions"><button class="btn primary">حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div></form>`);
        $("egForm").onsubmit = async ev => {
          ev.preventDefault();
          const name = ev.target.name.value.trim(), code = ev.target.code.value.trim();
          if (S.grades.some(x => x.code === code && x.id !== gid)) return toast("يوجد صف بنفس الرمز", "error");
          await updateDoc(dref("grades", gid), { name, code });
          closeModal(); toast("تم الحفظ", "success");
        };
      }
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
};
async function removeSections(ids, gradeId) {
  const set = new Set(ids);
  const b = writeBatch(db);
  ids.forEach(id => b.delete(dref("sections", id)));
  if (gradeId) b.delete(dref("grades", gradeId));
  for (const t of S.teachers) {
    const kept = (t.assignments || []).filter(a => !set.has(a.sectionId));
    if (kept.length !== (t.assignments || []).length) b.update(dref("teachers", t.id), { assignments: kept });
  }
  if (gradeId) for (const s of S.subjects) if (s.periods && gradeId in s.periods) {
    const p = { ...s.periods }; delete p[gradeId];
    b.update(dref("subjects", s.id), { periods: p });
  }
  await b.commit();
}

// =====================================================
//  المواد
// =====================================================
function vSubjects() {
  return `
  <div class="page-title"><h1>المواد</h1><button class="btn primary" id="addSub">+ إضافة مادة</button></div>
  ${!S.grades.length ? `<div class="notice warn">أضف الصفوف أولًا من <a href="#grades">الصفوف والشعب</a> حتى تحدد عدد حصص كل مادة لكل صف.</div>` : ""}
  <div class="card">
  ${S.subjects.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>المادة</th>
    ${S.grades.map(g => `<th>${esc(g.name)}</th>`).join("")}<th></th></tr></thead><tbody>
    ${S.subjects.map(s => `<tr data-id="${s.id}"><td><span class="dot" style="background:${s.color}"></span> <b>${esc(s.name)}</b></td>
      ${S.grades.map(g => `<td>${num(s.periods?.[g.id]) || "<span class='muted'>—</span>"}</td>`).join("")}
      <td><div class="row-actions"><button class="btn sm" data-act="edit">تعديل</button><button class="btn sm danger" data-act="del">حذف</button></div></td></tr>`).join("")}
    </tbody></table></div><p class="muted" style="margin-bottom:0">الأرقام = عدد حصص المادة أسبوعيًا لكل شعبة في الصف.</p>`
    : `<div class="empty"><div class="big">📚</div>لم تتم إضافة مواد بعد</div>`}
  </div>`;
}
function subjectModal(s) {
  const isNew = !s;
  s = s || { name: "", color: COLORS[S.subjects.length % COLORS.length], periods: {} };
  openModal(`${modalHead(isNew ? "إضافة مادة" : "تعديل المادة")}
  <form id="subForm">
    <div class="grid-2" style="grid-template-columns:1fr 110px">
      <div class="field"><label>اسم المادة</label><input name="name" value="${esc(s.name)}" required placeholder="مثال: الفيزياء"></div>
      <div class="field"><label>اللون</label><input name="color" type="color" value="${s.color}" style="padding:.2em;height:46px"></div>
    </div>
    ${S.grades.length ? `<label>عدد الحصص الأسبوعية لكل صف</label>
    <div class="grid-3">${S.grades.map(g => `<div class="field"><label class="muted" style="font-weight:500">${esc(g.name)}</label>
      <input type="number" min="0" max="20" name="p_${g.id}" value="${num(s.periods?.[g.id]) || ""}" placeholder="0"></div>`).join("")}</div>` : ""}
    <div class="modal-actions"><button class="btn primary">حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
  </form>`);
  $("subForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target, name = f.name.value.trim();
    if (!name) return;
    if (S.subjects.some(x => x.name === name && x.id !== s.id)) return toast("المادة موجودة مسبقًا", "error");
    const periods = {};
    S.grades.forEach(g => { const n = num(f["p_" + g.id].value); if (n > 0) periods[g.id] = n; });
    const data = { name, color: f.color.value, periods };
    try {
      if (isNew) await addDoc(col("subjects"), { ...data, createdAt: serverTimestamp() });
      else await updateDoc(dref("subjects", s.id), data);
      closeModal(); toast("تم الحفظ", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}
BIND.subjects = v => {
  $("addSub").onclick = () => subjectModal();
  v.querySelector(".tbl")?.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const s = subject(b.closest("[data-id]").dataset.id);
    if (b.dataset.act === "edit") return subjectModal(s);
    if (!(await confirmBox(tf("حذف مادة «{0}»؟ سيتم حذف إسنادها من المعلمين.", s.name), "حذف"))) return;
    try {
      const batch = writeBatch(db);
      batch.delete(dref("subjects", s.id));
      for (const t of S.teachers) {
        const kept = (t.assignments || []).filter(a => a.subjectId !== s.id);
        const upd = {};
        if (kept.length !== (t.assignments || []).length) upd.assignments = kept;
        if (t.subjectId === s.id) upd.subjectId = "";
        if (Object.keys(upd).length) batch.update(dref("teachers", t.id), upd);
      }
      await batch.commit();
      toast("تم حذف المادة", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  });
};

// =====================================================
//  المعلمون
// =====================================================
let tQuery = "";
function vTeachers() {
  return `
  <div class="page-title"><h1>المعلمون</h1>
    <div class="row-actions"><input id="tSearch" placeholder="بحث..." value="${esc(tQuery)}" style="max-width:200px"><button class="btn primary" id="addT">+ إضافة معلم</button></div></div>
  ${!S.subjects.length || !S.sections.length ? `<div class="notice warn">يُفضّل إضافة <a href="#grades">الشعب</a> و<a href="#subjects">المواد</a> أولًا حتى تستطيع إسنادها للمعلمين.</div>` : ""}
  <div class="card" id="tList"></div>`;
}
function drawTeachers() {
  const rows = S.teachers.filter(t => !tQuery || t.name.includes(tQuery) || (subject(t.subjectId)?.name || "").includes(tQuery));
  $("tList").innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>المعلم</th><th>المادة</th><th>الشعب المُسندة</th><th>النصاب</th><th></th></tr></thead><tbody>
    ${rows.map(t => {
      const l = load(t), max = num(t.maxLoad);
      return `<tr data-id="${t.id}"><td><b>${esc(t.name)}</b>${t.phone ? `<div class="muted" style="font-size:.82rem"><span dir="ltr">${esc(t.phone)}</span></div>` : ""}</td>
      <td>${esc(subject(t.subjectId)?.name || "—")}</td>
      <td style="max-width:380px">${(t.assignments || []).map(a => { const sb = subject(a.subjectId);
        return `<span class="chip" title="${esc(sb?.name || "")}"><span class="dot" style="background:${sb?.color || "#999"}"></span>${esc(secLabel(section(a.sectionId)))} <b>${num(a.periods)}</b></span>`; }).join("") || "<span class='muted'>—</span>"}</td>
      <td><span class="badge ${max && l > max ? "bad" : max && l === max ? "ok" : "info"}">${l}/${max || "-"}</span></td>
      <td><div class="row-actions"><button class="btn sm" data-act="edit">تعديل</button><button class="btn sm danger" data-act="del">حذف</button></div></td></tr>`;
    }).join("")}</tbody></table></div>`
    : `<div class="empty"><div class="big">👩‍🏫</div>${S.teachers.length ? "لا نتائج" : "لم تتم إضافة معلمين بعد"}</div>`;
}
BIND.teachers = () => {
  drawTeachers();
  $("tSearch").oninput = e => { tQuery = e.target.value.trim(); drawTeachers(); };
  $("addT").onclick = () => teacherModal();
  $("tList").onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const t = S.teachers.find(x => x.id === b.closest("[data-id]").dataset.id);
    if (b.dataset.act === "edit") return teacherModal(t);
    if (!(await confirmBox(tf("حذف المعلم «{0}»؟", t.name), "حذف"))) return;
    try { await deleteDoc(dref("teachers", t.id)); toast("تم الحذف", "success"); } catch (ex) { toast(errMsg(ex), "error"); }
  };
};

function teacherModal(t) {
  const isNew = !t;
  t = t || { name: "", phone: "", subjectId: "", maxLoad: 20, assignments: [] };
  let asg = (t.assignments || []).map(a => ({ ...a }));
  const subOpts = sel => `<option value="">— اختر —</option>` + S.subjects.map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  openModal(`${modalHead(isNew ? "إضافة معلم" : "تعديل بيانات المعلم")}
  <form id="tForm">
    <div class="grid-2">
      <div class="field"><label>اسم المعلم *</label><input name="name" value="${esc(t.name)}" required></div>
      <div class="field"><label>رقم الهاتف</label><input name="phone" dir="ltr" value="${esc(t.phone)}"></div>
      <div class="field"><label>مادة التخصص</label><select name="subjectId">${subOpts(t.subjectId)}</select></div>
      <div class="field"><label>النصاب الأسبوعي (حصص)</label><input name="maxLoad" type="number" min="0" max="60" value="${num(t.maxLoad)}"></div>
    </div>

    <div class="card" style="box-shadow:none;background:#fbfdfd">
      <div class="card-head" style="margin-bottom:.6rem"><h3>إسناد الشعب</h3><span>المجموع: <b id="tTotal">0</b> حصة</span></div>
      <div class="grid-2" style="grid-template-columns:1fr auto;align-items:end">
        <div class="field"><label>المادة</label><select id="aSub">${subOpts(t.subjectId)}</select></div>
        <div class="field"><button type="button" class="btn primary" id="aAdd">+ إسناد الشعب المحددة</button></div>
      </div>
      <div class="sec-pick" id="aSecs">
        ${S.grades.map(g => `<div class="gl">${esc(g.name)}</div>` + S.sections.filter(s => s.gradeId === g.id)
          .map(s => `<label class="check"><input type="checkbox" value="${s.id}"> ${esc(secLabel(s))}</label>`).join("")).join("") || "<span class='muted'>لا توجد شعب</span>"}
      </div>
      <div id="aList" style="margin-top:.6rem"></div>
    </div>

    <div class="modal-actions"><button class="btn primary lg">💾 حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
  </form>`);

  const f = $("tForm");
  f.subjectId.onchange = () => { if (!$("aSub").value) $("aSub").value = f.subjectId.value; };

  const drawAsg = () => {
    $("aList").innerHTML = asg.length ? asg.map((a, i) => {
      const s = subject(a.subjectId), sec = section(a.sectionId);
      const others = S.teachers.filter(x => x.id !== t.id && (x.assignments || []).some(y => y.sectionId === a.sectionId && y.subjectId === a.subjectId)).map(x => x.name);
      return `<div class="asg-row">
        <div><span class="dot" style="background:${s?.color || "#999"}"></span> ${esc(s?.name || "؟")}</div>
        <div><b>${esc(secLabel(sec))}</b></div>
        <input type="number" min="1" max="20" value="${num(a.periods)}" data-i="${i}" title="عدد الحصص أسبوعيًا">
        <button type="button" class="btn sm danger" data-rm="${i}">×</button>
        ${others.length ? `<div class="warn-t">⚠ ${esc(tf("هذه المادة في هذه الشعبة مُسندة أيضًا إلى: {0}", others.join("، ")))}</div>` : ""}
      </div>`;
    }).join("") : `<p class="muted" style="margin:.3rem 0 0">اختر المادة ثم حدّد الشعب واضغط «إسناد».</p>`;
    $("tTotal").textContent = asg.reduce((x, a) => x + num(a.periods), 0);
  };
  drawAsg();

  $("aAdd").onclick = () => {
    const subId = $("aSub").value;
    if (!subId) return toast("اختر المادة أولًا", "error");
    const picked = [...document.querySelectorAll("#aSecs input:checked")].map(i => i.value);
    if (!picked.length) return toast("حدّد شعبة واحدة على الأقل", "error");
    const sb = subject(subId);
    let added = 0;
    for (const secId of picked) {
      if (asg.some(a => a.sectionId === secId && a.subjectId === subId)) continue;
      asg.push({ subjectId: subId, sectionId: secId, periods: num(sb.periods?.[section(secId).gradeId]) || 1 });
      added++;
    }
    asg.sort((a, b) => S.sections.indexOf(section(a.sectionId)) - S.sections.indexOf(section(b.sectionId)));
    document.querySelectorAll("#aSecs input:checked").forEach(i => (i.checked = false));
    drawAsg();
    if (!added) toast("الشعب المحددة مُسندة مسبقًا");
  };
  $("aList").oninput = e => { const i = e.target.dataset.i; if (i !== undefined) { asg[i].periods = num(e.target.value); $("tTotal").textContent = asg.reduce((x, a) => x + num(a.periods), 0); } };
  $("aList").onclick = e => { const i = e.target.dataset.rm; if (i !== undefined) { asg.splice(i, 1); drawAsg(); } };

  f.onsubmit = async e => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return toast("اسم المعلم مطلوب", "error");
    const data = {
      name, phone: f.phone.value.trim(), subjectId: f.subjectId.value, maxLoad: num(f.maxLoad.value),
      assignments: asg.filter(a => num(a.periods) > 0).map(a => ({ subjectId: a.subjectId, sectionId: a.sectionId, periods: num(a.periods) })),
      updatedAt: serverTimestamp()
    };
    try {
      if (isNew) await addDoc(col("teachers"), { ...data, createdAt: serverTimestamp() });
      else await updateDoc(dref("teachers", t.id), data);
      closeModal(); toast("تم حفظ بيانات المعلم", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}

// =====================================================
//  توزيع الجدول (المرحلة الثانية)
// =====================================================
function vTimetable() {
  const over = S.teachers.filter(t => num(t.maxLoad) && load(t) > num(t.maxLoad)).length;
  const cap = capacity();
  const fullSecs = S.sections.filter(s => assignedFor(s.id).total > cap).length;
  return `
  <div class="page-title"><h1>توزيع الجدول</h1></div>
  <div class="card empty">
    <div class="big">🧩</div>
    <h2>قريبًا — المرحلة الثانية</h2>
    <p>${tf("هنا سيتم توزيع الحصص تلقائيًا على {0} أيام × {1} حصص بدون تعارض، مع إمكانية التعديل اليدوي.", settings().days.length, settings().periods.length)}</p>
  </div>
  <div class="card">
    <h3>جاهزية البيانات للتوزيع</h3>
    <div style="display:flex;flex-direction:column;gap:.4rem">
      <div>${S.teachers.length ? "✅" : "⬜"} ${S.teachers.length} معلم</div>
      <div>${S.sections.length ? "✅" : "⬜"} ${S.sections.length} شعبة</div>
      <div>${over ? "⚠️" : "✅"} معلمون تجاوزوا النصاب: ${over}</div>
      <div>${fullSecs ? "⚠️" : "✅"} ${tf("شعب حصصها أكثر من {0} حصة: {1}", cap, fullSecs)}</div>
    </div>
  </div>`;
}

// ---------- التحقق من الدخول ----------
const user = await waitUser();
const role = await getRole(user).catch(() => ({ role: "none" }));
if (role.role === "admin") location.replace("admin.html");
else if (role.role !== "school") location.replace("login.html");
else if (role.status !== "active") location.replace("login.html?s=" + role.status);
else init(user);
