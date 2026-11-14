// إرسال جدول المعلم كملف PDF عبر واتساب
// - الجوال: مشاركة الملف مباشرة (تختار واتساب ثم المعلم)
// - الكمبيوتر: تحميل الملف + فتح محادثة المعلم في واتساب والرسالة جاهزة (ثم إرفاق الملف)
import { APP, toast, tr, t as tf, confirmBox } from "./app.js?v=202611140043";
import { sheetsPdfFile } from "./print.js?v=202611140043";

export const WA_ICON = `<svg class="wa-ic" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.7 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z"/></svg>`;

// تحويل الرقم لصيغة واتساب الدولية (أرقام عُمان المحلية 8 خانات → 968xxxxxxxx)
export function waNumber(phone) {
  let d = String(phone || "").replace(/[٠-٩]/g, c => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  const cc = String(APP.countryCode || "968");
  if (d.length === 8) d = cc + d;
  else if (d.length === 9 && d.startsWith("0")) d = cc + d.slice(1);
  return d;
}

const firstNames = n => String(n || "").trim().split(/\s+/).slice(0, 2).join(" ");
export const waMessage = (name, link) => `${tf("السلام عليكم تفضل أستاذ {0} هذا جدولك", firstNames(name))}\n${link}`;

// رمز عشوائي صعب التخمين لرابط الجدول
export function newShareId() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(r, x => abc[x % abc.length]).join("");
}
export const shareLink = id => new URL("share.html?id=" + id, location.href).href;

// تحويل ورقة الجدول لصيغة تُحفظ في Firestore (بدون Map)
export function sheetToDoc(sh) {
  const cells = {};
  sh.cells.forEach((v, k) => { cells[k] = { main: v.main || "", sub: v.sub || "", color: v.color || "", blocked: !!v.blocked }; });
  return { kind: sh.kind, title: sh.title, school: sh.school || "", days: sh.days, periods: sh.periods, cells, stats: sh.stats || [], legend: sh.legend || [] };
}
export function docToSheet(d) {
  return { ...d, cells: new Map(Object.entries(d.cells || {})) };
}

/**
 * يفتح محادثة المعلم في واتساب والرسالة جاهزة مع رابط جدوله.
 * save: دالة تحفظ الجدول في الرابط وترجع رمزه (async)
 * يجب استدعاؤها مباشرة من حدث الضغط (لفتح النافذة قبل أي انتظار)
 */
export async function sendTimetableLink({ name, phone, save }) {
  const num = waNumber(phone);
  const win = window.open("about:blank", "_blank");
  try {
    const id = await save();
    const url = `https://wa.me/${num}?text=${encodeURIComponent(waMessage(name, shareLink(id)))}`;
    if (win && !win.closed) win.location.href = url; else location.href = url;
    toast(tr("تم فتح محادثة المعلم في واتساب والرسالة جاهزة مع رابط جدوله"), "success");
  } catch (e) {
    win?.close();
    throw e;
  }
}
