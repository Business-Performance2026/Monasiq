// لوحة تحكم المدرسة
import { db, applyBranding, waitUser, getRole, logout, esc, toast, confirmBox, errMsg, DAYS_ALL, defaultPeriods, t as tf, tr, fillIcons, isEn, sendReset, T_STATUS, norm } from "./app.js?v=202611151929";
import { setLang } from "./i18n.js?v=202611151929";
import { schedule, reconcile } from "./scheduler.js?v=202611151929";
import { sendTimetableLink, WA_ICON, newShareId, sheetToDoc, waNumber } from "./whatsapp.js?v=202611151929";
import { buildRules, slotViolation, precheck, teacherDepts, sectionViolation, sectionDays } from "./rules.js?v=202611151929";
import { buildSheet, downloadSheetsPDF, downloadHtmlPDF } from "./print.js?v=202611151929";
import { readPdfPages, parseTimetablePages, buildImport, parseGeneralPages, applyGeneralSubjects } from "./pdf-import.js?v=202611151929";
import { govOptions, wilOptions, linkGovWil } from "./oman.js?v=202611151929";
import { generalModel, generalTable, downloadGeneralPDF, bindGeneral } from "./general.js?v=202611151929";
import { parseAscXml } from "./xml-import.js?v=202611151929";
import { gzipText, gunzipText, buildNoorXml } from "./noor-export.js?v=202611151929";
import { parseExcel, downloadTemplate } from "./xlsx-import.js?v=202611151929";
import { watchBilling, subState, quote, fmtDate, money, stateLabel, receiptDataUrl, uploadReceipt, DAY, BILLING_DEFAULT } from "./billing.js?v=202611151929";
import { pushState, pushCardHTML, bindPushCard, refreshPush } from "./push.js?v=202611151929";
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, writeBatch, serverTimestamp, query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

applyBranding();


// ---------- الحالة ----------
let SID, pubLast = "";
const loaded = new Set();
const NEED = 7; // school, grades, sections, subjects, teachers, departments, timetable
const S = { school: null, grades: [], sections: [], subjects: [], teachers: [], departments: [], accounts: [] };
// الاشتراك: إعدادات الدفع، طلبات الدفع، والإشعارات
const B = { cfg: { ...BILLING_DEFAULT }, pays: [], notes: [] };
const $ = id => document.getElementById(id);
const col = name => collection(db, "schools", SID, name);
const dref = (name, id) => doc(db, "schools", SID, name, id);
const num = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

const GRADE_NAMES = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#be123c", "#65a30d", "#475569"];

const grade = id => S.grades.find(g => g.id === id);
const section = id => S.sections.find(s => s.id === id);
const subject = id => S.subjects.find(s => s.id === id);
// الترتيب المعتاد للمواد في المدارس (أي مادة غير معروفة تأتي بعدها أبجديًا)
const SUBJ_ORDER = [/إسلامي|اسلامي|قرآن|قران/, /عربي/, /إنجليز|انجليز|انقليز/, /رياضيات/, /فيزياء/, /كيمياء/, /أحياء|احياء/, /علوم/,
  /اجتماعي|تاريخ|جغرافيا|وطن/, /تقني|حاسوب|حاسب|معلومات/, /رياضة|بدني/, /فنون|فني|تشكيلي/, /موسيق/, /مهارات/];
function subjRank(name) { const i = SUBJ_ORDER.findIndex(r => r.test(name || "")); return i < 0 ? 99 : i; }
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
    updateBell();
  }, e => toast(errMsg(e), "error"));

  const sorters = {
    grades: (a, b) => num(a.code) - num(b.code) || a.name.localeCompare(b.name, "ar"),
    sections: (a, b) => (num(grade(a.gradeId)?.code) - num(grade(b.gradeId)?.code)) || num(a.num) - num(b.num),
    subjects: (a, b) => subjRank(a.name) - subjRank(b.name) || a.name.localeCompare(b.name, "ar"),
    teachers: (a, b) => a.name.localeCompare(b.name, "ar"),
    departments: (a, b) => a.name.localeCompare(b.name, "ar")
  };
  const billRefresh = () => { updateBell(); if (loaded.size >= NEED && (location.hash === "#billing" || !$("view").firstElementChild)) render(); else if (loaded.size >= NEED) updateSubUI(); };
  watchBilling(cfg => { B.cfg = cfg; billRefresh(); });
  onSnapshot(query(collection(db, "payments"), where("schoolId", "==", SID)), snap => {
    B.pays = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    billRefresh();
  }, () => {});
  onSnapshot(col("notifications"), snap => {
    B.notes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
    updateBell();
  }, () => {});
  document.querySelectorAll("[data-bell]").forEach(b => (b.onclick = () => openBell()));
  refreshPush({ uid: SID, role: "school", schoolId: SID });
  // وضع المشاهدة فقط بعد انتهاء الاشتراك: نمنع أزرار التعديل
  document.addEventListener("click", roGuard, true);
  document.addEventListener("submit", e => { if (isRO() && e.target.closest("#view, #modal") && !e.target.closest("#billView")) { e.preventDefault(); e.stopPropagation(); roToast(); } }, true);
  onSnapshot(query(collection(db, "teacherAccounts"), where("schoolId", "==", SID)), snap => {
    S.accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const n = S.accounts.filter(a => a.status === "pending").length;
    document.querySelectorAll("[data-acc-badge]").forEach(b => { b.textContent = n; b.classList.toggle("hidden", !n); });
    if (loaded.size >= NEED && ["#accounts", "#overview", ""].includes(location.hash)) render();
  }, () => {});
  // طلبات المعلمين (تبديل / احتياط)
  onSnapshot(col("requests"), snap => {
    REQ.list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || 0) - (a.at || 0));
    const n = REQ.list.filter(r => r.status === "pending").length;
    document.querySelectorAll("[data-req-badge]").forEach(b => { b.textContent = n; b.classList.toggle("hidden", !n); });
    if (loaded.size >= NEED && ["#requests", "#subs"].includes(location.hash)) render();
  }, () => {});
  // الاحتياط: الغيابات والتوزيعات اليومية
  onSnapshot(col("absences"), snap => { SUB.abs = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (location.hash === "#subs" && loaded.size >= NEED) subsRedraw(); }, () => {});
  onSnapshot(col("subs"), snap => { SUB.days = new Map(snap.docs.map(d => [d.id, d.data()])); if (location.hash === "#subs" && loaded.size >= NEED && !SUB.saving) subsRedraw(); }, () => {});
  // آخر نسخة أُرسلت للمعلمين (لمعرفة من تغيّر جدوله)
  onSnapshot(doc(db, "schools", SID, "timetable", "published"), d => {
    PUB.lessons = d.exists() ? (d.data().lessons || []) : null; PUB.ready = true;
    ensureBaseline(); updatePubBar();
  }, () => { PUB.ready = true; });
  onSnapshot(doc(db, "schools", SID, "timetable", "main"), d => {
    const incoming = d.exists() ? (d.data().lessons || []) : [];
    TT.saved = incoming;
    ensureBaseline();
    if (!loaded.has("timetable")) return mark("timetable");
    if (TT.dirty || TT.saving) return;
    const js = JSON.stringify(incoming);
    if (js === TT.lastJSON) return; // صدى حفظنا نحن
    // تغيير من جهاز آخر: نعيد بناء الجدول
    TT.lastJSON = js; TT.lessons = null; TV.sel = null;
    if (location.hash === "#timetable") render();
  }, e => { toast(errMsg(e), "error"); mark("timetable"); });
  for (const k of ["grades", "sections", "subjects", "teachers", "departments"]) {
    onSnapshot(col(k), snap => {
      S[k] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      S[k].sort(sorters[k]);
      if (k === "grades") S.sections.sort(sorters.sections);
      loaded.has(k) ? render() : mark(k);
    }, e => toast(errMsg(e), "error"));
  }
}

// ---------- التوجيه ----------
const VIEWS = { general: vGeneral, requests: vRequests, subs: vSubs, billing: vBilling, departments: vDepartments, overview: vOverview, settings: vSettings, grades: vGrades, subjects: vSubjects, teachers: vTeachers, timetable: vTimetable, accounts: vAccounts };
function render() {
  if (loaded.size < NEED) return;
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  document.querySelectorAll("#nav a, #bnav a, #sheet a").forEach(a => a.classList.toggle("active", a.dataset.v === v));
  document.querySelector("[data-more]").classList.toggle("active", ["settings", "grades", "accounts", "departments", "billing", "subjects", "general", "requests"].includes(v));
  const view = $("view");
  view.onclick = null;
  document.body.classList.remove("has-sel");
  document.body.classList.toggle("ro", isRO());
  view.innerHTML = (v === "billing" ? "" : subBanner()) + VIEWS[v]();
  BIND[v]?.(view);
}
const BIND = {};


// =====================================================
//  الاشتراك
// =====================================================
const curSub = () => subState(S.school, B.cfg);
const isRO = () => !!S.school && curSub().state === "expired";
const pendingPay = () => B.pays.find(p => p.status === "pending");
function roToast() { toast(tr("انتهى الاشتراك: يمكنك المشاهدة والتحميل فقط. جدّد من صفحة «اشتراكاتي»."), "error"); }
const RO_ALLOW = "#expNoor,#noorDl,#notiOld,[data-push],[data-pr],[data-act=wa],.wa-btn,.ld-head,.fold-head,.gh,#ttMode,#ttPrev,#ttNext,.tt-find,#ttPrint,#expPdfT,#expPdfS,[data-close],.x,.lang-btn,[data-bell],#billView,.ld-filters,#tFoldAll,.t-group-head,#xlsTpl,#dlCancel,.sub-banner";
function roGuard(e) {
  if (!isRO()) return;
  const t = e.target;
  if (!t.closest("#view, #modal") || t.closest(RO_ALLOW)) return;
  if (t.closest("button, [data-act], .tt-cell, .tt-tray, input[type=checkbox], input[type=file], label.check, .sec-btn")) {
    e.preventDefault(); e.stopPropagation(); roToast();
  }
}
// شريط أعلى الصفحات حسب حالة الاشتراك
function subBanner() {
  const st = curSub();
  if (st.state === "expired") return `<a class="sub-banner bad" href="#billing"><span data-ic="lock" data-size="18"></span><span>${esc(tr("انتهى الاشتراك — الوضع الآن مشاهدة وتحميل فقط."))} <b>${esc(tr("جدّد الآن"))}</b></span></a>`;
  if (st.state === "trial" && st.daysLeft != null) return `<a class="sub-banner info" href="#billing"><span data-ic="card" data-size="18"></span><span>${esc(tf("فترة تجريبية · باقي {0} يوم.", st.daysLeft))} <b>${esc(tr("اشترك الآن"))}</b></span></a>`;
  if (st.state === "active" && st.daysLeft <= 30) return `<a class="sub-banner warn" href="#billing"><span data-ic="card" data-size="18"></span><span>${esc(tf("ينتهي اشتراككم بعد {0} يوم.", st.daysLeft))} <b>${esc(tr("جدّد الآن"))}</b></span></a>`;
  return "";
}
function updateSubUI() {
  document.body.classList.toggle("ro", isRO());
  const v = $("view"), old = v?.querySelector(":scope > .sub-banner"), html = location.hash === "#billing" ? "" : subBanner();
  if (old) old.remove();
  if (html && v) { v.insertAdjacentHTML("afterbegin", html); fillIcons(v.firstElementChild); }
}
// تنبيهات محسوبة (غير محفوظة): قرب انتهاء التجربة أو الاشتراك
function subAlerts() {
  if (!S.school) return [];
  const st = curSub(), out = [];
  if (st.state === "expired") out.push({ kind: "bad", title: tr("انتهى الاشتراك"), body: tr("جدّد الاشتراك لتعود لك صلاحية التعديل والتوزيع.") });
  else if (st.state === "trial" && st.daysLeft != null && st.daysLeft <= 3) out.push({ kind: "warn", title: tr("الفترة التجريبية على وشك الانتهاء"), body: tf("باقي {0} يوم. اشترك من صفحة «اشتراكاتي».", st.daysLeft) });
  else if (st.state === "active" && st.daysLeft <= 30) out.push({ kind: "warn", title: tr("اقترب موعد التجديد"), body: tf("ينتهي اشتراككم في {0}.", fmtDate(st.until)) });
  return out;
}
function updateBell() {
  const n = B.notes.filter(x => !x.read).length + subAlerts().length;
  document.querySelectorAll("[data-bell-n]").forEach(b => { b.textContent = n; b.classList.toggle("hidden", !n); });
}
// الإشعارات: تظهر الجديدة فقط، والمقروءة تختفي (ويمكن عرضها من «الإشعارات السابقة»)
function openBell(showOld = false) {
  const al = subAlerts(), fresh = B.notes.filter(x => !x.read), old = B.notes.filter(x => x.read);
  const items = [...al.map(a => ({ ...a, alert: true })), ...fresh, ...(showOld ? old.slice(0, 30) : [])];
  const card = x => `<a class="noti ${x.kind || "info"} ${x.read || x.alert ? "" : "new"}" href="${esc(x.link || "#billing")}" data-close>
      <b>${esc(x.title)}</b>${x.body ? `<span>${esc(x.body)}</span>` : ""}${x.at ? `<small>${esc(new Date(x.at).toLocaleString(isEn ? "en-GB" : "ar-OM", { dateStyle: "medium", timeStyle: "short" }))}</small>` : ""}</a>`;
  openModal(`${modalHead(tr("الإشعارات"))}
    <div class="noti-list">${items.length ? items.map(card).join("") : `<div class="empty">${tr("لا توجد إشعارات جديدة")}</div>`}</div>
    ${!showOld && old.length ? `<button class="btn ghost block noti-old" id="notiOld">${esc(tf("الإشعارات السابقة ({0})", old.length))}</button>` : ""}
    <div id="pushBox2" style="margin-top:1rem"></div>`);
  drawPush($("pushBox2"));
  if ($("notiOld")) $("notiOld").onclick = () => openBell(true);
  if (fresh.length) {
    const b = writeBatch(db);
    fresh.forEach(x => b.update(dref("notifications", x.id), { read: true }));
    b.commit().catch(() => {});
  }
}

function vBilling() {
  const cfg = B.cfg, st = curSub(), lb = stateLabel(st), q = quote(S.school, cfg), pend = pendingPay();
  const hist = B.pays.filter(p => p.status !== "pending");
  const stBadge = { pending: ["warn", "قيد المراجعة"], approved: ["ok", "مقبول"], rejected: ["bad", "مرفوض"] };
  return `<div id="billView">
  <div class="page-title"><h1>اشتراكاتي</h1></div>
  <div class="card sub-status ${lb.cls}">
    <div class="sub-ic"><span data-ic="${st.state === "expired" ? "lock" : "card"}" data-size="26"></span></div>
    <div>
      <small class="muted">${tr("حالة الاشتراك")}</small>
      <h2>${esc(lb.text)}</h2>
      <p class="muted">${st.state === "expired" ? esc(tr("يمكنك مشاهدة الجداول وتحميلها، والمعلمون يرون جداولهم، لكن التعديل والتوزيع متوقفان حتى التجديد."))
        : st.state === "trial" ? esc(tf("الاشتراك السنوي {0}، وكل الاشتراكات تنتهي في نفس التاريخ: {1}.", money(cfg.price, cfg), fmtDate(nextExpiryOf(cfg))))
        : esc(tf("التجديد السنوي {0}.", money(cfg.price, cfg)))}</p>
    </div>
  </div>
  ${pend ? `<div class="card pay-pending">
      <h3>${tr("طلبك قيد المراجعة")}</h3>
      <p class="muted">${esc(tf("أُرسل في {0} بمبلغ {1}. سيصلك إشعار هنا بمجرد التفعيل.", new Date(pend.createdAt).toLocaleDateString(isEn ? "en-GB" : "ar-OM"), money(pend.amount, cfg)))}</p>
      ${pend.receipt ? `<img class="rcpt-thumb" src="${pend.receipt}" alt="">` : ""}
      ${pend.receiptUrl ? `<a href="${esc(pend.receiptUrl)}" target="_blank" rel="noopener">${tr("فتح الملف الأصلي")}</a>` : ""}
      <div class="row-actions">
        ${cfg.adminPhone ? `<button class="btn wa-notify" id="waAdmin">${WA_ICON}<span>${tr("إبلاغ الإدارة عبر واتساب")}</span></button>` : ""}
        <button class="btn ghost" id="payCancel">${tr("إلغاء الطلب")}</button>
      </div>
    </div>` : st.state === "active" && st.daysLeft > 60 ? `<div class="card"><h3>${tr("لا يلزم أي إجراء الآن")}</h3>
      <p class="muted" style="margin:0">${esc(tf("يُفتح التجديد قبل انتهاء الاشتراك بشهرين ({0}).", fmtDate(st.until - 60 * DAY)))}</p></div>` : `<div class="card pay-card">
      <h3>${tr(st.state === "active" ? "تجديد الاشتراك" : "الاشتراك")}</h3>
      <div class="pay-amount"><b>${esc(money(q.amount, cfg))}</b><span>${esc(tf("يمتد الاشتراك حتى {0}", fmtDate(q.until)))}${!q.renewal && q.months < 12 ? ` · ${esc(tf("حسب {0} أشهر متبقية", q.months))}` : ""}</span></div>
      <ol class="pay-steps">
        <li>${esc(tf("حوّل مبلغ {0} عبر التحويل البنكي برقم الهاتف:", money(q.amount, cfg)))}
          ${cfg.bankPhone ? `<div class="bank-box"><div><small>${tr("رقم الهاتف")}</small><b dir="ltr">${esc(cfg.bankPhone)}</b></div><button class="btn sm" id="copyPhone">${tr("نسخ")}</button></div>
          ${cfg.bankName ? `<div class="bank-box"><div><small>${tr("اسم صاحب الحساب")}</small><b>${esc(cfg.bankName)}</b></div></div>` : ""}
          ${cfg.bankNote ? `<p class="muted" style="margin:.4rem 0 0">${esc(cfg.bankNote)}</p>` : ""}` : `<div class="notice warn">${tr("لم تُضف بيانات التحويل بعد. تواصل مع إدارة المنصة.")}</div>`}
        </li>
        <li>${tr("ارفع صورة وصل التحويل (صورة أو PDF):")}
          <input type="file" id="rcptFile" accept="image/*,application/pdf">
          <div id="rcptPrev"></div>
          <textarea id="payNote" rows="2" placeholder="${esc(tr("ملاحظة (اختياري)"))}"></textarea>
        </li>
      </ol>
      <button class="btn primary block" id="paySend"><span data-ic="upload" data-size="18"></span>${tr("إرسال الوصل")}</button>
    </div>`}
  <div class="card"><h3>${tr("إشعارات الجوال")}</h3><div id="pushBox"></div></div>
  <div class="card">
    <h3>${tr("سجل الدفعات")}</h3>
    ${hist.length ? `<div class="pay-hist">${hist.map(p => `<div class="ph-row">
      <div><b>${esc(money(p.amount, cfg))}</b><small class="muted">${esc(new Date(p.createdAt).toLocaleDateString(isEn ? "en-GB" : "ar-OM"))}${p.status === "approved" && p.until ? ` · ${esc(tf("حتى {0}", fmtDate(p.until)))}` : ""}</small>
      ${p.status === "rejected" && p.reason ? `<small class="ph-reason">${esc(tf("سبب الرفض: {0}", p.reason))}</small>` : ""}</div>
      <span class="badge ${stBadge[p.status]?.[0] || "info"}">${tr(stBadge[p.status]?.[1] || p.status)}</span></div>`).join("")}</div>` : `<p class="muted">${tr("لا توجد دفعات سابقة")}</p>`}
  </div></div>`;
}
const nextExpiryOf = cfg => quote({}, cfg).until;
const pushCtx = () => ({ uid: SID, role: "school", schoolId: SID });
async function drawPush(box) {
  if (!box) return;
  box.innerHTML = pushCardHTML(await pushState(SID), esc);
  bindPushCard(box, pushCtx(), () => drawPush(box), toast);
}
BIND.billing = v => {
  fillIcons(v);
  drawPush($("pushBox"));
  const cfg = B.cfg, pend = pendingPay();
  const waAdmin = p => {
    const n = waNumber(cfg.adminPhone); if (!n) return;
    const msg = tf("السلام عليكم، مدرسة {0} رفعت وصل تحويل اشتراك منصة مُنسِّق بمبلغ {1}، يرجى المراجعة والتفعيل.", S.school.name, money(p.amount, cfg));
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  if (pend) {
    if ($("waAdmin")) $("waAdmin").onclick = () => waAdmin(pend);
    $("payCancel").onclick = async () => {
      if (!(await confirmBox(tr("إلغاء طلب الاشتراك المرسل؟"), tr("إلغاء الطلب")))) return;
      try { await deleteDoc(doc(db, "payments", pend.id)); toast(tr("تم إلغاء الطلب"), "success"); } catch (e) { toast(errMsg(e), "error"); }
    };
    return;
  }
  if (!$("paySend")) return;
  if ($("copyPhone")) $("copyPhone").onclick = async () => { try { await navigator.clipboard.writeText(cfg.bankPhone); toast(tr("تم نسخ الرقم"), "success"); } catch { toast(cfg.bankPhone); } };
  let rcpt = null, rcptFile = null;
  $("rcptFile").onchange = async e => {
    const f = e.target.files[0]; rcpt = null; rcptFile = f || null; $("rcptPrev").innerHTML = "";
    if (!f) return;
    $("rcptPrev").innerHTML = `<div class="muted">${tr("جارٍ تجهيز الصورة")}…</div>`;
    try { rcpt = await receiptDataUrl(f); $("rcptPrev").innerHTML = `<img class="rcpt-thumb" src="${rcpt}" alt="">`; }
    catch { $("rcptPrev").innerHTML = ""; e.target.value = ""; toast(tr("تعذّر قراءة الملف. أرسل صورة أوضح أو أصغر."), "error"); }
  };
  $("paySend").onclick = async () => {
    if (!rcpt) return toast(tr("ارفع صورة وصل التحويل أولًا"), "error");
    const q = quote(S.school, cfg), btn = $("paySend");
    btn.disabled = true;
    const p = { schoolId: SID, schoolName: S.school.name, email: S.school.email || "", amount: q.amount, until: q.until, months: q.months, renewal: q.renewal,
      receipt: rcpt, note: $("payNote").value.trim().slice(0, 500), status: "pending", createdAt: Date.now() };
    try {
      const pref = doc(collection(db, "payments"));
      // الملف الأصلي في Storage + صورة مصغّرة للعرض. إذا لم يكن Storage متاحًا نكتفي بالصورة المضغوطة
      try {
        btn.textContent = tr("جارٍ رفع الوصل…");
        const up = await uploadReceipt(rcptFile, SID, pref.id);
        Object.assign(p, { receiptUrl: up.url, receiptPath: up.path, receiptType: up.type, receipt: await receiptDataUrl(rcptFile, true) });
      } catch (ex) { console.warn("storage", ex); }
      await setDoc(pref, p);
      openModal(`${modalHead(tr("تم إرسال الوصل ✅"))}
        <p>${esc(tr("سيتم مراجعة الوصل وتفعيل الاشتراك، وسيصلك إشعار هنا عند التفعيل."))}</p>
        ${cfg.adminPhone ? `<p class="muted">${tr("لتسريع المراجعة أبلغ الإدارة عبر واتساب:")}</p>` : ""}
        <div class="modal-actions">${cfg.adminPhone ? `<button class="btn wa-notify" id="waAdmin2">${WA_ICON}<span>${tr("إبلاغ الإدارة عبر واتساب")}</span></button>` : ""}<button class="btn ghost" data-close>${tr("إغلاق")}</button></div>`);
      if ($("waAdmin2")) $("waAdmin2").onclick = () => { waAdmin(p); closeModal(); };
    } catch (e) { btn.disabled = false; btn.textContent = tr("إرسال الوصل"); toast(errMsg(e), "error"); }
  };
};


// =====================================================
//  إرسال تحديث الجدول للمعلمين
// =====================================================
const PUB = { lessons: null, ready: false, baselineTried: false };
const placedOf = arr => (arr || []).filter(x => x.d != null && x.p != null);
const lkey = x => `${x.d}|${x.p}|${x.c}|${x.s}`;
// أول مرة: نعتبر الجدول الحالي هو المُرسل (بدون إشعار)
function ensureBaseline() {
  if (!PUB.ready || PUB.lessons || PUB.baselineTried || !TT.saved || isRO()) return;
  PUB.baselineTried = true;
  const lessons = placedOf(TT.saved).map(x => ({ t: x.t, s: x.s, c: x.c, d: x.d, p: x.p }));
  setDoc(doc(db, "schools", SID, "timetable", "published"), { lessons, at: Date.now() }).catch(() => {});
}
// التغييرات لكل معلم: حصص أُضيفت وحصص أُزيلت مقارنة بآخر إرسال
function ttChanges() {
  if (!PUB.lessons) return new Map();
  const cur = placedOf(TT.lessons || TT.saved), old = placedOf(PUB.lessons);
  const by = (arr) => { const m = new Map(); for (const x of arr) { if (!m.has(x.t)) m.set(x.t, new Set()); m.get(x.t).add(lkey(x)); } return m; };
  const A = by(cur), B = by(old), out = new Map();
  for (const t of new Set([...A.keys(), ...B.keys()])) {
    if (!teacherOf(t)) continue;
    const a = A.get(t) || new Set(), b = B.get(t) || new Set();
    const added = [...a].filter(k => !b.has(k)), removed = [...b].filter(k => !a.has(k));
    if (added.length || removed.length) out.set(t, { added, removed });
  }
  return out;
}
function chgLabel(k) {
  const [d, p, c, sb] = k.split("|");
  return { d: +d, p: +p, text: `${tr(settings().days[+d] || "")} · ${tf("الحصة {0}", +p + 1)} · ${secLabel(section(c))} ${subject(sb)?.name || ""}` };
}
function updatePubBar() {
  const bar = $("pubBar"); if (!bar) return;
  const ch = ttChanges();
  bar.innerHTML = ch.size ? `<div class="pub-bar"><span data-ic="bell" data-size="18"></span><span>${esc(ch.size === 1 ? tf("تغيّر جدول {0} منذ آخر إرسال", teacherOf([...ch.keys()][0])?.name || "") : tf("تغيّرت جداول {0} معلمين منذ آخر إرسال", ch.size))}</span>
    <button class="btn sm primary" id="pubBtn">${tr("إرسال التحديث للمعلمين")}</button></div>` : "";
  fillIcons(bar);
  if ($("pubBtn")) $("pubBtn").onclick = publishModal;
}
const accOfTeacher = tid => S.accounts.find(a => a.teacherId === tid && a.status === "active");
function publishModal() {
  ttSync();
  const ch = ttChanges();
  const rows = [...ch].map(([tid, c]) => ({ t: teacherOf(tid), c, acc: accOfTeacher(tid) })).sort((a, b) => a.t.name.localeCompare(b.t.name, "ar"));
  const withAcc = rows.filter(r => r.acc).length;
  openModal(`${modalHead(tr("إرسال تحديث الجدول للمعلمين"))}
    <p class="muted" style="margin-top:0">${esc(tf("{0} معلمين تغيّر جدولهم. يصل إشعار لمن لديه حساب في المنصة ({1})، وللباقين يمكنك إرسال الرابط عبر واتساب.", rows.length, withAcc))}</p>
    <div class="pub-list">${rows.map(r => `<label class="pub-row">
      <input type="checkbox" data-tid="${r.t.id}" checked>
      <div class="pub-main"><b data-no-i18n>${esc(r.t.name)}</b>
        ${r.c.added.map(k => `<small class="add">＋ ${esc(chgLabel(k).text)}</small>`).join("")}
        ${r.c.removed.map(k => `<small class="rem">− ${esc(chgLabel(k).text)}</small>`).join("")}
      </div>
      <span class="pub-ch">${r.acc ? `<span class="badge ok" title="${esc(tr("لديه حساب في المنصة"))}">📱 ${tr("إشعار")}</span>` : teacherPhone(r.t) ? `<button type="button" class="wa-btn" data-wa="${r.t.id}">${WA_ICON}</button>` : `<span class="badge info">${tr("بدون حساب")}</span>`}</span>
    </label>`).join("")}</div>
    <div class="modal-actions">
      <button class="btn primary" id="pubGo">${tr("إرسال")}</button>
      <button class="btn ghost" id="pubSkip">${tr("تجاهل بدون إشعار")}</button>
    </div>`);
  $("modal").querySelectorAll("[data-wa]").forEach(b => (b.onclick = e => { e.preventDefault(); waTeacher(teacherOf(b.dataset.wa)); }));
  const commit = async notify => {
    const picked = new Set([...$("modal").querySelectorAll("[data-tid]:checked")].map(i => i.dataset.tid));
    const items = notify ? rows.filter(r => picked.has(r.t.id)).map(r => ({
      teacherId: r.t.id, name: r.t.name,
      added: r.c.added.map(k => chgLabel(k)), removed: r.c.removed.map(k => chgLabel(k))
    })) : [];
    const b = writeBatch(db);
    b.set(doc(db, "schools", SID, "timetable", "published"), { lessons: placedOf(TT.lessons).map(x => ({ t: x.t, s: x.s, c: x.c, d: x.d, p: x.p })), at: Date.now() });
    if (items.length) b.set(doc(col("publishes")), { at: Date.now(), items, school: S.school.name });
    // تحديث روابط الواتساب المرسلة سابقًا للمعلمين المتأثرين
    for (const r of rows) if (r.t.shareId)
      b.set(doc(db, "shares", r.t.shareId), { schoolId: SID, teacherId: r.t.id, name: r.t.name, sheet: sheetToDoc(sheetFor("teacher", r.t.id)), lang: isEn ? "en" : "ar", updatedAt: serverTimestamp() });
    try {
      await b.commit(); closeModal();
      toast(items.length ? tf("تم إرسال التحديث لـ {0} معلمين", items.length) : tr("تم حفظ الجدول الحالي كآخر نسخة مُرسلة"), "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
  $("pubGo").onclick = () => commit(true);
  $("pubSkip").onclick = () => commit(false);
}


// =====================================================
//  الاحتياط (حصص الانتظار)
// =====================================================
const SUB = { abs: [], days: new Map(), date: null, saving: false };
const ymd = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const parseYmd = v => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d); };
const subCfg = () => ({ dailyMax: 2, termStart: "", exclude: [], ...(S.school?.settings?.subs || {}) });
const dayIdxOf = date => settings().days.indexOf(DAYS_ALL[parseYmd(date).getDay()]);
const fmtDay = date => parseYmd(date).toLocaleDateString(isEn ? "en-GB" : "ar-OM", { weekday: "long", day: "numeric", month: "long" });
// الغيابات في تاريخ معيّن: teacherId -> null (يوم كامل) أو Set للحصص
function absentOn(date) {
  const m = new Map();
  for (const a of SUB.abs) if (a.from <= date && date <= (a.to || a.from)) {
    if (!a.periods) m.set(a.teacherId, null);
    else if (m.get(a.teacherId) !== null) { const st = m.get(a.teacherId) || new Set(); a.periods.forEach(p => st.add(p)); m.set(a.teacherId, st); }
  }
  return m;
}
const isAbsent = (abs, t, p) => abs.has(t) && (abs.get(t) === null || abs.get(t).has(p));
// الحصص التي تحتاج بديلًا في تاريخ معيّن
function neededOn(date) {
  const d = dayIdxOf(date); if (d < 0) return [];
  const abs = absentOn(date);
  return placedOf(TT.saved).filter(x => x.d === d && isAbsent(abs, x.t, x.p)).sort((a, b) => a.p - b.p || secLabel(section(a.c)).localeCompare(secLabel(section(b.c))));
}
const subKey = x => `${x.p}|${x.c}|${x.absent}`;
// عدد حصص الاحتياط لكل معلم منذ بداية الفصل (بدون اليوم المحدد)
function subCounts(exceptDate) {
  const cfg = subCfg(), m = new Map();
  for (const [date, doc_] of SUB.days) {
    if (date === exceptDate || (cfg.termStart && date < cfg.termStart)) continue;
    for (const it of doc_.items || []) if (it.t) m.set(it.t, (m.get(it.t) || 0) + 1);
  }
  return m;
}
// المعلمون المتاحون لحصة معيّنة مع ترتيبهم
function candidates(date, need, items) {
  const d = dayIdxOf(date), { P } = ttDims(), rules = ttRules(), abs = absentOn(date), cfg = subCfg();
  const busy = new Set(placedOf(TT.saved).filter(x => x.d === d).map(x => `${x.t}@${x.p}`));
  const counts = subCounts(date), today = new Map();
  for (const it of items) if (it.t) today.set(it.t, (today.get(it.t) || 0) + 1);
  const takenAt = new Set(items.filter(it => it.t && it.p === need.p && subKey(it) !== subKey(need)).map(it => it.t));
  const lessonsToday = t => placedOf(TT.saved).filter(x => x.d === d && x.t === t).length;
  const subOf = t => new Set([teacherOf(t)?.subjectId, ...(teacherOf(t)?.assignments || []).map(a => a.subjectId)]);
  const out = [];
  for (const t of S.teachers) {
    if (cfg.exclude.includes(t.id) || t.id === need.absent) continue;
    if (busy.has(`${t.id}@${need.p}`) || isAbsent(abs, t.id, need.p) || takenAt.has(t.id)) continue;
    const r = rules.teachers[t.id], sl = d * P + need.p;
    if (r?.unavail?.has(sl) || r?.meetings?.has(sl)) continue;
    const n = counts.get(t.id) || 0, nt = today.get(t.id) || 0;
    const same = subOf(t.id).has(need.s);
    out.push({ t, n, nt, same, full: nt >= cfg.dailyMax, score: n - (same ? 1.5 : 0) + nt * 0.5 + lessonsToday(t.id) * 0.05 });
  }
  return out.sort((a, b) => a.full - b.full || a.score - b.score || a.t.name.localeCompare(b.t.name, "ar"));
}
function dayItems(date) {
  const saved = SUB.days.get(date)?.items || [];
  const map = new Map(saved.map(it => [subKey(it), it]));
  return neededOn(date).map(x => {
    const k = { p: x.p, c: x.c, s: x.s, absent: x.t };
    return { ...k, ...(map.get(subKey(k)) || {}), p: x.p, c: x.c, s: x.s, absent: x.t };
  });
}
async function saveDay(date, items) {
  SUB.saving = true;
  try {
    await setDoc(doc(db, "schools", SID, "subs", date), { date, items: items.map(it => ({ p: it.p, c: it.c, s: it.s, absent: it.absent, t: it.t || "", sent: it.sent || "" })), updatedAt: Date.now() });
  } catch (e) { toast(errMsg(e), "error"); }
  SUB.saving = false;
}
function vSubs() {
  if (!SUB.date) SUB.date = ymd(new Date());
  return `<div class="page-title"><h1>${tr("الاحتياط")}</h1>
    <div class="row-actions"><button class="btn primary" id="absAdd">+ ${tr("تسجيل غياب")}</button></div></div>
    <div class="card sub-date">
      <button class="icon-btn" id="subPrev"><span data-ic="${isEn ? "chevL" : "chevR"}" data-size="18"></span></button>
      <div class="sd-mid"><input type="date" id="subDate" value="${SUB.date}"><b id="subDayName"></b></div>
      <button class="icon-btn" id="subNext"><span data-ic="${isEn ? "chevR" : "chevL"}" data-size="18"></span></button>
    </div>
    <div id="subBody"></div>
    <div class="card" data-fold="subLog" data-sum=""><h3>${tr("سجل الاحتياط والإعدادات")}</h3><div id="subLog"></div></div>`;
}
function subsRedraw() {
  const box = $("subBody"); if (!box) return;
  const date = SUB.date, d = dayIdxOf(date), cfg = subCfg();
  $("subDayName").textContent = fmtDay(date) + (date === ymd(new Date()) ? ` · ${tr("اليوم")}` : "");
  const abs = SUB.abs.filter(a => a.from <= date && date <= (a.to || a.from));
  const items = d < 0 ? [] : dayItems(date);
  const filled = items.filter(it => it.t).length, unsent = items.filter(it => it.t && it.sent !== it.t).length;
  const counts = subCounts(date);
  const reasonL = { sick: "مرض", leave: "إجازة", official: "مهمة رسمية", training: "تدريب", other: "أخرى" };
  box.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${tr("الغائبون")}</h3><span class="muted">${esc(tf("{0} معلم", abs.length))}</span></div>
    ${abs.length ? `<div class="abs-list">${abs.map(a => `<div class="abs-row">
      <div><b data-no-i18n>${esc(teacherOf(a.teacherId)?.name || "؟")}</b>
        <small class="muted">${esc(a.periods ? tf("الحصص {0}", a.periods.map(p => p + 1).join("، ")) : tr("يوم كامل"))}${a.to && a.to !== a.from ? ` · ${esc(tf("من {0} إلى {1}", a.from, a.to))}` : ""}${a.reason ? ` · ${esc(tr(reasonL[a.reason] || a.reason))}` : ""}</small></div>
      <button class="btn sm danger" data-del-abs="${a.id}">${tr("حذف")}</button></div>`).join("")}</div>`
      : `<p class="muted" style="margin:0">${d < 0 ? tr("ليس يوم دوام") : tr("لا يوجد غياب مسجّل في هذا اليوم")}</p>`}
  </div>
  ${daySwaps(date).length ? `<div class="card"><h3>${tr("تبديلات معتمدة لهذا اليوم")}</h3><div class="rq-list">${daySwaps(date).map(r => reqCard(r)).join("")}</div></div>` : ""}
  ${items.length ? `<div class="card">
    <div class="card-head"><h3>${tr("حصص الاحتياط")}</h3><span class="muted">${esc(tf("{0} من {1} حصة لها بديل", filled, items.length))}</span></div>
    <div class="row-actions" style="margin-bottom:.8rem">
      <button class="btn" id="subAuto"><span data-ic="magic" data-size="18"></span>${tr("توزيع الاحتياط تلقائيًا")}</button>
      <button class="btn primary" id="subSend" ${unsent ? "" : "disabled"}><span data-ic="bell" data-size="18"></span>${esc(unsent ? tf("اعتماد وإرسال ({0})", unsent) : tr("تم الإرسال"))}</button>
      <button class="btn" id="subPdf"><span data-ic="download" data-size="18"></span>${tr("تحميل PDF")}</button>
    </div>
    <div class="sub-list">${items.map((it, i) => {
      const cs = candidates(date, it, items), sb = subject(it.s);
      const cur = it.t && !cs.some(c => c.t.id === it.t) ? `<option value="${it.t}" selected>${esc(teacherOf(it.t)?.name || "؟")}</option>` : "";
      return `<div class="sub-row ${it.t ? (it.sent === it.t ? "sent" : "set") : "empty"}">
        <div class="sr-p"><b>${it.p + 1}</b><small>${esc(settings().periods[it.p]?.start || "")}</small></div>
        <div class="sr-m"><b><span class="dot" style="background:${sb?.color || "#999"}"></span> ${esc(secLabel(section(it.c)))} · ${esc(sb?.name || "")}</b>
          <small class="muted">${esc(tf("بدل {0}", teacherOf(it.absent)?.name || ""))}</small></div>
        <div class="sr-s">
          <select data-i="${i}"><option value="">— ${tr("اختر البديل")} —</option>${cur}${cs.map(c => `<option value="${c.t.id}" ${c.t.id === it.t ? "selected" : ""} ${c.full && c.t.id !== it.t ? "disabled" : ""}>${c.same ? "⭐ " : ""}${esc(c.t.name)} (${c.n}${c.nt ? ` · ${tf("{0} اليوم", c.nt)}` : ""})</option>`).join("")}</select>
          ${it.t ? `<span class="badge ${it.sent === it.t ? "ok" : "warn"}">${tr(it.sent === it.t ? "أُرسل" : "لم يُرسل")}</span>` : ""}
        </div></div>`;
    }).join("")}</div>
    <p class="muted sub-hint">${tr("⭐ معلم نفس المادة · الرقم بين القوسين = عدد احتياطاته منذ بداية الفصل")}</p>
  </div>` : ""}`;
  fillIcons(box);
  // السجل والإعدادات
  const log = $("subLog");
  if (log) {
    const all = subCounts(null), rows = S.teachers.map(t => ({ t, n: all.get(t.id) || 0 })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name, "ar"));
    log.innerHTML = `<div class="grid-2">
        <div class="field"><label>${tr("بداية الفصل الدراسي (لحساب العدل)")}</label><input type="date" id="subTerm" value="${esc(cfg.termStart)}"></div>
        <div class="field"><label>${tr("أقصى عدد حصص احتياط للمعلم في اليوم")}</label><input type="number" min="1" max="8" id="subMax" value="${cfg.dailyMax}"></div>
      </div>
      <div class="row-actions" style="margin-bottom:1rem"><button class="btn" id="subExcl">${esc(tf("المستثنون من الاحتياط ({0})", cfg.exclude.length))}</button><button class="btn primary" id="subCfgSave">${tr("حفظ")}</button>
        <button class="btn" id="subReport"><span data-ic="download" data-size="18"></span>${tr("تقرير PDF")}</button></div>
      <div class="sub-log">${rows.map(r => `<div><span data-no-i18n>${esc(r.t.name)}</span><b>${r.n}</b></div>`).join("")}</div>`;
    fillIcons(log);
  }
  bindSubs();
}
function bindSubs() {
  const date = SUB.date;
  document.querySelectorAll("[data-del-abs]").forEach(b => (b.onclick = async () => {
    if (!(await confirmBox(tr("حذف هذا الغياب؟"), tr("حذف")))) return;
    try { await deleteDoc(dref("absences", b.dataset.delAbs)); } catch (e) { toast(errMsg(e), "error"); }
  }));
  const items = dayIdxOf(date) < 0 ? [] : dayItems(date);
  document.querySelectorAll(".sub-list select").forEach(sel => (sel.onchange = async () => {
    items[+sel.dataset.i].t = sel.value; await saveDay(date, items); subsRedraw();
  }));
  if ($("subAuto")) $("subAuto").onclick = async () => {
    const work = items.map(it => ({ ...it }));
    for (const it of work) {
      if (it.t && it.sent === it.t) continue; // لا نغيّر ما أُرسل
      it.t = "";
      const c = candidates(date, it, work).find(x => !x.full);
      if (c) it.t = c.t.id;
    }
    await saveDay(date, work); subsRedraw();
    const miss = work.filter(x => !x.t).length;
    toast(miss ? tf("لم نجد بديلًا متاحًا لـ {0} حصة", miss) : tr("تم توزيع الاحتياط ✅"), miss ? "error" : "success");
  };
  if ($("subSend")) $("subSend").onclick = () => sendSubs(date, items);
  if ($("subPdf")) $("subPdf").onclick = () => subsPdf(date, items);
  if ($("subCfgSave")) $("subCfgSave").onclick = async () => {
    const cfg = { ...subCfg(), termStart: $("subTerm").value, dailyMax: Math.max(1, num($("subMax").value) || 2) };
    try { await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), subs: cfg }, updatedAt: serverTimestamp() }); toast(tr("تم الحفظ"), "success"); } catch (e) { toast(errMsg(e), "error"); }
  };
  if ($("subExcl")) $("subExcl").onclick = exclModal;
  if ($("subReport")) $("subReport").onclick = subsReport;
}
function exclModal() {
  const cfg = subCfg(), ex = new Set(cfg.exclude);
  openModal(`${modalHead(tr("المستثنون من الاحتياط"))}
    <input type="search" id="exQ" placeholder="${esc(tr("بحث..."))}" style="margin-bottom:.6rem">
    <div class="ex-list">${S.teachers.map(t => `<label class="check" data-q="${esc(norm(t.name))}"><input type="checkbox" value="${t.id}" ${ex.has(t.id) ? "checked" : ""}> <span data-no-i18n>${esc(t.name)}</span></label>`).join("")}</div>
    <div class="modal-actions"><button class="btn primary" id="exSave">${tr("حفظ")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  $("exQ").oninput = e => { const w = norm(e.target.value); $("modal").querySelectorAll(".ex-list label").forEach(l => l.classList.toggle("hidden", !!w && !l.dataset.q.includes(w))); };
  $("exSave").onclick = async () => {
    const exclude = [...$("modal").querySelectorAll(".ex-list input:checked")].map(i => i.value);
    try { await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), subs: { ...subCfg(), exclude } }, updatedAt: serverTimestamp() }); closeModal(); toast(tr("تم الحفظ"), "success"); } catch (e) { toast(errMsg(e), "error"); }
  };
}
function absModal() {
  const P = settings().periods.length;
  openModal(`${modalHead(tr("تسجيل غياب"))}
    <form id="absForm">
      <div class="field"><label>${tr("المعلم")}</label><input type="search" id="absQ" placeholder="${esc(tr("ابحث بالاسم"))}" autocomplete="off">
        <select name="t" id="absT" size="5" required>${S.teachers.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div>
      <div class="grid-2">
        <div class="field"><label>${tr("من تاريخ")}</label><input type="date" name="from" value="${SUB.date}" required></div>
        <div class="field"><label>${tr("إلى تاريخ")}</label><input type="date" name="to" value="${SUB.date}" required></div>
      </div>
      <div class="field"><label>${tr("المدة")}</label>
        <div class="seg" id="absKind"><button type="button" data-k="day" class="active">${tr("يوم كامل")}</button><button type="button" data-k="per">${tr("حصص محددة")}</button></div>
        <div id="absPer" class="abs-per hidden">${Array.from({ length: P }, (_, p) => `<label class="check"><input type="checkbox" value="${p}"> ${p + 1}</label>`).join("")}</div></div>
      <div class="field"><label>${tr("السبب (اختياري)")}</label><select name="reason"><option value="">—</option>
        ${[["sick", "مرض"], ["leave", "إجازة"], ["official", "مهمة رسمية"], ["training", "تدريب"], ["other", "أخرى"]].map(([k, l]) => `<option value="${k}">${tr(l)}</option>`).join("")}</select></div>
      <div class="modal-actions"><button class="btn primary">${tr("حفظ")}</button><button type="button" class="btn ghost" data-close>${tr("إلغاء")}</button></div>
    </form>`);
  let kind = "day";
  $("absQ").oninput = e => { const w = norm(e.target.value); [...$("absT").options].forEach(o => (o.hidden = !!w && !norm(o.textContent).includes(w))); const f = [...$("absT").options].find(o => !o.hidden); if (f) $("absT").value = f.value; };
  $("absKind").onclick = e => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; $("absKind").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); $("absPer").classList.toggle("hidden", kind !== "per"); };
  $("absForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target, t = $("absT").value;
    if (!t) return toast(tr("اختر المعلم"), "error");
    const periods = kind === "per" ? [...$("absPer").querySelectorAll("input:checked")].map(i => +i.value) : null;
    if (kind === "per" && !periods.length) return toast(tr("اختر الحصص"), "error");
    const from = f.from.value, to = f.to.value < from ? from : f.to.value;
    try { await addDoc(col("absences"), { teacherId: t, from, to, periods, reason: f.reason.value, at: Date.now() }); closeModal(); toast(tr("تم تسجيل الغياب"), "success"); }
    catch (ex) { toast(errMsg(ex), "error"); }
  };
}
// اعتماد وإرسال: إشعار للمعلمين البدلاء (ومن أُلغي احتياطه)
async function sendSubs(date, items) {
  const prev = SUB.days.get(date)?.items || [];
  const out = [];
  const txt = it => `${fmtDay(date)} · ${tf("الحصة {0}", it.p + 1)} · ${secLabel(section(it.c))} ${subject(it.s)?.name || ""} (${tf("بدل {0}", shortName(teacherOf(it.absent)?.name))})`;
  for (const it of items) if (it.t && it.sent !== it.t) {
    out.push({ t: it.t, text: txt(it) });
    if (it.sent) out.push({ t: it.sent, text: txt(it), cancel: true });
  }
  for (const p of prev) if (p.sent && !items.some(it => subKey(it) === subKey(p) && it.t === p.sent) && !out.some(o => o.cancel && o.t === p.sent)) out.push({ t: p.sent, text: txt(p), cancel: true });
  const noAcc = [...new Set(out.filter(o => !o.cancel).map(o => o.t))].filter(t => !accOfTeacher(t));
  const b = writeBatch(db);
  b.set(doc(db, "schools", SID, "subs", date), { date, items: items.map(it => ({ p: it.p, c: it.c, s: it.s, absent: it.absent, t: it.t || "", sent: it.t || "" })), updatedAt: Date.now(), sentAt: Date.now() });
  if (out.length) b.set(doc(col("subNotices")), { date, items: out, at: Date.now() });
  try {
    await b.commit();
    toast(tf("تم إرسال الاحتياط لـ {0} معلمين", new Set(out.filter(o => !o.cancel).map(o => o.t)).size), "success");
    if (noAcc.length) {
      openModal(`${modalHead(tr("معلمون بدون حساب في المنصة"))}
        <p class="muted" style="margin-top:0">${tr("هؤلاء لن يصلهم إشعار. أرسل لهم عبر واتساب:")}</p>
        <div class="pub-list">${noAcc.map(t => { const tt = teacherOf(t), lines = out.filter(o => o.t === t && !o.cancel).map(o => o.text);
          return `<div class="pub-row" style="grid-template-columns:1fr auto"><div class="pub-main"><b data-no-i18n>${esc(tt?.name || "")}</b>${lines.map(l => `<small>${esc(l)}</small>`).join("")}</div>
          ${teacherPhone(tt) ? `<a class="wa-btn" target="_blank" href="https://wa.me/${waNumber(teacherPhone(tt))}?text=${encodeURIComponent(tf("السلام عليكم أستاذ {0}، لديك حصة احتياط:", shortName(tt?.name)) + "\n" + lines.join("\n"))}">${WA_ICON}</a>` : `<span class="badge info">${tr("لا يوجد رقم")}</span>`}</div>`; }).join("")}</div>
        <div class="modal-actions"><button class="btn ghost" data-close>${tr("إغلاق")}</button></div>`);
    }
  } catch (e) { toast(errMsg(e), "error"); }
}
async function subsPdf(date, items) {
  const rows = items.map(it => `<tr><td>${it.p + 1}</td><td>${esc(secLabel(section(it.c)))}</td><td>${esc(subject(it.s)?.name || "")}</td><td>${esc(teacherOf(it.absent)?.name || "")}</td><td><b>${esc(teacherOf(it.t)?.name || "—")}</b></td></tr>`).join("");
  const html = `<div class="doc-page" dir="${isEn ? "ltr" : "rtl"}"><div class="doc-head"><div><small>${esc(S.school.name)}</small><h2>${esc(tr("جدول الاحتياط"))}</h2><b>${esc(fmtDay(date))}</b></div></div>
    <table class="doc-tbl"><thead><tr><th>${tr("الحصة")}</th><th>${tr("الشعبة")}</th><th>${tr("المادة")}</th><th>${tr("المعلم الغائب")}</th><th>${tr("المعلم البديل")}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  try { toast(tr("جارٍ تجهيز الملف")); await downloadHtmlPDF(html, `${tr("جدول الاحتياط")} ${date}`); } catch { toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
}
async function subsReport() {
  const cfg = subCfg(), all = subCounts(null);
  const rows = S.teachers.map(t => ({ t, n: all.get(t.id) || 0 })).sort((a, b) => b.n - a.n || a.t.name.localeCompare(b.t.name, "ar"));
  const html = `<div class="doc-page" dir="${isEn ? "ltr" : "rtl"}"><div class="doc-head"><div><small>${esc(S.school.name)}</small><h2>${esc(tr("سجل الاحتياط"))}</h2><b>${esc(cfg.termStart ? tf("منذ {0}", cfg.termStart) : tr("كل الفترة"))}</b></div></div>
    <table class="doc-tbl"><thead><tr><th>#</th><th>${tr("المعلم")}</th><th>${tr("عدد حصص الاحتياط")}</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.t.name)}</td><td><b>${r.n}</b></td></tr>`).join("")}</tbody></table></div>`;
  try { toast(tr("جارٍ تجهيز الملف")); await downloadHtmlPDF(html, tr("سجل الاحتياط")); } catch { toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
}
BIND.subs = v => {
  fillIcons(v);
  foldCards(v, "subs");
  const go = dt => { SUB.date = dt; $("subDate").value = dt; subsRedraw(); };
  $("subDate").onchange = e => e.target.value && go(e.target.value);
  const step = k => { const d = parseYmd(SUB.date); d.setDate(d.getDate() + k); go(ymd(d)); };
  $("subPrev").onclick = () => step(isEn ? -1 : -1);
  $("subNext").onclick = () => step(1);
  $("absAdd").onclick = absModal;
  subsRedraw();
};


// ---------- التفريغ الجماعي للشعب ----------
// تجميع التفريغات الموجودة: لكل يوم، فترات متتالية وعدد الشعب التي فيها
function bulkGroups() {
  const st = settings(), P = st.periods.length, total = S.sections.length, out = [];
  for (let d = 0; d < st.days.length; d++) {
    const whole = S.sections.filter(x => (x.rules?.free || []).some(f => f.d === d && f.p === -1)).length;
    if (whole) out.push({ d, from: -1, to: -1, n: whole });
    let cur = null;
    for (let p = 0; p <= P; p++) {
      const n = p < P ? S.sections.filter(x => (x.rules?.free || []).some(f => f.d === d && (f.p === p))).length : 0;
      if (cur && n === cur.n) { cur.to = p; continue; }
      if (cur && cur.n) out.push(cur);
      cur = n ? { d, from: p, to: p, n } : null;
    }
  }
  return out.map(g => ({ ...g, all: g.n === total }));
}
const bulkLabel = g => `${tr(settings().days[g.d] || "")} · ${g.from === -1 ? tr("يوم كامل") : g.from === g.to ? tf("الحصة {0}", g.from + 1) : tf("الحصص {0}-{1}", g.from + 1, g.to + 1)}`;
function bulkSummary() { const g = bulkGroups().filter(x => x.all); return g.length ? g.map(bulkLabel).join("، ") : ""; }
function bulkListHTML() {
  const gs = bulkGroups(); if (!gs.length) return "";
  return `<h4>${tr("التفريغات الحالية")}</h4>${gs.map(g => `<div class="bf-row"><span>${esc(bulkLabel(g))} — <b>${esc(g.all ? tr("كل الشعب") : tf("{0} شعبة", g.n))}</b></span>
    <button class="btn sm danger" data-bf-del="${g.d}|${g.from}|${g.to}">${tr("إزالة")}</button></div>`).join("")}`;
}
// تطبيق أو إزالة تفريغ على مجموعة شعب
async function bulkFree(secs, d, from, to, remove) {
  const b = writeBatch(db); let n = 0, skipped = 0;
  for (const x of secs) {
    const r = x.rules || {}, free = [...(r.free || [])], days = r.days || [];
    let next;
    if (remove) {
      next = free.filter(f => !(f.d === d && (from === -1 ? f.p === -1 : f.p >= from && f.p <= to)));
    } else {
      if (days.some(o => o.d === d)) { skipped++; continue; } // يوم مخصص لمعلم في هذه الشعبة
      if (from === -1) next = [...free.filter(f => f.d !== d), { d, p: -1 }];
      else {
        if (free.some(f => f.d === d && f.p === -1)) continue; // اليوم فارغ أصلًا
        next = [...free]; for (let p = from; p <= to; p++) if (!next.some(f => f.d === d && f.p === p)) next.push({ d, p });
      }
    }
    if (JSON.stringify(next) === JSON.stringify(free)) continue;
    b.update(dref("sections", x.id), { rules: { ...r, free: next, days } }); n++;
  }
  if (n) await b.commit();
  return { n, skipped };
}
function bindBulkFree() {
  if (!$("bfApply")) return;
  let kind = "day";
  $("bfKind").onclick = e => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; $("bfKind").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); $("bfRange").classList.toggle("hidden", kind !== "range"); };
  const run = async remove => {
    const gids = new Set([...document.querySelectorAll(".bf-grades input:checked")].map(i => i.value));
    const secs = S.sections.filter(x => gids.has(x.gradeId));
    if (!secs.length) return toast(tr("اختر صفًا واحدًا على الأقل"), "error");
    const d = +$("bfDay").value; let from = -1, to = -1;
    if (kind === "range") { from = +$("bfFrom").value; to = +$("bfTo").value; if (to < from) [from, to] = [to, from]; }
    const label = bulkLabel({ d, from, to });
    if (!(await confirmBox(tf(remove ? "إزالة تفريغ «{0}» من {1} شعبة؟" : "تفريغ «{0}» لـ {1} شعبة؟", label, secs.length), tr(remove ? "إزالة" : "تطبيق"), remove))) return;
    try {
      const r = await bulkFree(secs, d, from, to, remove);
      toast(tf(remove ? "تمت الإزالة من {0} شعبة" : "تم التفريغ في {0} شعبة", r.n) + (r.skipped ? " · " + tf("تم تجاوز {0} شعبة لأن هذا اليوم مخصص فيها لمعلم", r.skipped) : ""), "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
  $("bfApply").onclick = () => run(false);
  $("bfRemove").onclick = () => run(true);
  $("bfList").onclick = async e => {
    const b = e.target.closest("[data-bf-del]"); if (!b) return;
    const [d, from, to] = b.dataset.bfDel.split("|").map(Number);
    if (!(await confirmBox(tf("إزالة تفريغ «{0}» من كل الشعب؟", bulkLabel({ d, from, to })), tr("إزالة")))) return;
    try { const r = await bulkFree(S.sections, d, from, to, true); toast(tf("تمت الإزالة من {0} شعبة", r.n), "success"); } catch (ex) { toast(errMsg(ex), "error"); }
  };
}


// =====================================================
//  ملف نور (XML) — تصدير الجدول بصيغة الوزارة
// =====================================================
async function saveNoorSource(src) {
  const gz = await gzipText(src.text);
  if (gz.length > 900000) throw new Error("too-big");
  await setDoc(doc(db, "schools", SID, "noor", "source"), { gz, name: src.name || "", encoding: src.encoding || "windows-1256", size: src.text.length, at: Date.now() });
}
async function noorExport() {
  ttSync();
  let src;
  try { const d = await getDoc(doc(db, "schools", SID, "noor", "source")); src = d.exists() ? d.data() : null; } catch (e) { return toast(errMsg(e), "error"); }
  if (!src) {
    return openModal(`${modalHead(tr("ملف نور (XML)"))}
      <p>${tr("لتصدير ملف نور تحتاج المنصة ملف الوزارة الأصلي مرة واحدة، لأن فيه أرقام المعلمين والشعب والطلاب كما في نظام الوزارة.")}</p>
      <ol class="noor-steps"><li>${tr("استورد ملف XML الخاص بمدرستك (الذي يُرفع على نور) من: إعدادات الدوام ← استيراد البيانات.")}</li>
      <li>${tr("وزّع الجدول وعدّله كما تريد.")}</li><li>${tr("ثم صدّر ملف نور من هنا وارفعه على البوابة.")}</li></ol>
      <div class="modal-actions"><a class="btn primary" href="#settings" data-close>${tr("الذهاب للاستيراد")}</a><button class="btn ghost" data-close>${tr("إغلاق")}</button></div>`);
  }
  let text;
  try { text = await gunzipText(src.gz); } catch { return toast(tr("تعذّر قراءة ملف الوزارة المحفوظ"), "error"); }
  const lessons = TT.lessons || TT.saved || [];
  const unplaced = lessons.filter(x => x.d == null).length;
  const noExt = { t: new Set(), c: new Set() };
  const placed = [];
  for (const x of lessons) {
    if (x.d == null) continue;
    const t = teacherOf(x.t), c = section(x.c), sb = subject(x.s);
    if (!t?.extId) { noExt.t.add(x.t); continue; }
    if (!c?.extId) { noExt.c.add(x.c); continue; }
    if (!sb?.extId) continue;
    placed.push({ t: t.extId, s: sb.extId, c: c.extId, d: x.d, p: x.p });
  }
  const r = buildNoorXml(text, placed, src.encoding);
  if (r.error) return toast(tr("لا توجد حصص تخص شعب ملف الوزارة"), "error");
  const warn = [...r.warnings];
  if (unplaced) warn.unshift(tf("{0} حصة لم توزّع بعد — وزّعها قبل الرفع", unplaced));
  if (noExt.t.size) warn.push(tf("{0} معلم بدون رقم وزارة (أُضيف يدويًا) — حصصه لم تُضمَّن", noExt.t.size));
  const name = (src.name || "TimeTable").replace(/\.xml$/i, "") + ".xml";
  openModal(`${modalHead(tr("تصدير ملف نور (XML)"))}
    <div class="imp-stats"><div><b>${r.stats.lessons}</b><span>${tr("حصة")}</span></div><div><b>${r.stats.sections}</b><span>${tr("شعبة")}</span></div><div><b>${r.stats.teachers}</b><span>${tr("معلم")}</span></div></div>
    ${warn.length ? `<div class="notice warn"><b>${tr("ملاحظات")}:</b><ul>${warn.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : `<div class="notice ok">${tr("الملف جاهز. باقي بيانات ملف الوزارة (الطلاب والمجموعات والأرقام) بقيت كما هي.")}</div>`}
    <p class="muted" style="font-size:.85rem">${tr("ارفع الملف على بوابة الوزارة كما كنت ترفع ملف aSc.")}</p>
    <div class="modal-actions"><button class="btn primary" id="noorDl"><span data-ic="download" data-size="18"></span>${tr("تحميل الملف")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  fillIcons($("modal"));
  $("noorDl").onclick = () => {
    const url = URL.createObjectURL(new Blob([r.bytes], { type: "application/xml" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    closeModal(); toast(tr("تم تحميل ملف نور"), "success");
  };
}

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

  const secById = new Map(S.sections.map(x => [x.id, x]));
  const tItems = S.teachers.map(t => {
    const l = load(t), max = num(t.maxLoad) || 0, pct = max ? Math.min(100, (l / max) * 100) : 0;
    const k = !max ? "none" : l > max ? "bad" : l < max ? "warn" : "ok";
    const st = k === "bad" ? `<span class="badge bad">${esc(tf("زائد {0}", l - max))}</span>` : k === "warn" ? `<span class="badge warn">${esc(tf("ناقص {0}", max - l))}</span>` : k === "ok" ? `<span class="badge ok">مكتمل</span>` : "";
    const subs = [...new Set([t.subjectId, ...(t.assignments || []).map(a => a.subjectId)])].map(id => subject(id)?.name).filter(Boolean);
    const secs = [...new Set((t.assignments || []).map(a => a.sectionId))].map(id => secById.get(id)).filter(Boolean).map(secLabel);
    const q = norm([t.name, ...subs, ...secs].join(" "));
    return { k, q, html: `<div class="ld-row" data-k="${k}" data-q="${esc(q)}">
      <div class="ld-main" dir="auto"><b data-no-i18n dir="auto">${esc(t.name)}</b><small>${esc(subs[0] || "—")}${secs.length ? ` · <span data-no-i18n>${esc(secs.slice(0, 6).join("، "))}${secs.length > 6 ? "…" : ""}</span>` : ""}</small></div>
      <div class="ld-side"><span class="ld-n">${l}/${max || "-"}</span>${st}</div>
      <div class="load-bar ${k === "bad" ? "over" : ""}"><i style="width:${pct}%"></i></div></div>` };
  });

  const cap = capacity();
  const sItems = S.sections.map(sec => {
    const req = S.subjects.reduce((a, s) => a + num(s.periods?.[sec.gradeId]), 0);
    const asg = assignedFor(sec.id);
    const missing = S.subjects.filter(s => num(s.periods?.[sec.gradeId]) > 0)
      .map(s => ({ s, need: num(s.periods[sec.gradeId]), have: asg.bySub[s.id] || 0 }))
      .filter(x => x.have < x.need);
    const k = asg.total > cap ? "bad" : missing.length ? "warn" : req ? "ok" : "none";
    const st = k === "bad" ? `<span class="badge bad">${esc(tf("يتجاوز {0}", cap))}</span>` : k === "warn" ? `<span class="badge warn">ناقص</span>` : k === "ok" ? `<span class="badge ok">مكتمل</span>` : "";
    const pct = req ? Math.min(100, asg.total / req * 100) : 0;
    const q = norm([secLabel(sec), S.grades.find(g => g.id === sec.gradeId)?.name, ...missing.map(m => m.s.name)].join(" "));
    return { k, q, html: `<div class="ld-row" data-k="${k}" data-q="${esc(q)}">
      <div class="ld-main"><b data-no-i18n>${esc(secLabel(sec))}</b><small>${missing.length ? missing.map(m => `${esc(m.s.name)} ${m.have}/${m.need}`).join("، ") : esc(tr("كل المواد مُسندة"))}</small></div>
      <div class="ld-side"><span class="ld-n">${asg.total}/${req}</span>${st}</div>
      <div class="load-bar ${k === "bad" ? "over" : ""}"><i style="width:${pct}%"></i></div></div>` };
  });

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
  ${S.teachers.length ? ldBlock("ldT", "نصاب المعلمين", tf("{0} أيام × {1} حصص = {2} حصة أسبوعيًا لكل شعبة", settings().days.length, settings().periods.length, cap), "ابحث باسم المعلم أو المادة أو الشعبة", tItems)
    : `<div class="card"><h3>نصاب المعلمين</h3><div class="empty">لم يتم إضافة معلمين بعد</div></div>`}
  ${S.sections.length ? ldBlock("ldS", "تغطية الشعب", "هل كل مواد الشعبة مُسندة لمعلمين؟", "ابحث بالشعبة أو الصف أو المادة الناقصة", sItems)
    : `<div class="card"><h3>تغطية الشعب</h3><div class="empty">لم يتم إضافة شعب بعد</div></div>`}`;
}
// بطاقة قابلة للطي: ملخص بالأعداد، وعند الفتح بحث + فلاتر + قائمة بارتفاع محدود
function ldBlock(id, title, sub, ph, items) {
  const cnt = k => items.filter(x => k === "all" || x.k === k).length;
  const open = (() => { try { return localStorage.getItem("ov_" + id) === "1"; } catch { return false; } })();
  const sum = [["warn", "ناقص"], ["ok", "مكتمل"], ["bad", "زائد"]].filter(([k]) => cnt(k)).map(([k, n]) => `<span class="badge ${k}">${esc(tr(n))} ${cnt(k)}</span>`).join("");
  return `<div class="card ld-card ${open ? "open" : ""}" data-ld="${id}">
    <button class="ld-head" type="button" aria-expanded="${open}">
      <div><h3>${esc(tr(title))}</h3><span class="muted">${esc(sub)}</span></div>
      <div class="ld-sum">${sum}<span class="ld-chev"></span></div>
    </button>
    <div class="ld-body">
      <div class="ld-tools">
        <input type="search" class="ld-q" placeholder="${esc(tr(ph))}" autocomplete="off">
        <div class="ld-filters">
          ${[["all", "الكل"], ["warn", "ناقص"], ["ok", "مكتمل"], ["bad", "زائد"]].filter(([k]) => k !== "bad" || cnt(k)).map(([k, n]) => `<button type="button" data-k="${k}" class="${k === "all" ? "on" : ""}">${n} <span>${cnt(k)}</span></button>`).join("")}
        </div></div>
      <div class="ld-count muted"></div>
      <div class="ld-list">${items.map(x => x.html).join("")}</div>
      <div class="empty hidden ld-empty">لا توجد نتائج</div>
    </div>
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
  <div class="card" data-fold="days" data-sum="${esc(tf("{0} أيام", st.days.length))}">
    <h3>أيام الدوام</h3>
    <div style="display:flex;flex-wrap:wrap;gap:.6rem 1.4rem" id="daysBox">
      ${DAYS_ALL.map(d => `<label class="check"><input type="checkbox" value="${d}" ${st.days.includes(d) ? "checked" : ""}> ${d}</label>`).join("")}
    </div>
  </div>
  <div class="card" data-fold="periods" data-sum="${esc(tf("{0} حصص يوميًا", (st.periods || []).length))}">
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
  <div class="card" id="rulesCard" data-fold="rules">
    <h3>قيود التوزيع العامة</h3>
    <p class="muted" style="margin-top:0">تطبّق على جميع المعلمين عند التوزيع التلقائي، ويمكن تخصيصها لكل معلم من نافذة المعلم.</p>
    <label>حصص فارغة لجميع المعلمين <small class="muted">(${tr("لا توضع فيها أي حصة")})</small></label>
    <div id="freeBox"></div>
    <label style="margin-top:1rem">${tr("الحد العام: أقصى عدد مرات لكل حصة للمعلم في الأسبوع")} <small class="muted">(${tr("فارغ = بدون حد")})</small></label>
    <div class="pmax-grid">${st.periods.map((_, p) => `<label class="pmax"><span>${tf("الحصة {0}", p + 1)}</span><input type="number" min="0" max="${st.days.length}" data-gpm="${p}" value="${st.periodMax?.[p] ?? ""}" placeholder="∞"></label>`).join("")}</div>
    <div class="field" style="margin-top:.8rem;max-width:280px"><label>${tr("أقصى عدد حصص متتالية لأي معلم")}</label><input type="number" id="gMaxRun" min="1" max="8" value="${st.maxRun || ""}" placeholder="∞"></div>
    <div class="modal-actions"><button class="btn primary" id="saveRules">💾 ${tr("حفظ قيود التوزيع")}</button></div>
  </div>
  <div class="card" data-fold="school" data-sum="${esc(s.name || "")}">
    <h3>بيانات المدرسة</h3>
    <form id="infoForm">
      <div class="field"><label>اسم المدرسة</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="grid-2">
        <div class="field"><label>المحافظة</label><select name="region" id="stGov">${govOptions(s.region || "", tr("— اختر المحافظة —"))}</select></div>
        <div class="field"><label>الولاية</label><select name="wilayah" id="stWil">${wilOptions(s.region || "", s.wilayah || "", tr("— اختر الولاية —"))}</select></div>
        <div class="field"><label>اسم المسؤول</label><input name="principal" value="${esc(s.principal)}"></div>
        <div class="field"><label>رقم الهاتف</label><input name="phone" dir="ltr" value="${esc(s.phone)}"></div>
      </div>
      <div class="field"><label>المراحل الدراسية</label><input name="stages" value="${esc(s.stages)}"></div>
      <button class="btn primary">💾 حفظ بيانات المدرسة</button>
    </form>
  </div>
  <div class="card" data-fold="import" data-sum="${esc(tr("Excel أو PDF أو XML"))}">
    <h3>استيراد البيانات</h3>
    <p class="muted" style="margin-top:0">استورد المعلمين والصفوف والشعب والمواد دفعة واحدة من ملف Excel (سطر لكل معلم ومادة وشعبة)، أو من ملف PDF لجداول المعلمين أو «الجدول العام للمعلمين»، أو من ملف XML المُصدَّر من برنامج aSc (ينقل الجدول كاملًا كما هو).</p>
    <ul class="imp-kinds"><li><b>XML</b> — ${tr("ملف نور/aSc: ينقل الجدول كاملًا ويسمح بتصدير ملف نور بعد التعديل.")}</li>
      <li><b>PDF</b> — ${tr("جداول المعلمين الفردية، أو «الجدول العام للمعلمين» (صفحة واحدة لكل المعلمين) وتختار مادة كل معلم بعد القراءة.")}</li>
      <li><b>Excel</b> — ${tr("سطر لكل معلم ومادة وشعبة (حمّل النموذج).")}</li></ul>
    <div class="field"><label>ملف Excel أو PDF أو XML</label><input type="file" id="impFile" accept=".xlsx,.xls,.csv,.pdf,.xml,text/xml,application/xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"><div class="imp-picked hidden" id="impPicked"></div></div>
    <p class="muted imp-hint">ملف Excel: الأعمدة هي المعلم، المادة، الشعبة (مثل 5/12)، عدد الحصص، ورقم الجوال والنصاب اختياريًا. <a href="#" id="xlsTpl">تحميل نموذج Excel</a></p>
    <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="impReplace" checked> حذف البيانات الحالية قبل الاستيراد</label>
    <div class="row-actions">
      <button class="btn primary" id="impBtn"><span data-ic="upload" data-size="18"></span>استيراد</button>
    </div>
    <div class="wipe-box">
      <div><b>${tr("حذف البيانات المستوردة")}</b><p class="muted">${tr("احذف الجداول فقط، أو احذف كل شيء لتبدأ من جديد أو تستورد ملفًا آخر.")}</p></div>
      <button class="btn danger" id="wipeBtn"><span data-ic="trash" data-size="18"></span>${tr("حذف البيانات")}</button>
    </div>
  </div>
  <div class="card" data-fold="pdf" data-sum="PDF">
    <h3>تحميل الجداول</h3>
    <p class="muted" style="margin-top:0">ملف PDF واحد فيه كل الجداول، 6 جداول في كل صفحة.</p>
    <div class="row-actions">
      <button class="btn" id="expPdfT"><span data-ic="download" data-size="18"></span>تحميل جداول المعلمين PDF</button>
      <button class="btn" id="expPdfS"><span data-ic="download" data-size="18"></span>تحميل جداول الشعب PDF</button>
      <button class="btn" id="expNoor"><span data-ic="upload" data-size="18"></span>${tr("تصدير ملف نور (XML)")}</button>
    </div>
  </div>`;
}
BIND.overview = v => {
  fillIcons(v);
  v.querySelectorAll("[data-ld]").forEach(card => {
    const id = card.dataset.ld, rows = [...card.querySelectorAll(".ld-row")];
    const q = card.querySelector(".ld-q"), empty = card.querySelector(".ld-empty"), count = card.querySelector(".ld-count");
    let k = "all";
    card.querySelector(".ld-head").onclick = () => {
      const o = card.classList.toggle("open");
      card.querySelector(".ld-head").setAttribute("aria-expanded", o);
      try { localStorage.setItem("ov_" + id, o ? "1" : "0"); } catch {}
    };
    const apply = () => {
      const words = norm(q.value).split(" ").filter(Boolean);
      let n = 0;
      for (const r of rows) {
        const ok = (k === "all" || r.dataset.k === k) && words.every(w => r.dataset.q.includes(w));
        r.classList.toggle("hidden", !ok); if (ok) n++;
      }
      empty.classList.toggle("hidden", n > 0);
      count.textContent = words.length || k !== "all" ? tf("{0} نتيجة", n) : "";
      card.querySelector(".ld-list").scrollTop = 0;
    };
    q.addEventListener("input", apply); q.addEventListener("search", apply); q.addEventListener("keyup", apply);
    card.querySelector(".ld-filters").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      k = b.dataset.k;
      card.querySelectorAll(".ld-filters button").forEach(x => x.classList.toggle("on", x === b)); apply();
    };
  });
};
function cleanSettings() {
  const st = settings();
  const o = { days: st.days, periods: st.periods };
  if (st.freeAll) o.freeAll = st.freeAll;
  if (st.periodMax) o.periodMax = st.periodMax;
  if (st.maxRun) o.maxRun = st.maxRun;
  if (st.subs) o.subs = st.subs;
  if (st.halfBalance) o.halfBalance = true;
  return o;
}
// تحويل البطاقات التي تحمل data-fold إلى أقسام قابلة للطي (العنوان يفتح ويغلق، والحالة تُحفظ)
function foldCards(root, page, defaults = []) {
  const key = "fold_" + page;
  let open; try { const v = localStorage.getItem(key); open = new Set(v ? JSON.parse(v) : defaults); } catch { open = new Set(defaults); }
  root.querySelectorAll(".card[data-fold]").forEach(card => {
    const h = card.querySelector(":scope > h3"); if (!h || card.querySelector(":scope > .fold-head")) return;
    const id = card.dataset.fold;
    const head = document.createElement("button");
    head.type = "button"; head.className = "fold-head";
    head.innerHTML = `<span class="fold-t"></span><span class="fold-sum">${card.dataset.sum ? `<span class="muted" data-no-i18n>${esc(card.dataset.sum)}</span>` : ""}<span class="ld-chev"></span></span>`;
    head.querySelector(".fold-t").appendChild(h);
    const body = document.createElement("div"); body.className = "fold-body";
    while (card.firstChild) body.appendChild(card.firstChild);
    card.append(head, body);
    card.classList.add("fold"); card.classList.toggle("open", open.has(id));
    head.setAttribute("aria-expanded", open.has(id));
    head.onclick = () => {
      const o = card.classList.toggle("open"); head.setAttribute("aria-expanded", o);
      if (o) open.add(id); else open.delete(id);
      try { localStorage.setItem(key, JSON.stringify([...open])); } catch {}
    };
  });
}
BIND.settings = v => {
  foldCards(v, "settings");
  if ($("stGov")) linkGovWil($("stGov"), $("stWil"), tr("— اختر الولاية —"));
  const freeAll = (settings().freeAll || []).map(m => ({ ...m }));
  const drawFree = () => { $("freeBox").innerHTML = slotPicker("freeList", freeAll); bindSlots($("freeBox"), freeAll, drawFree); };
  drawFree();
  $("saveRules").onclick = async () => {
    const pm = {};
    v.querySelectorAll("[data-gpm]").forEach(i => { if (i.value !== "") pm[i.dataset.gpm] = Math.max(0, num(i.value)); });
    const mr = $("gMaxRun").value === "" ? 0 : Math.max(1, num($("gMaxRun").value));
    try {
      await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), freeAll, periodMax: pm, maxRun: mr }, updatedAt: serverTimestamp() });
      toast("تم حفظ قيود التوزيع", "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
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
      await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), days, periods: draftPeriods }, updatedAt: serverTimestamp() });
      toast("تم حفظ إعدادات الدوام", "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
  fillIcons(v);
  // الملف المختار يُحفظ هنا، لأن الصفحة قد تُعاد رسمها (تحديث بيانات) بعد اختيار الملف فيُفقد من الحقل
  $("impFile").onchange = e => { IMP_FILE = e.target.files[0] || null; showImpFile(); };
  showImpFile();
  $("impBtn").onclick = async () => {
    const f = $("impFile").files[0] || IMP_FILE;
    if (!f) return toast("اختر ملف البيانات أولًا", "error");
    const replace = $("impReplace").checked;
    let data, warnings = [], extra = "";
    // نوع الملف من محتواه (بعض الجوالات تحفظ الملف بدون امتداد)
    const kind = await fileKind(f);
    if (kind === "pdf") {
      openModal(`<div class="gen-box"><div class="spinner"></div><h3>${tr("جارٍ قراءة ملف PDF")}</h3><div class="progress"><i id="pdfBar"></i></div></div>`);
      $("modalBack").dataset.lock = "1";
      try {
        const pages = await readPdfPages(f, r => { const b = $("pdfBar"); if (b) b.style.width = Math.round(r * 100) + "%"; });
        let parsed = parseGeneralPages(pages), general = !!parsed;
        if (general) {
          // الجدول العام لا يذكر المادة: نطلب مادة كل معلم
          delete $("modalBack").dataset.lock; closeModal();
          const map = await generalSubjectsModal(parsed.owners.map(o => o.name));
          if (!map) return;
          applyGeneralSubjects(parsed, n => map.get(n));
        } else parsed = parseTimetablePages(pages);
        const r = buildImport(parsed, settings());
        data = r.data; warnings = r.warnings;
        extra = general ? tf("«الجدول العام للمعلمين»: {0} معلم، {1} حصة.", r.data.teachers.length, r.data.timetable.length) : tf("تمت قراءة {0} جدول من {1} صفحة.", r.stats.grids, r.stats.pages);
      } catch (ex) { console.error(ex); }
      delete $("modalBack").dataset.lock; closeModal();
      if (!data || !data.timetable?.length) return toast("لم يتم العثور على جداول يمكن قراءتها في هذا الملف. تأكد أن الملف PDF نصي (غير ممسوح ضوئيًا) ويحتوي جداول المعلمين.", "error");
    } else if (kind === "excel") {
      let r;
      try { toast(tr("جارٍ قراءة الملف")); r = await parseExcel(f); } catch (ex) { console.error(ex); return toast("تعذّر قراءة ملف Excel", "error"); }
      if (r.error === "header") return toast("لم نجد أعمدة «المعلم» و«المادة» و«الشعبة» في الملف. حمّل النموذج واستخدمه.", "error");
      if (r.error) return toast("لا توجد بيانات صالحة في الملف", "error");
      data = r.data; warnings = r.warnings;
      extra = tf("تمت قراءة {0} سطر من ورقة «{1}». بعد الاستيراد اضغط «توزيع تلقائي» في صفحة الجدول.", r.stats.rows, r.stats.sheet);
    } else if (kind === "xml") {
      let r;
      try { toast(tr("جارٍ قراءة الملف")); r = await parseAscXml(f, settings()); } catch (ex) { console.error(ex); return toast(tr("تعذّر قراءة ملف XML"), "error"); }
      if (r.error) return toast(tr(r.error === "empty" ? "لا توجد حصص في الملف" : "هذا ليس ملف XML من برنامج aSc Timetables"), "error");
      data = r.data; warnings = r.warnings;
      extra = tf("ملف aSc: {0} حصة موزعة في {1} شعبة، و{2} معلم. سيُنقل الجدول كما هو.", r.stats.lessons, r.stats.sections, r.stats.teachers);
    } else return toast("اختر ملف Excel أو PDF أو XML", "error");
    const ok = await importPreview(data, warnings, extra, replace);
    if (ok) await importData(data, replace);
  };
  $("xlsTpl").onclick = e => { e.preventDefault(); downloadTemplate(null, tr("نموذج بيانات المدرسة")).catch(() => toast("تعذّر إنشاء الملف", "error")); };
  $("expPdfT").onclick = () => downloadAll("teacher");
  $("expNoor").onclick = noorExport;
  $("wipeBtn").onclick = wipeModal;
  $("expPdfS").onclick = () => downloadAll("section");
  $("infoForm").onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    for (const k in d) d[k] = d[k].trim();
    if (!d.name) return toast("اسم المدرسة مطلوب", "error");
    try { await updateDoc(doc(db, "schools", SID), { ...d, updatedAt: serverTimestamp() }); toast("تم الحفظ", "success"); }
    catch (ex) { toast(errMsg(ex), "error"); }
  };
};

// الجدول العام: اختيار مادة كل معلم (يُعبّأ تلقائيًا لمن هو موجود مسبقًا بنفس الاسم)
function generalSubjectsModal(names) {
  return new Promise(resolve => {
    const known = new Map(S.teachers.map(t => [norm(t.name).replace(/\s+/g, ""), subject(t.subjectId)?.name || ""]));
    const pre = n => known.get(norm(n).replace(/\s+/g, "")) || "";
    const COMMON = ["التربية الإسلامية", "اللغة العربية", "اللغة الإنجليزية", "الرياضيات", "الفيزياء", "الكيمياء", "الأحياء", "العلوم", "الدراسات الاجتماعية", "هذا وطني", "تقنية المعلومات", "الرياضة المدرسية", "الفنون التشكيلية", "المهارات الموسيقية", "المهارات الحياتية"];
    const opts = [...new Set([...S.subjects.map(x => x.name), ...COMMON])];
    const filled = names.filter(pre).length;
    openModal(`${modalHead(tr("مادة كل معلم"))}
      <p class="muted" style="margin-top:0">${esc(tf("وجدنا «الجدول العام للمعلمين» فيه {0} معلم. هذا الجدول لا يذكر المواد، فاكتب أو اختر مادة كل معلم.", names.length))}${filled ? " " + esc(tf("عبّأنا {0} معلم تلقائيًا من بياناتك الحالية.", filled)) : ""}</p>
      <datalist id="gsList">${opts.map(o => `<option value="${esc(o)}">`).join("")}</datalist>
      <div class="gs-list">${names.map((n, i) => `<div class="gs-row"><b data-no-i18n>${esc(n)}</b><input list="gsList" data-gs="${i}" value="${esc(pre(n))}" placeholder="${tr("المادة")}"></div>`).join("")}</div>
      <p class="muted" style="font-size:.82rem">${tr("نصيحة: اضغط Enter بعد كتابة المادة للانتقال للمعلم التالي ونسخ نفس المادة له.")}</p>
      <div class="modal-actions"><button class="btn primary" id="gsGo">${tr("متابعة")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
    $("modal").querySelectorAll("[data-gs]").forEach(inp => inp.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && !inp.list?.options?.length) return;
      if (e.key === "Enter") { e.preventDefault(); const nx = $("modal").querySelector(`[data-gs="${+inp.dataset.gs + 1}"]`); if (nx) { if (!nx.value) nx.value = inp.value; nx.focus(); nx.select(); } }
    }));
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    $("gsGo").onclick = () => {
      const m = new Map(names.map((n, i) => [n, $("modal").querySelector(`[data-gs="${i}"]`).value.trim()]));
      const empty = [...m.values()].filter(v => !v).length;
      if (empty && !confirm(tf("{0} معلم بدون مادة — سيُستورد بمادة «غير محددة». متابعة؟", empty))) return;
      closeModal(); finish(m);
    };
    $("modal").querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => finish(null)));
  });
}
// ---------- الاستيراد والتصدير ----------
function importPreview(data, warnings, extra, replace) {
  return new Promise(resolve => {
    const n = k => (data[k] || []).length;
    openModal(`${modalHead(tr("مراجعة البيانات قبل الاستيراد"))}
      ${extra ? `<p class="muted" style="margin-top:0">${esc(extra)}</p>` : ""}
      <div class="tt-stats imp-stats">
        <div><b>${n("teachers")}</b><span>${tr("المعلمون")}</span></div>
        <div><b>${n("sections")}</b><span>${tr("الشعب")}</span></div>
        <div><b>${n("subjects")}</b><span>${tr("المواد")}</span></div>
        ${n("timetable") ? `<div><b>${n("timetable")}</b><span>${tr("حصص الجدول")}</span></div>` : `<div><b>${(data.teachers || []).reduce((a, t) => a + (t.assignments || []).reduce((x, y) => x + (+y.periods || 0), 0), 0)}</b><span>${tr("حصة مُسندة")}</span></div>`}
      </div>
      <p class="muted">${esc(tr("الصفوف"))}: ${(data.grades || []).map(g => esc(g.name)).join("، ")} · ${data.settings ? `${esc(tr("أيام الدوام"))}: ${(data.settings.days || []).length} · ${esc(tr("الحصص اليومية"))}: ${data.settings.periods?.length || data.settings.periodsCount || "-"}` : ""}</p>
      <details class="imp-more"><summary>${tr("المواد")}</summary><p>${(data.subjects || []).map(s => `<span class="chip"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join("")}</p></details>
      <details class="imp-more"><summary>${tr("المعلمون")}</summary><p>${(data.teachers || []).map(t => `<span class="chip">${esc(t.name)} <b>${t.maxLoad || ""}</b></span>`).join("")}</p></details>
      ${warnings.length ? `<div class="notice warn"><b>${tr("ملاحظات")}:</b><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      ${replace ? `<div class="notice bad">${tr("سيتم حذف البيانات الحالية أولًا.")}</div>` : ""}
      <div class="modal-actions"><button class="btn primary" data-go>${tr("استيراد")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
    const done = v => { $("modal").onclick = null; resolve(v); };
    $("modal").onclick = e => {
      if (e.target.closest("[data-go]")) { done(true); }
      else if (e.target.closest("[data-close]")) done(false);
    };
  });
}
function wipeModal() {
  const n = { t: S.teachers.length, c: S.sections.length, s: S.subjects.length, l: (TT.lessons || []).filter(x => x.d != null).length };
  if (!n.t && !n.c && !n.s) return toast(tr("لا توجد بيانات لحذفها"));
  const word = tr("حذف");
  openModal(`${modalHead(tr("حذف البيانات المستوردة"))}
    <div class="imp-stats"><div><b>${n.t}</b><span>${tr("معلم")}</span></div><div><b>${n.c}</b><span>${tr("شعبة")}</span></div><div><b>${n.s}</b><span>${tr("مادة")}</span></div><div><b>${n.l}</b><span>${tr("حصة")}</span></div></div>
    <div class="wipe-opts">
      <label class="wipe-opt"><input type="radio" name="wipeMode" value="tt" checked><div><b>${tr("حذف الجداول فقط")}</b><span>${tr("تفرغ كل الجداول وتبقى بيانات المعلمين والمواد والشعب والأقسام والصفوف وأنصبة الحصص، وتقدر توزّع من جديد.")}</span></div></label>
      <label class="wipe-opt"><input type="radio" name="wipeMode" value="all"><div><b>${tr("حذف كل شيء")}</b><span>${tr("المعلمين، الأقسام، الصفوف، الشعب، المواد، الجداول، ملف نور المحفوظ، وسجل الغياب والاحتياط. روابط جداول المعلمين المرسلة سابقًا ستتوقف.")}</span></div></label>
    </div>
    <p class="muted" style="font-size:.85rem">${tr("في الحالتين تبقى: بيانات المدرسة، أوقات الدوام والحصص، الاشتراك، وحسابات الدخول.")} <b>${tr("لا يمكن التراجع عن الحذف.")}</b></p>
    <div class="field"><label>${tf("للتأكيد اكتب كلمة «{0}»", word)}</label><input id="wipeWord" autocomplete="off"></div>
    <div class="modal-actions"><button class="btn danger" id="wipeGo" disabled><span data-ic="trash" data-size="18"></span>${tr("حذف نهائي")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  fillIcons($("modal"));
  $("wipeWord").oninput = e => { $("wipeGo").disabled = e.target.value.trim() !== word; };
  $("wipeGo").onclick = async () => {
    $("wipeGo").disabled = true;
    const all = document.querySelector("input[name=wipeMode]:checked")?.value === "all";
    openModal(`<div class="gen-box"><div class="spinner"></div><h3>${tr("جارٍ الحذف")}</h3></div>`);
    $("modalBack").dataset.lock = "1";
    clearTimeout(TT.timer); TT.dirty = false;
    try {
      const refs = !all ? [doc(db, "schools", SID, "timetable", "main")] : [...["grades", "sections", "subjects", "teachers", "departments"].flatMap(c => S[c].map(x => dref(c, x.id))),
        ...SUB.abs.map(x => dref("absences", x.id)), ...[...SUB.days.keys()].map(d => doc(db, "schools", SID, "subs", d)),
        doc(db, "schools", SID, "timetable", "main"), doc(db, "schools", SID, "timetable", "published"), doc(db, "schools", SID, "noor", "source")];
      for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
      clearTimeout(TT.timer); TT.dirty = false; TT.saving = false; TT.saved = []; TT.lessons = null; TV.sel = null; TV.id = null;
      delete $("modalBack").dataset.lock; closeModal();
      toast(tr(all ? "تم حذف كل البيانات المستوردة" : "تم حذف كل الجداول، والمعلمون والشعب والمواد باقية"), "success");
      render();
    } catch (e) { delete $("modalBack").dataset.lock; closeModal(); toast(errMsg(e), "error"); }
  };
}
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
    if (data.settings?.days?.length && (data.settings?.periods?.length || data.settings?.periodsCount)) {
      const cur = settings().periods;
      const periods = data.settings.periods?.length ? data.settings.periods
        : (cur.length === data.settings.periodsCount ? cur : defaultPeriods(data.settings.periodsCount, cur[0]?.start || "08:00"));
      await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), ...(data.settings.freeAll ? { freeAll: data.settings.freeAll } : {}), days: data.settings.days, periods }, updatedAt: serverTimestamp() });
    }
    // معرّفات جديدة لكل عنصر قبل الكتابة
    const id = {};
    const mk = (c, key) => { id[c + ":" + key] = doc(col(c)).id; };
    (data.grades || []).forEach(x => mk("grades", x.key));
    (data.sections || []).forEach(x => mk("sections", x.key));
    (data.subjects || []).forEach(x => mk("subjects", x.key));
    (data.teachers || []).forEach(x => mk("teachers", x.key));
    const G = k => id["grades:" + k], C = k => id["sections:" + k], SB = k => id["subjects:" + k], T = k => id["teachers:" + k];
    const ext = x => (x.ext != null && x.ext !== "" ? { extId: String(x.ext) } : {});
    for (const g of data.grades || []) ops.push(b => b.set(doc(db, "schools", SID, "grades", G(g.key)), { name: g.name, code: String(g.code), ...ext(g), createdAt: serverTimestamp() }));
    for (const x of data.sections || []) {
      const rules = x.rules ? { free: x.rules.free || [], days: (x.rules.days || []).filter(o => T(o.t)).map(o => ({ d: o.d, t: T(o.t), rest: o.rest || "free" })) } : null;
      ops.push(b => b.set(doc(db, "schools", SID, "sections", C(x.key)), { gradeId: G(x.grade), num: String(x.num), ...ext(x), ...(rules && (rules.free.length || rules.days.length) ? { rules } : {}) }));
    }
    for (const x of data.subjects || []) {
      const periods = {}; for (const [gk, n] of Object.entries(x.periods || {})) if (G(gk)) periods[G(gk)] = num(n);
      ops.push(b => b.set(doc(db, "schools", SID, "subjects", SB(x.key)), { name: x.name, color: x.color || "#0f766e", periods, ...ext(x), createdAt: serverTimestamp() }));
    }
    for (const x of data.teachers || []) {
      const assignments = (x.assignments || []).filter(a => SB(a.subject) && C(a.section)).map(a => ({ subjectId: SB(a.subject), sectionId: C(a.section), periods: num(a.periods) }));
      ops.push(b => b.set(doc(db, "schools", SID, "teachers", T(x.key)), { name: x.name, phone: x.phone || "", subjectId: SB(x.subject) || "", maxLoad: num(x.maxLoad), assignments, ...ext(x), createdAt: serverTimestamp() }));
    }
    await flush("استيراد الصفوف والمواد والمعلمين", 20, 85);
    if (data.timetable?.length) {
      step(90, "استيراد الجدول");
      const lessons = data.timetable.filter(x => T(x.teacher) && SB(x.subject) && C(x.section))
        .map(x => ({ t: T(x.teacher), s: SB(x.subject), c: C(x.section), d: x.d ?? null, p: x.p ?? null, l: !!x.l }));
      TT.dirty = false; TT.saving = true;
      await setDoc(doc(db, "schools", SID, "timetable", "main"), { lessons, updatedAt: serverTimestamp() });
      // الجدول المستورد يُعتبر آخر نسخة مُرسلة للمعلمين
      await setDoc(doc(db, "schools", SID, "timetable", "published"), { lessons: lessons.filter(x => x.d != null).map(x => ({ t: x.t, s: x.s, c: x.c, d: x.d, p: x.p })), at: Date.now() }).catch(() => {});
      TT.saving = false; TT.saved = lessons; TT.lessons = null;
    }
    // ملف الوزارة الأصلي: نحفظه لنصدّر منه ملف نور لاحقًا
    if (data.noorSource?.text) { step(95, "حفظ ملف الوزارة"); await saveNoorSource(data.noorSource).catch(e => console.warn("noor", e)); }
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

// =====================================================
//  الصفوف والشعب
// =====================================================
function vGrades() {
  return `
  <div class="page-title"><h1>الصفوف والشعب</h1></div>
  <div class="card" data-fold="addGrade" data-sum="${esc(tf("{0} صفوف · {1} شعبة", S.grades.length, S.sections.length))}">
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
  ${S.sections.length ? `<div class="card" data-fold="bulkFree" data-sum="${esc(bulkSummary())}">
    <h3>تفريغ جماعي للشعب</h3>
    <p class="muted" style="margin-top:0">${tr("فرّغ يومًا كاملًا أو حصصًا محددة لكل الشعب أو لصفوف معيّنة دفعة واحدة، بدل تعديل كل شعبة لوحدها.")}</p>
    <div class="field"><label>${tr("الصفوف")}</label>
      <div class="bf-grades">${S.grades.map(g => `<label class="check"><input type="checkbox" value="${g.id}" checked> ${esc(g.name)} <span class="muted">(${S.sections.filter(x => x.gradeId === g.id).length})</span></label>`).join("")}</div></div>
    <div class="grid-2">
      <div class="field"><label>${tr("اليوم")}</label><select id="bfDay">${settings().days.map((d, i) => `<option value="${i}">${esc(tr(d))}</option>`).join("")}</select></div>
      <div class="field"><label>${tr("المدة")}</label><div class="seg" id="bfKind"><button type="button" data-k="day" class="active">${tr("يوم كامل")}</button><button type="button" data-k="range">${tr("من حصة إلى حصة")}</button></div></div>
    </div>
    <div class="grid-2 hidden" id="bfRange">
      <div class="field"><label>${tr("من الحصة")}</label><select id="bfFrom">${settings().periods.map((_, p) => `<option value="${p}">${p + 1}</option>`).join("")}</select></div>
      <div class="field"><label>${tr("إلى الحصة")}</label><select id="bfTo">${settings().periods.map((_, p, a) => `<option value="${p}" ${p === a.length - 1 ? "selected" : ""}>${p + 1}</option>`).join("")}</select></div>
    </div>
    <div class="row-actions"><button class="btn primary" id="bfApply">${tr("تطبيق التفريغ")}</button><button class="btn" id="bfRemove">${tr("إزالة هذا التفريغ")}</button></div>
    <div id="bfList" class="bf-list">${bulkListHTML()}</div>
  </div>` : ""}
  ${S.grades.length ? S.grades.map(g => {
    const secs = S.sections.filter(s => s.gradeId === g.id);
    const open = gOpen.has(g.id), nr = secs.reduce((a, x) => a + secRuleCount(x), 0);
    return `<div class="grade-block ${open ? "open" : ""}" data-g="${g.id}">
      <div class="gh" data-act="toggleG" role="button" tabindex="0" aria-expanded="${open}">
        <h3>${esc(g.name)} <span class="badge info">${esc(g.code)}</span></h3>
        <span class="gh-sum"><span class="muted">${esc(tf("{0} شعبة", secs.length))}${nr ? ` · ${esc(tf("{0} قيود", nr))}` : ""}</span><span class="ld-chev"></span></span>
      </div>
      <div class="g-body">
        <div class="row-actions g-acts">
          <button class="btn sm primary" data-act="addSec">+ شعبة</button>
          <button class="btn sm" data-act="editGrade">تعديل</button>
          <button class="btn sm danger" data-act="delGrade">حذف</button>
        </div>
        ${secs.length ? `<div class="sec-grid">${secs.map(s => { const n = secRuleCount(s); return `<button type="button" class="sec-btn ${n ? "has-rules" : ""}" data-act="secRules" data-s="${s.id}" title="${esc(secRulesSummary(s) || "")}"><b>${esc(secLabel(s))}</b><span class="sec-sub"><span data-ic="${n ? "lock" : "settings"}" data-size="13"></span>${n ? esc(tf("{0} قيود", n)) : tr("القيود")}</span></button>`; }).join("")}</div>
        <p class="sec-hint">${tr("اضغط على أي شعبة لإضافة قيد مخصص")}</p>` : "<span class='muted'>لا توجد شعب</span>"}
      </div>
    </div>`;
  }).join("") : `<div class="card empty"><div class="big">🏷️</div>أضف أول صف من النموذج أعلاه</div>`}`;
}
// الصفوف المفتوحة في صفحة الصفوف والشعب
const gOpen = new Set((() => { try { return JSON.parse(localStorage.getItem("gOpen") || "[]"); } catch { return []; } })());
const saveGOpen = () => { try { localStorage.setItem("gOpen", JSON.stringify([...gOpen])); } catch {} };
const secRuleCount = s => (s.rules?.free || []).length + (s.rules?.days || []).length;
const secHasRules = s => secRuleCount(s) > 0;
function secRulesSummary(s) {
  const r = s.rules || {}, out = [];
  (r.free || []).forEach(m => out.push(tf("فارغة: {0}", slotLabel(m))));
  (r.days || []).forEach(o => out.push(tf("{0}: يوم كامل مع {1}", tr(settings().days[o.d] || ""), shortName(teacherOf(o.t)?.name))));
  return out.join(" · ");
}
function sectionModal(sec) {
  const label = secLabel(sec), st = settings(), P = st.periods.length;
  const free = (sec.rules?.free || []).map(m => ({ ...m }));
  const days = (sec.rules?.days || []).map(o => ({ ...o }));
  const tList = S.teachers.map(t => ({ t, n: (t.assignments || []).filter(a => a.sectionId === sec.id).reduce((x, a) => x + num(a.periods), 0) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const total = tList.reduce((x, y) => x + y.n, 0);
  openModal(`${modalHead(esc(tf("قيود الشعبة {0}", label)))}
    <p class="muted" style="margin-top:0">${esc(tf("{0} حصة أسبوعيًا مع {1} معلم.", total, tList.length))}</p>
    <label>${tr("أوقات فارغة للشعبة")} <small class="muted">(${tr("يوم كامل أو حصص محددة لا توضع فيها أي حصة")})</small></label>
    <div id="secFree"></div>
    <label style="margin-top:1.1rem">${tr("يوم كامل لمعلم معيّن")} <small class="muted">(${tr("مثل معلم السياحة")})</small></label>
    <div id="secDays"></div>
    <div class="modal-actions sec-actions"><button class="btn primary" id="secSave">💾 ${tr("حفظ")}</button><button type="button" class="btn ghost" data-close>${tr("إلغاء")}</button>
      <button type="button" class="btn danger sec-del" id="secDel">🗑 ${tr("حذف الشعبة")}</button></div>`);
  fillIcons($("modal"));
  const drawFree = () => { $("secFree").innerHTML = slotPicker("secFreeList", free, true); bindSlots($("secFree"), free, drawFree); };
  const drawDays = () => {
    $("secDays").innerHTML = `<div class="own-list">${days.map((o, i) => {
      const n = tList.find(x => x.t.id === o.t)?.n || 0, q = Math.min(n, P);
      const note = !o.t ? "" : n === 0 ? tr("هذا المعلم لا يدرّس هذه الشعبة") : n >= P ? tf("يأخذ اليوم كاملًا ({0} حصص)، والباقي ({1}) يتوزع على الأيام الأخرى", P, n - P)
        : (o.rest === "others" ? tf("يأخذ {0} حصص، ويكمل باقي اليوم معلمون آخرون", q) : tf("يأخذ الحصص 1-{0} ثم ينصرف الطلاب", q));
      return `<div class="own-row" data-i="${i}">
        <select data-k="d">${st.days.map((dn, di) => `<option value="${di}" ${o.d === di ? "selected" : ""}>${esc(dn)}</option>`).join("")}</select>
        <select data-k="t"><option value="">${tr("— اختر المعلم —")}</option>${tList.map(x => `<option value="${x.t.id}" ${o.t === x.t.id ? "selected" : ""}>${esc(x.t.name)} (${esc(tf("{0} حصص", x.n))})</option>`).join("")}</select>
        <select data-k="rest"><option value="free" ${o.rest !== "others" ? "selected" : ""}>${tr("الحصص المتبقية: ينصرف الطلاب")}</option><option value="others" ${o.rest === "others" ? "selected" : ""}>${tr("الحصص المتبقية: يكملها معلمون آخرون")}</option></select>
        <button type="button" class="btn sm danger" data-rm>×</button>
        ${note ? `<small class="own-note">${esc(note)}</small>` : ""}
      </div>`;
    }).join("")}</div>
    <button type="button" class="btn sm" id="ownAdd">+ ${tr("إضافة يوم لمعلم")}</button>`;
    $("ownAdd").onclick = () => { const used = new Set(days.map(o => o.d)); const d = st.days.findIndex((_, i) => !used.has(i)); days.push({ d: d < 0 ? 0 : d, t: tList[0]?.t.id || "", rest: "free" }); drawDays(); };
    $("secDays").querySelectorAll(".own-row").forEach(row => {
      const o = days[+row.dataset.i];
      row.querySelectorAll("select").forEach(sel => sel.onchange = () => { o[sel.dataset.k] = sel.dataset.k === "d" ? +sel.value : sel.value; drawDays(); });
      row.querySelector("[data-rm]").onclick = () => { days.splice(+row.dataset.i, 1); drawDays(); };
    });
  };
  drawFree(); drawDays();
  $("secDel").onclick = async () => {
    closeModal();
    if (!(await confirmBox(tf("حذف الشعبة {0}؟ سيتم حذف إسنادها من المعلمين.", label), tr("حذف")))) return;
    try { await removeSections([sec.id]); toast("تم حذف الشعبة", "success"); } catch (ex) { toast(errMsg(ex), "error"); }
  };
  $("secSave").onclick = async () => {
    const clean = days.filter(o => o.t);
    if (new Set(clean.map(o => o.d)).size !== clean.length) return toast("لا يمكن تخصيص نفس اليوم لأكثر من معلم", "error");
    if (clean.some(o => free.some(f => f.d === o.d && f.p === -1))) return toast("لا يمكن أن يكون اليوم فارغًا ومخصصًا لمعلم في نفس الوقت", "error");
    try {
      await updateDoc(dref("sections", sec.id), { rules: { free, days: clean.map(o => ({ d: o.d, t: o.t, rest: o.rest === "others" ? "others" : "free" })) } });
      closeModal(); toast("تم حفظ قيود الشعبة", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}
BIND.grades = v => {
  fillIcons(v);
  foldCards(v, "grades", S.grades.length ? [] : ["addGrade"]);
  bindBulkFree();
  v.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".gh")) { e.preventDefault(); e.target.click(); } };
  const f = $("gradeForm");
  f.name.oninput = () => { const i = GRADE_NAMES.indexOf(f.name.value.trim()); if (i >= 0) f.code.value = i + 1; };
  f.onsubmit = async e => {
    e.preventDefault();
    const name = f.name.value.trim(), code = f.code.value.trim(), count = Math.min(40, num(f.count.value));
    if (!name || !code) return;
    if (S.grades.some(g => g.code === code)) return toast("يوجد صف بنفس الرمز", "error");
    try {
      const gref = doc(col("grades"));
      gOpen.add(gref.id); saveGOpen();
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
    if (act === "secRules") return sectionModal(section(b.dataset.s));
    if (act === "toggleG") {
      const blk = b.closest(".grade-block"), o = blk.classList.toggle("open");
      b.setAttribute("aria-expanded", o);
      if (o) gOpen.add(gid); else gOpen.delete(gid);
      return saveGOpen();
    }
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
let IMP_FILE = null;
// تحديد نوع ملف الاستيراد من أول بايتات الملف، ثم من الامتداد
async function fileKind(f) {
  const b = new Uint8Array(await f.slice(0, 512).arrayBuffer());
  const txt = new TextDecoder("latin1").decode(b).replace(/^\uFEFF|^\xEF\xBB\xBF/, "").trimStart();
  if (txt.startsWith("%PDF")) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4B) return "excel"; // xlsx (zip)
  if (b[0] === 0xD0 && b[1] === 0xCF) return "excel"; // xls القديم
  if (/^<\?xml/i.test(txt) || /^<timetable/i.test(txt)) return "xml";
  if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") return "pdf";
  if (/\.xml$/i.test(f.name) || /xml/i.test(f.type)) return "xml";
  if (/\.(xlsx|xls|csv)$/i.test(f.name) || /sheet|excel|csv/i.test(f.type)) return "excel";
  return "";
}
function showImpFile() {
  const box = $("impPicked"); if (!box) return;
  box.innerHTML = IMP_FILE ? `📎 <b data-no-i18n>${esc(IMP_FILE.name)}</b> <span class="muted">(${Math.max(1, Math.round(IMP_FILE.size / 1024))} KB)</span> <button type="button" class="btn sm ghost" id="impClear">×</button>` : "";
  box.classList.toggle("hidden", !IMP_FILE);
  if ($("impClear")) $("impClear").onclick = () => { IMP_FILE = null; $("impFile").value = ""; showImpFile(); };
}
let TT_ENTS = [];
let tDept = "all";
// الأقسام المفتوحة في صفحة المعلمين (تُحفظ في المتصفح)
const tOpen = new Set((() => { try { return JSON.parse(localStorage.getItem("tOpen") || "[]"); } catch { return []; } })());
const saveTOpen = () => { try { localStorage.setItem("tOpen", JSON.stringify([...tOpen])); } catch {} };
function vTeachers() {
  const cntD = id => S.teachers.filter(t => id === "none" ? !deptsOfTeacher(t).length : deptsOfTeacher(t).some(x => x.id === id)).length;
  return `
  <div class="page-title"><h1>المعلمون</h1>
    <div class="row-actions"><button class="btn primary" id="addT">+ إضافة معلم</button></div></div>
  ${!S.subjects.length || !S.sections.length ? `<div class="notice warn">يُفضّل إضافة <a href="#grades">الشعب</a> و<a href="#subjects">المواد</a> أولًا حتى تستطيع إسنادها للمعلمين.</div>` : ""}
  <div class="card t-tools">
    <div class="t-find"><span class="tt-find-ic" data-ic="search" data-size="18"></span>
      <input type="search" id="tSearch" autocomplete="off" placeholder="${esc(tr("ابحث بالاسم أو المادة أو الشعبة"))}" value="${esc(tQuery)}"></div>
    ${S.departments.length ? `<select id="tDeptSel" class="t-dept">
      <option value="all" ${tDept === "all" ? "selected" : ""}>${esc(tr("كل الأقسام"))} (${S.teachers.length})</option>
      ${S.departments.map(d => `<option value="${d.id}" ${tDept === d.id ? "selected" : ""}>${esc(d.name)} (${cntD(d.id)})</option>`).join("")}
      ${cntD("none") ? `<option value="none" ${tDept === "none" ? "selected" : ""}>${esc(tr("بدون قسم"))} (${cntD("none")})</option>` : ""}
    </select>
    <button class="btn sm t-fold" id="tFoldAll" type="button"></button>` : ""}
  </div>
  <div id="tList"></div>`;
}
// وصف وقت التفريغ: "الثلاثاء · اليوم كامل" أو "الثلاثاء · الحصص 5-8"
function freeLabel(x) {
  const st = settings(), P = st.periods.length, day = tr(st.days[x.d] || "");
  if (x.from <= 0 && x.to >= P - 1) return `${day} · ${tr("اليوم كامل")}`;
  if (x.from === x.to) return `${day} · ${tf("الحصة {0}", x.from + 1)}`;
  return `${day} · ${tf("الحصص {0}-{1}", x.from + 1, x.to + 1)}`;
}
// رقم المعلم: من بياناته، أو من حسابه في المنصة
const teacherPhone = t => t?.phone || S.accounts.find(a => a.teacherId === t?.id && a.phone)?.phone || "";
function waTeacher(t) {
  const phone = teacherPhone(t);
  if (!phone) return toast("لا يوجد رقم هاتف لهذا المعلم", "error");
  if (!TT.lessons) ttSync();
  if (!TT.lessons.some(x => x.t === t.id && x.d != null)) return toast("لا يوجد جدول موزّع لهذا المعلم بعد", "error");
  // حفظ نسخة من جدول المعلم في رابط عام خاص به (نفس الرابط لكل مرة)
  const save = async () => {
    let id = t.shareId;
    if (!id) { id = newShareId(); await updateDoc(dref("teachers", t.id), { shareId: id }); t.shareId = id; }
    await setDoc(doc(db, "shares", id), { schoolId: SID, teacherId: t.id, name: t.name, sheet: sheetToDoc(sheetFor("teacher", t.id)), lang: isEn ? "en" : "ar", updatedAt: serverTimestamp() });
    return id;
  };
  sendTimetableLink({ name: t.name, phone, save }).catch(e => toast(errMsg(e), "error"));
}
const waBtn = (t, extra = "") => teacherPhone(t) ? `<button type="button" class="wa-btn ${extra}" data-act="wa" title="${esc(tr("إرسال الجدول عبر واتساب"))}">${WA_ICON}<span>${tr("واتساب")}</span></button>` : "";
function teacherRow(t) {
  const l = load(t), max = num(t.maxLoad);
  const r = t.rules || {};
  const tags = [];
  if (r.mode && r.mode !== "none") tags.push(tr({ double: "حصص مزدوجة", noConsec: "بدون متتالية", spread: "متباعدة" }[r.mode]));
  if (r.maxRun) tags.push(tf("أقصى {0} متتالية", r.maxRun));
  if (r.periodMax && Object.keys(r.periodMax).length) tags.push(tr("حدود حصص"));
  if ((r.free || []).length) tags.push(tf("تفريغ: {0}", (r.free || []).map(freeLabel).join("، ")));
  const ph = teacherPhone(t);
  return `<tr data-id="${t.id}"><td><b>${esc(t.name)}</b>${ph ? `<div class="t-phone"><span dir="ltr" class="muted">${esc(ph)}</span>${waBtn(t)}</div>` : ""}
    ${tags.length ? `<div>${tags.map(x => `<span class="badge info rule-tag">${esc(x)}</span>`).join(" ")}</div>` : ""}</td>
    <td data-l="${esc(tr("المادة"))}">${esc(subject(t.subjectId)?.name || "—")}</td>
    <td data-l="${esc(tr("الشعب"))}" style="max-width:380px">${(t.assignments || []).map(a => { const sb = subject(a.subjectId);
      return `<span class="chip" title="${esc(sb?.name || "")}"><span class="dot" style="background:${sb?.color || "#999"}"></span><bdi>${esc(secLabel(section(a.sectionId)))}</bdi><span class="pcount">${esc(tf("{0} حصص", num(a.periods)))}</span></span>`; }).join("") || "<span class='muted'>—</span>"}</td>
    <td data-l="${esc(tr("النصاب"))}"><span class="badge ${max && l > max ? "bad" : max && l === max ? "ok" : "info"}">${l}/${max || "-"}</span></td>
    <td><div class="row-actions"><button class="btn sm" data-act="edit">تعديل</button><button class="btn sm danger" data-act="del">حذف</button></div></td></tr>`;
}
function drawTeachers() {
  const nq = norm(tQuery).split(" ").filter(Boolean);
  const match = t => !nq.length || (h => nq.every(w => h.includes(w)))(norm([t.name, t.phone, subject(t.subjectId)?.name, ...(t.assignments || []).map(a => { const x = S.sections.find(z => z.id === a.sectionId); return x ? secLabel(x) : ""; })].join(" ")));
  const list = S.teachers.filter(match);
  const head = `<thead><tr><th>المعلم</th><th>المادة</th><th>الشعب المُسندة</th><th>النصاب</th><th></th></tr></thead>`;
  let groups;
  if (!S.departments.length) groups = [{ name: null, rows: list }];
  else if (tDept === "all") {
    groups = S.departments.map(d => ({ d, rows: list.filter(t => deptsOfTeacher(t).some(x => x.id === d.id)) }));
    groups.push({ none: true, rows: list.filter(t => !deptsOfTeacher(t).length) });
    groups = groups.filter(g => g.rows.length);
  } else if (tDept === "none") groups = [{ none: true, rows: list.filter(t => !deptsOfTeacher(t).length) }];
  else { const d = deptOf(tDept); groups = d ? [{ d, rows: list.filter(t => deptsOfTeacher(t).some(x => x.id === d.id)) }] : [{ rows: list }]; }
  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  // عند البحث أو اختيار قسم واحد: الأقسام مفتوحة. غير ذلك: حسب ما اختاره المستخدم (مطوية افتراضيًا)
  const forceOpen = nq.length > 0 || tDept !== "all" || groups.length === 1;
  const gk = g => g.d ? g.d.id : "none";
  $("tList").innerHTML = total ? groups.map(g => {
    const named = g.d || g.none, open = !named || forceOpen || tOpen.has(gk(g));
    const c = g.d?.color || "#94a3b8";
    return `<div class="card t-group ${open ? "open" : ""}" data-g="${gk(g)}">
    ${named ? `<button type="button" class="t-group-head" style="--c:${c}" aria-expanded="${open}">
      <span class="t-gname"><span class="dot" style="background:${c}"></span><b>${esc(g.d ? g.d.name : tr("بدون قسم"))}</b></span>
      <span class="t-gmeta"><span class="badge info-n">${esc(tf("{0} معلم", g.rows.length))}</span><span class="muted t-gper">${esc(tf("{0} حصة", g.rows.reduce((a, t) => a + load(t), 0)))}</span><span class="ld-chev"></span></span>
    </button>` : ""}
    <div class="t-group-body"><div class="table-wrap"><table class="tbl t-tbl">${head}<tbody>${g.rows.map(teacherRow).join("")}</tbody></table></div></div></div>`;
  }).join("")
    : `<div class="card empty"><div class="big">👩‍🏫</div>${S.teachers.length ? "لا نتائج" : "لم تتم إضافة معلمين بعد"}</div>`;
  const fb = $("tFoldAll");
  if (fb) {
    const named = groups.filter(g => g.d || g.none);
    fb.classList.toggle("hidden", forceOpen || named.length < 2);
    const allOpen = named.every(g => tOpen.has(gk(g)));
    fb.textContent = tr(allOpen ? "طي الكل" : "فتح الكل");
    fb.onclick = () => { if (allOpen) tOpen.clear(); else named.forEach(g => tOpen.add(gk(g))); saveTOpen(); drawTeachers(); };
  }
}
BIND.teachers = () => {
  drawTeachers();
  fillIcons(document.querySelector(".t-tools"));
  $("tSearch").oninput = e => { tQuery = e.target.value.trim(); drawTeachers(); };
  if ($("tDeptSel")) $("tDeptSel").onchange = e => { tDept = e.target.value; drawTeachers(); };
  $("addT").onclick = () => teacherModal();
  $("tList").onclick = async e => {
    const h = e.target.closest(".t-group-head");
    if (h) {
      const g = h.closest(".t-group"), k = g.dataset.g, o = g.classList.toggle("open");
      h.setAttribute("aria-expanded", o);
      if (o) tOpen.add(k); else tOpen.delete(k);
      saveTOpen(); return;
    }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const t = S.teachers.find(x => x.id === b.closest("[data-id]").dataset.id);
    if (b.dataset.act === "edit") return teacherModal(t);
    if (b.dataset.act === "wa") return waTeacher(t);
    if (!(await confirmBox(tf("حذف المعلم «{0}»؟", t.name), "حذف"))) return;
    try { await deleteDoc(dref("teachers", t.id)); toast("تم الحذف", "success"); } catch (ex) { toast(errMsg(ex), "error"); }
  };
};

function teacherModal(t) {
  const isNew = !t;
  t = t || { name: "", phone: "", subjectId: "", maxLoad: 20, assignments: [] };
  let asg = (t.assignments || []).map(a => ({ ...a }));
  const r = t.rules || {};
  const hasRules = (r.mode && r.mode !== "none") || r.maxRun || (r.periodMax && Object.keys(r.periodMax).length) || (r.free || []).length;
  const tFree = (r.free || []).map(f => ({ ...f }));
  const autoDepts = new Set(deptsOfTeacher(t).map(d => d.id));
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

    ${S.departments.length ? `<div class="field"><label>الأقسام <small class="muted">(${tr("تلقائي حسب المادة، ويمكن اختيار أكثر من قسم")})</small></label>
      <div class="sec-pick">${S.departments.map(d => `<label class="check"><input type="checkbox" name="dept" value="${d.id}" ${autoDepts.has(d.id) ? "checked" : ""}> <span class="dot" style="background:${d.color}"></span>${esc(d.name)}</label>`).join("")}</div></div>` : ""}

    <details class="rules-box" ${hasRules ? "open" : ""}>
      <summary><span data-ic="settings" data-size="16"></span> ${tr("قيود التوزيع لهذا المعلم")}</summary>
      <label>${tr("أوقات تفريغ المعلم")} <small class="muted">(${tr("مثل الدراسة — لا توضع له حصص فيها")})</small></label>
      <div id="tFreeBox" class="free-box"></div>
      <label>${tr("أقصى عدد مرات لكل حصة في الأسبوع")} <small class="muted">(${tr("فارغ = حسب إعداد المدرسة")})</small></label>
      <div class="pmax-grid">${settings().periods.map((_, p) => {
        const own = r.periodMax?.[p], def = settings().periodMax?.[p];
        return `<label class="pmax"><span>${tf("الحصة {0}", p + 1)}</span><input type="number" min="0" max="${settings().days.length}" name="pm${p}" value="${own ?? ""}" placeholder="${def ?? "∞"}"></label>`;
      }).join("")}</div>
      <div class="grid-3" style="margin-top:.8rem">
        <div class="field"><label>${tr("نمط الحصص")}</label><select name="mode">
          ${[["none", "بدون تفضيل"], ["double", "حصتان متتاليتان (مزدوجة)"], ["noConsec", "منع الحصص المتتالية"], ["spread", "توزيع متباعد"]].map(([v, l]) => `<option value="${v}" ${(r.mode || "none") === v ? "selected" : ""}>${tr(l)}</option>`).join("")}
        </select></div>
        <div class="field" id="dblField"><label>${tr("عدد الحصص المزدوجة أسبوعيًا")}</label><input type="number" name="doubles" min="1" max="10" value="${r.doubles || 2}"></div>
        <div class="field"><label>${tr("أقصى عدد حصص متتالية")}</label><input type="number" name="maxRun" min="1" max="8" value="${r.maxRun ?? ""}" placeholder="${settings().maxRun || "∞"}"></div>
      </div>
    </details>

    <div class="modal-actions"><button class="btn primary lg">💾 حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
  </form>`);

  const f = $("tForm");
  fillIcons($("modal"));
  const drawFree = () => {
    const st = settings(), P = st.periods.length;
    const pOpts = sel => st.periods.map((_, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(tf("الحصة {0}", i + 1))}</option>`).join("");
    $("tFreeBox").innerHTML = `<div class="slot-list">${tFree.map((x, i) => `<span class="chip slot-chip free-chip">${esc(freeLabel(x))}<button type="button" data-rmf="${i}">×</button></span>`).join("") || `<span class="muted">${tr("لا يوجد")}</span>`}</div>
      <div class="free-add">
        <select data-fd>${st.days.map((d, i) => `<option value="${i}">${esc(d)}</option>`).join("")}</select>
        <span class="muted">${tr("من")}</span><select data-ff>${pOpts(0)}</select>
        <span class="muted">${tr("إلى")}</span><select data-ft>${pOpts(P - 1)}</select>
        <button type="button" class="btn sm" data-addf>+ ${tr("إضافة")}</button>
        <button type="button" class="btn sm" data-addday>${tr("اليوم كامل")}</button>
      </div>`;
    const box = $("tFreeBox");
    const add = (d, a, b) => {
      if (a > b) [a, b] = [b, a];
      for (let i = tFree.length - 1; i >= 0; i--) if (tFree[i].d === d && tFree[i].from >= a && tFree[i].to <= b) tFree.splice(i, 1);
      if (!tFree.some(x => x.d === d && x.from <= a && x.to >= b)) tFree.push({ d, from: a, to: b });
      tFree.sort((x, y) => x.d - y.d || x.from - y.from); drawFree();
    };
    box.querySelector("[data-addf]").onclick = () => add(+box.querySelector("[data-fd]").value, +box.querySelector("[data-ff]").value, +box.querySelector("[data-ft]").value);
    box.querySelector("[data-addday]").onclick = () => add(+box.querySelector("[data-fd]").value, 0, P - 1);
    box.querySelectorAll("[data-rmf]").forEach(b => b.onclick = () => { tFree.splice(+b.dataset.rmf, 1); drawFree(); });
  };
  drawFree();
  const syncMode = () => { $("dblField").style.display = f.mode.value === "double" ? "" : "none"; f.maxRun.disabled = f.mode.value === "noConsec"; };
  f.mode.onchange = syncMode; syncMode();
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
    // الأقسام: نحفظها فقط إذا اختلفت عن التلقائي
    if (S.departments.length) {
      const chosen = [...f.querySelectorAll("[name=dept]:checked")].map(x => x.value);
      const auto = deptsOfTeacher({ ...t, deptIds: undefined, subjectId: data.subjectId, assignments: data.assignments }).map(d => d.id);
      data.deptIds = (chosen.length === auto.length && chosen.every(x => auto.includes(x))) ? null : chosen;
    }
    const pm = {};
    settings().periods.forEach((_, p) => { const v = f["pm" + p].value; if (v !== "") pm[p] = Math.max(0, num(v)); });
    data.rules = { free: tFree, periodMax: pm, mode: f.mode.value, doubles: f.mode.value === "double" ? Math.max(1, num(f.doubles.value)) : 0, maxRun: f.maxRun.value === "" || f.mode.value === "noConsec" ? null : Math.max(1, num(f.maxRun.value)) };
    try {
      if (isNew) await addDoc(col("teachers"), { ...data, createdAt: serverTimestamp() });
      else await updateDoc(dref("teachers", t.id), data);
      closeModal(); toast("تم حفظ بيانات المعلم", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}

// =====================================================
//  الأقسام
// =====================================================
const DEPT_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#be123c", "#475569"];
const deptOf = id => S.departments.find(d => d.id === id);
const deptsOfTeacher = t => teacherDepts(t, S.departments);
const slotLabel = m => `${tr(settings().days[m.d] || "")} · ${m.p === -1 ? tr("اليوم كامل") : tf("الحصة {0}", m.p + 1)}`;
function slotPicker(listId, slots, wholeDay = false) {
  const st = settings();
  return `<div class="slot-list" id="${listId}">${slots.map((m, i) => `<span class="chip slot-chip">${esc(slotLabel(m))}<button type="button" data-rm-slot="${i}">×</button></span>`).join("") || `<span class="muted">${tr("لا يوجد")}</span>`}</div>
    <div class="slot-add">
      <select data-slot-d>${st.days.map((d, i) => `<option value="${i}">${esc(d)}</option>`).join("")}</select>
      <select data-slot-p>${wholeDay ? `<option value="-1">${tr("اليوم كامل")}</option>` : ""}${st.periods.map((_, i) => `<option value="${i}">${esc(tf("الحصة {0}", i + 1))}</option>`).join("")}</select>
      <button type="button" class="btn sm" data-add-slot>+ ${tr("إضافة")}</button>
    </div>`;
}
// يربط أزرار الإضافة والحذف لقائمة خانات (يوم + حصة)
function bindSlots(root, slots, redraw) {
  root.querySelector("[data-add-slot]").onclick = () => {
    const d = +root.querySelector("[data-slot-d]").value, p = +root.querySelector("[data-slot-p]").value;
    if (p === -1) { for (let i = slots.length - 1; i >= 0; i--) if (slots[i].d === d) slots.splice(i, 1); }
    if (!slots.some(m => m.d === d && (m.p === p || m.p === -1))) slots.push({ d, p });
    slots.sort((a, b) => a.d - b.d || a.p - b.p); redraw();
  };
  root.querySelectorAll("[data-rm-slot]").forEach(b => b.onclick = () => { slots.splice(+b.dataset.rmSlot, 1); redraw(); });
}

function vDepartments() {
  const loadOf = t => load(t);
  const none = S.teachers.filter(t => !deptsOfTeacher(t).length);
  return `
  <div class="page-title"><h1>الأقسام</h1><button class="btn primary" id="addDept">+ إضافة قسم</button></div>
  <div class="notice info-n">جمّع المواد في أقسام (مثل العلوم: الفيزياء والكيمياء والأحياء). المعلم ينضم تلقائيًا لقسم مادته، ويمكن أن يكون في أكثر من قسم. حدّد لكل قسم حصص الاجتماع ليتركها التوزيع التلقائي فارغة لمعلميه.</div>
  ${S.departments.length ? `<div class="dept-grid">${S.departments.map(d => {
    const members = S.teachers.filter(t => deptsOfTeacher(t).some(x => x.id === d.id));
    return `<div class="card dept-card" data-id="${d.id}" style="--c:${d.color || "#0f766e"}">
      <div class="dept-head"><h3><span class="dot" style="background:${d.color || "#0f766e"}"></span> ${esc(d.name)}</h3>
        <div class="row-actions"><button class="btn sm" data-act="edit">تعديل</button><button class="btn sm danger" data-act="del">حذف</button></div></div>
      <div class="dept-stats"><div><b>${members.length}</b><span>معلم</span></div><div><b>${members.reduce((a, t) => a + loadOf(t), 0)}</b><span>حصة أسبوعيًا</span></div><div><b>${(d.meetings || []).length}</b><span>حصص اجتماع</span></div></div>
      <div class="dept-row"><span class="muted">المواد:</span> ${(d.subjectIds || []).map(id => subject(id)).filter(Boolean).map(s => `<span class="chip"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join("") || "—"}</div>
      <div class="dept-row"><span class="muted">اجتماع القسم:</span> ${(d.meetings || []).map(m => `<span class="chip meet-chip">${esc(slotLabel(m))}</span>`).join("") || "—"}</div>
      <a class="dept-link" href="#teachers" data-dept-go="${d.id}">${tf("عرض معلمي القسم ({0})", members.length)} ←</a>
    </div>`;
  }).join("")}</div>` : `<div class="card empty"><div class="big">🗂️</div>لم تتم إضافة أقسام بعد</div>`}
  ${S.departments.length && none.length ? `<div class="notice warn">${esc(tf("{0} معلم ليسوا في أي قسم", none.length))}: ${none.slice(0, 8).map(t => esc(t.name)).join("، ")}${none.length > 8 ? "…" : ""}</div>` : ""}`;
}
BIND.departments = v => {
  $("addDept").onclick = () => deptModal();
  v.onclick = async e => {
    const go = e.target.closest("[data-dept-go]");
    if (go) { tDept = go.dataset.deptGo; return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const d = deptOf(b.closest("[data-id]").dataset.id);
    if (b.dataset.act === "edit") return deptModal(d);
    if (!(await confirmBox(tf("حذف قسم «{0}»؟ لن يتم حذف المعلمين أو المواد.", d.name), "حذف"))) return;
    try { await deleteDoc(dref("departments", d.id)); toast("تم الحذف", "success"); } catch (ex) { toast(errMsg(ex), "error"); }
  };
};
function deptModal(d) {
  const isNew = !d;
  d = d || { name: "", color: DEPT_COLORS[S.departments.length % DEPT_COLORS.length], subjectIds: [], meetings: [] };
  const meetings = (d.meetings || []).map(m => ({ ...m }));
  openModal(`${modalHead(tr(isNew ? "إضافة قسم" : "تعديل القسم"))}
  <form id="dForm">
    <div class="g-subj">
      <div class="field"><label>اسم القسم *</label><input name="name" value="${esc(d.name)}" required placeholder="${esc(tr("مثال: العلوم"))}"></div>
      <div class="field"><label>اللون</label><input name="color" type="color" value="${d.color}" style="padding:.2em;height:46px"></div>
    </div>
    <label>مواد القسم</label>
    <div class="sec-pick" style="margin-bottom:1rem">${S.subjects.map(s => `<label class="check"><input type="checkbox" name="sub" value="${s.id}" ${(d.subjectIds || []).includes(s.id) ? "checked" : ""}> <span class="dot" style="background:${s.color}"></span>${esc(s.name)}</label>`).join("") || `<span class="muted">${tr("لا توجد مواد")}</span>`}</div>
    <label>حصص اجتماع القسم <small class="muted">(${tr("تبقى فارغة لكل معلمي القسم")})</small></label>
    <div id="meetBox"></div>
    <div class="modal-actions"><button class="btn primary">حفظ</button><button type="button" class="btn ghost" data-close>إلغاء</button></div>
  </form>`);
  const draw = () => { $("meetBox").innerHTML = slotPicker("meetList", meetings); bindSlots($("meetBox"), meetings, draw); fillIcons($("meetBox")); };
  draw();
  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target, name = f.name.value.trim();
    if (!name) return;
    const data = { name, color: f.color.value, subjectIds: [...f.querySelectorAll("[name=sub]:checked")].map(x => x.value), meetings };
    try {
      if (isNew) await addDoc(col("departments"), { ...data, createdAt: serverTimestamp() });
      else await updateDoc(dref("departments", d.id), data);
      closeModal(); toast("تم الحفظ", "success");
    } catch (ex) { toast(errMsg(ex), "error"); }
  };
}

// =====================================================
//  توزيع الجدول
// =====================================================
const TT = { saved: null, lessons: null, dirty: false, saving: false, timer: null, savedOk: true, lastJSON: "" };
const TV = { mode: "teacher", id: null, sel: null, flash: null, dept: null };
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
function ttRules() { return buildRules({ settings: settings(), departments: S.departments, teachers: S.teachers, sections: S.sections }); }
function ttIndex() {
  const tS = new Map(), cS = new Map(), slots = new Map();
  if (!TT.lessons) ttSync();
  const { P } = ttDims();
  TT.lessons.forEach((x, i) => {
    if (x.d == null) return;
    tS.set(`${x.t}@${x.d}.${x.p}`, i); cS.set(`${x.c}@${x.d}.${x.p}`, i);
    if (!slots.has(x.t)) slots.set(x.t, new Set());
    slots.get(x.t).add(x.d * P + x.p);
  });
  const rules = ttRules();
  const kN = new Map(), kDay = new Map(), cdT = new Map();
  TT.lessons.forEach(x => {
    if (x.d != null) { const kk = x.c + "@" + x.d; if (!cdT.has(kk)) cdT.set(kk, new Map()); const m = cdT.get(kk); m.set(x.t, (m.get(x.t) || 0) + 1); }
    const k = x.c + "|" + x.s; kN.set(k, (kN.get(k) || 0) + 1);
    if (x.d != null) { const kk = k + "@" + x.d; kDay.set(kk, (kDay.get(kk) || 0) + 1); }
  });
  return { tS, cS, slots, rules, kN, kDay, cdT };
}
const DAY_EN = { "الأحد": "Sun", "الاثنين": "Mon", "الثلاثاء": "Tue", "الأربعاء": "Wed", "الخميس": "Thu", "الجمعة": "Fri", "السبت": "Sat" };
const shortDay = d => isEn ? (DAY_EN[d] || d) : String(d).replace(/^ال/, "");
const shortName = n => String(n || "").split(/\s+/).slice(0, 2).join(" ");
const teacherOf = id => S.teachers.find(t => t.id === id);

function ttMark() {
  TT.dirty = true; TT.savedOk = false;
  clearTimeout(TT.timer);
  TT.timer = setTimeout(ttSave, 1500);
}
async function ttSave() {
  if (!TT.dirty) return;
  TT.saving = true; ttStatus();
  try {
    const lessons = TT.lessons.map(x => ({ t: x.t, s: x.s, c: x.c, d: x.d ?? null, p: x.p ?? null, l: !!x.l }));
    TT.lastJSON = JSON.stringify(lessons);
    TT.dirty = false;
    await setDoc(doc(db, "schools", SID, "timetable", "main"), { lessons, updatedAt: serverTimestamp() });
    TT.savedOk = true;
  } catch (e) { TT.dirty = true; toast(errMsg(e), "error"); }
  TT.saving = false; ttStatus();
  if (TT.dirty) { clearTimeout(TT.timer); TT.timer = setTimeout(ttSave, 3000); }
}
function ttStatus() {
  const el = $("ttSave"); if (!el) return;
  el.className = "save-state " + (TT.saving || TT.dirty ? "busy" : "ok");
  el.textContent = tr(TT.saving || TT.dirty ? "جارٍ الحفظ" : "محفوظ");
}
window.addEventListener("beforeunload", e => { if (TT.dirty) { e.preventDefault(); e.returnValue = ""; } });

// هل يمكن نقل الحصة i إلى الخانة (d,p)؟
function ruleCheck(idx, teacherId, d, p, remove = [], add = []) {
  const { P } = ttDims();
  const set = new Set(idx.slots.get(teacherId) || []);
  remove.forEach(x => set.delete(x)); add.forEach(x => set.add(x));
  return slotViolation(idx.rules, teacherId, d, p, set, tf);
}
// قاعدة التوزيع اليومي: حصص نفس المادة لنفس الشعبة تتوزع بالتساوي على أيام الأسبوع
function dailyLimits(n, c, idx) {
  const D = c && idx ? sectionDays(idx.rules, c) : ttDims().D;
  const cap = Math.max(1, Math.ceil(n / D)), f = Math.floor(n / D), r = n - D * f;
  return { cap, allowDays: cap > f ? r : D };
}
// هل نقل الحصة x إلى اليوم d يخالف القاعدة؟ (exclude: حصص ستُزاح من نفس اليوم)
function dailyViolation(idx, x, d, excludeSameDay = 0) {
  if (x.d === d) return null;
  const { D } = ttDims();
  if (idx.rules.sections?.[x.c]?.owners.some(o => o.t === x.t)) return null; // صاحب يوم مخصص
  const k = x.c + "|" + x.s, n = idx.kN.get(k) || 0;
  const { cap, allowDays } = dailyLimits(n, x.c, idx);
  const cnt = dd => (idx.kDay.get(k + "@" + dd) || 0) - (dd === x.d ? 1 : 0) - (dd === d ? excludeSameDay : 0);
  const target = cnt(d) + 1;
  const r = idx.rules.teachers[x.t];
  const isDouble = r?.mode === "double";
  if (target > cap + (isDouble ? 1 : 0)) return dailyMsg(x, cnt(d), n);
  if (!isDouble && cap > 1) {
    let atCap = 0;
    for (let dd = 0; dd < D; dd++) if ((dd === d ? target : cnt(dd)) >= cap) atCap++;
    if (atCap > allowDays) return dailyMsg(x, cnt(d), n);
  }
  return null;
}
const dailyMsg = (x, have, n) => tf("لا يمكن: الشعبة {0} عندها {1} حصة {2} في هذا اليوم. حصص المادة ({3} أسبوعيًا) تتوزع بالتساوي على الأيام.", secLabel(section(x.c)), have, subject(x.s)?.name || "", n);
// الحصص المخالفة حاليًا (مثل جدول مستورد)
function dailyViolators(idx) {
  const { D } = ttDims();
  const bad = new Set();
  const byK = new Map();
  TT.lessons.forEach((x, i) => { if (x.d == null) return; const k = x.c + "|" + x.s; if (!byK.has(k)) byK.set(k, []); byK.get(k).push(i); });
  for (const [k, list] of byK) {
    const t = TT.lessons[list[0]].t;
    if (idx.rules.teachers[t]?.mode === "double") continue;
    const c0 = TT.lessons[list[0]].c;
    if (idx.rules.sections?.[c0]?.owners.some(o => o.t === t)) continue;
    const { cap, allowDays } = dailyLimits(idx.kN.get(k) || 0, c0, idx);
    const per = new Map(); list.forEach(i => { const d = TT.lessons[i].d; per.set(d, (per.get(d) || 0) + 1); });
    const atCap = [...per.values()].filter(v => v >= cap).length;
    list.forEach(i => { const v = per.get(TT.lessons[i].d); if (v > cap || (cap > 1 && v >= cap && atCap > allowDays) || (cap === 1 && v > 1)) bad.add(i); });
  }
  return bad;
}
function secCheck(idx, x, d, p, excl = []) {
  const counts = {
    owner: (c, dd) => { const own = idx.rules.sections[c]?.owners.find(o => o.d === dd); if (!own) return 0; return (idx.cdT.get(c + "@" + dd)?.get(own.t) || 0) - excl.filter(e => e.c === c && e.d === dd && e.t === own.t).length; },
    nonOwner: (c, dd) => { const own = idx.rules.sections[c]?.owners.find(o => o.d === dd); const m = idx.cdT.get(c + "@" + dd); if (!m) return 0; let n = 0; m.forEach((v, t) => { if (t !== own?.t) n += v; }); return n - excl.filter(e => e.c === c && e.d === dd && e.t !== own?.t).length; }
  };
  return sectionViolation(idx.rules, x, d, p, counts, tf, { section: c => secLabel(section(c)), teacher: t => shortName(teacherOf(t)?.name), day: dd => tr(settings().days[dd] || "") });
}
function canMove(i, d, p, idx) {
  const L = TT.lessons[i];
  if (L.d === d && L.p === p) return { ok: false, same: true };
  const { P } = ttDims();
  const from = L.d != null ? L.d * P + L.p : -1, to = d * P + p;
  // الأوقات المغلقة أولًا (فارغة للجميع، اجتماع، تفريغ، قيود الشعبة) لتظهر رسالتها بوضوح
  {
    const tr0 = idx.rules.teachers[L.t];
    if (idx.rules.globalBlocked.has(to) || tr0?.unavail?.has(to) || tr0?.meetings?.has(to)) return { ok: false, reason: slotViolation(idx.rules, L.t, d, p, new Set(), tf) };
    if (idx.rules.sections?.[L.c]?.blocked.has(to)) return { ok: false, reason: secCheck(idx, L, d, p, [L]) };
  }
  const a = idx.tS.get(`${L.t}@${d}.${p}`), b = idx.cS.get(`${L.c}@${d}.${p}`);
  if (a == null && b == null) {
    const v = ruleCheck(idx, L.t, d, p, from >= 0 ? [from] : []) || secCheck(idx, L, d, p, [L]) || dailyViolation(idx, L, d);
    return v ? { ok: false, reason: v } : { ok: true };
  }
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
  if ((ta == null || ta === i) && (cb == null || cb === i)) {
    { const v = secCheck(idx, L, d, p, [L, J]) || secCheck(idx, J, L.d, L.p, [L, J]); if (v) return { ok: false, reason: v }; }
    if (L.c + "|" + L.s !== J.c + "|" + J.s && L.d !== d) {
      const v = dailyViolation(idx, L, d, J.c === L.c && J.s === L.s ? 1 : 0) || dailyViolation(idx, J, L.d);
      if (v) return { ok: false, reason: v };
    }
    if (J.t !== L.t) {
      // تبديل بين معلمين مختلفين: نتحقق من قيود الاثنين
      const v1 = ruleCheck(idx, L.t, d, p, [from]);
      if (v1) return { ok: false, reason: v1 };
      const v2 = ruleCheck(idx, J.t, L.d, L.p, [to]);
      if (v2) return { ok: false, reason: tf("لا يمكن التبديل: {0}", `${shortName(teacherOf(J.t)?.name)} — ${v2}`) };
    }
    return { ok: true, swap: j };
  }
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
    ? S.teachers.filter(t => tLoads.has(t.id) && (!TV.dept || deptsOfTeacher(t).some(x => x.id === TV.dept))).map(t => ({ id: t.id, name: t.name }))
    : S.sections.filter(s => cLoads.has(s.id)).map(s => ({ id: s.id, name: secLabel(s) }));
  if (!ents.some(e => e.id === TV.id)) TV.id = ents[0]?.id || null;
  // نص البحث لكل عنصر: المعلم = الاسم + مواده + شعبه، الشعبة = اسمها + الصف + موادها + معلميها
  {
    const subsOf = new Map(), othersOf = new Map();
    for (const x of all) {
      const k = TV.mode === "teacher" ? x.t : x.c, o = TV.mode === "teacher" ? x.c : x.t;
      if (!subsOf.has(k)) { subsOf.set(k, new Set()); othersOf.set(k, new Set()); }
      subsOf.get(k).add(x.s); othersOf.get(k).add(o);
    }
    for (const e of ents) {
      const subs = [...(subsOf.get(e.id) || [])].map(id => subject(id)?.name).filter(Boolean);
      const oth = [...(othersOf.get(e.id) || [])].map(id => TV.mode === "teacher" ? (section(id) ? secLabel(section(id)) : "") : teacherOf(id)?.name).filter(Boolean);
      const grade = TV.mode === "section" ? S.grades.find(g => g.id === section(e.id)?.gradeId)?.name || "" : "";
      e.sub = TV.mode === "teacher" ? subs.join("، ") : [grade, subs.length ? tf("{0} مواد", subs.length) : ""].filter(Boolean).join(" · ");
      e.subs = subs;
      e.q = norm([e.name, grade, ...subs, ...oth].join(" "));
    }
  }
  TT_ENTS = ents;
  const unByEnt = new Map();
  for (const x of all) if (x.d == null) { const k = TV.mode === "teacher" ? x.t : x.c; unByEnt.set(k, (unByEnt.get(k) || 0) + 1); }
  const pos = ents.findIndex(e => e.id === TV.id);

  return `
  <div class="page-title"><h1>توزيع الجدول</h1>
    <div class="row-actions">
      <span id="ttSave" class="save-state ok">محفوظ</span>
      <button class="btn" id="ttClear" title="${tr("مسح الجدول")}"><span data-ic="trash" data-size="18"></span>${tr("مسح الجدول")}</button>
      <button class="btn" id="ttPrint"><span data-ic="download" data-size="18"></span>تحميل PDF</button>
      <label class="half-tog" title="${tr("حصص كل معلم في الأسبوع: نصفها في الحصص الأولى ونصفها في الحصص الأخيرة")}"><input type="checkbox" id="ttHalf" ${settings().halfBalance ? "checked" : ""}><span class="sw"></span><span>${tf("توزيع منصف (1–{0} / {1}–{2})", Math.ceil(ttDims().P / 2), Math.ceil(ttDims().P / 2) + 1, ttDims().P)}</span></label>
      <button class="btn primary" id="ttGen"><span data-ic="magic" data-size="18"></span>توزيع تلقائي</button>
    </div>
  </div>

  <div class="tt-stats" id="ttStats">${ttStatsHTML()}</div>
  <div id="pubBar"></div>
  ${overT.length || overC.length ? `<div class="notice bad">${overT.map(([id, n]) => esc(tf("المعلم {0} لديه {1} حصة والأسبوع فيه {2} حصة فقط", teacherOf(id)?.name, n, cap))).join("<br>")}${overT.length && overC.length ? "<br>" : ""}${overC.map(([id, n]) => esc(tf("الشعبة {0} لديها {1} حصة والأسبوع فيه {2} حصة فقط", secLabel(section(id)), n, cap))).join("<br>")}</div>` : ""}

  <div class="card tt-card">
    <div class="tt-bar">
      <div class="seg" id="ttMode">
        <button data-m="teacher" class="${TV.mode === "teacher" ? "active" : ""}">المعلمون</button>
        <button data-m="section" class="${TV.mode === "section" ? "active" : ""}">الشعب</button>
      </div>
      ${TV.mode === "teacher" && S.departments.length ? `<select id="ttDept" class="tt-dept"><option value="">${tr("كل الأقسام")}</option>${S.departments.map(d => `<option value="${d.id}" ${TV.dept === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>` : ""}
      ${TV.mode === "teacher" && teacherOf(TV.id) && teacherPhone(teacherOf(TV.id)) ? `<div class="tt-wa" data-id="${TV.id}">${waBtn(teacherOf(TV.id), "lg")}</div>` : ""}
      <div class="tt-find">
        <span class="tt-find-ic" data-ic="search" data-size="18"></span>
        <input type="search" id="ttFind" autocomplete="off" placeholder="${esc(tr(TV.mode === "teacher" ? "ابحث باسم المعلم أو المادة" : "ابحث باسم الشعبة أو المادة"))}">
        <div class="tt-find-list hidden" id="ttFindList"></div>
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

function ttStatsHTML() {
  const all = TT.lessons || [], placed = all.filter(x => x.d != null).length, locked = all.filter(x => x.l).length;
  return `<div><b>${all.length}</b><span>${tr("إجمالي الحصص")}</span></div>
    <div><b class="okc">${placed}</b><span>${tr("موزّعة")}</span></div>
    <div><b class="${all.length - placed ? "badc" : ""}">${all.length - placed}</b><span>${tr("لم توزّع بعد")}</span></div>
    <div><b>${locked}</b><span>${tr("مثبتة")}</span></div>`;
}
// تحديث سريع بعد أي تعديل (بدون إعادة بناء الصفحة)
function ttRefresh() {
  ttDraw();
  updatePubBar();
  const st = $("ttStats"); if (st) st.innerHTML = ttStatsHTML();
  const sel = $("ttSel");
  if (sel) {
    const un = new Map();
    for (const x of TT.lessons) if (x.d == null) { const k = TV.mode === "teacher" ? x.t : x.c; un.set(k, (un.get(k) || 0) + 1); }
    [...sel.options].forEach(o => {
      const base = o.dataset.name || (o.dataset.name = o.textContent.replace(/\s*\(.*\)$/, ""));
      o.textContent = base + (un.get(o.value) ? ` (${un.get(o.value)} ${tr("غير موزّعة")})` : "");
    });
  }
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
      if (opts.interactive && i === TV.flash) cls += " flash";
      if (opts.bad?.has(i)) cls += " viol";
      inner = `<div class="lsn" style="--c:${sb?.color || "#64748b"}"><b>${esc(main)}</b><small>${esc(sub)}</small>${x.l ? `<i class="lk" data-ic="lock" data-size="12"></i>` : ""}</div>`;
      data += ` data-i="${i}"`;
    }
    const sl = d * P + p;
    const sb = mode === "section" ? idx.rules.sections?.[id]?.blocked.get(sl) : null;
    const blk = idx.rules.globalBlocked.has(sl) ? tr("فارغة للجميع")
      : sb ? tr(sb === "dismiss" ? "انصراف" : "فارغة للشعبة")
      : mode === "teacher" && idx.rules.teachers[id]?.unavail.has(sl) ? tr("تفريغ")
      : (mode === "teacher" && idx.rules.teachers[id]?.meetings.has(sl) ? tf("اجتماع {0}", idx.rules.teachers[id].meetings.get(sl)) : null);
    if (blk) { cls += i != null ? " viol" : " blk"; if (i == null) inner = `<div class="blk-l"><span data-ic="lock" data-size="12"></span>${esc(blk)}</div>`; }
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
  if (TV.flash != null) { clearTimeout(TV.flashT); TV.flashT = setTimeout(() => { TV.flash = null; }, 1600); }
  const idx = ttIndex();
  ttOrient = innerWidth < 700;
  const bad = dailyViolators(idx);
  grid.innerHTML = `${bad.size ? `<div class="notice bad viol-note">${esc(tf("{0} حصة مخالفة لقاعدة التوزيع اليومي (مظللة بالأحمر). اضغط «توزيع تلقائي» لإعادة توزيعها، أو انقلها يدويًا.", bad.size))}</div>` : ""}<div class="tt-wrap">${ttGridHTML(TV.mode, TV.id, { interactive: true, transpose: ttOrient, idx, bad })}</div>`;
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
    bar.innerHTML = `<div class="sb-info"><span class="dot" style="background:${sb?.color}"></span><b>${esc(sb?.name || "")}</b> · ${esc(secLabel(section(x.c)))} · ${esc(shortName(teacherOf(x.t)?.name))}<div class="sb-hint">👆 ${tr("اضغط على خانة خضراء لنقل الحصة")}</div></div>
      <div class="row-actions">
        ${x.d != null ? `<button class="btn sm" data-sa="lock"><span data-ic="lock" data-size="15"></span>${tr(x.l ? "إلغاء التثبيت" : "تثبيت")}</button><button class="btn sm sb-del" data-sa="remove">${tr("حذف من الجدول")}</button>` : ""}
        <button class="btn sm ghost" data-sa="cancel">${tr("إلغاء")}</button>
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
  {
    const inp = $("ttFind"), list = $("ttFindList");
    const show = () => {
      const words = norm(inp.value).split(" ").filter(Boolean);
      if (!words.length) { list.classList.add("hidden"); list.innerHTML = ""; return; }
      const hits = TT_ENTS.filter(e => words.every(w => e.q.includes(w)));
      list.innerHTML = hits.length ? hits.slice(0, 40).map(e => `<button type="button" data-id="${esc(e.id)}" class="${e.id === TV.id ? "on" : ""}"><b data-no-i18n>${esc(e.name)}</b>${e.sub ? `<small data-no-i18n>${esc(e.sub)}</small>` : ""}</button>`).join("")
        + (hits.length > 40 ? `<div class="muted tt-find-more">${esc(tf("و{0} نتيجة أخرى، اكتب أكثر لتضييق البحث", hits.length - 40))}</div>` : "")
        : `<div class="muted tt-find-more">${esc(tr("لا توجد نتائج"))}</div>`;
      list.classList.remove("hidden");
    };
    inp.addEventListener("input", show); inp.addEventListener("focus", show); inp.addEventListener("search", show);
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") { const b = list.querySelector("button"); if (b) { e.preventDefault(); b.click(); } }
      if (e.key === "Escape") { inp.value = ""; show(); inp.blur(); }
    });
    list.addEventListener("mousedown", e => e.preventDefault());
    list.onclick = e => { const b = e.target.closest("button[data-id]"); if (!b) return; TV.id = b.dataset.id; TV.sel = null; render(); };
    document.addEventListener("click", function off(e) {
      if (!document.body.contains(inp)) return document.removeEventListener("click", off);
      if (!e.target.closest(".tt-find")) list.classList.add("hidden");
    });
  }
  v.querySelector(".tt-wa [data-act=wa]")?.addEventListener("click", e => { e.stopPropagation(); waTeacher(teacherOf(TV.id)); });
  if ($("ttDept")) $("ttDept").onchange = e => { TV.dept = e.target.value || null; TV.id = null; TV.sel = null; render(); };
  const step = k => { const o = [...$("ttSel").options]; const i = o.findIndex(x => x.selected) + k; if (o[i]) { TV.id = o[i].value; TV.sel = null; render(); } };
  $("ttPrev").onclick = () => step(-1);
  $("ttNext").onclick = () => step(1);
  $("ttGen").onclick = ttGenerate;
  $("ttClear").onclick = ttClearModal;
  $("ttHalf").onchange = async e => {
    const on = e.target.checked;
    try {
      await updateDoc(doc(db, "schools", SID), { settings: { ...cleanSettings(), halfBalance: on }, updatedAt: serverTimestamp() });
      toast(on ? tr("سيتم توزيع حصص كل معلم بالتساوي بين الحصص الأولى والأخيرة عند التوزيع التلقائي القادم") : tr("تم إيقاف التوزيع المنصف"), "success");
    } catch (er) { e.target.checked = !on; toast(errMsg(er), "error"); }
  };
  updatePubBar();
  $("ttPrint").onclick = ttPrintMenu;

  v.onclick = async e => {
    if (!TT.lessons) ttSync();
    const chip = e.target.closest(".tray-chip");
    if (chip) { const i = +chip.dataset.i; TV.sel = TV.sel === i ? null : i; return ttDraw(); }
    const sa = e.target.closest("[data-sa]");
    if (sa && TV.sel != null) {
      const x = TT.lessons[TV.sel], label = `${subject(x.s)?.name || ""} (${secLabel(section(x.c))})`;
      if (sa.dataset.sa === "cancel") { TV.sel = null; return ttDraw(); }
      if (sa.dataset.sa === "lock") {
        x.l = !x.l; TV.sel = null; TV.flash = TT.lessons.indexOf(x); ttMark(); ttRefresh();
        return toast(x.l ? tf("تم تثبيت الحصة {0}", label) : tf("تم إلغاء تثبيت الحصة {0}", label), "success");
      }
      if (sa.dataset.sa === "remove") {
        TV.sel = null; ttDraw();
        if (!(await confirmBox(tf("هل أنت متأكد من حذف حصة {0} من الجدول؟ ستنتقل إلى قائمة الحصص غير الموزّعة ويمكنك إعادتها لاحقًا.", label), tr("حذف")))) return;
        x.d = x.p = null; x.l = false; ttMark(); ttRefresh();
        return toast(tf("تم حذف الحصة {0} من الجدول", label), "success");
      }
      return;
    }
    const td = e.target.closest("td.tt-cell");
    if (!td) {
      // ضغط خارج الجدول يلغي التحديد
      if (TV.sel != null && !e.target.closest("#selBar, .tt-bar, button, select, a")) { TV.sel = null; ttDraw(); }
      return;
    }
    const d = +td.dataset.d, p = +td.dataset.p, i = td.dataset.i != null ? +td.dataset.i : null;
    if (TV.sel == null) { if (i != null) { TV.sel = i; TV.flash = null; ttDraw(); } return; }
    if (i === TV.sel) { TV.sel = null; return ttDraw(); }
    const r = canMove(TV.sel, d, p, ttIndex());
    if (!r.ok) {
      if (i != null) { TV.sel = i; return ttDraw(); }
      td.classList.remove("shake"); void td.offsetWidth; td.classList.add("shake");
      if (r.reason) toast(r.reason, "error");
      return;
    }
    const L = TT.lessons[TV.sel];
    if (r.swap != null) { const J = TT.lessons[r.swap]; J.d = L.d; J.p = L.p; }
    L.d = d; L.p = p; L.l = true;
    TV.sel = null; TV.flash = TT.lessons.indexOf(L);
    ttMark(); ttRefresh();
    toast(r.swap != null ? tr("تم تبديل الحصتين وتثبيتهما 🔒") : tr("تم نقل الحصة وتثبيتها 🔒"), "success");
  };
};

window.addEventListener("resize", () => {
  if (location.hash === "#timetable" && ttOrient !== null && (innerWidth < 700) !== ttOrient) ttDraw();
});

async function ttGenerate() {
  const placed = TT.lessons.filter(x => x.d != null && !x.l).length;
  if (placed && !(await confirmBox(tf("سيتم إعادة توزيع كل الحصص غير المثبتة. هل تريد المتابعة؟"), "توزيع", false))) return;
  const { D, P } = ttDims();
  const rules = ttRules();
  const issues = precheck(rules, TT.lessons);
  if (issues.length && !(await precheckModal(issues))) return;
  openModal(`<div class="gen-box"><div class="spinner"></div><h3>جارٍ توزيع الحصص</h3><div class="progress"><i id="genBar"></i></div><p class="muted" id="genTxt"></p></div>`);
  $("modalBack").dataset.lock = "1";
  const input = TT.lessons.map(x => x.l ? x : { ...x, d: null, p: null });
  const r = await schedule({
    D, P, lessons: input, rules, timeBudget: 6000, maxTries: 120, halfBalance: !!settings().halfBalance,
    onProgress: pr => {
      const b = $("genBar"); if (b) b.style.width = Math.min(100, Math.max(pr.tries / pr.maxTries, pr.elapsed / 6000) * 100) + "%";
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
  if (r.balance?.length) setTimeout(() => balanceReport(r.balance, r.H, P), 600);
  if (r.lockedDropped) setTimeout(() => toast(tf("{0} حصة مثبتة كانت في وقت اجتماع أو حصة فارغة فأُعيد توزيعها", r.lockedDropped)), 3500);
}
function ttClearModal() {
  const placed = TT.lessons.filter(x => x.d != null), locked = placed.filter(x => x.l).length;
  if (!placed.length) return toast(tr("الجدول فارغ بالفعل"));
  openModal(`${modalHead(tr("مسح الجدول"))}
    <p style="margin-top:0">${tf("في الجدول الآن {0} حصة موزّعة، منها {1} مثبتة 🔒.", placed.length, locked)}</p>
    <label class="check clr-opt"><input type="radio" name="clr" value="unlocked" ${locked ? "checked" : "disabled"}> ${tr("مسح الحصص غير المثبتة فقط (تبقى المثبتة في مكانها)")}</label>
    <label class="check clr-opt"><input type="radio" name="clr" value="all" ${locked ? "" : "checked"}> ${tr("مسح كل الحصص حتى المثبتة")}</label>
    <div class="notice warn" style="margin-top:.8rem">${tr("المعلمون والشعب والمواد وأنصبة الحصص لا تُحذف — فقط تفرغ الجداول وترجع الحصص إلى قائمة «غير الموزّعة»، وتقدر توزّعها من جديد بالتوزيع التلقائي.")}</div>
    <div class="modal-actions"><button class="btn danger" id="clrGo"><span data-ic="trash" data-size="18"></span>${tr("مسح")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  fillIcons($("modal"));
  $("clrGo").onclick = () => {
    const all = document.querySelector("input[name=clr]:checked")?.value === "all";
    let n = 0;
    TT.lessons = TT.lessons.map(x => { if (x.d == null || (x.l && !all)) return x; n++; return { ...x, d: null, p: null, l: false }; });
    TV.sel = null; ttMark(); closeModal(); render();
    toast(tf("تم مسح {0} حصة من الجدول", n), "success");
  };
}

// =====================================================
//  الجدول العام للمعلمين
// =====================================================
function genModel() {
  ttSync();
  const st = settings();
  return generalModel({ lessons: TT.lessons, teachers: S.teachers, subjects: S.subjects, days: st.days, P: st.periods.length });
}
const genOpts = () => ({ days: settings().days, P: settings().periods.length, secLabel: id => secLabel(section(id)), subjName: id => subject(id)?.name || "", school: S.school?.name || "",
  stamp: new Date().toLocaleDateString(isEn ? "en-GB" : "ar-OM", { dateStyle: "long" }) });
function vGeneral() {
  const m = genModel();
  return `<div class="page-title"><h1>${tr("الجدول العام للمعلمين")}</h1>
    <div class="row-actions"><button class="btn primary" id="genPdf" ${m.count ? "" : "disabled"}><span data-ic="download" data-size="18"></span>${tr("تحميل PDF (A3)")}</button></div></div>
    <div class="notice info">${tr("جدول واحد لكل المعلمين للتعليق في المدرسة: الخانة فيها رمز الشعبة، والخانة الفارغة تعني أن المعلم فارغ.")} ${tr("يظهر للمعلمين في حساباتهم بآخر نسخة أرسلتها بزر «إرسال التحديث للمعلمين».")}</div>
    ${m.count ? `<div class="card">
      <div class="gen-tools"><input type="search" data-gsearch placeholder="${tr("ابحث باسم المعلم أو المادة أو الشعبة…")}"><span class="gen-free hidden" data-gfree></span></div>
      <div class="gen-wrap">${generalTable(m, genOpts())}</div>
      <p class="gen-hint">${tr("اضغط على رقم أي حصة لإظهار المعلمين الفارغين فيها، واضغط على اسم معلم لتمييز صفه.")} · ${tf("{0} معلم · {1} حصة", m.count, m.lessons)}</p>
    </div>` : `<div class="card"><div class="empty">${tr("لا يوجد جدول موزّع بعد.")} <a href="#timetable">${tr("اذهب لتوزيع الجدول")}</a></div></div>`}`;
}
BIND.general = view => {
  bindGeneral(view);
  $("genPdf") && ($("genPdf").onclick = async () => {
    const b = $("genPdf"); b.disabled = true; toast(tr("جارٍ تجهيز الملف"));
    try { await downloadGeneralPDF(genModel(), genOpts(), `${tr("الجدول العام للمعلمين")} - ${S.school?.name || ""}`); }
    catch (e) { console.error(e); toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
    b.disabled = false;
  });
};

// =====================================================
//  طلبات المعلمين: تبديل حصة / احتياط
// =====================================================
const REQ = { list: [], showOld: false };
const REQ_ST = { peer: ["بانتظار موافقة الزميل", "info"], pending: ["بانتظار موافقة المدرسة", "warn"], approved: ["تمت الموافقة", "ok"], rejected: ["مرفوض", "bad"], declined: ["رفضه الزميل", "bad"], cancelled: ["ألغاه المعلم", "muted"] };
const slotTxt = x => x ? `${settings().days[x.d] || ""} · ${tf("ح{0}", x.p + 1)} · ${secLabel(section(x.c))} ${subject(x.s)?.name || ""}` : "";
function reqCard(r, actions) {
  const st = REQ_ST[r.status] || [r.status, "muted"];
  const who = teacherOf(r.from)?.name || r.fromName || "؟", peer = r.to ? (teacherOf(r.to)?.name || r.toName || "؟") : "";
  const body = r.kind === "swap"
    ? `<div class="rq-swap"><div><small>${esc(who)}</small><b>${esc(slotTxt(r.a))}</b></div><span class="rq-arrow">⇄</span><div><small>${esc(peer)}</small><b>${esc(slotTxt(r.b))}</b></div></div>
       <small class="muted">${r.mode === "perm" ? tr("تبديل دائم (يتغير الجدول الأساسي)") : tf("تبديل ليوم {0} فقط", r.date || "")}</small>`
    : `<div><b>${esc(tf("احتياط يوم {0}", r.date || ""))}</b> — ${esc((r.periods || []).map(p => tf("ح{0}", p + 1)).join("، "))}</div>`;
  return `<div class="rq-card" data-rq="${r.id}">
    <div class="rq-h"><b data-no-i18n>${esc(who)}</b><span class="badge ${st[1]}">${tr(st[0])}</span><span class="rq-kind">${r.kind === "swap" ? tr("طلب تبديل") : tr("طلب احتياط")}</span></div>
    ${body}${r.note ? `<p class="rq-note">“${esc(r.note)}”</p>` : ""}${r.reason && r.status === "rejected" ? `<p class="rq-note bad">${esc(tf("سبب الرفض: {0}", r.reason))}</p>` : ""}
    <small class="muted">${esc(new Date(r.at || 0).toLocaleString(isEn ? "en-GB" : "ar-OM", { dateStyle: "medium", timeStyle: "short" }))}</small>
    ${actions ? `<div class="rq-act"><button class="btn sm primary" data-rq-ok="${r.id}">${tr("موافقة")}</button><button class="btn sm danger" data-rq-no="${r.id}">${tr("رفض")}</button></div>` : ""}
  </div>`;
}
function vRequests() {
  const pend = REQ.list.filter(r => r.status === "pending"), peer = REQ.list.filter(r => r.status === "peer");
  const old = REQ.list.filter(r => !["pending", "peer"].includes(r.status));
  return `<div class="page-title"><h1>${tr("طلبات المعلمين")}</h1></div>
    <div class="notice info">${tr("يرسل المعلمون من حساباتهم طلبات تبديل حصة مع زميل (بعد موافقة الزميل) أو طلب احتياط، وتصل هنا للموافقة أو الرفض.")}</div>
    <div class="card"><div class="card-head"><h3>${tr("بانتظار موافقتك")}</h3><span class="badge warn">${pend.length}</span></div>
      ${pend.length ? `<div class="rq-list">${pend.map(r => reqCard(r, true)).join("")}</div>` : `<div class="empty">${tr("لا توجد طلبات جديدة")}</div>`}</div>
    ${peer.length ? `<div class="card"><h3>${tr("بانتظار موافقة الزميل")}</h3><div class="rq-list">${peer.map(r => reqCard(r)).join("")}</div></div>` : ""}
    ${old.length ? `<div class="card"><h3>${tr("السجل")}</h3><div class="rq-list">${old.slice(0, REQ.showOld ? 200 : 10).map(r => reqCard(r)).join("")}</div>
      ${!REQ.showOld && old.length > 10 ? `<button class="btn ghost block" id="rqMore">${tf("عرض الكل ({0})", old.length)}</button>` : ""}</div>` : ""}`;
}
BIND.requests = view => {
  $("rqMore") && ($("rqMore").onclick = () => { REQ.showOld = true; render(); });
  view.onclick = e => {
    const ok = e.target.closest("[data-rq-ok]"), no = e.target.closest("[data-rq-no]");
    if (ok) approveReq(REQ.list.find(r => r.id === ok.dataset.rqOk));
    if (no) rejectReq(REQ.list.find(r => r.id === no.dataset.rqNo));
  };
};
const reqRef = id => dref("requests", id);
async function decide(r, patch) { await updateDoc(reqRef(r.id), { ...patch, decidedAt: Date.now() }); }
function rejectReq(r) {
  if (!r) return;
  openModal(`${modalHead(tr("رفض الطلب"))}<div class="field"><label>${tr("سبب الرفض (اختياري، يصل للمعلم)")}</label><input id="rqWhy" maxlength="140"></div>
    <div class="modal-actions"><button class="btn danger" id="rqNoGo">${tr("رفض")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  $("rqNoGo").onclick = async () => {
    try { await decide(r, { status: "rejected", reason: $("rqWhy").value.trim() }); closeModal(); toast(tr("تم رفض الطلب"), "success"); }
    catch (e) { toast(errMsg(e), "error"); }
  };
}
// يتحقق أن الحصتين ما زالتا في مكانهما وأن التبديل لا يسبب تعارضًا
function swapCheck(r) {
  ttSync();
  const { P } = ttDims(), L = TT.lessons;
  const find = (t, x) => L.findIndex(l => l.t === t && l.d === x.d && l.p === x.p && l.c === x.c);
  const ia = find(r.from, r.a), ib = find(r.to, r.b);
  if (ia < 0 || ib < 0) return { err: tr("تغيّر الجدول منذ إرسال الطلب: إحدى الحصتين لم تعد في مكانها.") };
  if (r.mode !== "perm") return { ia, ib };
  const busy = (t, x, skip) => L.some((l, i) => i !== skip && l.t === t && l.d === x.d && l.p === x.p);
  if (busy(r.from, r.b, ib)) return { err: tf("{0} لديه حصة أخرى في وقت حصة الزميل.", teacherOf(r.from)?.name || "") };
  if (busy(r.to, r.a, ia)) return { err: tf("{0} لديه حصة أخرى في وقت الحصة المطلوبة.", teacherOf(r.to)?.name || "") };
  const R = buildRules({ settings: settings(), departments: S.departments, teachers: S.teachers, sections: S.sections });
  const slots = (t, skip) => new Set(L.filter((l, i) => i !== skip && l.t === t && l.d != null).map(l => l.d * P + l.p));
  const v1 = slotViolation(R, r.from, r.b.d, r.b.p, slots(r.from, ia), tf), v2 = slotViolation(R, r.to, r.a.d, r.a.p, slots(r.to, ib), tf);
  return { ia, ib, warn: [v1 && `${teacherOf(r.from)?.name}: ${v1}`, v2 && `${teacherOf(r.to)?.name}: ${v2}`].filter(Boolean) };
}
function approveReq(r) {
  if (!r) return;
  if (r.kind === "sub") {
    return confirmBox(tf("سيُسجَّل غياب {0} يوم {1} في الحصص المطلوبة، ثم تختار البديل من صفحة الاحتياط.", teacherOf(r.from)?.name || "", r.date), tr("موافقة"), false).then(async ok => {
      if (!ok) return;
      try {
        await addDoc(col("absences"), { teacherId: r.from, from: r.date, to: r.date, periods: r.periods?.length ? r.periods : null, reason: "other", note: r.note || "", reqId: r.id, at: Date.now() });
        await decide(r, { status: "approved" });
        toast(tr("تمت الموافقة — اختر البديل الآن"), "success");
        SUB.date = r.date; location.hash = "#subs";
      } catch (e) { toast(errMsg(e), "error"); }
    });
  }
  const c = swapCheck(r);
  if (c.err) return openModal(`${modalHead(tr("لا يمكن تنفيذ التبديل"))}<div class="notice bad">${esc(c.err)}</div>
    <div class="modal-actions"><button class="btn danger" id="rqAutoNo">${tr("رفض الطلب")}</button><button class="btn ghost" data-close>${tr("إغلاق")}</button></div>`), ($("rqAutoNo").onclick = async () => { await decide(r, { status: "rejected", reason: c.err }).catch(() => {}); closeModal(); });
  openModal(`${modalHead(tr("الموافقة على التبديل"))}
    ${reqCard(r)}
    ${c.warn?.length ? `<div class="notice warn">${c.warn.map(esc).join("<br>")}</div>` : ""}
    <p class="muted">${r.mode === "perm" ? tr("سيتغيّر الجدول الأساسي للمعلمين الاثنين، ثم أرسل التحديث للمعلمين.") : tr("الجدول الأساسي لا يتغيّر؛ التبديل يظهر للمعلمين في ذلك اليوم فقط.")}</p>
    <div class="modal-actions"><button class="btn primary" id="rqGo">${tr("موافقة")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
  $("rqGo").onclick = async () => {
    try {
      if (r.mode === "perm") {
        const A = TT.lessons[c.ia], Bl = TT.lessons[c.ib];
        TT.lessons[c.ia] = { ...A, d: r.b.d, p: r.b.p }; TT.lessons[c.ib] = { ...Bl, d: r.a.d, p: r.a.p };
        ttMark();
      }
      await decide(r, { status: "approved" });
      closeModal(); toast(tr("تمت الموافقة على التبديل"), "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
}
// تبديلات اليوم المعتمدة (تظهر في صفحة الاحتياط)
const daySwaps = date => REQ.list.filter(r => r.kind === "swap" && r.status === "approved" && r.mode !== "perm" && r.date === date);

function balanceReport(list, H, P) {
  list.sort((a, b) => Math.abs(b.early - b.late) - Math.abs(a.early - a.late));
  openModal(`${modalHead(tr("التوزيع المنصف للفترات"))}
    <p style="margin-top:0">${tf("تم التوزيع، لكن {0} معلم لم يصل للنصف بالنصف بسبب القيود (حصص فارغة، أيام مخصصة، تعارضات):", list.length)}</p>
    <table class="tbl bal-tbl"><thead><tr><th>${tr("المعلم")}</th><th>${tf("الحصص 1–{0}", H)}</th><th>${tf("الحصص {0}–{1}", H + 1, P)}</th></tr></thead>
    <tbody>${list.map(c => `<tr><td data-no-i18n>${esc(teacherOf(c.t)?.name || "")}</td><td>${c.early}</td><td>${c.late}</td></tr>`).join("")}</tbody></table>
    <p class="muted" style="font-size:.85rem">${tr("يمكنك تعديل حصصهم يدويًا بالنقل أو التبديل، أو إعادة التوزيع التلقائي لمحاولة أخرى.")}</p>
    <div class="modal-actions"><button class="btn primary" data-close>${tr("حسنًا")}</button></div>`);
}
function precheckModal(issues) {
  return new Promise(resolve => {
    openModal(`${modalHead(tr("تنبيه قبل التوزيع"))}
      <p style="margin-top:0">${tr("بعض القيود لا يمكن تحقيقها بالكامل، وستبقى حصص بدون مكان:")}</p>
      <div class="notice warn"><ul>${issues.slice(0, 15).map(x => `<li>${esc(x.k === "teacher"
        ? tf("المعلم {0}: لديه {1} حصة والمتاح له {2} فقط بسبب القيود", teacherOf(x.id)?.name || "", x.need, x.have)
        : tf("الشعبة {0}: لديها {1} حصة والمتاح {2} فقط (بسبب الأوقات الفارغة)", secLabel(section(x.id)), x.need, x.have))}</li>`).join("")}
        ${issues.length > 15 ? `<li>${esc(tf("و{0} أخرى…", issues.length - 15))}</li>` : ""}</ul></div>
      <p class="muted">${tr("يمكنك تخفيف القيود أو تقليل الحصص، أو المتابعة وتوزيع الحصص المتبقية يدويًا.")}</p>
      <div class="modal-actions"><button class="btn primary" data-go>${tr("متابعة التوزيع")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
    $("modal").onclick = e => {
      if (e.target.closest("[data-go]")) { $("modal").onclick = null; resolve(true); }
      else if (e.target.closest("[data-close]")) { $("modal").onclick = null; resolve(false); }
    };
  });
}

// ---------- الطباعة والتحميل ----------
function sheetFor(mode, id) {
  const rules = ttRules(), { P } = ttDims(), blocked = new Map();
  rules.globalBlocked.forEach(sl => blocked.set(sl, tr("فارغة للجميع")));
  if (mode === "teacher") rules.teachers[id]?.meetings.forEach((name, sl) => { if (!blocked.has(sl)) blocked.set(sl, tf("اجتماع {0}", name)); });
  if (mode === "teacher") rules.teachers[id]?.unavail.forEach(sl => { if (!blocked.has(sl)) blocked.set(sl, tr("تفريغ")); });
  if (mode === "section") rules.sections?.[id]?.blocked.forEach((why, sl) => { if (!blocked.has(sl)) blocked.set(sl, tr(why === "dismiss" ? "انصراف" : "فارغة للشعبة")); });
  return buildSheet({ blocked, P,
    kind: mode, ownerId: id,
    title: mode === "teacher" ? (teacherOf(id)?.name || "") : tf("الشعبة {0}", secLabel(section(id))),
    school: S.school.name, settings: settings(), lessons: TT.lessons || [],
    subjectOf: subject, sectionLabel: id2 => secLabel(section(id2)), teacherName: t => shortName(teacherOf(t)?.name)
  });
}
function allSheets(mode) {
  ttSync();
  const used = new Set((TT.lessons || []).map(x => mode === "teacher" ? x.t : x.c));
  let list = (mode === "teacher" ? S.teachers : S.sections).filter(x => used.has(x.id));
  if (mode === "teacher") {
    // ترتيب المعلمين حسب مادتهم الأساسية (الأكثر حصصًا) بترتيب المواد المعتاد، ثم بالاسم
    const subIdx = new Map(S.subjects.map((x, i) => [x.id, i]));
    const main = new Map();
    for (const t of list) {
      const cnt = {};
      for (const x of TT.lessons || []) if (x.t === t.id && x.d != null) cnt[x.s] = (cnt[x.s] || 0) + 1;
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1] || (subIdx.get(a[0]) ?? 999) - (subIdx.get(b[0]) ?? 999))[0];
      main.set(t.id, best ? (subIdx.get(best[0]) ?? 999) : 999);
    }
    list = [...list].sort((a, b) => main.get(a.id) - main.get(b.id) || a.name.localeCompare(b.name, "ar"));
  }
  return list.map(x => sheetFor(mode, x.id));
}
// تحميل كل الجداول في ملف PDF واحد مع شريط تقدّم وإلغاء
async function downloadAll(mode) {
  const sheets = allSheets(mode);
  if (!sheets.length) return toast("لا يوجد جدول موزّع للتصدير بعد", "error");
  const ctrl = new AbortController();
  const title = mode === "teacher" ? tr("جداول المعلمين") : tr("جداول الشعب");
  openModal(`<div class="gen-box"><div class="spinner"></div><h3>${esc(tf("جارٍ إنشاء ملف {0}", title))}</h3>
    <div class="progress"><i id="dlBar"></i></div><p class="muted" id="dlTxt">${esc(tf("جدول {0} من {1}", 0, sheets.length))}</p>
    <button class="btn ghost" id="dlCancel">${tr("إلغاء")}</button></div>`);
  $("modalBack").dataset.lock = "1";
  $("dlCancel").onclick = () => ctrl.abort();
  try {
    await downloadSheetsPDF(sheets, `${title} - ${S.school.name}`, {
      signal: ctrl.signal, perPage: 6,
      onProgress: (n, total) => {
        const b = $("dlBar"); if (b) b.style.width = Math.round(n / total * 100) + "%";
        const t = $("dlTxt"); if (t) t.textContent = tf("جدول {0} من {1}", n, total);
      }
    });
    toast(tf("تم تحميل {0} ({1} صفحة)", title, Math.ceil(sheets.length / 6)), "success");
  } catch (e) {
    if (e?.name !== "AbortError") toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error");
  } finally {
    delete $("modalBack").dataset.lock; closeModal();
  }
}
function ttPrintMenu() {
  openModal(`${modalHead(tr("تحميل PDF"))}
    <div class="print-opts">
      <button class="btn block primary" data-pr="dl"><span data-ic="download" data-size="18"></span>تحميل الجدول المعروض PDF</button>
      <div class="print-sep">${tr("ملف PDF واحد — 6 جداول في كل صفحة")}</div>
      <button class="btn block" data-pr="dlTeachers"><span data-ic="download" data-size="18"></span>تحميل جداول كل المعلمين PDF</button>
      <button class="btn block" data-pr="dlSections"><span data-ic="download" data-size="18"></span>تحميل جداول كل الشعب PDF</button>
      <div class="print-sep">${tr("منصة الوزارة")}</div>
      <button class="btn block" data-pr="noor"><span data-ic="upload" data-size="18"></span>${tr("تصدير ملف نور (XML)")}</button>
    </div>`);
  fillIcons($("modal"));
  $("modal").onclick = async e => {
    const b = e.target.closest("[data-pr]"); if (!b) return;
    $("modal").onclick = null; closeModal();
    const k = b.dataset.pr;
    if (k === "dlTeachers") return downloadAll("teacher");
    if (k === "dlSections") return downloadAll("section");
    if (k === "noor") return noorExport();
    if (k === "dl") {
      const sh = sheetFor(TV.mode, TV.id);
      try { toast(tr("جارٍ تجهيز الملف")); await downloadSheetsPDF([sh], sh.title); }
      catch (ex) { toast(tr("تعذّر إنشاء ملف PDF، حاول مرة أخرى."), "error"); }
    }
  };
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
