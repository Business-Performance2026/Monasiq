// إشعارات الجوال (Firebase Cloud Messaging)
import { app, db, tr } from "./app.js?v=202611141906";
import { firebaseConfig } from "./config.js?v=202611141906";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MSG = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
const KEY = "pushToken";
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
async function supported() {
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return false;
  try { return await (await import(MSG)).isSupported(); } catch { return false; }
}

// on | off | denied | ios-install | unsupported
export async function pushState() {
  if (isIOS() && !standalone()) return "ios-install";
  if (!(await supported())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && localStorage.getItem(KEY) ? "on" : "off";
}

async function getTok() {
  const { getMessaging, getToken } = await import(MSG);
  const reg = await navigator.serviceWorker.register("firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  const opts = { serviceWorkerRegistration: reg };
  if (firebaseConfig.vapidKey) opts.vapidKey = firebaseConfig.vapidKey;
  return getToken(getMessaging(app), opts);
}
async function save(token, ctx) {
  await setDoc(doc(db, "pushTokens", await hash(token)), {
    token, uid: ctx.uid, role: ctx.role, schoolId: ctx.schoolId || "", ua: navigator.userAgent.slice(0, 160), at: Date.now()
  });
  localStorage.setItem(KEY, token);
}

// تفعيل الإشعارات على هذا الجهاز (يجب أن يكون بعد ضغطة زر)
export async function enablePush(ctx) {
  if (!(await supported())) throw new Error("unsupported");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");
  const token = await getTok();
  if (!token) throw new Error("token");
  await save(token, ctx);
  return token;
}
// تحديث الرمز بصمت عند كل فتح (الرموز تتغير أحيانًا)
export async function refreshPush(ctx) {
  try {
    if (!localStorage.getItem(KEY) || Notification.permission !== "granted" || !(await supported())) return;
    const old = localStorage.getItem(KEY), token = await getTok();
    if (token && token !== old) { await deleteDoc(doc(db, "pushTokens", await hash(old))).catch(() => {}); await save(token, ctx); }
    else if (token) await save(token, ctx);
  } catch {}
}
export async function disablePush() {
  const old = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  if (!old) return;
  await deleteDoc(doc(db, "pushTokens", await hash(old))).catch(() => {});
  try { const { getMessaging, deleteToken } = await import(MSG); await deleteToken(getMessaging(app)); } catch {}
}

// بطاقة/زر جاهز لصفحات المنصة
export function pushCardHTML(state, esc) {
  const msg = {
    on: ["ok", "الإشعارات مفعّلة على هذا الجهاز ✅", "ستصلك التنبيهات حتى لو كانت المنصة مغلقة."],
    off: ["info", "فعّل إشعارات الجوال", "ليصلك تنبيه فوري حتى لو كانت المنصة مغلقة."],
    denied: ["bad", "الإشعارات محظورة في هذا المتصفح", "اسمح بالإشعارات لهذا الموقع من إعدادات المتصفح ثم أعد المحاولة."],
    "ios-install": ["warn", "على الآيفون: أضف المنصة للشاشة الرئيسية أولًا", "من Safari اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتح المنصة من الأيقونة، ثم فعّل الإشعارات من هنا."],
    unsupported: ["warn", "هذا المتصفح لا يدعم الإشعارات", "استخدم Chrome على الأندرويد أو الكمبيوتر، أو أضف المنصة للشاشة الرئيسية على الآيفون."]
  }[state];
  return `<div class="push-card ${msg[0]}">
    <div><b>${esc(tr(msg[1]))}</b><small>${esc(tr(msg[2]))}</small></div>
    ${state === "off" ? `<button class="btn primary sm" data-push="on">${esc(tr("تفعيل"))}</button>` : state === "on" ? `<button class="btn sm ghost" data-push="off">${esc(tr("إيقاف"))}</button>` : ""}
  </div>`;
}
// ربط أزرار البطاقة
export function bindPushCard(root, ctx, onChange, toast) {
  root.querySelectorAll("[data-push]").forEach(b => (b.onclick = async () => {
    b.disabled = true;
    try {
      if (b.dataset.push === "on") { await enablePush(ctx); toast(tr("تم تفعيل الإشعارات ✅"), "success"); }
      else { await disablePush(); toast(tr("تم إيقاف الإشعارات"), "info"); }
    } catch (e) {
      toast(tr(e.message === "denied" ? "لم يتم السماح بالإشعارات" : "تعذّر تفعيل الإشعارات على هذا الجهاز"), "error");
    }
    onChange();
  }));
}
