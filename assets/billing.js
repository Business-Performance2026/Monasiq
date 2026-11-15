// الاشتراكات: حساب الحالة والمبلغ، وتجهيز صورة الوصل
// كل المدارس تنتهي اشتراكاتها في تاريخ واحد كل سنة (افتراضيًا 31 أغسطس)
import { app, db, t as tf, tr, isEn } from "./app.js?v=202611150751";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const DAY = 86400000;
export const BILLING_DEFAULT = { price: 10, trialDays: 7, expMonth: 8, expDay: 31, bankPhone: "", bankName: "", bankNote: "", adminPhone: "", currency: "ر.ع" };

export function watchBilling(cb) {
  return onSnapshot(doc(db, "config", "billing"), d => cb({ ...BILLING_DEFAULT, ...(d.exists() ? d.data() : {}) }), () => cb({ ...BILLING_DEFAULT }));
}

// تاريخ الانتهاء الموحد في سنة معيّنة (نهاية اليوم)
const expIn = (y, cfg) => new Date(y, (+cfg.expMonth || 8) - 1, +cfg.expDay || 31, 23, 59, 59).getTime();
// أول تاريخ انتهاء موحد بعد لحظة معيّنة
export function nextExpiry(ms, cfg) {
  const y = new Date(ms).getFullYear();
  for (let k = 0; k < 3; k++) { const e = expIn(y + k, cfg); if (e > ms) return e; }
  return expIn(y + 3, cfg);
}

// حالة اشتراك المدرسة: active | trial | expired
export function subState(school, cfg, now = Date.now()) {
  const paid = +school?.paidUntil || 0, trial = +school?.trialEnds || 0;
  if (paid > now) return { state: "active", until: paid, daysLeft: Math.ceil((paid - now) / DAY) };
  if (!trial && !paid) return { state: "trial", until: 0, daysLeft: null }; // مدرسة قديمة لم تبدأ تجربتها بعد
  if (trial > now) return { state: "trial", until: trial, daysLeft: Math.ceil((trial - now) / DAY) };
  return { state: "expired", until: paid || trial, daysLeft: 0 };
}

// المبلغ المطلوب وتاريخ الانتهاء الجديد
// تجديد مدرسة مشتركة: سنة كاملة بعد تاريخ انتهائها بالسعر الكامل
// اشتراك جديد: حتى التاريخ الموحد القادم، بالسعر حسب الأشهر المتبقية
// (إذا بقي أقل من 45 يومًا على التاريخ الموحد، يمتد للسنة التي بعدها بالسعر الكامل)
export function quote(school, cfg, now = Date.now()) {
  const price = +cfg.price || 0, paid = +school?.paidUntil || 0;
  if (paid > now) return { amount: price, until: nextExpiry(paid + DAY, cfg), months: 12, renewal: true };
  let until = nextExpiry(now, cfg);
  if (until - now < 45 * DAY) return { amount: price, until: nextExpiry(until + DAY, cfg), months: 12, renewal: false };
  const months = Math.min(12, Math.ceil((until - now) / (30.44 * DAY)));
  return { amount: Math.max(1, Math.ceil(price * months / 12)), until, months, renewal: false };
}

export const fmtDate = ms => ms ? new Date(ms).toLocaleDateString(isEn ? "en-GB" : "ar-OM", { day: "numeric", month: "long", year: "numeric" }) : "";
export const money = (n, cfg) => `${n} ${isEn ? "OMR" : (cfg?.currency || "ر.ع")}`;

export function stateLabel(st) {
  if (st.state === "active") return { cls: "ok", text: tf("مفعّل حتى {0}", fmtDate(st.until)) };
  if (st.state === "trial") return { cls: "info", text: st.daysLeft == null ? tr("فترة تجريبية") : tf("فترة تجريبية · باقي {0} يوم", st.daysLeft) };
  return { cls: "bad", text: tr("منتهي") };
}

// ---------- صورة الوصل: تصغير وضغط داخل المتصفح (تُحفظ في Firestore، الحد ~1MB) ----------
const MAX_CHARS = 850000;
const STG = "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
async function canvasFromImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0); return c;
  } finally { URL.revokeObjectURL(url); }
}
async function canvasFromPdf(file) {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c;
}
const isPdf = f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
// صورة مضغوطة من الوصل. small = صورة مصغّرة للعرض السريع في القوائم
export async function receiptDataUrl(file, small = false) {
  const src = isPdf(file) ? await canvasFromPdf(file) : await canvasFromImage(file);
  const steps = small ? [[700, .7], [500, .6]] : [[1600, .8], [1280, .72], [1024, .65], [800, .6], [640, .55]];
  const limit = small ? 120000 : MAX_CHARS;
  for (const [max, q] of steps) {
    const k = Math.min(1, max / Math.max(src.width, src.height));
    const c = document.createElement("canvas"); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < limit) return url;
  }
  throw new Error("too-big");
}

// رفع الملف الأصلي للوصل إلى Firebase Storage (إذا كان مفعّلًا)
export async function uploadReceipt(file, schoolId, payId) {
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import(STG);
  if (file.size > 10 * 1024 * 1024) throw new Error("too-big");
  const ext = isPdf(file) ? "pdf" : ((file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg");
  const path = `receipts/${schoolId}/${payId}.${ext}`;
  const r = ref(getStorage(app), path);
  await uploadBytes(r, file, { contentType: file.type || (isPdf(file) ? "application/pdf" : "image/jpeg") });
  return { url: await getDownloadURL(r), path, type: isPdf(file) ? "pdf" : "image" };
}
