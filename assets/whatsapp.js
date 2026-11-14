// إرسال جدول المعلم كملف PDF عبر واتساب
// - الجوال: مشاركة الملف مباشرة (تختار واتساب ثم المعلم)
// - الكمبيوتر: تحميل الملف + فتح محادثة المعلم في واتساب والرسالة جاهزة (ثم إرفاق الملف)
import { APP, toast, tr, t as tf, confirmBox } from "./app.js?v=202611140018";
import { sheetsPdfFile } from "./print.js?v=202611140018";

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
export const waMessage = name => tf("السلام عليكم أستاذ {0}، هذا جدولك تفضل", firstNames(name));

function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] })); }
  catch { return false; }
}

// يُستدعى مباشرة من حدث الضغط (حتى لا يمنع المتصفح فتح النافذة)
export async function sendTimetableWA({ name, phone, sheet }) {
  const num = waNumber(phone);
  const msg = waMessage(name);
  const mobile = canShareFiles();
  // في الكمبيوتر نفتح النافذة فورًا ثم نوجهها لاحقًا (تفاديًا لمنع النوافذ المنبثقة)
  const win = !mobile && num ? window.open("about:blank", "_blank") : null;
  toast(tr("جارٍ تجهيز ملف الجدول"));
  let file;
  try { file = await sheetsPdfFile([sheet], tf("جدول {0}", name)); }
  catch (e) { win?.close(); toast(tr("تعذّر إنشاء ملف PDF. استخدم الطباعة ثم «حفظ بتنسيق PDF»."), "error"); return; }

  if (mobile) {
    const share = () => navigator.share({ files: [file], text: msg, title: file.name });
    try { await share(); }
    catch (e) {
      if (e?.name === "AbortError") return;
      // انتهت مهلة الضغط أثناء تجهيز الملف: نطلب ضغطة جديدة
      if (await confirmBox(tf("ملف جدول {0} جاهز. اضغط «إرسال» ثم اختر واتساب والمعلم.", name), tr("إرسال"), false)) {
        try { await share(); } catch (e2) { if (e2?.name !== "AbortError") fallback(); }
      }
    }
    return;
  }
  fallback();

  function fallback() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    const url = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
    if (win) win.location.href = url; else window.open(url, "_blank");
    toast(tr("تم تحميل ملف الجدول وفتح محادثة المعلم في واتساب. أرفق الملف في المحادثة ثم أرسل."), "success");
  }
}
