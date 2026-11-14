// ===============================================
//  إعدادات المنصة — عدّل هذا الملف فقط
// ===============================================

// 1) بيانات المنصة (الاسم ووسائل التواصل التي تظهر في الصفحة الرئيسية)
export const APP = {
  name: "مُنسِّق",
  nameEn: "Monasiq",                 // الاسم في النسخة الإنجليزية
  tagline: "منصة توزيع جدول الحصص للمدارس",
  taglineEn: "School Timetable Distribution Platform",
  contactPhone: "",   // مثال: "+96890000000" — اتركه فارغًا لإخفائه
  contactEmail: "",   // مثال: "info@example.com" — اتركه فارغًا لإخفائه
  whatsapp: "",
  countryCode: "968"  // رمز الدولة لأرقام المعلمين المحلية (واتساب)        // رقم واتساب بدون + مثال: "96890000000"
};

// 2) إعدادات Firebase — انسخها من:
// Firebase Console > Project settings > General > Your apps > SDK setup and configuration
export const firebaseConfig = {
  apiKey: "AIzaSyD9oxecNw5MZYuQme8CcmpXeaioD_pmZv4",
  authDomain: "monasiq.firebaseapp.com",
  projectId: "monasiq",
  storageBucket: "monasiq.firebasestorage.app",
  messagingSenderId: "661419083587",
  appId: "1:661419083587:web:863371e81c8293ff3d91f6"
};
