// لوحة المعلم: جدولي، حصص اليوم، حسابي
import { db, applyBranding, waitUser, getRole, logout, esc, toast, errMsg, DAYS_ALL, t as tf, tr, fillIcons, isEn, sendReset } from "./app.js?v=202611151440";
import { buildSheet, downloadSheetsPDF } from "./print.js?v=202611151440";
import { buildRules } from "./rules.js?v=202611151440";
import { collection, doc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { pushState, pushCardHTML, bindPushCard, refreshPush } from "./push.js?v=202611151440";

applyBranding();
const $ = id => document.getElementById(id);
const S = { acc: null, school: null, tt: [], subjects: [], sections: [], grades: [], departments: [], teacher: null, notes: [], subs: {} };
const ymd = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const loaded = new Set();
const NEED = ["acc", "school", "tt", "subjects", "sections", "grades", "departments", "teacher"];
const DAY_EN = { "الأحد": "Sun", "الاثنين": "Mon", "الثلاثاء": "Tue", "الأربعاء": "Wed", "الخميس": "Thu", "الجمعة": "Fri", "السبت": "Sat" };
const shortDay = d => isEn ? (DAY_EN[d] || d) : String(d).replace(/^ال/, "");

const user = await waitUser();
const role = await getRole(user).catch(() => ({ role: "none" }));
if (role.role === "admin") location.replace("admin.html");
else if (role.role === "school") location.replace("dashboard.html");
else if (role.role !== "teacher") location.replace("login.html");
else if (role.status !== "active") location.replace("login.html?s=t_" + role.status);
else init();

let teacherSub = null;
function init() {
  $("loading").classList.add("hidden");
  $("appRoot").classList.remove("hidden");
  fillIcons();
  $("logoutBtn").onclick = logout;
  const sid = role.account.schoolId;
  const mark = k => { loaded.add(k); render(); };
  const err = e => { toast(errMsg(e), "error"); };

  onSnapshot(doc(db, "teacherAccounts", user.uid), d => {
    if (!d.exists()) return location.replace("login.html");
    S.acc = { id: d.id, ...d.data() };
    if (S.acc.status !== "active") return location.replace("login.html?s=t_" + S.acc.status);
    if (S.acc.teacherId && S.acc.teacherId !== teacherSub) {
      teacherSub = S.acc.teacherId;
      onSnapshot(doc(db, "schools", sid, "teachers", teacherSub), t => { S.teacher = t.exists() ? { id: t.id, ...t.data() } : null; mark("teacher"); }, () => mark("teacher"));
    } else if (!S.acc.teacherId) mark("teacher");
    mark("acc");
  }, err);
  onSnapshot(doc(db, "schools", sid), d => {
    S.school = d.data() || {};
    $("schoolName").textContent = S.school.name || "";
    mark("school");
  }, err);
  onSnapshot(doc(db, "schools", sid, "timetable", "main"), d => { S.tt = d.exists() ? d.data().lessons || [] : []; mark("tt"); }, err);
  for (const k of ["subjects", "sections", "grades", "departments"]) {
    onSnapshot(collection(db, "schools", sid, k), snap => { S[k] = snap.docs.map(x => ({ id: x.id, ...x.data() })); mark(k); }, err);
  }
  window.addEventListener("resize", () => { if (loaded.size >= NEED.length) drawGrid(); });
  // الاحتياط: اليوم وغدًا
  const t0 = new Date(), t1 = new Date(); t1.setDate(t1.getDate() + 1);
  for (const dt of [ymd(t0), ymd(t1)]) onSnapshot(doc(db, "schools", sid, "subs", dt), d => { S.subs[dt] = d.exists() ? (d.data().items || []) : []; render(); }, () => {});
  // إشعارات تحديث الجدول
  onSnapshot(collection(db, "teacherAccounts", user.uid, "notifications"), snap => {
    S.notes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
    updateBell(); render();
  }, () => {});
  $("bellBtn").onclick = () => openBell();
  $("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack" || e.target.closest("[data-close]")) closeModal(); });
  refreshPush({ uid: user.uid, role: "teacher", schoolId: sid });
}
const pushCtx = () => ({ uid: user.uid, role: "teacher", schoolId: role.account.schoolId });
function openModal(html) { $("modal").innerHTML = html; $("modalBack").classList.add("show"); }
function closeModal() { $("modalBack").classList.remove("show"); $("modal").innerHTML = ""; }
const unreadTT = () => S.notes.filter(n => !n.read && n.kind === "tt");
function updateBell() {
  const n = S.notes.filter(x => !x.read).length;
  $("bellN").textContent = n; $("bellN").classList.toggle("hidden", !n);
}
function markRead(list = S.notes.filter(x => !x.read)) {
  if (!list.length) return;
  const b = writeBatch(db);
  list.forEach(x => b.update(doc(db, "teacherAccounts", user.uid, "notifications", x.id), { read: true }));
  b.commit().catch(() => {});
}
const when = ms => new Date(ms).toLocaleString(isEn ? "en-GB" : "ar-OM", { dateStyle: "medium", timeStyle: "short" });
function changesHTML(n) {
  return `${(n.added || []).map(x => `<small class="add">＋ ${esc(x.text)}</small>`).join("")}${(n.removed || []).map(x => `<small class="rem">− ${esc(x.text)}</small>`).join("")}`;
}
async function drawPush(box) {
  if (!box) return;
  box.innerHTML = pushCardHTML(await pushState(user.uid), esc);
  bindPushCard(box, pushCtx(), () => drawPush(box), toast);
}
function openBell(showOld = false) {
  const fresh = S.notes.filter(x => !x.read), old = S.notes.filter(x => x.read);
  const items = [...fresh, ...(showOld ? old.slice(0, 30) : [])];
  openModal(`<div class="modal-head"><h3>${esc(tr("الإشعارات"))}</h3><button class="x" data-close>×</button></div>
    <div class="noti-list">${items.length ? items.map(n => `<div class="noti ${n.read ? "" : "new"}">
      <b>${esc(n.title || "")}</b><span>${esc(n.body || "")}</span>${changesHTML(n)}<small>${esc(when(n.at))}</small></div>`).join("")
      : `<div class="empty">${esc(tr("لا توجد إشعارات جديدة"))}</div>`}</div>
    ${!showOld && old.length ? `<button class="btn ghost block noti-old" id="notiOld">${esc(tf("الإشعارات السابقة ({0})", old.length))}</button>` : ""}
    <div id="pushBox2" style="margin-top:1rem"></div>`);
  fillIcons($("modal"));
  drawPush($("pushBox2"));
  if ($("notiOld")) $("notiOld").onclick = () => openBell(true);
  // الإشعارات العادية تُعلَّم مقروءة؛ إشعار تحديث الجدول يبقى حتى يضغط المعلم «حسنًا» في صفحته
  markRead(fresh.filter(n => n.kind !== "tt"));
}

const subject = id => S.subjects.find(s => s.id === id);
const section = id => S.sections.find(s => s.id === id);
const grade = id => S.grades.find(g => g.id === id);
const secLabel = s => { if (!s) return "؟"; const g = grade(s.gradeId); return `${s.num}/${g ? g.code : "?"}`; };
const settings = () => S.school?.settings || { days: DAYS_ALL.slice(0, 5), periods: [] };
// اجتماعات القسم والحصص الفارغة للجميع
function blockedMap() {
  const st = settings(), P = st.periods.length, m = new Map();
  const r = buildRules({ settings: st, departments: S.departments, teachers: S.teacher ? [S.teacher] : [] });
  r.globalBlocked.forEach(sl => m.set(sl, tr("فارغة للجميع")));
  if (S.teacher) r.teachers[S.teacher.id]?.meetings.forEach((n, sl) => { if (!m.has(sl)) m.set(sl, tf("اجتماع {0}", n)); });
  if (S.teacher) r.teachers[S.teacher.id]?.unavail.forEach(sl => { if (!m.has(sl)) m.set(sl, tr("تفريغ")); });
  return m;
}
const mine = () => S.acc?.teacherId ? S.tt.filter(x => x.t === S.acc.teacherId && x.d != null) : [];

function render() {
  if (loaded.size < NEED.length) return;
  const st = settings(), my = mine();
  const linked = !!S.acc.teacherId;
  // اليوم الحالي ضمن أيام الدوام؟
  const todayName = DAYS_ALL[new Date().getDay()];
  const dIdx = st.days.indexOf(todayName);
  const mySubs = dt => (S.subs[dt] || []).filter(x => x.t && x.t === S.acc.teacherId && x.sent === x.t);
  const todaySubs = mySubs(ymd(new Date())).map(x => ({ ...x, sub: true }));
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const tomorrowSubs = mySubs(ymd(tm));
  const today = dIdx >= 0 ? [...my.filter(x => x.d === dIdx), ...todaySubs].sort((a, b) => a.p - b.p) : [];
  const perDay = st.days.map((_, d) => my.filter(x => x.d === d).length);
  const secs = new Set(my.map(x => x.c));

  $("view").innerHTML = `
  <h1 class="tp-hello">${esc(tf("أهلًا، {0}", S.acc.name))} 👋</h1>
  ${unreadTT().length ? `<div class="tt-upd">
    <div class="tt-upd-h"><b>📅 ${esc(tr("تم تحديث جدولك"))}</b><button class="btn sm" id="updOk">${esc(tr("حسنًا"))}</button></div>
    <div class="tt-upd-l">${unreadTT().map(changesHTML).join("")}</div>
    <small class="muted">${esc(tr("الحصص الجديدة مظللة في الجدول."))}</small>
  </div>` : ""}
  ${!linked ? `<div class="notice warn">لم تربطك إدارة المدرسة بجدولك بعد. سيظهر جدولك هنا بعد الربط.</div>` : ""}
  ${linked && !my.length ? `<div class="notice warn">لم يتم توزيع جدولك بعد. تابع لاحقًا.</div>` : ""}

  ${linked && my.length ? `
  <div class="tt-stats">
    <div><b>${my.length}</b><span>حصة أسبوعيًا</span></div>
    <div><b>${secs.size}</b><span>شعبة</span></div>
    <div><b>${today.length}</b><span>حصص اليوم</span></div>
    <div><b>${Math.max(...perDay)}</b><span>أكثر يوم</span></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>${esc(tr("حصص اليوم"))} <span class="muted" data-no-i18n style="font-weight:500">— ${esc(isEn ? (DAY_EN[todayName] || todayName) : todayName)}</span></h3></div>
    ${dIdx < 0 ? `<div class="empty">ليس يوم دوام</div>` : today.length ? `<div class="today-list">${today.map(x => {
      const sb = subject(x.s), pr = st.periods[x.p] || {};
      return `<div class="today-item ${x.sub ? "is-sub" : ""}" style="--c:${sb?.color || "#64748b"}">
        <div class="ti-p"><b>${x.p + 1}</b><small>${esc(pr.start || "")}</small></div>
        <div class="ti-b"><b>${esc(secLabel(section(x.c)))} ${x.sub ? `<span class="badge warn">${esc(tr("احتياط"))}</span>` : ""}</b><span>${esc(sb?.name || "")}</span></div>
        <div class="ti-t">${esc(pr.start || "")} – ${esc(pr.end || "")}</div>
      </div>`;
    }).join("")}</div>` : `<div class="empty">لا توجد لديك حصص اليوم 🎉</div>`}
  </div>
  ${tomorrowSubs.length ? `<div class="card"><h3>${esc(tr("احتياط غدًا"))}</h3><div class="today-list">${tomorrowSubs.sort((a, b) => a.p - b.p).map(x => {
    const sb = subject(x.s), pr = settings().periods[x.p] || {};
    return `<div class="today-item is-sub" style="--c:${sb?.color || "#64748b"}"><div class="ti-p"><b>${x.p + 1}</b><small>${esc(pr.start || "")}</small></div>
      <div class="ti-b"><b>${esc(secLabel(section(x.c)))} <span class="badge warn">${esc(tr("احتياط"))}</span></b><span>${esc(sb?.name || "")}</span></div><div class="ti-t">${esc(pr.start || "")} – ${esc(pr.end || "")}</div></div>`;
  }).join("")}</div></div>` : ""}

  <div class="card tt-card">
    <div class="card-head"><h3>جدولي الأسبوعي</h3><div class="row-actions"><button class="btn sm primary" id="dlBtn"><span data-ic="download" data-size="16"></span>تحميل PDF</button></div></div>
    <div id="grid"></div>
  </div>` : ""}

  <div class="card">
    <h3>حسابي</h3>
    <div class="acc-info">
      <div><span>الاسم</span><b data-no-i18n>${esc(S.acc.name)}</b></div>
      <div><span>البريد الإلكتروني</span><b dir="ltr" data-no-i18n>${esc(S.acc.email || user.email || "")}</b></div>
      ${S.acc.phone ? `<div><span>رقم الهاتف</span><b dir="ltr" data-no-i18n>${esc(S.acc.phone)}</b></div>` : ""}
      <div><span>المدرسة</span><b data-no-i18n>${esc(S.school.name || "")}</b></div>
    </div>
    <div id="pushBox" style="margin-bottom:1rem"></div>
    <button class="btn" id="pwBtn"><span data-ic="key" data-size="18"></span>تغيير كلمة المرور</button>
    <p class="muted" style="font-size:.85rem;margin-bottom:0">سيصلك رابط على بريدك الإلكتروني لتعيين كلمة مرور جديدة.</p>
  </div>`;
  fillIcons($("view"));
  drawGrid();
  drawPush($("pushBox"));
  $("updOk") && ($("updOk").onclick = () => markRead(unreadTT()));
  $("dlBtn") && ($("dlBtn").onclick = async () => {
    const sh = mySheet();
    try { toast(tr("جارٍ تجهيز الملف")); await downloadSheetsPDF([sh], sh.title); }
    catch (e) { toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
  });
  $("pwBtn").onclick = async () => {
    try { await sendReset(S.acc.email || user.email); toast(tf("تم إرسال رابط إعادة التعيين إلى {0}", S.acc.email || user.email), "success"); }
    catch (e) { toast(errMsg(e), "error"); }
  };
}

function gridHTML(transpose) {
  const st = settings(), D = st.days.length, P = st.periods.length;
  const map = new Map(mine().map(x => [`${x.d}.${x.p}`, x]));
  const blk = blockedMap();
  const fresh = new Set(unreadTT().flatMap(n => (n.added || []).map(x => `${x.d}.${x.p}`)));
  const cell = (d, p) => {
    const x = map.get(`${d}.${p}`);
    if (!x && blk.has(d * P + p)) return `<td class="tt-cell ro blk"><div class="blk-l">🔒 ${esc(blk.get(d * P + p))}</div></td>`;
    if (!x) return `<td class="tt-cell ro"></td>`;
    const sb = subject(x.s);
    return `<td class="tt-cell has ro ${fresh.has(`${d}.${p}`) ? "fresh" : ""}"><div class="lsn" style="--c:${sb?.color || "#64748b"}"><b>${esc(secLabel(section(x.c)))}</b><small>${esc(sb?.name || "")}</small></div></td>`;
  };
  const pHead = p => `<th class="ph"><b>${p + 1}</b><small>${esc(st.periods[p]?.start || "")}</small></th>`;
  if (!transpose) return `<table class="tt"><thead><tr><th></th>${Array.from({ length: P }, (_, p) => pHead(p)).join("")}</tr></thead><tbody>
    ${st.days.map((dn, d) => `<tr><th class="dh">${esc(dn)}</th>${Array.from({ length: P }, (_, p) => cell(d, p)).join("")}</tr>`).join("")}</tbody></table>`;
  return `<table class="tt tr"><thead><tr><th></th>${st.days.map(dn => `<th class="dh" data-no-i18n>${esc(shortDay(dn))}</th>`).join("")}</tr></thead><tbody>
    ${Array.from({ length: P }, (_, p) => `<tr>${pHead(p)}${st.days.map((_, d) => cell(d, p)).join("")}</tr>`).join("")}</tbody></table>`;
}
function drawGrid() {
  const g = $("grid"); if (!g) return;
  g.innerHTML = `<div class="tt-wrap">${gridHTML(innerWidth < 700)}</div>`;
}
function mySheet() {
  return buildSheet({
    kind: "teacher", ownerId: S.acc.teacherId, title: S.acc.name, school: S.school.name || "", blocked: blockedMap(), P: settings().periods.length,
    settings: settings(), lessons: S.tt, subjectOf: subject, sectionLabel: id => secLabel(section(id)), teacherName: () => ""
  });
}
