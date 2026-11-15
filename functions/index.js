// وظائف السيرفر لمنصة مُنسِّق:
// 1) إشعار للإدارة عند وصول وصل تحويل أو تسجيل مدرسة جديدة
// 2) إشعار للمدرسة عند أي إشعار جديد في حسابها (تفعيل، رفض، تذكير)
// 3) تذكيرات يومية: قرب انتهاء الاشتراك أو التجربة، والطلبات المعلّقة للإدارة
// 4) حذف ملف الوصل من التخزين عند حذف الطلب
const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
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
  logger.info("push", { title, sent: res.successCount, failed: res.failureCount });
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
  await push(userTokens(e.params.sid), n.title || "مُنسِّق", n.body || "", "dashboard.html#billing");
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
