// أدوات مشتركة بين صفحات المنصة
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, APP } from "./config.js";

export { APP };
export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const DAYS_ALL = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function applyBranding() {
  document.querySelectorAll("[data-app-name]").forEach(e => (e.textContent = APP.name));
  document.querySelectorAll("[data-app-tagline]").forEach(e => (e.textContent = APP.tagline));
  if (document.title.includes("{app}")) document.title = document.title.replace("{app}", APP.name);
  if (!configured) {
    const b = document.createElement("div");
    b.className = "config-banner";
    b.textContent = "تنبيه: لم يتم ربط Firebase بعد. ضع إعدادات مشروعك في الملف assets/config.js";
    document.body.prepend(b);
  }
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function toast(msg, type = "info") {
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add("hide"), 3200);
  setTimeout(() => t.remove(), 3700);
}

export function confirmBox(msg, okText = "تأكيد", danger = true) {
  return new Promise(resolve => {
    const wrap = document.createElement("div");
    wrap.className = "modal-back show";
    wrap.innerHTML = `<div class="modal small"><p class="confirm-msg">${esc(msg)}</p>
      <div class="modal-actions"><button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(okText)}</button>
      <button class="btn ghost" data-no>إلغاء</button></div></div>`;
    document.body.appendChild(wrap);
    const done = v => { wrap.remove(); resolve(v); };
    wrap.querySelector("[data-ok]").onclick = () => done(true);
    wrap.querySelector("[data-no]").onclick = () => done(false);
    wrap.onclick = e => { if (e.target === wrap) done(false); };
  });
}

export function waitUser() {
  return new Promise(resolve => {
    const un = onAuthStateChanged(auth, u => { un(); resolve(u); });
  });
}

// يحدد نوع المستخدم: admin | school(+status) | none
export async function getRole(user) {
  if (!user) return { role: "none" };
  const a = await getDoc(doc(db, "admins", user.uid));
  if (a.exists()) return { role: "admin" };
  const s = await getDoc(doc(db, "schools", user.uid));
  if (s.exists()) return { role: "school", status: s.data().status, school: { id: s.id, ...s.data() } };
  return { role: "none" };
}

export async function logout() {
  await signOut(auth);
  location.href = "login.html";
}

export function errMsg(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-email": "البريد الإلكتروني غير صحيح",
    "auth/email-already-in-use": "هذا البريد مسجّل مسبقًا",
    "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
    "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة",
    "auth/wrong-password": "كلمة المرور غير صحيحة",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/too-many-requests": "محاولات كثيرة، حاول بعد قليل",
    "auth/network-request-failed": "تحقق من اتصال الإنترنت",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "إعدادات Firebase غير صحيحة",
    "permission-denied": "ليس لديك صلاحية لهذه العملية"
  };
  return map[code] || e?.message || "حدث خطأ غير متوقع";
}

export const STATUS = {
  pending: { label: "بانتظار الموافقة", cls: "warn" },
  active: { label: "مفعّلة", cls: "ok" },
  suspended: { label: "موقوفة", cls: "bad" },
  rejected: { label: "مرفوضة", cls: "bad" }
};

export function defaultPeriods(count = 8, start = "08:00", dur = 45, gap = 15) {
  const out = [];
  let [h, m] = start.split(":").map(Number);
  let t = h * 60 + m;
  for (let i = 0; i < count; i++) {
    out.push({ start: fmt(t), end: fmt(t + dur) });
    t += dur + gap;
  }
  return out;
}
function fmt(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
