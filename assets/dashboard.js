// لوحة تحكم المدرسة
import { db, applyBranding, waitUser, getRole, logout, esc, toast, confirmBox, errMsg, DAYS_ALL, defaultPeriods, t as tf, tr, fillIcons, isEn, sendReset, T_STATUS } from "./app.js";
import { setLang } from "./i18n.js";
import { schedule, reconcile } from "./scheduler.js";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

applyBranding();


// ---------- الحالة ----------
let SID, pubLast = "";
const loaded = new Set();
const NEED = 6; // school, grades, sections, subjects, teachers, timetable
const S = { school: null, grades: [], sections: [], subjects: [], teachers: [], accounts: [] };
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
  fillIcons();
  document.querySelectorAll("[data-logout]").forEach(b => (b.onclick = logout));
  const sheet = $("sheet");
  const closeSheet = () => sheet.classList.remove("show");
  document.querySelector("[data-more]").onclick = e => { e.preventDefault(); sheet.classList.add("show"); };
  sheet.onclick = e => { if (e.target === sheet || e.target.closest("a")) closeSheet(); };
  const lb = document.querySelector("[data-lang-label]");
  lb.textContent = isEn ? "العربية" : "English"; lb.setAttribute("data-no-i18n", "");
  document.querySelector("[data-lang-toggle-row]").onclick = () => setLang(isEn ? "ar" : "en");
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  $("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack" && !$("modalBack").dataset.lock) closeModal(); });

  const mark = k => { loaded.add(k); render(); };

  onSnapshot(doc(db, "schools", SID), d => {
    S.school = { id: d.id, ...d.data() };
    if (S.school.status !== "active") return location.replace("login.html?s=" + S.school.status);
    document.querySelectorAll("[data-school-name]").forEach(e => { e.textContent = S.school.name; e.setAttribute("data-no-i18n", ""); });
    const pubData = { name: S.school.name, region: S.school.region || "", wilayah: S.school.wilayah || "" };
    if (JSON.stringify(pubData) !== pubLast) { pubLast = JSON.stringify(pubData); setDoc(doc(db, "publicSchools", SID), pubData).catch(() => { pubLast = ""; }); }
    loaded.has("school") ? render() : mark("school");
  }, e => toast(errMsg(e), "error"));

  const sorters = {
    grades: (a, b) => num(a.code) - num(b.code) || a.name.localeCompare(b.name, "ar"),
    sections: (a, b) => (num(grade(a.gradeId)?.code) - num(grade(b.gradeId)?.code)) || num(a.num) - num(b.num),
    subjects: (a, b) => a.name.localeCompare(b.name, "ar"),
    teachers: (a, b) => a.name.localeCompare(b.name, "ar")
  };
  onSnapshot(query(collection(db, "teacherAccounts"), where("schoolId", "==", SID)), snap => {
    S.accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const n = S.accounts.filter(a => a.status === "pending").length;
    document.querySelectorAll("[data-acc-badge]").forEach(b => { b.textContent = n; b.classList.toggle("hidden", !n); });
    if (loaded.size >= NEED && ["#accounts", "#overview", ""].includes(location.hash)) render();
  }, () => {});
  onSnapshot(doc(db, "schools", SID, "timetable", "main"), d => {
    if (!TT.dirty && !TT.saving) { TT.saved = d.exists() ? (d.data().lessons || []) : []; TT.lessons = null; }
    loaded.has("timetable") ? (location.hash === "#timetable" ? null : render()) : mark("timetable");
  }, e => { toast(errMsg(e), "error"); mark("timetable"); });
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
const VIEWS = { overview: vOverview, settings: vSettings, grades: vGrades, subjects: vSubjects, teachers: vTeachers, timetable: vTimetable, accounts: vAccounts };
function render() {
  if (loaded.size < NEED) return;
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  document.querySelectorAll("#nav a, #bnav a, #sheet a").forEach(a => a.classList.toggle("active", a.dataset.v === v));
  document.querySelector("[data-more]").classList.toggle("active", v === "settings" || v === "grades" || v === "accounts");
  const view = $("view");
  view.onclick = null;
  document.body.classList.remove("has-sel");
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
  const pendingAcc = S.accounts.filter(a => a.status === "pending").length;

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
  ${pendingAcc ? `<a class="notice warn acc-alert" href="#accounts"><span data-ic="userCheck"></span> ${esc(tf("لديك {0} طلب انضمام من معلمين بانتظار موافقتك", pendingAcc))} ←</a>` : ""}
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
    <div class="g-periods">
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
  </div>
  <div class="card">
    <h3>استيراد وتصدير البيانات</h3>
    <p class="muted" style="margin-top:0">استورد الصفوف والشعب والمواد والمعلمين والجدول دفعة واحدة من ملف بيانات (JSON)، أو صدّر نسخة احتياطية من بيانات مدرستك.</p>
    <div class="field"><label>ملف البيانات</label><input type="file" id="impFile" accept=".json,application/json"></div>
    <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="impReplace" checked> حذف البيانات الحالية قبل الاستيراد</label>
    <div class="row-actions">
      <button class="btn primary" id="impBtn"><span data-ic="upload" data-size="18"></span>استيراد</button>
      <button class="btn" id="expBtn"><span data-ic="download" data-size="18"></span>تصدير نسخة احتياطية</button>
    </div>
  </div>`;
}
BIND.overview = v => fillIcons(v);
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
  fillIcons(v);
  $("impBtn").onclick = async () => {
    const f = $("impFile").files[0];
    if (!f) return toast("اختر ملف البيانات أولًا", "error");
    let data;
    try { data = JSON.parse(await f.text()); } catch { return toast("الملف غير صالح", "error"); }
    if (data.format !== "monasiq-import") return toast("الملف غير صالح", "error");
    const replace = $("impReplace").checked;
    const msg = tf("سيتم استيراد {0} معلم و{1} شعبة و{2} مادة و{3} حصة في الجدول.", data.teachers?.length || 0, data.sections?.length || 0, data.subjects?.length || 0, data.timetable?.length || 0)
      + (replace ? " " + tf("سيتم حذف البيانات الحالية أولًا.") : "");
    if (!(await confirmBox(msg, tr("استيراد"), replace))) return;
    await importData(data, replace);
  };
  $("expBtn").onclick = exportData;
  $("infoForm").onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    for (const k in d) d[k] = d[k].trim();
    if (!d.name) return toast("اسم المدرسة مطلوب", "error");
    try { await updateDoc(doc(db, "schools", SID), { ...d, updatedAt: serverTimestamp() }); toast("تم الحفظ", "success"); }
    catch (ex) { toast(errMsg(ex), "error"); }
  };
};

// ---------- الاستيراد والتصدير ----------
async function importData(data, replace) {
  openModal(`<div class="gen-box"><div class="spinner"></div><h3>${tr("جارٍ الاستيراد")}</h3><div class="progress"><i id="impBar"></i></div><p class="muted" id="impTxt"></p></div>`);
  $("modalBack").dataset.lock = "1";
  const step = (pct, txt) => { const b = $("impBar"); if (b) b.style.width = pct + "%"; const t = $("impTxt"); if (t) t.textContent = tr(txt); };
  // كتابة على دفعات (حد Firestore 500 عملية لكل دفعة)
  const ops = [];
  const flush = async (label, from, to) => {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      ops.slice(i, i + 400).forEach(fn => fn(b));
      await b.commit();
      step(from + (to - from) * Math.min(1, (i + 400) / ops.length), label);
    }
    ops.length = 0;
  };
  try {
    if (replace) {
      step(2, "حذف البيانات الحالية");
      const old = [...S.grades.map(x => ["grades", x.id]), ...S.sections.map(x => ["sections", x.id]), ...S.subjects.map(x => ["subjects", x.id]), ...S.teachers.map(x => ["teachers", x.id])];
      old.forEach(([c, id]) => ops.push(b => b.delete(dref(c, id))));
      ops.push(b => b.delete(doc(db, "schools", SID, "timetable", "main")));
      await flush("حذف البيانات الحالية", 2, 20);
    }
    if (data.settings?.days?.length && data.settings?.periods?.length) {
      await updateDoc(doc(db, "schools", SID), { settings: { days: data.settings.days, periods: data.settings.periods }, updatedAt: serverTimestamp() });
    }
    // معرّفات جديدة لكل عنصر قبل الكتابة
    const id = {};
    const mk = (c, key) => { id[c + ":" + key] = doc(col(c)).id; };
    (data.grades || []).forEach(x => mk("grades", x.key));
    (data.sections || []).forEach(x => mk("sections", x.key));
    (data.subjects || []).forEach(x => mk("subjects", x.key));
    (data.teachers || []).forEach(x => mk("teachers", x.key));
    const G = k => id["grades:" + k], C = k => id["sections:" + k], SB = k => id["subjects:" + k], T = k => id["teachers:" + k];
    for (const g of data.grades || []) ops.push(b => b.set(doc(db, "schools", SID, "grades", G(g.key)), { name: g.name, code: String(g.code), createdAt: serverTimestamp() }));
    for (const x of data.sections || []) ops.push(b => b.set(doc(db, "schools", SID, "sections", C(x.key)), { gradeId: G(x.grade), num: String(x.num) }));
    for (const x of data.subjects || []) {
      const periods = {}; for (const [gk, n] of Object.entries(x.periods || {})) if (G(gk)) periods[G(gk)] = num(n);
      ops.push(b => b.set(doc(db, "schools", SID, "subjects", SB(x.key)), { name: x.name, color: x.color || "#0f766e", periods, createdAt: serverTimestamp() }));
    }
    for (const x of data.teachers || []) {
      const assignments = (x.assignments || []).filter(a => SB(a.subject) && C(a.section)).map(a => ({ subjectId: SB(a.subject), sectionId: C(a.section), periods: num(a.periods) }));
      ops.push(b => b.set(doc(db, "schools", SID, "teachers", T(x.key)), { name: x.name, phone: x.phone || "", subjectId: SB(x.subject) || "", maxLoad: num(x.maxLoad), assignments, createdAt: serverTimestamp() }));
    }
    await flush("استيراد الصفوف والمواد والمعلمين", 20, 85);
    if (data.timetable?.length) {
      step(90, "استيراد الجدول");
      const lessons = data.timetable.filter(x => T(x.teacher) && SB(x.subject) && C(x.section))
        .map(x => ({ t: T(x.teacher), s: SB(x.subject), c: C(x.section), d: x.d ?? null, p: x.p ?? null, l: !!x.l }));
      TT.dirty = false; TT.saving = true;
      await setDoc(doc(db, "schools", SID, "timetable", "main"), { lessons, updatedAt: serverTimestamp() });
      TT.saving = false; TT.saved = lessons; TT.lessons = null;
    }
    step(100, "تم");
    delete $("modalBack").dataset.lock;
    closeModal();
    toast(tf("تم استيراد {0} معلم و{1} شعبة بنجاح ✅", data.teachers?.length || 0, data.sections?.length || 0), "success");
    location.hash = "#overview";
  } catch (e) {
    delete $("modalBack").dataset.lock;
    closeModal();
    toast(errMsg(e), "error");
  }
}
function exportData() {
  ttSync();
  const gk = id => "g_" + id, sk = id => "c_" + id, bk = id => "s_" + id, tk = id => "t_" + id;
  const data = {
    format: "monasiq-import", version: 1, source: S.school.name, exportedAt: new Date().toISOString(),
    settings: settings(),
    grades: S.grades.map(g => ({ key: gk(g.id), name: g.name, code: g.code })),
    sections: S.sections.map(x => ({ key: sk(x.id), grade: gk(x.gradeId), num: x.num })),
    subjects: S.subjects.map(x => ({ key: bk(x.id), name: x.name, color: x.color, periods: Object.fromEntries(Object.entries(x.periods || {}).map(([g, n]) => [gk(g), n])) })),
    teachers: S.teachers.map(t => ({ key: tk(t.id), name: t.name, phone: t.phone || "", subject: t.subjectId ? bk(t.subjectId) : "", maxLoad: num(t.maxLoad),
      assignments: (t.assignments || []).map(a => ({ subject: bk(a.subjectId), section: sk(a.sectionId), periods: num(a.periods) })) })),
    timetable: (TT.lessons || []).map(x => ({ teacher: tk(x.t), subject: bk(x.s), section: sk(x.c), d: x.d, p: x.p, l: !!x.l }))
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `monasiq-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// =====================================================
//  الصفوف والشعب
// =====================================================
function vGrades() {
  return `
  <div class="page-title"><h1>الصفوف والشعب</h1></div>
  <div class="card">
    <h3>إضافة صف</h3>
    <form id="gradeForm" class="g-grade">
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
    <div class="g-subj">
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
        return `<span class="chip" title="${esc(sb?.name || "")}"><span class="dot" style="background:${sb?.color || "#999"}"></span><bdi>${esc(secLabel(section(a.sectionId)))}</bdi><span class="pcount">${esc(tf("{0} حصص", num(a.periods)))}</span></span>`; }).join("") || "<span class='muted'>—</span>"}</td>
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
      <div class="g-asg">
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
//  توزيع الجدول
// =====================================================
const TT = { saved: null, lessons: null, dirty: false, saving: false, timer: null, savedOk: true };
const TV = { mode: "teacher", id: null, sel: null };
let ttOrient = null;

function ttDims() { return { D: settings().days.length, P: settings().periods.length }; }
function ttSync() {
  const { D, P } = ttDims();
  const base = TT.lessons ?? TT.saved ?? [];
  const before = TT.lessons ? TT.lessons.length : -1;
  TT.lessons = reconcile(S.teachers, base, D, P, new Set(S.sections.map(s => s.id)));
  if (TT.lessons.length !== before) TV.sel = null;
  if (TV.sel != null && !TT.lessons[TV.sel]) TV.sel = null;
}
function ttIndex() {
  const tS = new Map(), cS = new Map();
  TT.lessons.forEach((x, i) => { if (x.d != null) { tS.set(`${x.t}@${x.d}.${x.p}`, i); cS.set(`${x.c}@${x.d}.${x.p}`, i); } });
  return { tS, cS };
}
const DAY_EN = { "الأحد": "Sun", "الاثنين": "Mon", "الثلاثاء": "Tue", "الأربعاء": "Wed", "الخميس": "Thu", "الجمعة": "Fri", "السبت": "Sat" };
const shortDay = d => isEn ? (DAY_EN[d] || d) : String(d).replace(/^ال/, "");
const shortName = n => String(n || "").split(/\s+/).slice(0, 2).join(" ");
const teacherOf = id => S.teachers.find(t => t.id === id);

function ttMark() {
  TT.dirty = true; TT.savedOk = false;
  clearTimeout(TT.timer);
  TT.timer = setTimeout(ttSave, 1200);
}
async function ttSave() {
  if (!TT.dirty) return;
  TT.saving = true; ttStatus();
  try {
    await setDoc(doc(db, "schools", SID, "timetable", "main"), {
      lessons: TT.lessons.map(x => ({ t: x.t, s: x.s, c: x.c, d: x.d ?? null, p: x.p ?? null, l: !!x.l })),
      updatedAt: serverTimestamp()
    });
    TT.dirty = false; TT.savedOk = true;
  } catch (e) { toast(errMsg(e), "error"); }
  TT.saving = false; ttStatus();
}
function ttStatus() {
  const el = $("ttSave"); if (!el) return;
  el.className = "save-state " + (TT.saving || TT.dirty ? "busy" : "ok");
  el.textContent = tr(TT.saving || TT.dirty ? "جارٍ الحفظ" : "محفوظ");
}
window.addEventListener("beforeunload", e => { if (TT.dirty) { e.preventDefault(); e.returnValue = ""; } });

// هل يمكن نقل الحصة i إلى الخانة (d,p)؟
function canMove(i, d, p, idx) {
  const L = TT.lessons[i];
  if (L.d === d && L.p === p) return { ok: false, same: true };
  const a = idx.tS.get(`${L.t}@${d}.${p}`), b = idx.cS.get(`${L.c}@${d}.${p}`);
  if (a == null && b == null) return { ok: true };
  if (a != null && b != null && a !== b) {
    return { ok: false, reason: tf("المعلم والشعبة كلاهما مشغولان في هذا الوقت") };
  }
  const j = a ?? b, J = TT.lessons[j];
  if (J.l) return { ok: false, reason: tf("الخانة فيها حصة مثبتة") };
  if (L.d == null) {
    return { ok: false, reason: a != null ? tf("المعلم لديه حصة مع {0} في هذا الوقت", secLabel(section(J.c))) : tf("الشعبة {0} لديها حصة {1} في هذا الوقت", secLabel(section(J.c)), subject(J.s)?.name || "") };
  }
  // تبديل: هل تستطيع الحصة j الذهاب إلى مكان L؟
  const ta = idx.tS.get(`${J.t}@${L.d}.${L.p}`), cb = idx.cS.get(`${J.c}@${L.d}.${L.p}`);
  if ((ta == null || ta === i) && (cb == null || cb === i)) return { ok: true, swap: j };
  return {
    ok: false,
    reason: a != null ? tf("المعلم لديه حصة مع {0} في هذا الوقت", secLabel(section(J.c)))
      : tf("الشعبة {0} لديها حصة {1} في هذا الوقت", secLabel(section(J.c)), subject(J.s)?.name || "")
  };
}

function vTimetable() {
  ttSync();
  const { D, P } = ttDims();
  const st = settings();
  const all = TT.lessons, placed = all.filter(x => x.d != null).length, locked = all.filter(x => x.l).length;
  const cap = D * P;
  if (!all.length) return `
    <div class="page-title"><h1>توزيع الجدول</h1></div>
    <div class="card empty"><div class="big">🗓️</div><h3>لا توجد حصص لتوزيعها</h3>
    <p>أضف المعلمين وأسند لهم الشعب أولًا، ثم ارجع هنا للتوزيع.</p><a class="btn primary" href="#teachers">المعلمون</a></div>`;

  const tLoads = new Map(), cLoads = new Map();
  for (const x of all) { tLoads.set(x.t, (tLoads.get(x.t) || 0) + 1); cLoads.set(x.c, (cLoads.get(x.c) || 0) + 1); }
  const overT = [...tLoads].filter(([, n]) => n > cap), overC = [...cLoads].filter(([, n]) => n > cap);

  const ents = TV.mode === "teacher"
    ? S.teachers.filter(t => tLoads.has(t.id)).map(t => ({ id: t.id, name: t.name }))
    : S.sections.filter(s => cLoads.has(s.id)).map(s => ({ id: s.id, name: secLabel(s) }));
  if (!ents.some(e => e.id === TV.id)) TV.id = ents[0]?.id || null;
  const unByEnt = new Map();
  for (const x of all) if (x.d == null) { const k = TV.mode === "teacher" ? x.t : x.c; unByEnt.set(k, (unByEnt.get(k) || 0) + 1); }
  const pos = ents.findIndex(e => e.id === TV.id);

  return `
  <div class="page-title"><h1>توزيع الجدول</h1>
    <div class="row-actions">
      <span id="ttSave" class="save-state ok">محفوظ</span>
      <button class="btn" id="ttPrint"><span data-ic="print" data-size="18"></span>طباعة</button>
      <button class="btn primary" id="ttGen"><span data-ic="magic" data-size="18"></span>توزيع تلقائي</button>
    </div>
  </div>

  <div class="tt-stats">
    <div><b>${all.length}</b><span>إجمالي الحصص</span></div>
    <div><b class="okc">${placed}</b><span>موزّعة</span></div>
    <div><b class="${all.length - placed ? "badc" : ""}">${all.length - placed}</b><span>لم توزّع بعد</span></div>
    <div><b>${locked}</b><span>مثبتة</span></div>
  </div>
  ${overT.length || overC.length ? `<div class="notice bad">${overT.map(([id, n]) => esc(tf("المعلم {0} لديه {1} حصة والأسبوع فيه {2} حصة فقط", teacherOf(id)?.name, n, cap))).join("<br>")}${overT.length && overC.length ? "<br>" : ""}${overC.map(([id, n]) => esc(tf("الشعبة {0} لديها {1} حصة والأسبوع فيه {2} حصة فقط", secLabel(section(id)), n, cap))).join("<br>")}</div>` : ""}

  <div class="card tt-card">
    <div class="tt-bar">
      <div class="seg" id="ttMode">
        <button data-m="teacher" class="${TV.mode === "teacher" ? "active" : ""}">المعلمون</button>
        <button data-m="section" class="${TV.mode === "section" ? "active" : ""}">الشعب</button>
      </div>
      <div class="tt-pick">
        <button class="icon-btn" id="ttPrev" ${pos <= 0 ? "disabled" : ""}><span data-ic="${isEn ? "chevL" : "chevR"}" data-size="18"></span></button>
        <select id="ttSel">${ents.map(e => `<option value="${e.id}" ${e.id === TV.id ? "selected" : ""}>${esc(e.name)}${unByEnt.get(e.id) ? ` (${unByEnt.get(e.id)} ${tr("غير موزّعة")})` : ""}</option>`).join("")}</select>
        <button class="icon-btn" id="ttNext" ${pos >= ents.length - 1 ? "disabled" : ""}><span data-ic="${isEn ? "chevR" : "chevL"}" data-size="18"></span></button>
      </div>
    </div>
    <div id="ttGrid"></div>
    <div id="ttTray"></div>
    <p class="muted tt-hint">اضغط على أي حصة ثم اضغط على خانة أخرى لنقلها أو تبديلها. الحصص التي تنقلها يدويًا تُثبّت تلقائيًا ولا يغيّرها التوزيع التلقائي.</p>
  </div>
  <div class="sel-bar hidden" id="selBar"></div>`;
}

function ttGridHTML(mode, id, opts = {}) {
  const { D, P } = ttDims();
  const st = settings();
  const idx = opts.idx || ttIndex();
  const sel = opts.interactive ? TV.sel : null;
  const transpose = !!opts.transpose;
  const cell = (d, p) => {
    const i = (mode === "teacher" ? idx.tS : idx.cS).get(`${id}@${d}.${p}`);
    let cls = "tt-cell", inner = "", data = `data-d="${d}" data-p="${p}"`;
    if (i != null) {
      const x = TT.lessons[i], sb = subject(x.s);
      const main = mode === "teacher" ? secLabel(section(x.c)) : (sb?.name || "؟");
      const sub = mode === "teacher" ? (sb?.name || "") : shortName(teacherOf(x.t)?.name);
      cls += " has";
      if (i === sel) cls += " sel";
      if (x.l) cls += " locked";
      inner = `<div class="lsn" style="--c:${sb?.color || "#64748b"}"><b>${esc(main)}</b><small>${esc(sub)}</small>${x.l ? `<i class="lk" data-ic="lock" data-size="12"></i>` : ""}</div>`;
      data += ` data-i="${i}"`;
    }
    if (sel != null && i !== sel) {
      const r = canMove(sel, d, p, idx);
      cls += r.ok ? " can" : " cant";
    }
    return `<td class="${cls}" ${data}>${inner}</td>`;
  };
  const pHead = p => `<th class="ph"><b>${p + 1}</b><small>${esc(st.periods[p]?.start || "")}</small></th>`;
  if (!transpose) {
    return `<table class="tt"><thead><tr><th></th>${Array.from({ length: P }, (_, p) => pHead(p)).join("")}</tr></thead><tbody>
      ${st.days.map((dn, d) => `<tr><th class="dh">${esc(dn)}</th>${Array.from({ length: P }, (_, p) => cell(d, p)).join("")}</tr>`).join("")}
    </tbody></table>`;
  }
  return `<table class="tt tr"><thead><tr><th></th>${st.days.map(dn => `<th class="dh" data-no-i18n>${esc(shortDay(dn))}</th>`).join("")}</tr></thead><tbody>
    ${Array.from({ length: P }, (_, p) => `<tr>${pHead(p)}${st.days.map((_, d) => cell(d, p)).join("")}</tr>`).join("")}
  </tbody></table>`;
}

function ttDraw() {
  const grid = $("ttGrid"); if (!grid || !TV.id) return;
  const idx = ttIndex();
  ttOrient = innerWidth < 700;
  grid.innerHTML = `<div class="tt-wrap">${ttGridHTML(TV.mode, TV.id, { interactive: true, transpose: ttOrient, idx })}</div>`;
  // الحصص غير الموزعة
  const un = TT.lessons.map((x, i) => [x, i]).filter(([x]) => x.d == null && (TV.mode === "teacher" ? x.t : x.c) === TV.id);
  $("ttTray").innerHTML = un.length ? `<div class="tray"><b>حصص غير موزّعة:</b> ${un.map(([x, i]) => {
    const sb = subject(x.s);
    const label = TV.mode === "teacher" ? secLabel(section(x.c)) : (sb?.name || "");
    return `<button class="tray-chip ${TV.sel === i ? "sel" : ""}" data-i="${i}" style="--c:${sb?.color || "#64748b"}">${esc(label)} <small>${esc(TV.mode === "teacher" ? sb?.name || "" : shortName(teacherOf(x.t)?.name))}</small></button>`;
  }).join("")}</div>` : "";
  // شريط الحصة المحددة
  const bar = $("selBar");
  document.body.classList.toggle("has-sel", TV.sel != null);
  if (TV.sel != null) {
    const x = TT.lessons[TV.sel], sb = subject(x.s);
    bar.classList.remove("hidden");
    bar.innerHTML = `<div class="sb-info"><span class="dot" style="background:${sb?.color}"></span><b>${esc(sb?.name || "")}</b> · ${esc(secLabel(section(x.c)))} · ${esc(shortName(teacherOf(x.t)?.name))}<div class="muted sb-hint">اختر خانة خضراء لنقل الحصة</div></div>
      <div class="row-actions">
        ${x.d != null ? `<button class="btn sm" data-sa="lock">${x.l ? "إلغاء التثبيت" : "تثبيت"}</button><button class="btn sm" data-sa="remove">إزالة من الجدول</button>` : ""}
        <button class="btn sm ghost" data-sa="cancel">إلغاء</button>
      </div>`;
  } else { bar.classList.add("hidden"); bar.innerHTML = ""; }
  fillIcons(document.getElementById("view"));
  ttStatus();
}

BIND.timetable = v => {
  if (!TT.lessons?.length) return;
  fillIcons(v);
  ttDraw();
  $("ttMode").onclick = e => { const b = e.target.closest("button"); if (!b) return; TV.mode = b.dataset.m; TV.id = null; TV.sel = null; render(); };
  $("ttSel").onchange = e => { TV.id = e.target.value; TV.sel = null; render(); };
  const step = k => { const o = [...$("ttSel").options]; const i = o.findIndex(x => x.selected) + k; if (o[i]) { TV.id = o[i].value; TV.sel = null; render(); } };
  $("ttPrev").onclick = () => step(-1);
  $("ttNext").onclick = () => step(1);
  $("ttGen").onclick = ttGenerate;
  $("ttPrint").onclick = ttPrintMenu;

  v.onclick = async e => {
    const chip = e.target.closest(".tray-chip");
    if (chip) { const i = +chip.dataset.i; TV.sel = TV.sel === i ? null : i; return ttDraw(); }
    const sa = e.target.closest("[data-sa]");
    if (sa && TV.sel != null) {
      const x = TT.lessons[TV.sel];
      if (sa.dataset.sa === "lock") { x.l = !x.l; ttMark(); }
      if (sa.dataset.sa === "remove") { x.d = x.p = null; x.l = false; ttMark(); }
      TV.sel = null; return render();
    }
    const td = e.target.closest("td.tt-cell"); if (!td) return;
    const d = +td.dataset.d, p = +td.dataset.p, i = td.dataset.i != null ? +td.dataset.i : null;
    if (TV.sel == null) { if (i != null) { TV.sel = i; ttDraw(); } return; }
    if (i === TV.sel) { TV.sel = null; return ttDraw(); }
    const r = canMove(TV.sel, d, p, ttIndex());
    if (!r.ok) {
      if (i != null) { TV.sel = i; return ttDraw(); }
      if (r.reason) toast(r.reason, "error");
      return;
    }
    const L = TT.lessons[TV.sel];
    if (r.swap != null) { const J = TT.lessons[r.swap]; J.d = L.d; J.p = L.p; }
    L.d = d; L.p = p; L.l = true;
    TV.sel = null; ttMark(); render();
  };
};

window.addEventListener("resize", () => {
  if (location.hash === "#timetable" && ttOrient !== null && (innerWidth < 700) !== ttOrient) ttDraw();
});

async function ttGenerate() {
  const placed = TT.lessons.filter(x => x.d != null && !x.l).length;
  if (placed && !(await confirmBox(tf("سيتم إعادة توزيع كل الحصص غير المثبتة. هل تريد المتابعة؟"), "توزيع", false))) return;
  const { D, P } = ttDims();
  openModal(`<div class="gen-box"><div class="spinner"></div><h3>جارٍ توزيع الحصص</h3><div class="progress"><i id="genBar"></i></div><p class="muted" id="genTxt"></p></div>`);
  $("modalBack").dataset.lock = "1";
  const input = TT.lessons.map(x => x.l ? x : { ...x, d: null, p: null });
  const r = await schedule({
    D, P, lessons: input, timeBudget: 5000, maxTries: 120,
    onProgress: pr => {
      const b = $("genBar"); if (b) b.style.width = Math.min(100, Math.max(pr.tries / pr.maxTries, pr.elapsed / 5000) * 100) + "%";
      const tx = $("genTxt"); if (tx) tx.textContent = tf("محاولة {0} — غير موزّعة: {1}", pr.tries, pr.unplaced);
    }
  });
  delete $("modalBack").dataset.lock;
  TT.lessons = r.lessons;
  TV.sel = null;
  ttMark();
  closeModal();
  render();
  if (r.unplaced) toast(tf("تم التوزيع، وبقيت {0} حصة بدون مكان. راجعها في قائمة غير الموزّعة.", r.unplaced), "error");
  else toast(tf("تم توزيع {0} حصة بدون تعارض ✅", r.lessons.length), "success");
}

// ---------- الطباعة ----------
function ttPrintMenu() {
  openModal(`${modalHead(tr("طباعة"))}
    <div class="print-opts">
      <button class="btn block" data-pr="one">طباعة الجدول المعروض</button>
      <button class="btn block" data-pr="teachers">طباعة جداول كل المعلمين</button>
      <button class="btn block" data-pr="sections">طباعة جداول كل الشعب</button>
    </div>
    <p class="muted" style="margin-bottom:0">للحفظ كملف PDF اختر «حفظ بتنسيق PDF» من نافذة الطباعة.</p>`);
  $("modal").onclick = e => {
    const b = e.target.closest("[data-pr]"); if (!b) return;
    closeModal(); $("modal").onclick = null;
    ttPrint(b.dataset.pr);
  };
}
function ttPrint(kind) {
  const idx = ttIndex();
  const blocks = [];
  const add = (mode, id, title) => blocks.push(`<div class="pblock"><div class="ph-head"><b>${esc(title)}</b><span>${esc(S.school.name)}</span></div>${ttGridHTML(mode, id, { idx })}</div>`);
  const tLoad = new Set(TT.lessons.map(x => x.t)), cLoad = new Set(TT.lessons.map(x => x.c));
  if (kind === "one") add(TV.mode, TV.id, TV.mode === "teacher" ? teacherOf(TV.id)?.name : tf("الشعبة {0}", secLabel(section(TV.id))));
  if (kind === "teachers") S.teachers.filter(t => tLoad.has(t.id)).forEach(t => add("teacher", t.id, t.name));
  if (kind === "sections") S.sections.filter(s => cLoad.has(s.id)).forEach(s => add("section", s.id, tf("الشعبة {0}", secLabel(s))));
  const per = kind === "one" ? 1 : 4;
  let html = "";
  for (let i = 0; i < blocks.length; i += per) html += `<div class="ppage ${per === 4 ? "four" : ""}">${blocks.slice(i, i + per).join("")}</div>`;
  let pa = $("printArea");
  if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  pa.innerHTML = html;
  setTimeout(() => window.print(), 300);
}

// =====================================================
//  حسابات المعلمين
// =====================================================
let accFilter = "pending";
const normName = s => String(s || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\bال/g, "").replace(/\s+/g, " ").trim();
function bestTeacherMatch(name) {
  const a = normName(name).split(" ").filter(Boolean);
  let best = null, bs = 0;
  for (const t of S.teachers) {
    const b = normName(t.name).split(" ").filter(Boolean);
    let sc = 0;
    a.forEach((w, i) => { if (b.includes(w)) sc += i === 0 ? 3 : 1; });
    if (normName(t.name) === normName(name)) sc += 10;
    if (sc > bs) { bs = sc; best = t; }
  }
  return bs >= 3 ? best : null;
}
const linkedTo = id => S.accounts.find(a => a.teacherId === id && a.status !== "pending");
function teacherOptions(sel, selfId) {
  return `<option value="">${tr("— بدون ربط —")}</option>` + S.teachers.map(t => {
    const other = linkedTo(t.id);
    const taken = other && other.id !== selfId;
    return `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}${taken ? " ⚠" : ""}</option>`;
  }).join("");
}

function vAccounts() {
  const c = st => S.accounts.filter(a => a.status === st).length;
  const rows = S.accounts.filter(a => a.status === accFilter)
    .sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0));
  return `
  <div class="page-title"><h1>حسابات المعلمين</h1></div>
  <div class="notice info-n">يسجّل المعلم من صفحة «التسجيل» ويختار مدرستك، ثم يظهر طلبه هنا. بعد الموافقة يربط بجدوله في المدرسة ويستطيع الدخول ومشاهدة جدوله.</div>
  <div class="tabs" id="accTabs">
    <button data-f="pending" class="${accFilter === "pending" ? "active" : ""}">${tr("طلبات الانضمام")} (${c("pending")})</button>
    <button data-f="active" class="${accFilter === "active" ? "active" : ""}">${tr("المفعّلون")} (${c("active")})</button>
    <button data-f="suspended" class="${accFilter === "suspended" ? "active" : ""}">${tr("الموقوفون")} (${c("suspended")})</button>
  </div>
  <div id="accList">
  ${rows.length ? rows.map(a => {
    const st = T_STATUS[a.status] || { label: a.status, cls: "info" };
    const linked = S.teachers.find(t => t.id === a.teacherId);
    const sug = a.status === "pending" ? (linked || bestTeacherMatch(a.name)) : linked;
    const date = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString(isEn ? "en-GB" : "ar-OM") : "";
    return `<div class="card acc-card" data-id="${a.id}">
      <div class="acc-head">
        <div class="acc-av">${esc(String(a.name || "?").trim().charAt(0))}</div>
        <div class="acc-main">
          <b>${esc(a.name)}</b> <span class="badge ${st.cls}">${st.label}</span>
          <div class="meta"><span dir="ltr">${esc(a.email || "")}</span>${a.phone ? ` · <span dir="ltr">${esc(a.phone)}</span>` : ""}${date ? ` · ${date}` : ""}</div>
        </div>
      </div>
      ${a.status === "pending" ? `
        <div class="acc-link"><label>ربط الحساب بالمعلم في جدول المدرسة</label>
          <select data-link>${teacherOptions(sug?.id, a.id)}</select>
          ${sug && !linked ? `<small class="muted">${esc(tf("اقتراح تلقائي حسب الاسم: {0}", sug.name))}</small>` : ""}
        </div>
        <div class="row-actions"><button class="btn sm success" data-a="approve">✔ موافقة</button><button class="btn sm danger" data-a="reject">رفض</button></div>`
      : `
        <div class="acc-linked">${linked ? `<span data-ic="timetable" data-size="16"></span> ${esc(tf("مرتبط بجدول: {0}", linked.name))}` : `<span class="badge warn">غير مرتبط بجدول</span>`}</div>
        <div class="row-actions">
          ${a.status === "active" ? `<button class="btn sm warn" data-a="suspend">إيقاف</button>` : `<button class="btn sm success" data-a="activate">تفعيل</button>`}
          <button class="btn sm" data-a="edit">تعديل</button>
          <button class="btn sm" data-a="reset">إعادة تعيين كلمة المرور</button>
          <button class="btn sm danger" data-a="delete">حذف</button>
        </div>`}
    </div>`;
  }).join("") : `<div class="card empty"><div class="big">👩‍🏫</div>${tr({ pending: "لا توجد طلبات انضمام جديدة", active: "لا يوجد معلمون مفعّلون", suspended: "لا يوجد معلمون موقوفون" }[accFilter])}</div>`}
  </div>`;
}
BIND.accounts = v => {
  fillIcons(v);
  $("accTabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; accFilter = b.dataset.f; render(); };
  $("accList").onclick = async e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const card = b.closest("[data-id]"), a = S.accounts.find(x => x.id === card.dataset.id);
    const ref = doc(db, "teacherAccounts", a.id);
    try {
      switch (b.dataset.a) {
        case "approve": {
          const tid = card.querySelector("[data-link]").value;
          const other = tid && linkedTo(tid);
          if (other && other.id !== a.id && !(await confirmBox(tf("هذا المعلم مرتبط بحساب آخر ({0}). المتابعة ستربط الحسابين بنفس الجدول.", other.email), "متابعة", false))) return;
          await updateDoc(ref, { status: "active", teacherId: tid || null, approvedAt: serverTimestamp() });
          toast(tf("تمت الموافقة على {0} ✅", a.name), "success");
          break;
        }
        case "reject":
          if (!(await confirmBox(tf("رفض طلب {0}؟", a.name), "رفض"))) return;
          await deleteDoc(ref); toast("تم رفض الطلب", "success"); break;
        case "suspend":
          if (!(await confirmBox(tf("إيقاف حساب {0}؟ لن يتمكن من الدخول حتى تعيد تفعيله.", a.name), "إيقاف"))) return;
          await updateDoc(ref, { status: "suspended" }); toast("تم إيقاف الحساب", "success"); break;
        case "activate":
          await updateDoc(ref, { status: "active" }); toast("تم تفعيل الحساب", "success"); break;
        case "reset":
          if (!(await confirmBox(tf("إرسال رابط إعادة تعيين كلمة المرور إلى {0}؟", a.email), "إرسال", false))) return;
          await sendReset(a.email);
          toast(tf("تم إرسال رابط إعادة التعيين إلى {0}", a.email), "success"); break;
        case "delete":
          if (!(await confirmBox(tf("حذف حساب {0} من المدرسة؟ لن يتمكن من الدخول لمدرستك.", a.name), "حذف"))) return;
          await deleteDoc(ref); toast("تم حذف الحساب", "success"); break;
        case "edit": accountModal(a); break;
      }
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
};
function accountModal(a) {
  openModal(`${modalHead(tr("تعديل حساب المعلم"))}
  <form id="accForm">
    <div class="grid-2">
      <div class="field"><label>الاسم الكامل</label><input name="name" value="${esc(a.name)}" required></div>
      <div class="field"><label>رقم الهاتف</label><input name="phone" dir="ltr" value="${esc(a.phone || "")}"></div>
    </div>
    <div class="field"><label>البريد الإلكتروني</label><input value="${esc(a.email || "")}" dir="ltr" disabled></div>
    <div class="field"><label>ربط الحساب بالمعلم في جدول المدرسة</label><select name="teacherId">${teacherOptions(a.teacherId, a.id)}</select></div>
    <div class="modal-actions"><button class="btn primary">حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
  </form>`);
  $("accForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) return;
    try {
      await updateDoc(doc(db, "teacherAccounts", a.id), { name: f.name.value.trim(), phone: f.phone.value.trim(), teacherId: f.teacherId.value || null, updatedAt: serverTimestamp() });
      closeModal(); toast("تم الحفظ", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}

// ---------- التحقق من الدخول ----------
const user = await waitUser();
const role = await getRole(user).catch(() => ({ role: "none" }));
if (role.role === "admin") location.replace("admin.html");
else if (role.role !== "school") location.replace("login.html");
else if (role.status !== "active") location.replace("login.html?s=" + role.status);
else init(user);
