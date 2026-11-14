// صفحة جدول المعلم العامة (من رابط واتساب) — بدون تسجيل دخول
import { db, applyBranding, esc, toast, tr, t as tf, isEn, fillIcons } from "./app.js?v=202611140043";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sheetHTML, downloadSheetsPDF, printSheets } from "./print.js?v=202611140043";
import { docToSheet } from "./whatsapp.js?v=202611140043";

applyBranding();
const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";

let sheet = null;
try {
  const snap = id ? await getDoc(doc(db, "shares", id)) : null;
  if (snap?.exists()) sheet = docToSheet(snap.data().sheet || {});
  if (snap?.exists()) {
    const d = snap.data();
    $("schoolName").textContent = d.sheet?.school || "";
    document.title = `${d.name} | ${document.title.split("|").pop().trim()}`;
    render(d);
  } else notFound();
} catch (e) { notFound(); }

function notFound() {
  $("view").innerHTML = `<div class="card empty"><div class="big">🔗</div><h3>${tr("الرابط غير صالح")}</h3><p class="muted">${tr("تأكد من الرابط أو اطلب من إدارة المدرسة إرساله مرة أخرى.")}</p></div>`;
}

function render(d) {
  const when = d.updatedAt?.toDate ? d.updatedAt.toDate().toLocaleDateString(isEn ? "en-GB" : "ar-OM") : "";
  $("view").innerHTML = `
    <div class="share-head">
      <div><small class="muted">${tr("جدول المعلم")}</small><h1>${esc(d.name)}</h1>${when ? `<small class="muted">${esc(tf("آخر تحديث: {0}", when))}</small>` : ""}</div>
      <div class="row-actions">
        <button class="btn primary lg" id="dlBtn"><span data-ic="download" data-size="18"></span>${tr("تحميل PDF")}</button>
        <button class="btn lg" id="prBtn"><span data-ic="print" data-size="18"></span>${tr("طباعة")}</button>
      </div>
    </div>
    <div class="share-sheet"><div class="share-scale" id="scale">${sheetHTML(sheet)}</div></div>`;
  fillIcons($("view"));
  fit(); window.addEventListener("resize", fit);
  setTimeout(fit, 300); document.fonts?.ready?.then(fit);
  $("dlBtn").onclick = async () => {
    const b = $("dlBtn"); b.disabled = true;
    try { toast(tr("جارٍ تجهيز الملف")); await downloadSheetsPDF([sheet], tf("جدول {0}", d.name)); }
    catch (e) { toast(tr("تعذّر إنشاء ملف PDF. استخدم الطباعة ثم «حفظ بتنسيق PDF»."), "error"); }
    b.disabled = false;
  };
  $("prBtn").onclick = () => printSheets([sheet], 1);
}
// تصغير الجدول ليناسب عرض الشاشة (مع إمكانية التكبير بالأصابع)
function fit() {
  const box = document.querySelector(".share-sheet"), el = $("scale");
  if (!box || !el) return;
  const W = 1123, s = Math.min(1, box.clientWidth / W);
  el.style.transform = `scale(${s})`;
  box.style.height = Math.ceil(el.scrollHeight * s) + 2 + "px";
}
