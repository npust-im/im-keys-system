// ============================================================
//  後台管理邏輯
// ============================================================
import {
  db, ready, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, orderBy, serverTimestamp,
  loadCatalog, addCatalogItem, removeCatalogItem, seedCatalogIfEmpty, fmtTime,
} from "./db.js";
import { ADMIN_PASSWORD } from "./config.js";

const $ = (id) => document.getElementById(id);

let records = [];
let staffNames = [];
let catalogKeys = [];
let catalogEquip = [];
let recFilter = "out";
let recSearch = "";
let ovSearch = "";

// ── 密碼閘門 ─────────────────────────────────────────────────
const KEY = "cb_admin_ok";
if (sessionStorage.getItem(KEY) === "1") enterApp();

$("gateBtn").addEventListener("click", tryLogin);
$("gatePw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });

function tryLogin() {
  if ($("gatePw").value === ADMIN_PASSWORD) {
    sessionStorage.setItem(KEY, "1");
    enterApp();
  } else {
    $("gateMsg").innerHTML = `<div class="msg msg-err">密碼錯誤，請再試一次。</div>`;
  }
}
$("logoutBtn").addEventListener("click", () => { sessionStorage.removeItem(KEY); location.reload(); });

async function enterApp() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
  try {
    await ready;
    await seedCatalogIfEmpty();
    setupTabs();
    subscribeRecords();
    subscribeGroups();
    subscribeCatalog();
    subscribeStaff();
    bindManualAdd();
    bindCatalogAdds();
    bindStaffAdd();
    bindImport();
    // 每分鐘重繪一次今日總表，讓跨過午夜時自動歸零
    setInterval(() => { renderRecords(); }, 60 * 1000);
  } catch (err) {
    alert("連線失敗：" + err.message);
  }
}

// ── 分頁切換 ─────────────────────────────────────────────────
function setupTabs() {
  const tabs = ["records", "overview", "groups", "catalog", "staff"];
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      tabs.forEach((name) => $("tab-" + name).classList.toggle("hidden", name !== t.dataset.tab));
    });
  });
}

// ── 判斷時間是否為今天 ───────────────────────────────────────
function isToday(ts) {
  if (!ts) return true;                    // 剛送出、伺服器時間還沒回填 → 視為今天
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function contentTags(r) {
  const c = [];
  if (r.key) c.push(`<span class="tag tag-key">🔑 ${esc(r.key)}</span>`);
  (r.equipment || []).forEach((e) => c.push(`<span class="tag tag-eq">${esc(e.name)} ×${e.qty}</span>`));
  return c.join(" ") || "—";
}

function staffOptions() {
  return `<option value="">選擇工讀生…</option>` +
    staffNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
}

// 綁定所有「確認歸還」按鈕（今日表與總覽共用）
function bindReturnButtons(scope) {
  scope.querySelectorAll(".returnBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const sel = scope.querySelector(`.staffSel[data-id="${id}"]`);
      if (!sel.value) { sel.focus(); sel.style.borderColor = "var(--danger)"; return; }
      btn.disabled = true; btn.textContent = "處理中…";
      try {
        await updateDoc(doc(db, "records", id), {
          status: "returned", returnedBy: sel.value, returnedAt: serverTimestamp(),
        });
      } catch (err) {
        alert("更新失敗：" + err.message);
        btn.disabled = false; btn.textContent = "確認歸還";
      }
    });
  });
}

// ── 今日借還總表 ─────────────────────────────────────────────
function subscribeRecords() {
  const q = query(collection(db, "records"), orderBy("borrowedAt", "desc"));
  onSnapshot(q, (snap) => {
    records = [];
    snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
    renderRecords();
    renderOverview();
  });

  document.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll('[data-filter]').forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      recFilter = chip.dataset.filter;
      renderRecords();
    });
  });
  $("recSearch").addEventListener("input", (e) => { recSearch = e.target.value.trim().toLowerCase(); renderRecords(); });
  $("ovSearch").addEventListener("input", (e) => { ovSearch = e.target.value.trim().toLowerCase(); renderOverview(); });
}

function renderRecords() {
  const today = records.filter((r) => isToday(r.borrowedAt));
  const out = today.filter((r) => r.status === "borrowed").length;
  const ret = today.filter((r) => r.status === "returned").length;
  $("statOut").textContent = out;
  $("statReturned").textContent = ret;
  $("statTotal").textContent = today.length;

  let list = today;
  if (recFilter === "out") list = list.filter((r) => r.status === "borrowed");
  else if (recFilter === "returned") list = list.filter((r) => r.status === "returned");
  if (recSearch) list = list.filter((r) =>
    String(r.studentId).toLowerCase().includes(recSearch) || String(r.name).toLowerCase().includes(recSearch));

  $("recEmpty").classList.toggle("hidden", list.length !== 0);

  $("recBody").innerHTML = list.map((r) => {
    const confirmCell = r.status === "returned"
      ? `<span class="badge badge-returned">已由 ${esc(r.returnedBy || "—")} 確認</span>`
      : `<div class="row" style="gap:6px">
           <select class="staffSel" data-id="${r.id}" style="min-width:130px;padding:7px 10px">${staffOptions()}</select>
           <button class="btn btn-return btn-sm returnBtn" data-id="${r.id}">確認歸還</button>
         </div>`;
    return `<tr class="${r.status === "returned" ? "returned" : ""}">
      <td class="num">${esc(r.studentId)}</td>
      <td>${esc(r.name)}<div class="small">${esc(r.className || r.groupName || "")}</div></td>
      <td class="num">${esc(r.idLast3 || "—")}</td>
      <td>${contentTags(r)}</td>
      <td class="num">${fmtTime(r.borrowedAt)}</td>
      <td>${confirmCell}</td>
      <td class="num">${r.status === "returned" ? fmtTime(r.returnedAt) : "—"}</td>
    </tr>`;
  }).join("");

  bindReturnButtons($("recBody"));
}

// ── 借用狀況總覽 ─────────────────────────────────────────────
function daysSince(ts) {
  if (!ts) return "今天";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  return diff <= 0 ? "今天" : `${diff} 天`;
}

function renderOverview() {
  const outstanding = records.filter((r) => r.status === "borrowed");

  // 鑰匙狀態
  const holder = {};
  outstanding.forEach((r) => { if (r.key) holder[r.key] = r; });
  const keysOut = catalogKeys.filter((k) => holder[k]).length;
  $("ovKeysOut").textContent = keysOut;
  $("ovKeysFree").textContent = Math.max(0, catalogKeys.length - keysOut);

  $("keyBoard").innerHTML = catalogKeys.length === 0
    ? `<p class="small">清單是空的。</p>`
    : catalogKeys.map((k) => {
        const r = holder[k];
        return r
          ? `<div class="cell busy"><span class="ck">${esc(k)}</span><span class="cs mono">${esc(r.studentId)}</span></div>`
          : `<div class="cell free"><span class="ck">${esc(k)}</span><span class="cs">可借用</span></div>`;
      }).join("");

  // 設備借出統計
  const agg = {};
  outstanding.forEach((r) => (r.equipment || []).forEach((e) => { agg[e.name] = (agg[e.name] || 0) + (e.qty || 0); }));
  const totalEqOut = Object.values(agg).reduce((s, n) => s + n, 0);
  $("ovEqOut").textContent = totalEqOut;
  const aggEntries = Object.entries(agg).filter(([, n]) => n > 0);
  $("eqOutList").innerHTML = aggEntries.length === 0
    ? `<p class="small">目前沒有設備借出中。</p>`
    : aggEntries.map(([name, n]) =>
        `<div class="list-item"><span class="spread"><span class="tag tag-eq">${esc(name)}</span></span><span class="strong mono">${n} 件</span></div>`).join("");

  // 未歸還清單（含跨日），可直接歸還
  let list = outstanding;
  if (ovSearch) list = list.filter((r) =>
    String(r.studentId).toLowerCase().includes(ovSearch) || String(r.name).toLowerCase().includes(ovSearch));

  $("ovEmpty").classList.toggle("hidden", list.length !== 0);
  $("ovBody").innerHTML = list.map((r) => `
    <tr>
      <td class="num">${esc(r.studentId)}</td>
      <td>${esc(r.name)}<div class="small">${esc(r.className || r.groupName || "")}</div></td>
      <td>${contentTags(r)}</td>
      <td class="num">${fmtTime(r.borrowedAt)}</td>
      <td class="num">${daysSince(r.borrowedAt)}</td>
      <td>
        <div class="row" style="gap:6px">
          <select class="staffSel" data-id="${r.id}" style="min-width:130px;padding:7px 10px">${staffOptions()}</select>
          <button class="btn btn-return btn-sm returnBtn" data-id="${r.id}">確認歸還</button>
        </div>
      </td>
    </tr>`).join("");

  bindReturnButtons($("ovBody"));
}

// ── 學生群組 ─────────────────────────────────────────────────
let groups = [];
function subscribeGroups() {
  onSnapshot(collection(db, "groups"), (snap) => {
    groups = [];
    snap.forEach((d) => groups.push({ id: d.id, ...d.data() }));
    groups.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderGroups();
    fillGroupSelect();
  });
}
function renderGroups() {
  const total = groups.reduce((s, g) => s + (g.students?.length || 0), 0);
  $("groupTotals").textContent = `共 ${groups.length} 個群組・${total} 人`;
  $("groupList").innerHTML = groups.length === 0
    ? `<p class="small">尚未匯入任何群組。請由上方匯入 Excel。</p>`
    : groups.map((g) => `
      <div class="list-item">
        <div class="spread"><span class="name">${esc(g.name || "(未命名)")}</span><span class="meta">・${g.students?.length || 0} 人</span></div>
        <button class="btn btn-ghost btn-sm renameGrp" data-id="${g.id}">改名</button>
        <button class="btn btn-danger-ghost btn-sm delGrp" data-id="${g.id}" data-name="${esc(g.name)}">刪除</button>
      </div>`).join("");
  document.querySelectorAll(".renameGrp").forEach((b) => b.addEventListener("click", async () => {
    const g = groups.find((x) => x.id === b.dataset.id);
    const name = prompt("輸入新的群組名稱：", g.name || "");
    if (name && name.trim()) await updateDoc(doc(db, "groups", g.id), { name: name.trim() });
  }));
  document.querySelectorAll(".delGrp").forEach((b) => b.addEventListener("click", async () => {
    if (confirm(`確定刪除群組「${b.dataset.name}」及其所有學生資料？此動作無法復原。`))
      await deleteDoc(doc(db, "groups", b.dataset.id));
  }));
}
function fillGroupSelect() {
  $("mGroup").innerHTML = groups.length
    ? groups.map((g) => `<option value="${g.id}">${esc(g.name || "(未命名)")}</option>`).join("")
    : `<option value="">（請先匯入群組）</option>`;
}
function bindManualAdd() {
  $("mAddBtn").addEventListener("click", async () => {
    const sid = $("mSid").value.trim(), name = $("mName").value.trim();
    const id3 = $("mId3").value.trim(), cls = $("mClass").value.trim(), gid = $("mGroup").value;
    const msg = $("manualMsg");
    const show = (t, c = "msg-err") => { msg.innerHTML = `<div class="msg ${c}">${t}</div>`; };
    if (!gid) return show("請先匯入一個群組，才能加入學生。");
    if (!sid || !name || !id3) return show("學號、姓名、身分證後3碼為必填。");
    if (!/^\d{3}$/.test(id3)) return show("身分證後3碼需為 3 位數字。");
    const ref = doc(db, "groups", gid);
    const snap = await getDoc(ref);
    const arr = snap.data().students || [];
    if (arr.some((s) => String(s.studentId) === sid)) return show(`此群組已有學號 ${sid}。`);
    arr.push({ studentId: sid, name, idLast3: id3, className: cls });
    await updateDoc(ref, { students: arr });
    show(`已將 ${name}（${sid}）加入群組。`, "msg-ok");
    $("mSid").value = $("mName").value = $("mId3").value = $("mClass").value = "";
  });
}

// ── Excel 匯入 ───────────────────────────────────────────────
function bindImport() {
  const drop = $("drop"), input = $("fileInput");
  input.addEventListener("change", () => { if (input.files[0]) importFile(input.files[0]); });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) importFile(f); });
}
async function importFile(file) {
  const msg = $("importMsg");
  const show = (t, c = "msg-info") => { msg.innerHTML = `<div class="msg ${c}">${t}</div>`; };
  show("讀取中…");
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    if (rows.length === 0) return show("這個檔案沒有資料列。", "msg-err");
    const pick = (row, keys) => { for (const k of Object.keys(row)) if (keys.includes(String(k).trim())) return row[k]; return ""; };
    const students = [], seen = new Set(); let skipped = 0;
    for (const row of rows) {
      const sid = String(pick(row, ["學號"])).trim();
      const name = String(pick(row, ["姓名"])).trim();
      let id3 = String(pick(row, ["身分證後3碼", "身分證後三碼", "身份證後3碼"])).trim();
      const cls = String(pick(row, ["班級"])).trim();
      if (!sid || !name) { skipped++; continue; }
      if (/^\d+$/.test(id3) && id3.length < 3) id3 = id3.padStart(3, "0");
      if (seen.has(sid)) { skipped++; continue; }
      seen.add(sid);
      students.push({ studentId: sid, name, idLast3: id3, className: cls });
    }
    if (students.length === 0) return show("找不到有效資料。請確認第一列欄位名稱為：學號、姓名、身分證後3碼、班級。", "msg-err");
    const defaultName = file.name.replace(/\.(xlsx|xls)$/i, "");
    await addDoc(collection(db, "groups"), { name: defaultName, students, createdAt: serverTimestamp() });
    show(`已匯入群組「${defaultName}」，共 ${students.length} 人${skipped ? `（略過 ${skipped} 筆空白或重複）` : ""}。可在下方改名。`, "msg-ok");
    $("fileInput").value = "";
  } catch (err) { show("匯入失敗：" + err.message, "msg-err"); }
}

// ── 鑰匙 / 設備清單 ──────────────────────────────────────────
function subscribeCatalog() {
  onSnapshot(doc(db, "catalog", "keys"), (d) => {
    catalogKeys = d.exists() ? d.data().items || [] : [];
    renderCatalogList("keyList", "keys", catalogKeys, "tag-key");
    renderOverview();
  });
  onSnapshot(doc(db, "catalog", "equipment"), (d) => {
    catalogEquip = d.exists() ? d.data().items || [] : [];
    renderCatalogList("eqList2", "equipment", catalogEquip, "tag-eq");
  });
}
function renderCatalogList(elId, type, items, tagCls) {
  $(elId).innerHTML = items.length === 0
    ? `<p class="small">清單是空的。</p>`
    : items.map((it) => `
      <div class="list-item">
        <span class="spread"><span class="tag ${tagCls}">${esc(it)}</span></span>
        <button class="btn btn-danger-ghost btn-sm delCat" data-type="${type}" data-name="${esc(it)}">刪除</button>
      </div>`).join("");
  $(elId).querySelectorAll(".delCat").forEach((b) => b.addEventListener("click", async () => {
    if (confirm(`確定從清單刪除「${b.dataset.name}」？（不影響已建立的借出紀錄）`))
      await removeCatalogItem(b.dataset.type, b.dataset.name);
  }));
}
function bindCatalogAdds() {
  const add = async (type, input) => {
    const name = input.value.trim(); if (!name) return;
    const ok = await addCatalogItem(type, name);
    if (!ok) alert(`「${name}」已存在，不能重複新增。`); else input.value = "";
  };
  $("addKeyBtn2").addEventListener("click", () => add("keys", $("addKeyInput")));
  $("addEqBtn2").addEventListener("click", () => add("equipment", $("addEqInput")));
  $("addKeyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addKeyBtn2").click(); });
  $("addEqInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addEqBtn2").click(); });
}

// ── 工讀生名單 ───────────────────────────────────────────────
function subscribeStaff() {
  onSnapshot(doc(db, "staff", "list"), (d) => {
    staffNames = d.exists() ? d.data().names || [] : [];
    renderStaff();
    renderRecords();
    renderOverview();
  });
}
function renderStaff() {
  $("staffList").innerHTML = staffNames.length === 0
    ? `<p class="small">尚未新增任何工讀生。</p>`
    : staffNames.map((n) => `
      <div class="list-item"><span class="spread name">${esc(n)}</span>
        <button class="btn btn-danger-ghost btn-sm delStaff" data-name="${esc(n)}">刪除</button></div>`).join("");
  $("staffList").querySelectorAll(".delStaff").forEach((b) => b.addEventListener("click", async () => {
    if (confirm(`確定刪除工讀生「${b.dataset.name}」？`))
      await setDoc(doc(db, "staff", "list"), { names: staffNames.filter((x) => x !== b.dataset.name) });
  }));
}
function bindStaffAdd() {
  const add = async () => {
    const name = $("addStaffInput").value.trim(); if (!name) return;
    if (staffNames.includes(name)) return alert(`「${name}」已在名單中。`);
    await setDoc(doc(db, "staff", "list"), { names: [...staffNames, name] });
    $("addStaffInput").value = "";
  };
  $("addStaffBtn").addEventListener("click", add);
  $("addStaffInput").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
