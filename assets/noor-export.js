// تصدير ملف الجدول لمنصة نور (صيغة «Oman XML» من aSc)
// الفكرة: نأخذ ملف الوزارة الأصلي كما هو، ونستبدل أجزاء الجدول فقط بالتوزيع الجديد:
// TimeTableSchedules + cards + lessons + TeacherSubjectClasses — وباقي الملف (الطلاب، المجموعات، الأرقام) لا يتغير

// ---------- ضغط وحفظ النص ----------
const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
export async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return b64(await new Response(stream).arrayBuffer());
}
export async function gunzipText(data) {
  const stream = new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// ---------- ترميز windows-1256 (الترميز الذي يستخدمه aSc للعربية) ----------
let REV = null;
function encodeLegacy(text, enc) {
  if (!/1256/.test(enc)) return new TextEncoder().encode(text);
  if (!REV) {
    REV = new Map();
    const dec = new TextDecoder("windows-1256");
    for (let b = 0; b < 256; b++) { const ch = dec.decode(new Uint8Array([b])); if (ch !== "�" && !REV.has(ch)) REV.set(ch, b); }
  }
  const out = [];
  for (const ch of text) {
    const b = REV.get(ch);
    if (b != null) out.push(b);
    else for (const c of `&#${ch.codePointAt(0)};`) out.push(c.charCodeAt(0)); // أي حرف غير موجود في الترميز يُكتب كرمز رقمي
  }
  return new Uint8Array(out);
}

const xa = v => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const NL = "\r\n";

// placed: [{t, s, c, d, p}] بأرقام الوزارة (d و p تبدأ من 0)
export function buildNoorXml(text, placed, encoding = "windows-1256") {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const all = tag => [...doc.getElementsByTagName(tag)];
  const at = (e, k) => e.getAttribute(k) || "";
  const classes = new Set(all("class").map(e => at(e, "id")));
  const teachers = new Set(all("teacher").map(e => at(e, "id")));
  const subjects = new Set(all("subject").map(e => at(e, "id")));

  // من الملف الأصلي: قاعة كل شعبة، والمجموعة الاختيارية لكل (مادة، شعبة) وطلابها
  const roomOf = new Map();
  for (const e of all("TimeTableSchedule")) if (at(e, "SchoolRoomID")) roomOf.set(at(e, "ClassID"), at(e, "SchoolRoomID"));
  for (const e of all("card")) if (at(e, "classroomid")) for (const c of at(e, "classids").split(",")) if (!roomOf.has(c)) roomOf.set(c, at(e, "classroomid"));
  const optOf = new Map();
  for (const e of all("TeacherSubjectClass")) if (at(e, "OptionalClassID")) optOf.set(at(e, "SubjectGradeID") + "|" + at(e, "ClassID"), at(e, "OptionalClassID"));
  const optStudents = new Map();
  for (const e of all("StudentOptionalClass")) { const o = at(e, "OptionalClassID"); if (!optStudents.has(o)) optStudents.set(o, []); optStudents.get(o).push(at(e, "StudentID")); }
  const optGroup = new Map(all("OptionalClass").map(e => [at(e, "OptionalClassID"), (at(e, "arName").match(/(\d+)\s*$/) || [])[1] || at(e, "ClassIndex")]));

  const warnings = [];
  let skipped = 0;
  const rows = placed.filter(x => {
    const ok = classes.has(x.c) && teachers.has(x.t) && subjects.has(x.s) && x.d != null && x.p != null;
    if (!ok) skipped++;
    return ok;
  }).sort((a, b) => a.c.localeCompare(b.c) || a.s.localeCompare(b.s) || a.d - b.d || a.p - b.p);
  if (skipped) warnings.push(`${skipped} حصة لشعب أو معلمين أو مواد غير موجودة في ملف الوزارة لم تُضمَّن`);
  if (!rows.length) return { error: "empty", warnings };

  // تجميع حسب (معلم، مادة، شعبة)
  const groups = new Map();
  for (const r of rows) { const k = `${r.t}|${r.s}|${r.c}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  let n = 0; const lessonId = new Map();
  for (const k of groups.keys()) lessonId.set(k, "*" + ++n);

  const opt = (s, c) => optOf.get(s + "|" + c) || "";
  const studs = (s, c) => { const o = opt(s, c); return o ? (optStudents.get(o) || []).join(",") : ""; };
  const sem = (s, c) => { const o = opt(s, c); return o ? optGroup.get(o) || "" : ""; };

  const schedXml = rows.map(r => `      <TimeTableSchedule DayID="${r.d + 1}" Period="${r.p + 1}" LengthID="0" SchoolRoomID="${xa(roomOf.get(r.c))}" SubjectGradeID="${xa(r.s)}" ClassID="${xa(r.c)}" OptionalClassID="${xa(opt(r.s, r.c))}" TeacherID="${xa(r.t)}"/>`);
  const cardXml = rows.map(r => `      <card classids="${xa(r.c)}" subjectid="${xa(r.s)}" lessonid="${lessonId.get(`${r.t}|${r.s}|${r.c}`)}" teacherid="${xa(r.t)}" classroomid="${xa(roomOf.get(r.c))}" studentids="${xa(studs(r.s, r.c))}" day="${r.d + 1}" period="${r.p + 1}"/>`);
  const lessonXml = [...groups].map(([k, list]) => { const [t, s, c] = k.split("|"); return `      <lesson id="${lessonId.get(k)}" classids="${xa(c)}" subjectid="${xa(s)}" periodsperweek="${list.length}.0" teacherid="${xa(t)}" studentids="${xa(studs(s, c))}" capacity="*" seminargroup="${xa(sem(s, c))}"/>`; });
  const tscXml = [...groups.keys()].map(k => { const [t, s, c] = k.split("|"); return `      <TeacherSubjectClass OptionalClassID="${xa(opt(s, c))}" SubjectGradeID="${xa(s)}" ClassID="${xa(c)}" TeacherID="${xa(t)}"/>`; });

  // استبدال محتوى الأقسام فقط مع الحفاظ على بقية الملف كما هو
  let out = text;
  const swap = (re, body, label) => {
    if (!re.test(out)) { warnings.push(`لم يوجد قسم ${label} في الملف الأصلي`); return; }
    out = out.replace(re, (m, open, close) => `${open}${NL}${body.join(NL)}${NL}   ${close}`);
  };
  swap(/(<TimeTableSchedules[^>]*>)[\s\S]*?(<\/TimeTableSchedules>)/, schedXml, "TimeTableSchedules");
  swap(/(<cards\b[^>]*>)[\s\S]*?(<\/cards>)/, ["\t", ...cardXml], "cards");
  swap(/(<lessons\b[^>]*>)[\s\S]*?(<\/lessons>)/, ["\t", ...lessonXml], "lessons");
  swap(/(<TeacherSubjectClasses[^>]*>)[\s\S]*?(<\/TeacherSubjectClasses>)/, tscXml, "TeacherSubjectClasses");

  return { bytes: encodeLegacy(out, encoding), text: out, warnings, stats: { lessons: rows.length, sections: new Set(rows.map(r => r.c)).size, teachers: new Set(rows.map(r => r.t)).size } };
}
