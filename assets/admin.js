// لوحة إدارة المنصة: المدارس، طلبات الاشتراك، إعدادات الاشتراك
import { db, applyBranding, waitUser, getRole, logout, esc, toast, confirmBox, STATUS, errMsg, t, tr, lang, isEn, fillIcons, sendReset, norm } from "./app.js?v=202611151929";
import { collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDocs, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { watchBilling, subState, nextExpiry, fmtDate, money, stateLabel, DAY, BILLING_DEFAULT } from "./billing.js?v=202611151929";
import { WA_ICON as WA, waNumber as waNum } from "./whatsapp.js?v=202611151929";
import { pushState, pushCardHTML, bindPushCard, refreshPush } from "./push.js?v=202611151929";
applyBranding();

const $ = id => document.getElementById(id);
const user = await waitUser();
const role = await getRole(user).catch(() => ({ role: "none" }));
if (role.role !== "admin") location.replace("login.html");
else start();

function openModal(html) { $("modal").innerHTML = html; $("modalBack").classList.add("show"); fillIcons($("modal")); }
function closeModal() { $("modalBack").classList.remove("show"); $("modal").innerHTML = ""; $("modal").onclick = null; }
const modalHead = h => `<div class="modal-head"><h3>${h}</h3><button class="x" data-close>×</button></div>`;
const dateIn = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dateOut = v => { const [y, m, d] = v.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59).getTime(); };
const dt = ms => ms ? new Date(ms).toLocaleString(isEn ? "en-GB" : "ar-OM", { dateStyle: "medium", timeStyle: "short" }) : "";

function start() {
  $("loading").classList.add("hidden");
  $("appRoot").classList.remove("hidden");
  fillIcons();
  document.querySelectorAll("[data-logout]").forEach(b => (b.onclick = logout));
  $("modalBack").addEventListener("click", e => { if (e.target.id === "modalBack" || e.target.closest("[data-close]")) closeModal(); });

  let schools = [], pays = [], cfg = { ...BILLING_DEFAULT }, filter = "pending", q = "", payFilter = "pending", pub = null, syncWarned = false, backfilled = false, lastPending = -1;
  const view = () => (["stats", "schools", "payments", "billing"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "stats");

  onSnapshot(collection(db, "schools"), snap => {
    schools = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    render(); syncPublic(); backfillTrials();
  }, e => toast(errMsg(e), "error"));
  onSnapshot(collection(db, "publicSchools"), snap => {
    pub = new Map(snap.docs.map(d => [d.id, d.data()])); syncPublic();
  }, () => { pub = new Map(); syncPublic(); });
  onSnapshot(collection(db, "payments"), snap => {
    pays = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const n = pays.filter(p => p.status === "pending").length;
    if (lastPending >= 0 && n > lastPending) toast(t("طلب اشتراك جديد بانتظار المراجعة ({0})", n), "success");
    lastPending = n;
    render();
  }, e => toast(errMsg(e), "error"));
  watchBilling(c => { cfg = c; render(); });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  document.querySelectorAll("[data-bell]").forEach(b => (b.onclick = () => { payFilter = "pending"; location.hash = "#payments"; render(); }));
  const pushCtx = { uid: user.uid, role: "admin" };
  refreshPush(pushCtx);
  async function drawPush(box, onlyIfOff = false) {
    if (!box) return;
    const st = await pushState(user.uid);
    if (onlyIfOff && st === "on") { box.innerHTML = ""; return; }
    box.innerHTML = pushCardHTML(st, esc);
    bindPushCard(box, pushCtx, () => drawPush(box, onlyIfOff), toast);
  }

  // قائمة المدارس المفعّلة التي يختار منها المعلم عند التسجيل
  async function syncPublic() {
    if (!pub || !schools.length) return;
    for (const s of schools) {
      const p = pub.get(s.id);
      try {
        if (s.status === "active") {
          if (!p || p.name !== s.name || (p.region || "") !== (s.region || "") || (p.wilayah || "") !== (s.wilayah || ""))
            await setDoc(doc(db, "publicSchools", s.id), { name: s.name, region: s.region || "", wilayah: s.wilayah || "" });
        } else if (p) await deleteDoc(doc(db, "publicSchools", s.id));
      } catch (e) { if (!syncWarned) { syncWarned = true; toast(t("تعذّر تحديث قائمة المدارس للمعلمين. تأكد من نشر قواعد Firestore الجديدة."), "error"); } }
    }
  }
  // المدارس المفعّلة قبل نظام الاشتراك: تبدأ فترتها التجريبية الآن
  async function backfillTrials() {
    if (backfilled || !schools.length) return; backfilled = true;
    for (const s of schools.filter(s => s.status === "active" && !s.trialEnds && !s.paidUntil))
      await updateDoc(doc(db, "schools", s.id), { trialEnds: Date.now() + (+cfg.trialDays || 7) * DAY }).catch(() => {});
  }

  function render() {
    const v = view();
    document.querySelectorAll("[data-view]").forEach(a => a.classList.toggle("active", a.dataset.view === v));
    const nP = pays.filter(p => p.status === "pending").length;
    document.querySelectorAll("[data-bell-n], [data-pay-n]").forEach(b => { b.textContent = nP; b.classList.toggle("hidden", !nP); });
    document.title = (nP ? `(${nP}) ` : "") + tr("إدارة المنصة");
    const main = $("main");
    if (v === "stats") main.innerHTML = vStats();
    else if (v === "payments") main.innerHTML = vPayments();
    else if (v === "billing") main.innerHTML = vBillingCfg();
    else main.innerHTML = vSchools();
    fillIcons(main);
    drawPush($("pushBox"), v !== "billing");
    BIND[v]?.();
  }


  const BIND = {};
  // ---------- الإحصائيات ----------
  const monthsBack = n => { const out = [], d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setMonth(d.getMonth() - i); out.push(x); } return out; };
  const mKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}`; };
  const mLabel = d => d.toLocaleDateString(isEn ? "en-GB" : "ar-OM", { month: "short" });
  const createdMs = s => s.createdAt?.toDate ? s.createdAt.toDate().getTime() : (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : 0);
  // مخطط أعمدة بسيط (سلسلة واحدة) مع تلميح عند المرور أو اللمس
  function barChart(id, months, values, fmt) {
    const max = Math.max(1, ...values), W = 640, H = 240, padB = 34, padT = 26, n = values.length, gap = 2, bw = (W - gap * (n - 1)) / n;
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
    const y = v => padT + (H - padT - padB) * (1 - v / nice);
    const grid = [0, .5, 1].map(f => `<line x1="0" x2="${W}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="cg"/><text x="${isEn ? 2 : W - 2}" y="${y(nice * f) - 3}" class="ct" text-anchor="${isEn ? "start" : "end"}">${fmt(nice * f)}</text>`).join("");
    const order = isEn ? values.map((v, i) => i) : values.map((v, i) => n - 1 - i); // من اليمين في العربية
    const bars = values.map((v, i) => {
      const x = order[i] * (bw + gap), top = y(v), h = Math.max(0, H - padB - top), r = Math.min(4, bw / 2, h);
      const path = h ? `M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - padB} Z` : "";
      return `<g class="cb" data-tip="${esc(mLabel(months[i]) + " " + months[i].getFullYear() + ": " + fmt(v))}"><rect x="${x}" y="${padT}" width="${bw}" height="${H - padT}" fill="transparent"/>${path ? `<path d="${path}"/>` : ""}
        ${(n - 1 - i) % 2 === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" class="cx" text-anchor="middle">${esc(mLabel(months[i]))}</text>` : ""}</g>`;
    }).join("");
    return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}</svg><div class="ctip hidden"></div></div>`;
  }
  function vStats() {
    const now = Date.now(), act = schools.filter(s => s.status === "active");
    const st = act.map(s => ({ s, st: subState(s, cfg) }));
    const paid = st.filter(x => x.st.state === "active"), trial = st.filter(x => x.st.state === "trial"), expired = st.filter(x => x.st.state === "expired");
    const approved = pays.filter(p => p.status === "approved");
    const yearStart = nextExpiry(now, cfg) - 365 * DAY; // بداية سنة الاشتراك الحالية
    const revYear = approved.filter(p => (p.decidedAt || p.createdAt) > yearStart).reduce((a, p) => a + (+p.amount || 0), 0);
    const revAll = approved.reduce((a, p) => a + (+p.amount || 0), 0);
    const pendAmt = pays.filter(p => p.status === "pending").reduce((a, p) => a + (+p.amount || 0), 0);
    const months = monthsBack(12), idx = new Map(months.map((m, i) => [`${m.getFullYear()}-${m.getMonth()}`, i]));
    const rev = months.map(() => 0), newS = months.map(() => 0);
    approved.forEach(p => { const i = idx.get(mKey(p.decidedAt || p.createdAt)); if (i != null) rev[i] += +p.amount || 0; });
    schools.forEach(s => { const c = createdMs(s); if (!c) return; const i = idx.get(mKey(c)); if (i != null) newS[i]++; });
    const soon = paid.filter(x => x.st.daysLeft <= 30).sort((a, b) => a.st.daysLeft - b.st.daysLeft);
    const trialSoon = trial.filter(x => x.st.daysLeft != null && x.st.daysLeft <= 3).sort((a, b) => a.st.daysLeft - b.st.daysLeft);
    const exp = expired.sort((a, b) => b.st.until - a.st.until);
    const conv = act.length ? Math.round(paid.length / act.length * 100) : 0;
    const row = (x, note) => `<div class="st-row" data-id="${x.s.id}">
      <div><b data-no-i18n>${esc(x.s.name)}</b><small class="muted">${esc(note)}</small></div>
      <div class="row-actions">${x.s.phone ? `<button class="wa-btn" data-remind="${x.s.id}" title="${esc(tr("تذكير عبر واتساب"))}">${WA}</button>` : ""}<button class="btn sm" data-sub="${x.s.id}">${tr("الاشتراك")}</button></div></div>`;
    return `<div class="page-title"><h1>${tr("الإحصائيات")}</h1></div>
      <div class="stats st-kpi">
        <div class="stat"><div class="n">${schools.length}</div><div class="l">${tr("إجمالي المدارس")}</div></div>
        <div class="stat"><div class="n" style="color:var(--ok)">${paid.length}</div><div class="l">${tr("اشتراك مدفوع")}</div></div>
        <div class="stat"><div class="n">${trial.length}</div><div class="l">${tr("فترة تجريبية")}</div></div>
        <div class="stat"><div class="n" style="color:var(--bad)">${expired.length}</div><div class="l">${tr("اشتراك منتهي")}</div></div>
      </div>
      <div class="stats st-kpi">
        <div class="stat"><div class="n">${esc(money(revYear, cfg))}</div><div class="l">${tr("إيرادات السنة الحالية")}</div></div>
        <div class="stat"><div class="n">${esc(money(revAll, cfg))}</div><div class="l">${tr("إجمالي الإيرادات")}</div></div>
        <div class="stat"><div class="n" style="color:var(--warn)">${esc(money(pendAmt, cfg))}</div><div class="l">${tr("بانتظار المراجعة")}</div></div>
        <div class="stat"><div class="n">${conv}%</div><div class="l">${tr("نسبة المدارس المشتركة")}</div></div>
      </div>
      <div class="grid-2 st-charts">
        <div class="card"><h3>${tr("الإيرادات حسب الشهر")}</h3><p class="muted st-sub">${tr("آخر 12 شهرًا · حسب تاريخ التفعيل")}</p>${barChart("chRev", months, rev, v => money(Math.round(v), cfg))}</div>
        <div class="card"><h3>${tr("المدارس الجديدة حسب الشهر")}</h3><p class="muted st-sub">${tr("آخر 12 شهرًا · حسب تاريخ التسجيل")}</p>${barChart("chNew", months, newS, v => String(Math.round(v)))}</div>
      </div>
      <div class="card"><div class="card-head"><h3>⏰ ${tr("اقترب انتهاء اشتراكها")}</h3><span class="muted">${esc(t("خلال 30 يومًا · {0}", soon.length))}</span></div>
        ${soon.length ? soon.map(x => row(x, t("ينتهي بعد {0} يوم · {1}", x.st.daysLeft, fmtDate(x.st.until)))).join("") : `<p class="muted" style="margin:0">${tr("لا توجد مدارس")}</p>`}</div>
      <div class="card"><div class="card-head"><h3>🔴 ${tr("لم تجدد (اشتراك منتهي)")}</h3><span class="muted">${exp.length}</span></div>
        ${exp.length ? exp.map(x => row(x, t("منتهي منذ {0}", fmtDate(x.st.until)))).join("") : `<p class="muted" style="margin:0">${tr("لا توجد مدارس")}</p>`}</div>
      <div class="card"><div class="card-head"><h3>🧪 ${tr("تجربة تنتهي قريبًا")}</h3><span class="muted">${trialSoon.length}</span></div>
        ${trialSoon.length ? trialSoon.map(x => row(x, t("باقي {0} يوم من التجربة", x.st.daysLeft))).join("") : `<p class="muted" style="margin:0">${tr("لا توجد مدارس")}</p>`}</div>`;
  }
  BIND.stats = () => {
    document.querySelectorAll(".chart").forEach(ch => {
      const tip = ch.querySelector(".ctip");
      const show = (g, e) => {
        ch.querySelectorAll(".cb.on").forEach(x => x.classList.remove("on")); g.classList.add("on");
        tip.textContent = g.dataset.tip; tip.classList.remove("hidden");
        const r = ch.getBoundingClientRect(), gr = g.getBoundingClientRect();
        tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, gr.left - r.left + gr.width / 2 - tip.offsetWidth / 2)) + "px";
      };
      ch.querySelectorAll(".cb").forEach(g => { g.onmouseenter = e => show(g, e); g.onclick = e => show(g, e); });
      ch.onmouseleave = () => { tip.classList.add("hidden"); ch.querySelectorAll(".cb.on").forEach(x => x.classList.remove("on")); };
    });
    $("main").onclick = e => {
      const s = schools.find(x => x.id === (e.target.closest("[data-sub]")?.dataset.sub || e.target.closest("[data-remind]")?.dataset.remind));
      if (!s) return;
      if (e.target.closest("[data-sub]")) return subModal(s);
      const st = subState(s, cfg), n = waNum(s.phone);
      const msg = st.state === "expired"
        ? t("السلام عليكم، نذكّركم بأن اشتراك {0} في منصة مُنسِّق قد انتهى. يمكنكم التجديد من صفحة «اشتراكاتي» في لوحة المدرسة. شكرًا لكم.", s.name)
        : t("السلام عليكم، نذكّركم بأن اشتراك {0} في منصة مُنسِّق ينتهي في {1}. يمكنكم التجديد من صفحة «اشتراكاتي» في لوحة المدرسة. شكرًا لكم.", s.name, fmtDate(st.until));
      if (n) window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank");
    };
  };

  // ---------- المدارس ----------
  function vSchools() {
    const c = s => schools.filter(x => x.status === s).length;
    const subOf = s => s.status === "active" ? subState(s, cfg) : null;
    const expired = schools.filter(s => subOf(s)?.state === "expired").length;
    let rows = filter === "all" ? schools : filter === "expired" ? schools.filter(s => subOf(s)?.state === "expired") : schools.filter(s => s.status === filter);
    if (q) { const w = norm(q); rows = rows.filter(s => norm(s.name + " " + (s.email || "") + " " + (s.region || "")).includes(w)); }
    return `<div class="page-title"><h1>${tr("إدارة المدارس")}</h1></div>
      <div class="stats">
        <div class="stat"><div class="n">${schools.length}</div><div class="l">${tr("إجمالي المدارس")}</div></div>
        <div class="stat"><div class="n" style="color:var(--warn)">${c("pending")}</div><div class="l">${tr("بانتظار الموافقة")}</div></div>
        <div class="stat"><div class="n" style="color:var(--ok)">${c("active")}</div><div class="l">${tr("مدارس مفعّلة")}</div></div>
        <div class="stat"><div class="n" style="color:var(--bad)">${expired}</div><div class="l">${tr("اشتراك منتهي")}</div></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="tabs" id="filters">
            ${[["pending", "بانتظار الموافقة"], ["active", "المفعّلة"], ["expired", "اشتراك منتهي"], ["suspended", "الموقوفة"], ["rejected", "المرفوضة"], ["all", "الكل"]].map(([k, l]) => `<button data-f="${k}" class="${filter === k ? "active" : ""}">${tr(l)}</button>`).join("")}
          </div>
          <input id="search" type="search" placeholder="${esc(tr("بحث باسم المدرسة أو البريد..."))}" value="${esc(q)}" style="max-width:280px">
        </div>
        <div id="list">${rows.length ? rows.map(schoolCard).join("") : `<div class="empty"><div class="big">📭</div>${tr("لا توجد مدارس في هذا القسم")}</div>`}</div>
      </div>`;
  }
  function schoolCard(s) {
    const st = STATUS[s.status] || { label: s.status, cls: "info" };
    const date = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString(lang === "en" ? "en-GB" : "ar-OM") : "";
    const sub = s.status === "active" ? stateLabel(subState(s, cfg)) : null;
    const acts = [];
    if (s.status === "pending") acts.push(`<button class="btn sm success" data-a="active">✔ ${tr("موافقة")}</button><button class="btn sm warn" data-a="rejected">${tr("رفض")}</button>`);
    if (s.status === "active") acts.push(`<button class="btn sm primary" data-a="sub"><span data-ic="card" data-size="15"></span>${tr("الاشتراك")}</button><button class="btn sm warn" data-a="suspended">${tr("إيقاف")}</button>`);
    if (s.status === "suspended" || s.status === "rejected") acts.push(`<button class="btn sm success" data-a="active">${tr("تفعيل")}</button>`);
    if (s.email) acts.push(`<button class="btn sm" data-a="reset">${tr("إعادة تعيين كلمة المرور")}</button>`);
    acts.push(`<button class="btn sm danger" data-a="delete">${tr("حذف")}</button>`);
    return `<div class="card school-card" data-id="${s.id}">
      <div>
        <h3 style="margin:0 0 .3rem">${esc(s.name)} <span class="badge ${st.cls}">${tr(st.label)}</span> ${sub ? `<span class="badge ${sub.cls} sub-chip">${esc(sub.text)}</span>` : ""}</h3>
        <div class="meta">
          <span>📍 ${esc(s.region || "")}${s.wilayah ? " - " + esc(s.wilayah) : ""}</span>
          ${s.stages ? `<span>🎓 ${esc(s.stages)}</span>` : ""}
          <span>👤 ${esc(s.principal || "")}</span>
          <span>📞 <a href="tel:${esc(s.phone)}" dir="ltr">${esc(s.phone || "")}</a></span>
          <span>✉️ <a href="mailto:${esc(s.email)}">${esc(s.email || "")}</a></span>
          ${date ? `<span>🗓️ ${date}</span>` : ""}
        </div>
      </div>
      <div class="row-actions">${acts.join("")}</div>
    </div>`;
  }
  BIND.schools = () => {
    $("filters").onclick = e => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.f; render(); };
    $("search").oninput = e => { q = e.target.value.trim(); const pos = e.target.selectionStart; render(); const i = $("search"); i.focus(); i.setSelectionRange(pos, pos); };
    $("list").onclick = async e => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const id = b.closest("[data-id]").dataset.id, s = schools.find(x => x.id === id), a = b.dataset.a;
      try {
        if (a === "sub") return subModal(s);
        if (a === "reset") {
          if (!(await confirmBox(t("إرسال رابط إعادة تعيين كلمة المرور إلى {0}؟", s.email), "إرسال", false))) return;
          await sendReset(s.email);
          return toast(t("تم إرسال رابط إعادة التعيين إلى {0}", s.email), "success");
        }
        if (a === "delete") {
          if (!(await confirmBox(t("حذف مدرسة «{0}» وكل بياناتها نهائيًا؟", s.name), "حذف نهائي"))) return;
          for (const sub of ["grades", "sections", "subjects", "teachers", "departments", "timetable", "notifications"]) {
            const docs = (await getDocs(collection(db, "schools", id, sub))).docs;
            for (let i = 0; i < docs.length; i += 400) {
              const batch = writeBatch(db);
              docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
              await batch.commit();
            }
          }
          const accs = (await getDocs(query(collection(db, "teacherAccounts"), where("schoolId", "==", id)))).docs;
          for (const d of accs) await deleteDoc(d.ref);
          await deleteDoc(doc(db, "publicSchools", id)).catch(() => {});
          await deleteDoc(doc(db, "schools", id));
          return toast("تم حذف المدرسة", "success");
        }
        const labels = { active: "تفعيل", suspended: "إيقاف", rejected: "رفض" };
        if (a !== "active" && !(await confirmBox(t({ suspended: "إيقاف مدرسة «{0}»؟", rejected: "رفض مدرسة «{0}»؟" }[a], s.name), labels[a]))) return;
        const upd = { status: a, statusAt: Date.now() };
        // عند الموافقة أول مرة تبدأ الفترة التجريبية
        if (a === "active" && !s.trialEnds && !s.paidUntil) upd.trialEnds = Date.now() + (+cfg.trialDays || 7) * DAY;
        await updateDoc(doc(db, "schools", id), upd);
        toast(a === "active" ? "تم تفعيل المدرسة ✅" : "تم التحديث", "success");
      } catch (ex) { toast(errMsg(ex), "error"); }
    };
  };
  // إدارة اشتراك مدرسة يدويًا
  function subModal(s) {
    const st = subState(s, cfg), lb = stateLabel(st);
    const nextE = nextExpiry(Math.max(Date.now(), +s.paidUntil || 0), cfg);
    openModal(`${modalHead(esc(t("اشتراك {0}", s.name)))}
      <p><span class="badge ${lb.cls}">${esc(lb.text)}</span></p>
      <div class="field"><label>${tr("مفعّل حتى")}</label><input type="date" id="subUntil" value="${dateIn(+s.paidUntil > Date.now() ? +s.paidUntil : nextE)}"></div>
      <div class="row-actions" style="margin-bottom:1rem">
        <button class="btn sm" id="subToE">${esc(t("حتى {0}", fmtDate(nextE)))}</button>
        <button class="btn sm" id="subTrial">${esc(t("تمديد التجربة {0} أيام", +cfg.trialDays || 7))}</button>
        ${+s.paidUntil > Date.now() ? `<button class="btn sm danger" id="subStop">${tr("إلغاء الاشتراك")}</button>` : ""}
      </div>
      <div class="modal-actions"><button class="btn primary" id="subSave">${tr("تفعيل حتى التاريخ المحدد")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
    const notify = (b, title, body, kind) => b.set(doc(collection(db, "schools", s.id, "notifications")), { title, body, kind, at: Date.now(), read: false });
    const activate = async until => {
      const b = writeBatch(db);
      b.update(doc(db, "schools", s.id), { paidUntil: until });
      notify(b, "تم تفعيل الاشتراك ✅", `اشتراككم مفعّل حتى ${fmtDate(until)}.`, "ok");
      await b.commit(); closeModal(); toast(tr("تم التفعيل"), "success");
    };
    $("subToE").onclick = () => { $("subUntil").value = dateIn(nextE); };
    $("subSave").onclick = () => { const v = $("subUntil").value; if (!v) return; activate(dateOut(v)).catch(e => toast(errMsg(e), "error")); };
    $("subTrial").onclick = async () => {
      const until = Math.max(Date.now(), +s.trialEnds || 0) + (+cfg.trialDays || 7) * DAY;
      const b = writeBatch(db);
      b.update(doc(db, "schools", s.id), { trialEnds: until });
      notify(b, "تم تمديد الفترة التجريبية", `الفترة التجريبية حتى ${fmtDate(until)}.`, "info");
      try { await b.commit(); closeModal(); toast(tr("تم التمديد"), "success"); } catch (e) { toast(errMsg(e), "error"); }
    };
    if ($("subStop")) $("subStop").onclick = async () => {
      if (!(await confirmBox(t("إلغاء اشتراك «{0}»؟", s.name), "إلغاء الاشتراك"))) return;
      try { await updateDoc(doc(db, "schools", s.id), { paidUntil: 0 }); closeModal(); toast(tr("تم الإلغاء"), "success"); } catch (e) { toast(errMsg(e), "error"); }
    };
  }

  // ---------- طلبات الاشتراك ----------
  function vPayments() {
    const rows = payFilter === "all" ? pays : pays.filter(p => p.status === payFilter);
    const c = k => pays.filter(p => p.status === k).length;
    const stB = { pending: ["warn", "قيد المراجعة"], approved: ["ok", "مقبول"], rejected: ["bad", "مرفوض"] };
    return `<div class="page-title"><h1>${tr("طلبات الاشتراك")}</h1></div>
      <div id="pushBox"></div>
      <div class="card">
        <div class="tabs adm-tabs" id="payF">
          ${[["pending", "قيد المراجعة"], ["approved", "المقبولة"], ["rejected", "المرفوضة"], ["all", "الكل"]].map(([k, l]) => `<button data-f="${k}" class="${payFilter === k ? "active" : ""}">${tr(l)} ${k !== "all" ? `(${c(k)})` : ""}</button>`).join("")}
        </div>
        ${!cfg.bankPhone ? `<div class="notice warn">${tr("لم تضف رقم التحويل بعد.")} <a href="#billing">${tr("إعدادات الاشتراك")}</a></div>` : ""}
        <div id="payList">${rows.length ? rows.map(p => `<div class="card pay-adm" data-id="${p.id}">
          ${p.receipt ? `<img class="rcpt-thumb" src="${p.receipt}" alt="" data-zoom>` : `<div class="empty">—</div>`}
          <div>
            <h3>${esc(p.schoolName || "")} <span class="badge ${stB[p.status]?.[0] || "info"}">${tr(stB[p.status]?.[1] || p.status)}</span></h3>
            <div class="meta">
              <span>💰 <b>${esc(money(p.amount, cfg))}</b></span>
              <span>📅 ${esc(t("حتى {0}", fmtDate(p.until)))}${p.renewal ? ` · ${tr("تجديد")}` : p.months < 12 ? ` · ${esc(t("{0} أشهر", p.months))}` : ""}</span>
              <span>🕒 ${esc(dt(p.createdAt))}</span>
              ${p.email ? `<span>✉️ ${esc(p.email)}</span>` : ""}
            </div>
            ${p.note ? `<p class="muted" style="margin:.4rem 0 0">📝 ${esc(p.note)}</p>` : ""}
            ${p.receiptUrl ? `<p style="margin:.4rem 0 0"><a href="${esc(p.receiptUrl)}" target="_blank" rel="noopener">📎 ${tr(p.receiptType === "pdf" ? "فتح ملف PDF الأصلي" : "فتح الصورة الأصلية")}</a></p>` : ""}
            ${p.status === "rejected" && p.reason ? `<p class="ph-reason" style="margin:.4rem 0 0">${esc(t("سبب الرفض: {0}", p.reason))}</p>` : ""}
          </div>
          <div class="row-actions">
            ${p.status === "pending" ? `<button class="btn sm success" data-a="approve">✔ ${tr("تفعيل")}</button><button class="btn sm warn" data-a="reject">${tr("رفض")}</button>` : ""}
            <button class="btn sm danger" data-a="del">${tr("حذف")}</button>
          </div>
        </div>`).join("") : `<div class="empty"><div class="big">🧾</div>${tr("لا توجد طلبات")}</div>`}</div>
      </div>`;
  }
  BIND.payments = () => {
    $("payF").onclick = e => { const b = e.target.closest("button"); if (!b) return; payFilter = b.dataset.f; render(); };
    $("payList").onclick = async e => {
      const z = e.target.closest("[data-zoom]");
      if (z) { const pz = pays.find(x => x.id === z.closest("[data-id]").dataset.id);
        if (pz?.receiptUrl && pz.receiptType === "pdf") return window.open(pz.receiptUrl, "_blank");
        return openModal(`${modalHead(tr("وصل التحويل"))}<img class="rcpt-full" src="${esc(pz?.receiptUrl || z.src)}" alt="">`); }
      const b = e.target.closest("button[data-a]"); if (!b) return;
      const p = pays.find(x => x.id === b.closest("[data-id]").dataset.id), a = b.dataset.a;
      const s = schools.find(x => x.id === p.schoolId);
      const notify = (bt, title, body, kind) => bt.set(doc(collection(db, "schools", p.schoolId, "notifications")), { title, body, kind, at: Date.now(), read: false });
      if (a === "approve") {
        openModal(`${modalHead(esc(t("تفعيل اشتراك {0}", p.schoolName)))}
          ${p.receipt ? `<img class="rcpt-thumb" src="${p.receipt}" alt="">` : ""}
          <p>${esc(t("المبلغ: {0}", money(p.amount, cfg)))}</p>
          <div class="field"><label>${tr("مفعّل حتى")}</label><input type="date" id="apUntil" value="${dateIn(p.until)}"></div>
          <div class="modal-actions"><button class="btn primary" id="apGo">✔ ${tr("تفعيل")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
        $("apGo").onclick = async () => {
          const until = dateOut($("apUntil").value);
          const bt = writeBatch(db);
          bt.update(doc(db, "payments", p.id), { status: "approved", until, decidedAt: Date.now() });
          bt.update(doc(db, "schools", p.schoolId), { paidUntil: until });
          notify(bt, p.renewal ? "تم تجديد الاشتراك ✅" : "تم تفعيل الاشتراك ✅", `شكرًا لكم، اشتراككم مفعّل حتى ${fmtDate(until)}.`, "ok");
          try { await bt.commit(); closeModal(); toast(tr("تم التفعيل"), "success"); } catch (ex) { toast(errMsg(ex), "error"); }
        };
        return;
      }
      if (a === "reject") {
        openModal(`${modalHead(esc(t("رفض وصل {0}", p.schoolName)))}
          <div class="field"><label>${tr("سبب الرفض (يظهر للمدرسة)")}</label><input id="rjWhy" placeholder="${esc(tr("مثال: المبلغ غير مكتمل"))}"></div>
          <div class="modal-actions"><button class="btn danger" id="rjGo">${tr("رفض")}</button><button class="btn ghost" data-close>${tr("إلغاء")}</button></div>`);
        $("rjGo").onclick = async () => {
          const reason = $("rjWhy").value.trim();
          const bt = writeBatch(db);
          bt.update(doc(db, "payments", p.id), { status: "rejected", reason, decidedAt: Date.now() });
          notify(bt, "تم رفض وصل التحويل", reason ? `السبب: ${reason}. يمكنكم إرسال وصل جديد من صفحة «اشتراكاتي».` : "يمكنكم إرسال وصل جديد من صفحة «اشتراكاتي».", "bad");
          try { await bt.commit(); closeModal(); toast(tr("تم الرفض"), "success"); } catch (ex) { toast(errMsg(ex), "error"); }
        };
        return;
      }
      if (a === "del") {
        if (!(await confirmBox(tr("حذف هذا الطلب نهائيًا؟"), "حذف"))) return;
        try { await deleteDoc(doc(db, "payments", p.id)); } catch (ex) { toast(errMsg(ex), "error"); }
      }
    };
  };

  // ---------- إعدادات الاشتراك ----------
  function vBillingCfg() {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    return `<div class="page-title"><h1>${tr("إعدادات الاشتراك")}</h1></div>
      <div class="card"><h3>${tr("إشعارات الجوال")}</h3><p class="muted" style="margin-top:0">${tr("يصلك إشعار عند وصول وصل تحويل أو تسجيل مدرسة جديدة، وتذكير يومي بالطلبات المعلّقة، حتى لو كانت المنصة مغلقة.")}</p><div id="pushBox"></div></div>
      <form class="card" id="cfgForm">
        <h3>${tr("السعر والمدة")}</h3>
        <div class="grid-2">
          <div class="field"><label>${tr("سعر الاشتراك السنوي (ر.ع)")}</label><input name="price" type="number" min="0" step="0.5" value="${esc(cfg.price)}" required></div>
          <div class="field"><label>${tr("أيام الفترة التجريبية")}</label><input name="trialDays" type="number" min="0" max="90" value="${esc(cfg.trialDays)}" required></div>
        </div>
        <label>${tr("تاريخ انتهاء الاشتراك الموحد لكل المدارس")}</label>
        <div class="grid-2">
          <div class="field"><select name="expDay">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${+cfg.expDay === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
          <div class="field"><select name="expMonth">${months.map((m, i) => `<option value="${i + 1}" ${+cfg.expMonth === i + 1 ? "selected" : ""}>${tr(m)}</option>`).join("")}</select></div>
        </div>
        <p class="muted" style="margin-top:0">${esc(t("الاشتراك الجديد يدفع حسب الأشهر المتبقية حتى هذا التاريخ، والتجديد سنة كاملة. التاريخ القادم: {0}", fmtDate(nextExpiry(Date.now(), cfg))))}</p>
        <h3 style="margin-top:1rem">${tr("بيانات التحويل البنكي")}</h3>
        <div class="grid-2">
          <div class="field"><label>${tr("رقم الهاتف للتحويل")}</label><input name="bankPhone" dir="ltr" value="${esc(cfg.bankPhone)}" placeholder="9xxxxxxx"></div>
          <div class="field"><label>${tr("اسم صاحب الحساب")}</label><input name="bankName" value="${esc(cfg.bankName)}"></div>
        </div>
        <div class="field"><label>${tr("ملاحظة للمدارس (اختياري)")}</label><input name="bankNote" value="${esc(cfg.bankNote)}" placeholder="${esc(tr("مثال: اكتب اسم المدرسة في وصف التحويل"))}"></div>
        <div class="field"><label>${tr("رقم واتساب لاستلام تنبيهات الوصولات")}</label><input name="adminPhone" dir="ltr" value="${esc(cfg.adminPhone)}" placeholder="9xxxxxxx"></div>
        <button class="btn primary">💾 ${tr("حفظ")}</button>
      </form>`;
  }
  BIND.billing = () => {
    $("cfgForm").onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      const d = { price: +f.price || 0, trialDays: +f.trialDays || 0, expDay: +f.expDay, expMonth: +f.expMonth,
        bankPhone: f.bankPhone.trim(), bankName: f.bankName.trim(), bankNote: f.bankNote.trim(), adminPhone: f.adminPhone.trim(), updatedAt: Date.now() };
      try { await setDoc(doc(db, "config", "billing"), d); toast(tr("تم الحفظ"), "success"); } catch (ex) { toast(errMsg(ex), "error"); }
    };
  };
}
