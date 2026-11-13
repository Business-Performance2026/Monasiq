// أدوات مشتركة بين صفحات المنصة
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, APP } from "./config.js";
import { initI18n, isEn, tr, t, lang } from "./i18n.js";
export { tr, t, isEn, lang };
export const APP_NAME = isEn ? (APP.nameEn || APP.name) : APP.name;
export const APP_TAGLINE = isEn ? (APP.taglineEn || APP.tagline) : APP.tagline;

export { APP };
export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const DAYS_ALL = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function applyBranding() {
  document.querySelectorAll("[data-app-name]").forEach(e => { e.textContent = APP_NAME; e.setAttribute("data-no-i18n", ""); });
  document.querySelectorAll("[data-app-tagline]").forEach(e => { e.textContent = APP_TAGLINE; e.setAttribute("data-no-i18n", ""); });
  const parts = document.title.split("|").map(x => x.trim());
  document.title = parts.length > 1 ? `${tr(parts[0])} | ${APP_NAME}` : APP_NAME;
  if (!configured) {
    const b = document.createElement("div");
    b.className = "config-banner";
    b.textContent = "تنبيه: لم يتم ربط Firebase بعد. ضع إعدادات مشروعك في الملف assets/config.js";
    document.body.prepend(b);
  }
  initI18n();
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

// أيقونات (خطوط بسيطة بنمط التطبيقات)
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  grades: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  subjects: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8"/>',
  teachers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.4.2 4 1.7 4.5 4.5"/>',
  timetable: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  schools: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5M9 11h.01M15 11h.01"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  magic: '<path d="m4 20 11-11M14 4l1.2 2.8L18 8l-2.8 1.2L14 12l-1.2-2.8L10 8l2.8-1.2zM19 13l.7 1.6 1.6.7-1.6.7L19 17.6l-.7-1.6-1.6-.7 1.6-.7zM6 3l.6 1.4L8 5l-1.4.6L6 7l-.6-1.4L4 5l1.4-.6z"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  web: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'
};
export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll("[data-ic]").forEach(el => { if (!el.firstChild) el.innerHTML = icon(el.dataset.ic, +(el.dataset.size || 22)); });
}
