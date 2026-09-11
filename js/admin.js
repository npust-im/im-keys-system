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

let records = [];           // 目前所有借還紀錄
let staffNames = [];        // 工讀生名單
let recFilter = "out";      // out | returned | all
let recSearch = "";

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
$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(KEY);
  location.reload();
});

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
  } catch (err) {
    alert("連線失敗：" + err.message);
  }
}

// ── 分頁切換 ─────────────────────────────────────────────────
function setupTabs() {
  const tabs = ["records", "groups", "catalog", "staff"];
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      tabs.forEach((name) => $("tab-" + name).classList.toggle("hidden", name !== t.dataset.tab));
    });
  });
}

// ── 借還總表（即時）──────────────────────────────────────────
function subscribeRecords() {
  const q = query(collection(db, "records"), orderBy("borrowedAt", "desc"));
  onSnapshot(q, (snap) => {
    records = [];
    snap.forEach((d) => records.push({ id: d.id, ...d.data() }));
    renderRecords();
  });

  document.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll('[data-filter]').forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      recFilter = chip.dataset.filter;
      renderRecords();
    });
  });
  $("recSearch").addEventListener("input", (e) => {
    recSearch = e.target.value.trim().toLowerCase();
    renderRecords();
  });
}

function renderRecords() {
  // 統計
  const out = records.filter((r) => r.status === "borrowed").length;
  const ret = records.filter((r) => r.status === "returned").length;
  $("statOut").textContent = out;
  $("statReturned").textContent = ret;
  $("statTotal").textContent = records.length;

  // 篩選 + 搜尋
  let list = records;
  if (recFilter === "out") list = list.filter((r) => r.status === "borrowed");
  else if (recFilter === "returned") list = list.filter((r) => r.status === "returned");
  if (recSearch) {
    list = list.filter((r) =>
      String(r.studentId).toLowerCase().includes(recSearch) ||
      String(r.name).toLowerCase().includes(recSearch));
  }

  $("recEmpty").classList.toggle("hidden", list.length !== 0);

  const staffOptions = (sel) =>
    `<option value="">選擇工讀生…</option>` +
    staffNames.map((n) => `<option value="${esc(n)}" ${sel === n ? "selected" : ""}>${esc(n)}</option>`).join("");

  $("recBody").innerHTML = list.map((r) => {
    const content = [];
    if (r.key) content.push(`<span class="tag tag-key">🔑 ${esc(r.key)}</span>`);
    (r.equipment || []).forEach((e) => content.push(`<span class="tag tag-eq">${esc(e.name)} ×${e.qty}</span>`));

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
      <td>${content.join(" ") || "—"}</td>
      <td class="num">${fmtTime(r.borrowedAt)}</td>
      <td>${confirmCell}</td>
      <td class="num">${r.status === "returned" ? fmtTime(r.returnedAt) : "—"}</td>
    </tr>`;
  }).join("");

  // 綁定確認歸還
  document.querySelectorAll(".returnBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const sel = document.querySelector(`.staffSel[data-id="${id}"]`);
      const who = sel.value;
      if (!who) { sel.focus(); sel.style.borderColor = "var(--danger)"; return; }
      btn.disabled = true; btn.textContent = "處理中…";
      try {
        await updateDoc(doc(db, "records", id), {
          status: "returned",
          returnedBy: who,
          returnedAt: serverTimestamp(),
        });
      } catch (err) {
        alert("更新失敗：" + err.message);
        btn.disabled = false; btn.textContent = "確認歸還";
      }
    });
  });
}

// ── 學生群組（即時）──────────────────────────────────────────
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
  const totalStudents = groups.reduce((s, g) => s + (g.students?.length || 0), 0);
  $("groupTotals").textContent = `共 ${groups.length} 個群組・${totalStudents} 人`;

  $("groupList").innerHTML = groups.length === 0
    ? `<p class="small">尚未匯入任何群組。請由上方匯入 Excel。</p>`
    : groups.map((g) => `
      <div class="list-item">
        <div class="spread">
          <span class="name">${esc(g.name || "(未命名)")}</span>
          <span class="meta">・${g.students?.length || 0} 人</span>
        </div>
        <button class="btn btn-ghost btn-sm renameGrp" data-id="${g.id}">改名</button>
        <button class="btn btn-danger-ghost btn-sm delGrp" data-id="${g.id}" data-name="${esc(g.name)}">刪除</button>
      </div>`).join("");

  document.querySelectorAll(".renameGrp").forEach((b) => b.addEventListener("click", async () => {
    const g = groups.find((x) => x.id === b.dataset.id);
    const name = prompt("輸入新的群組名稱：", g.name || "");
    if (name && name.trim()) await updateDoc(doc(db, "groups", g.id), { name: name.trim() });
  }));
  document.querySelectorAll(".delGrp").forEach((b) => b.addEventListener("click", async () => {
    if (confirm(`確定刪除群組「${b.dataset.name}」及其所有學生資料？此動作無法復原。`)) {
      await deleteDoc(doc(db, "groups", b.dataset.id));
    }
  }));
}

function fillGroupSelect() {
  $("mGroup").innerHTML = groups.length
    ? groups.map((g) => `<option value="${g.id}">${esc(g.name || "(未命名)")}</option>`).join("")
    : `<option value="">（請先匯入群組）</option>`;
}

// 手動新增學生到群組（讀-改-寫該群組的 students 陣列）
function bindManualAdd() {
  $("mAddBtn").addEventListener("click", async () => {
    const sid = $("mSid").value.trim();
    const name = $("mName").value.trim();
    const id3 = $("mId3").value.trim();
    const cls = $("mClass").value.trim();
    const gid = $("mGroup").value;
    const msg = $("manualMsg");
    const show = (t, cls2 = "msg-err") => { msg.innerHTML = `<div class="msg ${cls2}">${t}</div>`; };

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
  const drop = $("drop");
  const input = $("fileInput");
  input.addEventListener("change", () => { if (input.files[0]) importFile(input.files[0]); });

  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hot"); }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });
}

async function importFile(file) {
  const msg = $("importMsg");
  const show = (t, cls = "msg-info") => { msg.innerHTML = `<div class="msg ${cls}">${t}</div>`; };
  show("讀取中…");
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length === 0) return show("這個檔案沒有資料列。", "msg-err");

    // 對應固定欄位名稱
    const pick = (row, keys) => {
      for (const k of Object.keys(row)) {
        const kk = String(k).trim();
        if (keys.includes(kk)) return row[k];
      }
      return "";
    };
    const students = [];
    const seen = new Set();
    let skipped = 0;
    for (const row of rows) {
      const sid = String(pick(row, ["學號"])).trim();
      const name = String(pick(row, ["姓名"])).trim();
      let id3 = String(pick(row, ["身分證後3碼", "身分證後三碼", "身份證後3碼"])).trim();
      const cls = String(pick(row, ["班級"])).trim();
      if (!sid || !name) { skipped++; continue; }
      if (/^\d+$/.test(id3) && id3.length < 3) id3 = id3.padStart(3, "0"); // 修正被 Excel 去掉的前導 0
      if (seen.has(sid)) { skipped++; continue; }                          // 檔案內學號重複
      seen.add(sid);
      students.push({ studentId: sid, name, idLast3: id3, className: cls });
    }
    if (students.length === 0)
      return show("找不到有效資料。請確認第一列欄位名稱為：學號、姓名、身分證後3碼、班級。", "msg-err");

    const defaultName = file.name.replace(/\.(xlsx|xls)$/i, "");
    await addDoc(collection(db, "groups"), {
      name: defaultName,
      students,
      createdAt: serverTimestamp(),
    });
    show(`已匯入群組「${defaultName}」，共 ${students.length} 人${skipped ? `（略過 ${skipped} 筆空白或重複）` : ""}。可在下方改名。`, "msg-ok");
    $("fileInput").value = "";
  } catch (err) {
    show("匯入失敗：" + err.message, "msg-err");
  }
}

// ── 鑰匙 / 設備清單（即時）──────────────────────────────────
function subscribeCatalog() {
  onSnapshot(doc(db, "catalog", "keys"), (d) =>
    renderCatalogList("keyList", "keys", d.exists() ? d.data().items || [] : [], "tag-key"));
  onSnapshot(doc(db, "catalog", "equipment"), (d) =>
    renderCatalogList("eqList2", "equipment", d.exists() ? d.data().items || [] : [], "tag-eq"));
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
    const name = input.value.trim();
    if (!name) return;
    const ok = await addCatalogItem(type, name);
    if (!ok) alert(`「${name}」已存在，不能重複新增。`);
    else input.value = "";
  };
  $("addKeyBtn2").addEventListener("click", () => add("keys", $("addKeyInput")));
  $("addEqBtn2").addEventListener("click", () => add("equipment", $("addEqInput")));
  $("addKeyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addKeyBtn2").click(); });
  $("addEqInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addEqBtn2").click(); });
}

// ── 工讀生名單（即時）──────────────────────────────────────
function subscribeStaff() {
  onSnapshot(doc(db, "staff", "list"), (d) => {
    staffNames = d.exists() ? d.data().names || [] : [];
    renderStaff();
    renderRecords();   // 讓「確認歸還」下拉更新
  });
}

function renderStaff() {
  $("staffList").innerHTML = staffNames.length === 0
    ? `<p class="small">尚未新增任何工讀生。</p>`
    : staffNames.map((n) => `
      <div class="list-item">
        <span class="spread name">${esc(n)}</span>
        <button class="btn btn-danger-ghost btn-sm delStaff" data-name="${esc(n)}">刪除</button>
      </div>`).join("");
  $("staffList").querySelectorAll(".delStaff").forEach((b) => b.addEventListener("click", async () => {
    if (confirm(`確定刪除工讀生「${b.dataset.name}」？`)) {
      const next = staffNames.filter((x) => x !== b.dataset.name);
      await setDoc(doc(db, "staff", "list"), { names: next });
    }
  }));
}

function bindStaffAdd() {
  const add = async () => {
    const name = $("addStaffInput").value.trim();
    if (!name) return;
    if (staffNames.includes(name)) return alert(`「${name}」已在名單中。`);
    await setDoc(doc(db, "staff", "list"), { names: [...staffNames, name] });
    $("addStaffInput").value = "";
  };
  $("addStaffBtn").addEventListener("click", add);
  $("addStaffInput").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
}

// ── 工具 ─────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
