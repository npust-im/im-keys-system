// ============================================================
//  前台學生借用邏輯
// ============================================================
import {
  db, ready, collection, getDocs, addDoc, serverTimestamp,
  loadCatalog, addCatalogItem, seedCatalogIfEmpty, fmtTime,
} from "./db.js";

const $ = (id) => document.getElementById(id);

let students = [];          // 所有學生的比對索引
let selected = null;        // 已選定的學生
let catalog = { keys: [], equipment: [] };
let chosenKey = null;       // 選中的鑰匙（單選，可為 null）
let chosenEq = {};          // { 設備名稱: 數量 }

// ── 初始化 ───────────────────────────────────────────────────
init();
async function init() {
  try {
    await ready;
    await seedCatalogIfEmpty();     // 第一次使用自動建立預設清單
    await loadStudents();
    catalog = await loadCatalog();
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

// 把所有群組文件裡的學生攤平成一個比對索引
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
let activeIdx = -1;
function runSearch() {
  const q = $("sid").value.trim().toLowerCase();
  const box = $("suggest");
  if (!q) { box.classList.add("hidden"); return; }

  // 學號包含輸入字串，或姓名包含
  const hits = students.filter(
    (s) => s.studentId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
  ).slice(0, 8);

  activeIdx = -1;
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
  box._hits = hits;
}

function pick(s) {
  selected = s;
  $("sid").value = s.studentId;
  $("sname").value = s.name;
  $("suggest").classList.add("hidden");
  $("sid3").focus();
}

// ── 鑰匙（單選晶片）────────────────────────────────────────
function renderKeys() {
  const box = $("keyChips");
  box.innerHTML = catalog.keys.map(
    (k) => `<button type="button" class="chip ${chosenKey === k ? "on" : ""}" data-key="${esc(k)}">${esc(k)}</button>`
  ).join("");
  [...box.querySelectorAll(".chip")].forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.dataset.key;
      chosenKey = (chosenKey === k) ? null : k;   // 再點一次取消
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
      const v = (parseInt(qtyInput.value) || 0) + 1;
      chosenEq[name] = v; renderEquipment();
    });
    row.querySelector('[data-act=dec]').addEventListener("click", () => {
      const v = Math.max(1, (parseInt(qtyInput.value) || 1) - 1);
      chosenEq[name] = v; renderEquipment();
    });
    qtyInput.addEventListener("input", () => {
      let v = parseInt(qtyInput.value.replace(/\D/g, "")) || 1;
      if (v < 1) v = 1;
      chosenEq[name] = v;
    });
  });
}

// ── 新增鑰匙 / 設備到共用清單 ───────────────────────────────
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

  // 驗證學號選定
  const sidVal = $("sid").value.trim();
  if (!selected || selected.studentId !== sidVal) {
    return show("請從搜尋清單中選擇你的學號（不要只手動輸入）。");
  }
  // 驗證後 3 碼
  const id3 = $("sid3").value.trim();
  if (!/^\d{3}$/.test(id3)) return show("請輸入身分證後 3 碼（3 位數字）。");
  if (id3 !== selected.idLast3) return show("身分證後 3 碼與學號不符，請重新確認。");

  // 至少要借一項
  const eqArr = Object.entries(chosenEq).map(([name, qty]) => ({ name, qty }));
  if (!chosenKey && eqArr.length === 0) {
    return show("請至少選擇一支鑰匙或一項設備。");
  }

  const btn = $("submitBtn");
  btn.disabled = true; btn.textContent = "送出中…";
  try {
    await addDoc(collection(db, "records"), {
      studentId: selected.studentId,
      name: selected.name,
      className: selected.className,
      groupName: selected.groupName,
      idLast3: selected.idLast3,
      key: chosenKey || null,
      equipment: eqArr,
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
  if (chosenKey) parts.push(`<span class="tag tag-key">🔑 ${esc(chosenKey)}</span>`);
  eqArr.forEach((e) => parts.push(`<span class="tag tag-eq">${esc(e.name)} ×${e.qty}</span>`));
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
