// ============================================================
//  設定檔 — 部署前只需要修改「這一個檔案」
// ============================================================

// ── 1. Firebase 設定 ─────────────────────────────────────────
// 到 Firebase 主控台 → 專案設定 → 你的應用程式 → 複製 firebaseConfig，
// 把下面整段換成你自己的。（README 有圖解步驟）
export const firebaseConfig = {
  apiKey: "AIzaSyA3INR5x-YgpOB8WgBWflmO55fmxyfahsg",
  authDomain: "im-keys-system.firebaseapp.com",
  projectId: "im-keys-system",
  storageBucket: "im-keys-system.firebasestorage.app",
  messagingSenderId: "1034776154974",
  appId: "1:1034776154974:web:894387b1613129799cb5cf"
};

// ── 2. 後台密碼 ──────────────────────────────────────────────
// 系辦工讀生進入後台（admin.html）時要輸入的共用密碼。請改成你要的密碼。
export const ADMIN_PASSWORD = "im7660";

// ── 3. 前台網址（QR code 用）─────────────────────────────────
// 部署完成後把你的 index.html 網址貼進來，qr.html 會用它產生固定 QR code。
// 例如：https://你的帳號.github.io/你的儲存庫/index.html
export const SITE_URL = "https://npust-im.github.io/im-keys-system/";
