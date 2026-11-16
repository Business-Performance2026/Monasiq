// وظائف السيرفر لمنصة مُنسِّق:
// 1) إشعار للإدارة عند وصول وصل تحويل أو تسجيل مدرسة جديدة
// 2) إشعار للمدرسة عند أي إشعار جديد في حسابها (تفعيل، رفض، تذكير)
// 3) تذكيرات يومية: قرب انتهاء الاشتراك أو التجربة، والطلبات المعلّقة للإدارة
// 4) حذف ملف الوصل من التخزين عند حذف الطلب
const { onDocumentCreated, onDocumentDeleted, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
// المنطقة تُحدد تلقائيًا من موقع قاعدة البيانات أثناء النشر (ملف .env)
setGlobalOptions({ region: process.env.FN_REGION || "us-central1", maxInstances: 5 });

const APP_URL = "https://business-performance2026.github.io/Monasiq/";
const DAY = 86400000;
const DEF = { price: 10, trialDays: 7, expMonth: 8, expDay: 31 };
const fmt = ms => new Date(ms).toLocaleDateString("ar-OM", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Muscat" });

// إرسال إشعار لكل أجهزة مستخدم أو للإدارة
async function push(q, title, body, link) {
  const snap = await q.get();
  if (snap.empty) return 0;
  const docs = snap.docs, tokens = docs.map(d => d.get("token")).filter(Boolean);
  if (!tokens.length) return 0;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      notification: { icon: APP_URL + "assets/img/icon-192.png", badge: APP_URL + "assets/img/icon-96.png", dir: "rtl", lang: "ar" },
      fcmOptions: { link: APP_URL + link }
    }
  });
  // حذف الأجهزة التي لم تعد صالحة
  const dead = [];
  res.responses.forEach((r, i) => {
    const c = r.error?.code || "";
    if (c.includes("registration-token-not-registered") || c.includes("invalid-registration-token") || c.includes("invalid-argument")) dead.push(docs[i].ref);
  });
  await Promise.all(dead.map(r => r.delete().catch(() => {})));
  logger.info("push", { title, sent: res.successCount, failed: res.failureCount, errors: res.responses.filter(r => !r.success).map(r => r.error?.code) });
  return res.successCount;
}
const adminTokens = () => db.collection("pushTokens").where("role", "==", "admin");
const userTokens = uid => db.collection("pushTokens").where("uid", "==", uid);

exports.onPaymentCreated = onDocumentCreated("payments/{id}", async e => {
  const p = e.data?.data(); if (!p || p.status !== "pending") return;
  await push(adminTokens(), "وصل تحويل جديد 💳", `${p.schoolName || "مدرسة"} — ${p.amount} ر.ع. اضغط للمراجعة والتفعيل.`, "admin.html#payments");
});

exports.onSchoolCreated = onDocumentCreated("schools/{sid}", async e => {
  const s = e.data?.data(); if (!s || s.status !== "pending") return;
  await push(adminTokens(), "مدرسة جديدة بانتظار الموافقة 🏫", `${s.name || ""}${s.region ? " — " + s.region : ""}`, "admin.html#schools");
});

exports.onSchoolNotification = onDocumentCreated("schools/{sid}/notifications/{nid}", async e => {
  const n = e.data?.data(); if (!n) return;
  await push(userTokens(e.params.sid), n.title || "مُنسِّق", n.body || "", "dashboard.html" + (n.link || "#billing"));
});

// تحديث جدول المعلمين: إشعار داخل المنصة + إشعار جوال لكل معلم تغيّر جدوله
exports.onTimetablePublished = onDocumentCreated("schools/{sid}/publishes/{pid}", async e => {
  const pub = e.data?.data(); if (!pub?.items?.length) return;
  const sid = e.params.sid;
  const accs = await db.collection("teacherAccounts").where("schoolId", "==", sid).get();
  let sent = 0;
  for (const it of pub.items) {
    const mine = accs.docs.filter(a => a.get("teacherId") === it.teacherId && a.get("status") === "active");
    const n = (it.added?.length || 0) + (it.removed?.length || 0);
    const first = it.added?.[0]?.text || it.removed?.[0]?.text || "";
    for (const a of mine) {
      await a.ref.collection("notifications").doc(e.params.pid).set({
        title: "تم تحديث جدولك 📅", body: n === 1 ? `تغيّرت حصة: ${first}` : `تغيّرت ${n} حصص في جدولك.`,
        kind: "tt", added: it.added || [], removed: it.removed || [], at: Date.now(), read: false
      });
      sent += await push(userTokens(a.id), "تم تحديث جدولك 📅", n === 1 ? `تغيّرت حصة: ${first}` : `تغيّرت ${n} حصص في جدولك. اضغط للاطلاع.`, "teacher.html");
    }
  }
  logger.info("publish", { sid, teachers: pub.items.length, sent });
});

// الاحتياط: إشعار للمعلم البديل (أو إلغاء احتياطه)
exports.onSubsSent = onDocumentCreated("schools/{sid}/subNotices/{nid}", async e => {
  const n = e.data?.data(); if (!n?.items?.length) return;
  const sid = e.params.sid;
  const accs = await db.collection("teacherAccounts").where("schoolId", "==", sid).get();
  const byT = new Map();
  for (const it of n.items) { if (!byT.has(it.t)) byT.set(it.t, []); byT.get(it.t).push(it); }
  let sent = 0;
  for (const [t, list] of byT) {
    const add = list.filter(x => !x.cancel), cancel = list.filter(x => x.cancel);
    const title = add.length ? "عندك احتياط 📌" : "أُلغي احتياطك";
    const body = (add.length ? add : cancel).map(x => x.text).join("\n");
    for (const a of accs.docs.filter(a => a.get("teacherId") === t && a.get("status") === "active")) {
      await a.ref.collection("notifications").doc(`${e.params.nid}_${t}`).set({
        title, body, kind: "sub", at: Date.now(), read: false,
        added: add.map(x => ({ text: x.text })), removed: cancel.map(x => ({ text: x.text }))
      });
      sent += await push(userTokens(a.id), title, body, "teacher.html");
    }
  }
  logger.info("subs", { sid, teachers: byT.size, sent });
});

exports.onPaymentDeleted = onDocumentDeleted("payments/{id}", async e => {
  const path = e.data?.get("receiptPath"); if (!path) return;
  await admin.storage().bucket().file(path).delete().catch(() => {});
});

// كل يوم الساعة 9 صباحًا بتوقيت مسقط
exports.dailyReminders = onSchedule({ schedule: "0 9 * * *", timeZone: "Asia/Muscat" }, async () => {
  const now = Date.now();
  const cfg = { ...DEF, ...((await db.doc("config/billing").get()).data() || {}) };
  const schools = await db.collection("schools").where("status", "==", "active").get();
  let made = 0;
  for (const d of schools.docs) {
    const s = d.data(), paid = +s.paidUntil || 0, trial = +s.trialEnds || 0;
    let key = null, title = "", body = "", kind = "warn";
    if (paid > now) {
      const days = Math.ceil((paid - now) / DAY);
      if ([30, 7, 1].includes(days)) { key = `paid-${days}-${paid}`; title = "اقترب موعد التجديد ⏰"; body = `ينتهي اشتراككم بعد ${days} يوم (${fmt(paid)}). جدّدوا من صفحة «اشتراكاتي».`; }
    } else if (trial > now) {
      const days = Math.ceil((trial - now) / DAY);
      if ([3, 1].includes(days)) { key = `trial-${days}-${trial}`; title = "الفترة التجريبية على وشك الانتهاء"; body = `باقي ${days} يوم. اشتركوا من صفحة «اشتراكاتي» حتى لا يتوقف التعديل.`; }
    } else if (paid || trial) {
      const end = Math.max(paid, trial);
      key = `expired-${end}`; kind = "bad"; title = "انتهى الاشتراك";
      body = "أصبحت المنصة للمشاهدة والتحميل فقط. جدّدوا من صفحة «اشتراكاتي» لتعود صلاحية التعديل.";
    }
    if (!key) continue;
    try {
      // معرّف ثابت لكل تذكير حتى لا يتكرر
      await d.ref.collection("notifications").doc(key).create({ title, body, kind, at: now, read: false, auto: true });
      made++;
    } catch { /* أُرسل سابقًا */ }
  }
  const pending = await db.collection("payments").where("status", "==", "pending").get();
  if (!pending.empty) await push(adminTokens(), "طلبات اشتراك بانتظارك", `لديك ${pending.size} طلب اشتراك بانتظار المراجعة.`, "admin.html#payments");
  logger.info("daily", { reminders: made, pending: pending.size });
});

// طلبات المعلمين (تبديل / احتياط): إشعار للزميل، ثم للمدرسة، ثم بالنتيجة لصاحب الطلب
exports.onRequestWritten = onDocumentWritten("schools/{sid}/requests/{rid}", async e => {
  const before = e.data?.before?.data(), r = e.data?.after?.data();
  if (!r || before?.status === r.status) return;
  const sid = e.params.sid, rid = e.params.rid;
  const accs = await db.collection("teacherAccounts").where("schoolId", "==", sid).get();
  const notifyTeacher = async (tid, title, body) => {
    for (const a of accs.docs.filter(a => a.get("teacherId") === tid && a.get("status") === "active")) {
      await a.ref.collection("notifications").doc(`rq_${rid}_${r.status}`).set({ title, body, kind: "req", at: Date.now(), read: false });
      await push(userTokens(a.id), title, body, "teacher.html");
    }
  };
  const notifySchool = (title, body) => db.collection("schools").doc(sid).collection("notifications").doc(`rq_${rid}_${r.status}`)
    .set({ title, body, kind: "info", link: "#requests", at: Date.now(), read: false });
  const txt = r.text || "";
  const swap = r.kind === "swap";
  if (r.status === "peer") await notifyTeacher(r.to, "طلب تبديل حصة 🔁", `${r.fromName || "زميلك"} يطلب التبديل معك: ${txt}`);
  else if (r.status === "pending") await notifySchool(swap ? "طلب تبديل جديد 🔁" : "طلب احتياط جديد 📌", swap ? `${r.fromName || ""} ⇄ ${r.toName || ""}: ${txt}` : `${r.fromName || ""}: ${txt}${r.note ? " — " + r.note : ""}`);
  else if (r.status === "declined") await notifyTeacher(r.from, "رفض زميلك طلب التبديل", `${r.toName || ""}: ${txt}`);
  else if (r.status === "approved") {
    await notifyTeacher(r.from, swap ? "تمت الموافقة على التبديل ✅" : "تمت الموافقة على طلب الاحتياط ✅", txt);
    if (swap) await notifyTeacher(r.to, "تمت الموافقة على التبديل ✅", `${r.fromName || ""}: ${txt}`);
  } else if (r.status === "rejected") {
    await notifyTeacher(r.from, swap ? "رُفض طلب التبديل" : "رُفض طلب الاحتياط", `${txt}${r.reason ? " — " + r.reason : ""}`);
    if (swap && before?.status === "pending") await notifyTeacher(r.to, "رُفض طلب التبديل", txt);
  }
  logger.info("request", { sid, rid, status: r.status });
});
