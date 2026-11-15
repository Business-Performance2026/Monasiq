// عامل الخدمة لإشعارات الجوال (يعمل حتى لو كانت المنصة مغلقة)
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD9oxecNw5MZYuQme8CcmpXeaioD_pmZv4",
  authDomain: "monasiq.firebaseapp.com",
  projectId: "monasiq",
  storageBucket: "monasiq.firebasestorage.app",
  messagingSenderId: "661419083587",
  appId: "1:661419083587:web:863371e81c8293ff3d91f6"
});
// الإشعار يُعرض تلقائيًا من بيانات الرسالة (العنوان، النص، الرابط)
firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
