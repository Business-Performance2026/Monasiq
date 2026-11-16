// لوحة المعلم: جدولي، حصص اليوم، حسابي
import { db, applyBranding, waitUser, getRole, logout, esc, toast, errMsg, DAYS_ALL, t as tf, tr, fillIcons, isEn, sendReset } from "./app.js?v=202611151929";
import { buildSheet, downloadSheetsPDF } from "./print.js?v=202611151929";
import { buildRules } from "./rules.js?v=202611151929";
import { generalModel, generalTable, downloadGeneralPDF, bindGeneral } from "./general.js?v=202611151929";
import { collection, doc, onSnapshot, writeBatch, addDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { pushState, pushCardHTML, bindPushCard, refreshPush } from "./push.js?v=202611151929";

applyBranding();
const $ = id => document.getElementById(id);
const S = { acc: null, school: null, tt: [], subjects: [], sections: [], grades: [], departments: [], teacher: null, notes: [], subs: {}, teachers: [], pub: null, pubAt: 0, reqs: [] };
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
      onSnapshot(query(collection(db, "schools", sid, "requests"), where("parties", "array-contains", teacherSub)), q => {
        S.reqs = q.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (b.at || 0) - (a.at || 0)); render();
      }, e => console.warn("reqs", e));
    } else if (!S.acc.teacherId) mark("teacher");
    mark("acc");
  }, err);
  onSnapshot(doc(db, "schools", sid), d => {
    S.school = d.data() || {};
    $("schoolName").textContent = S.school.name || "";
    mark("school");
  }, err);
  onSnapshot(doc(db, "schools", sid, "timetable", "main"), d => { S.tt = d.exists() ? d.data().lessons || [] : []; mark("tt"); }, err);
  // الجدول العام: آخر نسخة أرسلتها المدرسة
  onSnapshot(doc(db, "schools", sid, "timetable", "published"), d => { S.pub = d.exists() ? d.data().lessons || [] : null; S.pubAt = d.exists() ? (d.data().at || d.data().updatedAt || 0) : 0; render(); }, () => {});
  for (const k of ["subjects", "sections", "grades", "departments", "teachers"]) {
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
  const sw = daySwapsFor(ymd(new Date()));
  const today = dIdx >= 0 ? [...my.filter(x => x.d === dIdx && !sw.out.has(x.p)), ...sw.in, ...todaySubs].sort((a, b) => a.p - b.p) : [];
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
        <div class="ti-b"><b>${esc(secLabel(section(x.c)))} ${x.sub ? `<span class="badge warn">${esc(tr("احتياط"))}</span>` : ""}${x.swap ? `<span class="badge info">${esc(tr("تبديل"))}</span>` : ""}</b><span>${esc(sb?.name || "")}</span></div>
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

  ${linked && my.length ? reqSectionHTML() : ""}
  ${generalCardHTML()}
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
  bindReqs();
  bindGeneralCard();
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


// ================= الجدول العام =================
const G = { open: false };
function genData() {
  const st = settings();
  return generalModel({ lessons: S.pub || [], teachers: S.teachers, subjects: S.subjects, days: st.days, P: st.periods.length });
}
const genOpts = () => ({ days: settings().days, P: settings().periods.length, secLabel: id => secLabel(section(id)), subjName: id => subject(id)?.name || "",
  school: S.school?.name || "", stamp: S.pubAt ? new Date(S.pubAt).toLocaleDateString(isEn ? "en-GB" : "ar-OM", { dateStyle: "long" }) : "" });
function generalCardHTML() {
  if (!S.pub) return `<div class="card"><h3>${esc(tr("الجدول العام للمعلمين"))}</h3><div class="empty">${esc(tr("لم ترسل المدرسة الجدول العام بعد."))}</div></div>`;
  const m = genData();
  return `<div class="card">
    <div class="card-head"><h3>${esc(tr("الجدول العام للمعلمين"))}</h3><div class="row-actions">
      <button class="btn sm" id="genToggle">${esc(G.open ? tr("إخفاء") : tr("عرض"))}</button>
      <button class="btn sm primary" id="genPdf"><span data-ic="download" data-size="16"></span>PDF (A3)</button></div></div>
    <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${esc(tr("جدول كل المعلمين — يفيدك لمعرفة من هو فارغ قبل طلب تبديل أو احتياط."))}${S.pubAt ? " · " + esc(tf("آخر تحديث: {0}", genOpts().stamp)) : ""}</p>
    ${G.open ? `<div class="gen-tools"><input type="search" data-gsearch placeholder="${esc(tr("ابحث باسم المعلم أو المادة أو الشعبة…"))}"><span class="gen-free hidden" data-gfree></span></div>
      <div class="gen-wrap">${generalTable(m, { ...genOpts(), highlight: S.acc.teacherId })}</div>
      <p class="gen-hint">${esc(tr("اضغط على رقم أي حصة لإظهار المعلمين الفارغين فيها. صفك مميز بنجمة ★."))}</p>` : ""}
  </div>`;
}
function bindGeneralCard() {
  $("genToggle") && ($("genToggle").onclick = () => { G.open = !G.open; render(); if (G.open) setTimeout(() => document.querySelector(".gtt tr.me")?.scrollIntoView({ block: "center", inline: "nearest" }), 50); });
  if (G.open) bindGeneral($("view"));
  $("genPdf") && ($("genPdf").onclick = async () => {
    toast(tr("جارٍ تجهيز الملف"));
    try { await downloadGeneralPDF(genData(), genOpts(), `${tr("الجدول العام للمعلمين")} - ${S.school?.name || ""}`); }
    catch (e) { console.error(e); toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
  });
}

// ================= طلبات التبديل والاحتياط =================
const teacherName = id => S.teachers.find(t => t.id === id)?.name || "؟";
const slotTxt = x => x ? `${settings().days[x.d] || ""} · ${tf("ح{0}", x.p + 1)} · ${secLabel(section(x.c))} ${subject(x.s)?.name || ""}` : "";
const REQ_ST = { peer: ["بانتظار موافقة الزميل", "info"], pending: ["بانتظار موافقة المدرسة", "warn"], approved: ["تمت الموافقة", "ok"], rejected: ["رفضته المدرسة", "bad"], declined: ["رفضه الزميل", "bad"], cancelled: ["ملغى", "muted"] };
// التبديلات المعتمدة ليوم معيّن: ما يخرج من جدولي وما يدخل
function daySwapsFor(date) {
  const me = S.acc?.teacherId, out = new Set(), inn = [];
  for (const r of S.reqs) {
    if (r.kind !== "swap" || r.status !== "approved" || r.mode === "perm" || r.date !== date) continue;
    if (r.from === me) { out.add(r.a.p); inn.push({ ...r.b, t: me, s: r.a.s, c: r.a.c, d: r.b.d, p: r.b.p, swap: true }); }
    if (r.to === me) { out.add(r.b.p); inn.push({ ...r.a, t: me, s: r.b.s, c: r.b.c, d: r.a.d, p: r.a.p, swap: true }); }
  }
  return { out, in: inn };
}
function reqItem(r) {
  const me = S.acc.teacherId, st = REQ_ST[r.status] || [r.status, "muted"];
  const incoming = r.kind === "swap" && r.to === me;
  const body = r.kind === "swap"
    ? `<div class="rq-swap"><div><small>${esc(teacherName(r.from))}</small><b>${esc(slotTxt(r.a))}</b></div><span class="rq-arrow">⇄</span><div><small>${esc(teacherName(r.to))}</small><b>${esc(slotTxt(r.b))}</b></div></div>
       <small class="muted">${esc(r.mode === "perm" ? tr("تبديل دائم") : tf("تبديل ليوم {0} فقط", r.date || ""))}</small>`
    : `<div><b>${esc(tf("احتياط يوم {0}", r.date || ""))}</b> — ${esc((r.periods || []).map(p => tf("ح{0}", p + 1)).join("، "))}</div>`;
  return `<div class="rq-card"><div class="rq-h"><b>${esc(r.kind === "swap" ? (incoming ? tf("طلب تبديل من {0}", teacherName(r.from)) : tr("طلب تبديل")) : tr("طلب احتياط"))}</b><span class="badge ${st[1]}">${esc(tr(st[0]))}</span></div>
    ${body}${r.note ? `<p class="rq-note">“${esc(r.note)}”</p>` : ""}${r.reason && ["rejected", "declined"].includes(r.status) ? `<p class="rq-note bad">${esc(tf("السبب: {0}", r.reason))}</p>` : ""}
    ${incoming && r.status === "peer" ? `<div class="rq-act"><button class="btn sm primary" data-peer-ok="${r.id}">${esc(tr("أوافق"))}</button><button class="btn sm danger" data-peer-no="${r.id}">${esc(tr("أرفض"))}</button></div>` : ""}
    ${r.from === me && ["peer", "pending"].includes(r.status) ? `<div class="rq-act"><button class="btn sm ghost" data-rq-cancel="${r.id}">${esc(tr("إلغاء الطلب"))}</button></div>` : ""}
  </div>`;
}
function reqSectionHTML() {
  const me = S.acc.teacherId;
  const waiting = S.reqs.filter(r => r.to === me && r.status === "peer");
  const active = S.reqs.filter(r => !waiting.includes(r) && (["peer", "pending"].includes(r.status) || (r.decidedAt || r.at || 0) > Date.now() - 14 * 864e5));
  return `<div class="card">
    <div class="card-head"><h3>${esc(tr("طلبات التبديل والاحتياط"))}</h3></div>
    <div class="rq-btns"><button class="btn primary" id="rqSwap"><span data-ic="swap" data-size="18"></span>${esc(tr("طلب تبديل حصة"))}</button>
      <button class="btn" id="rqSub"><span data-ic="userCheck" data-size="18"></span>${esc(tr("طلب احتياط"))}</button></div>
    ${waiting.length ? `<h4 class="rq-sub">${esc(tr("بانتظار موافقتك"))}</h4><div class="rq-list">${waiting.map(reqItem).join("")}</div>` : ""}
    ${active.length ? `<h4 class="rq-sub">${esc(tr("طلباتي"))}</h4><div class="rq-list">${active.map(reqItem).join("")}</div>` : ""}
  </div>`;
}
function bindReqs() {
  const v = $("view");
  $("rqSwap") && ($("rqSwap").onclick = swapModal);
  $("rqSub") && ($("rqSub").onclick = subModal);
  v.querySelectorAll("[data-peer-ok]").forEach(b => b.onclick = () => peerDecide(b.dataset.peerOk, true));
  v.querySelectorAll("[data-peer-no]").forEach(b => b.onclick = () => peerDecide(b.dataset.peerNo, false));
  v.querySelectorAll("[data-rq-cancel]").forEach(b => b.onclick = async () => {
    try { await updateDoc(doc(db, "schools", role.account.schoolId, "requests", b.dataset.rqCancel), { status: "cancelled", decidedAt: Date.now() }); toast(tr("تم إلغاء الطلب"), "success"); }
    catch (e) { toast(errMsg(e), "error"); }
  });
}
async function peerDecide(id, ok) {
  try {
    await updateDoc(doc(db, "schools", role.account.schoolId, "requests", id), ok ? { status: "pending", peerAt: Date.now() } : { status: "declined", peerAt: Date.now(), decidedAt: Date.now() });
    toast(ok ? tr("تمت موافقتك — أُرسل الطلب للمدرسة") : tr("تم رفض الطلب"), "success");
  } catch (e) { toast(errMsg(e), "error"); }
}
// أقرب تاريخ قادم ليوم الدوام d
function nextDate(d) {
  const st = settings(), name = st.days[d], x = new Date();
  for (let i = 0; i < 14; i++) { if (DAYS_ALL[x.getDay()] === name) return ymd(x); x.setDate(x.getDate() + 1); }
  return ymd(new Date());
}
const dayOfDate = date => settings().days.indexOf(DAYS_ALL[new Date(date + "T12:00:00").getDay()]);
// الحصص التي يمكن التبديل معها: نفس الشعبة، معلم آخر، وكل منهما فارغ في وقت الآخر
function swapCandidates(a, sameDay) {
  const me = S.acc.teacherId, P = settings().periods.length, blk = blockedMap();
  const busy = (t, d, p) => S.tt.some(x => x.t === t && x.d === d && x.p === p);
  return S.tt.filter(x => x.c === a.c && x.t !== me && x.d != null && !(x.d === a.d && x.p === a.p)
    && (!sameDay || x.d === a.d) && !busy(me, x.d, x.p) && !busy(x.t, a.d, a.p) && !blk.has(x.d * P + x.p))
    .sort((u, v) => u.d - v.d || u.p - v.p);
}
function swapModal() {
  const my = mine().slice().sort((a, b) => a.d - b.d || a.p - b.p);
  const st = settings();
  let sel = null;
  openModal(`<div class="modal-head"><h3>${esc(tr("طلب تبديل حصة"))}</h3><button class="x" data-close>×</button></div>
    <div class="field"><label>${esc(tr("نوع التبديل"))}</label><div class="seg">
      <label><input type="radio" name="mode" value="day" checked>${esc(tr("ليوم محدد"))}</label><label><input type="radio" name="mode" value="perm">${esc(tr("دائم"))}</label></div></div>
    <div class="field"><label>${esc(tr("حصتك التي تريد تبديلها"))}</label><select id="swMine"><option value="">${esc(tr("— اختر —"))}</option>${my.map((x, i) => `<option value="${i}">${esc(slotTxt(x))}</option>`).join("")}</select></div>
    <div class="field" id="swDateF"><label>${esc(tr("التاريخ"))}</label><input type="date" id="swDate"></div>
    <div class="field"><label>${esc(tr("التبديل مع"))}</label><div id="swCands" class="rq-opts"><p class="muted">${esc(tr("اختر حصتك أولًا"))}</p></div></div>
    <div class="field"><label>${esc(tr("ملاحظة (اختياري)"))}</label><input id="swNote" maxlength="140"></div>
    <p class="muted" style="font-size:.82rem">${esc(tr("يصل الطلب لزميلك أولًا، وبعد موافقته يصل لإدارة المدرسة."))}</p>
    <div class="modal-actions"><button class="btn primary" id="swGo" disabled>${esc(tr("إرسال الطلب"))}</button><button class="btn ghost" data-close>${esc(tr("إلغاء"))}</button></div>`);
  fillIcons($("modal"));
  const mode = () => document.querySelector("input[name=mode]:checked").value;
  const draw = () => {
    const a = my[$("swMine").value]; sel = null; $("swGo").disabled = true;
    $("swDateF").classList.toggle("hidden", mode() !== "day");
    if (!a) return;
    if (mode() === "day") {
      if (!$("swDate").value || dayOfDate($("swDate").value) !== a.d) $("swDate").value = nextDate(a.d);
    }
    const list = swapCandidates(a, mode() === "day");
    $("swCands").innerHTML = list.length ? list.map((x, i) => `<label class="rq-opt"><input type="radio" name="cand" value="${i}"><div><b>${esc(teacherName(x.t))}</b><small>${esc(slotTxt(x))}</small></div></label>`).join("")
      : `<p class="muted">${esc(mode() === "day" ? tr("لا يوجد زميل في نفس الشعبة يمكن التبديل معه في هذا اليوم. جرّب «دائم» أو حصة أخرى.") : tr("لا يوجد زميل في نفس الشعبة يمكن التبديل معه."))}</p>`;
    $("swCands").querySelectorAll("input").forEach(inp => inp.onchange = () => { sel = list[+inp.value]; $("swGo").disabled = false; });
  };
  $("swMine").onchange = draw;
  document.querySelectorAll("input[name=mode]").forEach(r => r.onchange = draw);
  $("swDate").onchange = () => { const a = my[$("swMine").value]; if (a && dayOfDate($("swDate").value) !== a.d) { toast(tf("اختر تاريخًا يوافق يوم {0}", st.days[a.d]), "error"); $("swDate").value = nextDate(a.d); } };
  $("swGo").onclick = async () => {
    const a = my[$("swMine").value]; if (!a || !sel) return;
    const m = mode(), date = m === "day" ? $("swDate").value : "";
    if (m === "day" && date < ymd(new Date())) return toast(tr("التاريخ في الماضي"), "error");
    $("swGo").disabled = true;
    try {
      await addDoc(collection(db, "schools", role.account.schoolId, "requests"), {
        kind: "swap", mode: m, date, from: S.acc.teacherId, to: sel.t, parties: [S.acc.teacherId, sel.t], fromUid: user.uid,
        fromName: S.acc.name || "", toName: teacherName(sel.t),
        a: { d: a.d, p: a.p, c: a.c, s: a.s }, b: { d: sel.d, p: sel.p, c: sel.c, s: sel.s },
        text: `${slotTxt(a)} ⇄ ${slotTxt(sel)}`, note: $("swNote").value.trim(), status: "peer", at: Date.now()
      });
      closeModal(); toast(tf("أُرسل الطلب إلى {0}", teacherName(sel.t)), "success");
    } catch (e) { $("swGo").disabled = false; toast(errMsg(e), "error"); }
  };
}
function subModal() {
  const st = settings();
  openModal(`<div class="modal-head"><h3>${esc(tr("طلب احتياط"))}</h3><button class="x" data-close>×</button></div>
    <p class="muted" style="margin-top:0;font-size:.88rem">${esc(tr("إذا لن تحضر حصصًا في يوم معيّن، اطلب من الإدارة تعيين معلم احتياط."))}</p>
    <div class="field"><label>${esc(tr("التاريخ"))}</label><input type="date" id="sbDate" value="${ymd(new Date())}" min="${ymd(new Date())}"></div>
    <div class="field"><label>${esc(tr("الحصص"))}</label><div id="sbPer" class="rq-opts"></div></div>
    <div class="field"><label>${esc(tr("السبب"))}</label><input id="sbNote" maxlength="140" placeholder="${esc(tr("مثال: موعد طبي"))}"></div>
    <div class="modal-actions"><button class="btn primary" id="sbGo" disabled>${esc(tr("إرسال للمدرسة"))}</button><button class="btn ghost" data-close>${esc(tr("إلغاء"))}</button></div>`);
  const draw = () => {
    const d = dayOfDate($("sbDate").value);
    const list = d < 0 ? [] : mine().filter(x => x.d === d).sort((a, b) => a.p - b.p);
    $("sbPer").innerHTML = d < 0 ? `<p class="muted">${esc(tr("ليس يوم دوام"))}</p>` : list.length ? list.map(x => `<label class="rq-opt"><input type="checkbox" value="${x.p}" checked><div><b>${esc(tf("الحصة {0}", x.p + 1))}</b><small>${esc(secLabel(section(x.c)) + " " + (subject(x.s)?.name || ""))}</small></div></label>`).join("")
      : `<p class="muted">${esc(tr("لا توجد لديك حصص في هذا اليوم"))}</p>`;
    const upd = () => { $("sbGo").disabled = !$("sbPer").querySelector("input:checked"); };
    $("sbPer").querySelectorAll("input").forEach(i => i.onchange = upd); upd();
  };
  $("sbDate").onchange = draw; draw();
  $("sbGo").onclick = async () => {
    const date = $("sbDate").value, periods = [...$("sbPer").querySelectorAll("input:checked")].map(i => +i.value);
    if (!periods.length) return;
    $("sbGo").disabled = true;
    try {
      await addDoc(collection(db, "schools", role.account.schoolId, "requests"), {
        kind: "sub", date, periods, from: S.acc.teacherId, parties: [S.acc.teacherId], fromUid: user.uid, fromName: S.acc.name || "",
        text: `${date} — ${periods.map(p => tf("ح{0}", p + 1)).join("، ")}`, note: $("sbNote").value.trim(), status: "pending", at: Date.now()
      });
      closeModal(); toast(tr("أُرسل طلب الاحتياط للمدرسة"), "success");
    } catch (e) { $("sbGo").disabled = false; toast(errMsg(e), "error"); }
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
