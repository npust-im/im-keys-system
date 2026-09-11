// ============================================================
//  資料層：初始化 Firebase、匿名登入、共用讀寫函式
//  （一般情況不需要修改這個檔案）
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 匿名登入：讓安全規則能要求「必須登入」，擋掉未經網頁的直接刷資料。
// 回傳一個 Promise，頁面會等它完成後才讀寫資料。
export const ready = signInAnonymously(auth).catch((err) => {
  console.error("匿名登入失敗，請確認 Firebase Authentication 已開啟「匿名」登入方式。", err);
  throw err;
});

// 把 Firestore 常用函式再匯出，讓 student.js / admin.js 直接用。
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
};

// ── 共用小工具 ───────────────────────────────────────────────

// 把 Firestore 的 Timestamp 轉成好讀的字串：2026/09/11 14:03
export function fmtTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 讀取整份鑰匙 / 設備清單（catalog）。回傳 { keys:[], equipment:[] }
// 設備項目統一整理成物件 { name, max }。max 為 null 代表不限制。
// 相容舊資料：舊的設備是純字串，會被轉成 { name, max:null }。
export function normEquip(items) {
  return (items || []).map((it) =>
    typeof it === "string"
      ? { name: it, max: null }
      : { name: it.name, max: (it.max === undefined || it.max === "" ? null : it.max) }
  );
}

export async function loadCatalog() {
  const keysSnap = await getDoc(doc(db, "catalog", "keys"));
  const eqSnap = await getDoc(doc(db, "catalog", "equipment"));
  return {
    keys: keysSnap.exists() ? keysSnap.data().items || [] : [],
    equipment: eqSnap.exists() ? normEquip(eqSnap.data().items) : [],
  };
}

// 取得清單中所有項目的「名稱」（設備可能是物件，鑰匙是字串）
function itemNames(items) {
  return (items || []).map((i) => (typeof i === "string" ? i : i.name));
}

// 新增一個項目。type 為 "keys" 或 "equipment"；名稱相同不會重複加入。
// 設備可帶 max（數量上限），留空 / null = 不限制。回傳 true=成功，false=名稱已存在。
export async function addCatalogItem(type, name, max = null) {
  name = String(name).trim();
  if (!name) return false;
  const ref = doc(db, "catalog", type);
  const snap = await getDoc(ref);
  const items = snap.exists() ? snap.data().items || [] : [];
  if (itemNames(items).includes(name)) return false;
  const newItem =
    type === "equipment"
      ? { name, max: (max === "" || max == null ? null : Number(max)) }
      : name;
  await setDoc(ref, { items: [...items, newItem] });
  return true;
}

// 刪除清單項目（依名稱）
export async function removeCatalogItem(type, name) {
  const ref = doc(db, "catalog", type);
  const snap = await getDoc(ref);
  const items = snap.exists() ? snap.data().items || [] : [];
  const next = items.filter((i) => (typeof i === "string" ? i : i.name) !== name);
  await setDoc(ref, { items: next });
}

// 直接覆寫整份清單（用於拖曳排序、修改數量上限）
export async function setCatalogItems(type, items) {
  await setDoc(doc(db, "catalog", type), { items });
}

// 若清單為空，寫入預設鑰匙與設備（第一次使用時自動建立）
export async function seedCatalogIfEmpty() {
  const cat = await loadCatalog();
  if (cat.keys.length === 0) {
    await setDoc(doc(db, "catalog", "keys"), {
      items: [
        "CM105", "CM107", "CM110", "CM113", "CM212", "CM214",
        "CM216", "CM316", "CM318", "CM411", "CM436",
      ],
    });
  }
  if (cat.equipment.length === 0) {
    await setDoc(doc(db, "catalog", "equipment"), {
      items: ["塑膠立牌", "簡報筆", "電腦", "海報架", "相機", "腳架", "延長線", "長條桌"]
        .map((name) => ({ name, max: null })),
    });
  }
}
