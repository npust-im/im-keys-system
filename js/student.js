// ============================================================
//  前台學生借用邏輯
// ============================================================
import {
  db, ready, collection, getDocs, addDoc, serverTimestamp,
  onSnapshot, query, where,
  loadCatalog, addCatalogItem, seedCatalogIfEmpty, fmtTime,
} from "./db.js";

const $ = (id) => document.getElementById(id);

let students = [];
let selected = null;
let catalog = { keys: [], equipment: [] };
let chosenKey = null;
let chosenEq = {};
let wantKey = false;   // 是否要借鑰匙
let wantEq = false;    // 是否要借設備
let borrowedKeys = new Set();   // 目前借出中（未歸還）的鑰匙

init();
async function init() {
  try {
    await ready;
    await seedCatalogIfEmpty();
    await loadStudents();
    catalog = await loadCatalog();
    watchBorrowedKeys();     // 即時追蹤哪些鑰匙已借出
    renderKeys();
    renderEquipment();
    $("loading").classList.add("hidden");
    $("form").classList.remove("hidden");
    startClock();
    bindEvents();
  } catch (err) {
    $("loading").innerHTML =
      `<p class="msg msg-err">連線失敗，請稍後再試，或通知系辦。<br><span class="small">${err.message}</span></p>`;
  }
}

async function loadStudents() {
  const snap = await getDocs(collection(db, "groups"));
  students = [];
  snap.forEach((d) => {
    const g = d.data();
    (g.students || []).forEach((s) => {
      students.push({
        studentId: String(s.studentId || "").trim(),
        name: String(s.name || "").trim(),
        idLast3: String(s.idLast3 || "").trim(),
        className: String(s.className || "").trim(),
        groupName: g.name || "",
      });
    });
  });
}

// ── 學號模糊比對 ─────────────────────────────────────────────
function runSearch() {
  const q = $("sid").value.trim().toLowerCase();
  const box = $("suggest");
  if (!q) { box.classList.add("hidden"); return; }
  const hits = students.filter(
    (s) => s.studentId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  ).slice(0, 8);
  if (hits.length === 0) {
    box.innerHTML = `<div class="empty">查無符合的學號，請確認或洽系辦</div>`;
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = hits.map((s, i) => `
    <div class="item" data-i="${i}">
      <span class="sid">${s.studentId}</span>
      <span class="snm">${esc(s.name)}</span>
      <span class="scl">${esc(s.className || s.groupName)}</span>
    </div>`).join("");
  box.classList.remove("hidden");
  [...box.querySelectorAll(".item")].forEach((el, i) => {
    el.addEventListener("mousedown", (e) => { e.preventDefault(); pick(hits[i]); });
  });
}

function pick(s) {
  selected = s;
  $("sid").value = s.studentId;
  $("sname").value = s.name;
  $("suggest").classList.add("hidden");
  $("sid3").focus();
}

// ── 借用項目開關 ─────────────────────────────────────────────
function toggleWantKey() {
  wantKey = !wantKey;
  $("wantKey").classList.toggle("on", wantKey);
  $("keySection").classList.toggle("hidden", !wantKey);
  if (!wantKey) { chosenKey = null; renderKeys(); }
}
function toggleWantEq() {
  wantEq = !wantEq;
  $("wantEq").classList.toggle("on", wantEq);
  $("eqSection").classList.toggle("hidden", !wantEq);
  if (!wantEq) { chosenEq = {}; renderEquipment(); }
}

// 即時追蹤借出中（未歸還）的鑰匙，已借出的就不能再借
function watchBorrowedKeys() {
  const q = query(collection(db, "records"), where("status", "==", "borrowed"));
  onSnapshot(q, (snap) => {
    borrowedKeys = new Set();
    snap.forEach((d) => { const k = d.data().key; if (k) borrowedKeys.add(k); });
    if (chosenKey && borrowedKeys.has(chosenKey)) chosenKey = null; // 剛好被別人借走 → 取消選取
    renderKeys();
  });
}

// ── 鑰匙（單選晶片）────────────────────────────────────────
function renderKeys() {
  const box = $("keyChips");
  box.innerHTML = catalog.keys.map((k) => {
    if (borrowedKeys.has(k)) {
      // 已借出：顯示為停用狀態，不可點選
      return `<span class="chip" style="opacity:.45;cursor:not-allowed;border-style:dashed" title="已借出，暫不可借">${esc(k)}・借出中</span>`;
    }
    return `<button type="button" class="chip ${chosenKey === k ? "on" : ""}" data-key="${esc(k)}">${esc(k)}</button>`;
  }).join("");
  [...box.querySelectorAll("button.chip")].forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.dataset.key;
      chosenKey = (chosenKey === k) ? null : k;
      renderKeys();
    });
  });
}

// ── 設備（複選 + 數量）─────────────────────────────────────
function renderEquipment() {
  const box = $("eqList");
  box.innerHTML = catalog.equipment.map((e) => {
    const on = e in chosenEq;
    const qty = chosenEq[e] || 1;
    return `
      <div class="eq-row ${on ? "" : "dim"}" data-eq="${esc(e)}">
        <label class="eq-check">
          <input type="checkbox" ${on ? "checked" : ""} />
          <span>${esc(e)}</span>
        </label>
        <div class="stepper">
          <button type="button" data-act="dec">−</button>
          <input class="qty" type="text" inputmode="numeric" value="${qty}" />
          <button type="button" data-act="inc">+</button>
        </div>
      </div>`;
  }).join("");

  [...box.querySelectorAll(".eq-row")].forEach((row) => {
    const name = row.dataset.eq;
    const cb = row.querySelector('input[type=checkbox]');
    const qtyInput = row.querySelector(".qty");
    cb.addEventListener("change", () => {
      if (cb.checked) chosenEq[name] = parseInt(qtyInput.value) || 1;
      else delete chosenEq[name];
      renderEquipment();
    });
    row.querySelector('[data-act=inc]').addEventListener("click", () => {
      chosenEq[name] = (parseInt(qtyInput.value) || 0) + 1; renderEquipment();
    });
    row.querySelector('[data-act=dec]').addEventListener("click", () => {
      chosenEq[name] = Math.max(1, (parseInt(qtyInput.value) || 1) - 1); renderEquipment();
    });
    qtyInput.addEventListener("input", () => {
      let v = parseInt(qtyInput.value.replace(/\D/g, "")) || 1;
      if (v < 1) v = 1;
      chosenEq[name] = v;
    });
  });
}

// ── 新增鑰匙 / 設備 ──────────────────────────────────────────
async function handleAdd(type, inputEl, msgEl) {
  const name = inputEl.value.trim();
  if (!name) return;
  inputEl.disabled = true;
  const ok = await addCatalogItem(type, name);
  inputEl.disabled = false;
  if (!ok) {
    msgEl.textContent = `「${name}」已經在清單中，不需要重複新增。`;
    msgEl.style.color = "var(--danger)";
    return;
  }
  msgEl.textContent = `已新增「${name}」。`;
  msgEl.style.color = "var(--returned)";
  inputEl.value = "";
  catalog = await loadCatalog();
  if (type === "keys") renderKeys(); else renderEquipment();
}

// ── 送出 ─────────────────────────────────────────────────────
async function submit() {
  const msg = $("submitMsg");
  msg.innerHTML = "";
  const show = (t, cls = "msg-err") => { msg.innerHTML = `<div class="msg ${cls}">${t}</div>`; };

  const sidVal = $("sid").value.trim();
  if (!selected || selected.studentId !== sidVal) {
    return show("請從搜尋清單中選擇你的學號（不要只手動輸入）。");
  }
  const id3 = $("sid3").value.trim();
  if (!/^\d{3}$/.test(id3)) return show("請輸入身分證後 3 碼（3 位數字）。");
  if (id3 !== selected.idLast3) return show("身分證後 3 碼與學號不符，請重新確認。");

  if (!wantKey && !wantEq) return show("請先在「要借什麼？」選擇借鑰匙或借設備。");
  if (wantKey && !chosenKey) return show("你選了借鑰匙，請在清單中挑一支鑰匙。");
  const eqArr = Object.entries(chosenEq).map(([name, qty]) => ({ name, qty }));
  if (wantEq && eqArr.length === 0) return show("你選了借設備，請至少勾選一項設備。");

  const btn = $("submitBtn");
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    // 送出前再確認一次鑰匙沒有被別人搶先借走
    if (wantKey && chosenKey) {
      const snap = await getDocs(query(collection(db, "records"), where("status", "==", "borrowed")));
      const taken = new Set();
      snap.forEach((d) => { const k = d.data().key; if (k) taken.add(k); });
      if (taken.has(chosenKey)) {
        const takenName = chosenKey;
        borrowedKeys = taken;
        chosenKey = null;
        renderKeys();
        show(`鑰匙「${esc(takenName)}」剛剛已被借走，請改選其他教室。`);
        btn.disabled = false; btn.textContent = "送出借用登記";
        return;
      }
    }
    await addDoc(collection(db, "records"), {
      studentId: selected.studentId,
      name: selected.name,
      className: selected.className,
      groupName: selected.groupName,
      idLast3: selected.idLast3,
      key: wantKey ? (chosenKey || null) : null,
      equipment: wantEq ? eqArr : [],
      status: "borrowed",
      returnedBy: null,
      returnedAt: null,
      borrowedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    showDone(eqArr);
  } catch (err) {
    show("送出失敗，請重試。" + err.message);
    btn.disabled = false; btn.textContent = "送出借用登記";
  }
}

function showDone(eqArr) {
  const parts = [];
  if (wantKey && chosenKey) parts.push(`<span class="tag tag-key">🔑 ${esc(chosenKey)}</span>`);
  if (wantEq) eqArr.forEach((e) => parts.push(`<span class="tag tag-eq">${esc(e.name)} ×${e.qty}</span>`));
  $("doneSummary").innerHTML =
    `<div><span class="strong">${esc(selected.name)}</span> · <span class="mono">${selected.studentId}</span></div>
     <div class="mt8">${parts.join(" ")}</div>
     <div class="small mt8">借出時間：${fmtTime(new Date())}</div>`;
  $("form").classList.add("hidden");
  $("done").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── 事件綁定 & 工具 ──────────────────────────────────────────
function bindEvents() {
  $("sid").addEventListener("input", () => {
    selected = null; $("sname").value = "";
    runSearch();
  });
  $("sid").addEventListener("focus", runSearch);
  $("sid").addEventListener("blur", () => setTimeout(() => $("suggest").classList.add("hidden"), 150));
  $("sid3").addEventListener("input", () => {
    $("sid3").value = $("sid3").value.replace(/\D/g, "").slice(0, 3);
  });

  $("wantKey").addEventListener("click", toggleWantKey);
  $("wantEq").addEventListener("click", toggleWantEq);

  $("addKeyBtn").addEventListener("click", () => handleAdd("keys", $("newKey"), $("keyMsg")));
  $("addEqBtn").addEventListener("click", () => handleAdd("equipment", $("newEq"), $("eqMsg")));
  $("newKey").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("addKeyBtn").click(); }});
  $("newEq").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("addEqBtn").click(); }});

  $("submitBtn").addEventListener("click", submit);
  $("againBtn").addEventListener("click", () => location.reload());
}

function startClock() {
  const tick = () => { $("clock").textContent = fmtTime(new Date()); };
  tick(); setInterval(tick, 1000 * 20);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
