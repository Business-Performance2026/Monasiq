// تشخيص الإشعارات: الأجهزة المسجلة وآخر الطلبات (بدون طباعة الرموز كاملة)
const admin = require("../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "monasiq" });
const db = admin.firestore();
(async () => {
  const toks = await db.collection("pushTokens").get();
  console.log("pushTokens:", toks.size);
  toks.forEach(d => { const x = d.data(); console.log(" -", x.role, x.uid.slice(0, 6), (x.ua || "").slice(0, 70), new Date(x.at).toISOString(), "tok:", (x.token || "").slice(0, 12)); });
  const pays = await db.collection("payments").orderBy("createdAt", "desc").limit(3).get();
  pays.forEach(d => { const x = d.data(); console.log("payment", x.status, x.schoolName, new Date(x.createdAt).toISOString(), "url:", !!x.receiptUrl); });
  if (process.env.TEST_PUSH === "1") {
    const tokens = toks.docs.filter(d => d.get("role") === "admin").map(d => d.get("token"));
    if (tokens.length) {
      const r = await admin.messaging().sendEachForMulticast({ tokens, notification: { title: "اختبار مُنسِّق", body: "هذا إشعار تجريبي" },
        webpush: { fcmOptions: { link: "https://business-performance2026.github.io/Monasiq/admin.html#payments" } } });
      r.responses.forEach((x, i) => console.log("send", i, x.success, x.error?.code, x.error?.message));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
