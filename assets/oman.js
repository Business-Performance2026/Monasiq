// محافظات سلطنة عمان (11) وولاياتها (63)
export const OMAN = [
  { gov: "مسقط", en: "Muscat", w: ["مسقط", "مطرح", "بوشر", "السيب", "العامرات", "قريات"] },
  { gov: "ظفار", en: "Dhofar", w: ["صلالة", "طاقة", "مرباط", "رخيوت", "ثمريت", "ضلكوت", "المزيونة", "مقشن", "شليم وجزر الحلانيات", "سدح"] },
  { gov: "مسندم", en: "Musandam", w: ["خصب", "دبا", "بخا", "مدحاء"] },
  { gov: "البريمي", en: "Al Buraimi", w: ["البريمي", "محضة", "السنينة"] },
  { gov: "الداخلية", en: "Ad Dakhiliyah", w: ["نزوى", "بهلاء", "منح", "الحمراء", "أدم", "إزكي", "سمائل", "بدبد", "الجبل الأخضر"] },
  { gov: "شمال الباطنة", en: "North Al Batinah", w: ["صحار", "شناص", "لوى", "صحم", "الخابورة", "السويق"] },
  { gov: "جنوب الباطنة", en: "South Al Batinah", w: ["الرستاق", "العوابي", "نخل", "وادي المعاول", "بركاء", "المصنعة"] },
  { gov: "جنوب الشرقية", en: "South Ash Sharqiyah", w: ["صور", "الكامل والوافي", "جعلان بني بو حسن", "جعلان بني بو علي", "مصيرة"] },
  { gov: "شمال الشرقية", en: "North Ash Sharqiyah", w: ["إبراء", "المضيبي", "بدية", "القابل", "وادي بني خالد", "دماء والطائيين", "سناو"] },
  { gov: "الظاهرة", en: "Ad Dhahirah", w: ["عبري", "ينقل", "ضنك"] },
  { gov: "الوسطى", en: "Al Wusta", w: ["هيماء", "محوت", "الدقم", "الجازر"] }
];
const wilOf = gov => OMAN.find(g => g.gov === gov)?.w || [];
// قائمتا المحافظة والولاية المرتبطتان. القيم الحالية غير الموجودة في القائمة تبقى كخيار
export function govOptions(cur = "", ph = "— اختر المحافظة —") {
  const known = OMAN.some(g => g.gov === cur);
  return `<option value="">${ph}</option>${!known && cur ? `<option selected>${cur}</option>` : ""}${OMAN.map(g => `<option value="${g.gov}" ${g.gov === cur ? "selected" : ""}>${g.gov}</option>`).join("")}`;
}
export function wilOptions(gov, cur = "", ph = "— اختر الولاية —") {
  const list = wilOf(gov), known = list.includes(cur);
  return `<option value="">${ph}</option>${!known && cur ? `<option selected>${cur}</option>` : ""}${list.map(w => `<option value="${w}" ${w === cur ? "selected" : ""}>${w}</option>`).join("")}`;
}
export function linkGovWil(govSel, wilSel, ph) {
  govSel.addEventListener("change", () => { wilSel.innerHTML = wilOptions(govSel.value, "", ph); wilSel.disabled = !govSel.value; });
  wilSel.disabled = !govSel.value;
}
