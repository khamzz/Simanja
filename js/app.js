/* =========================================================
   SIMANJA — Sistem Pemantauan Penugasan Manajemen Risiko
   app.js — state, CRUD, render, dashboard, approval, ekspor/impor
   Penyimpanan: localStorage (berjalan penuh di browser, tanpa server)
   ========================================================= */

const STORAGE_KEY = "siwasdik_penugasan_v2";
const SETTINGS_KEY = "siwasdik_settings_v1";

const REF = {
  kategori: ["Rapat", "Sosialisasi", "Monitoring", "Evaluasi", "Pendampingan", "Koordinasi", "Pelatihan"],
  periode: ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"],
  status: ["Progres", "Selesai", "Terlambat"],
  prioritas: ["Tinggi", "Sedang", "Rendah"],
  approval: ["Menunggu", "Disetujui", "Ditolak"],
  pic: [
    "Asep Noor Hasan",
    "Kgs. M. Ilham Kurniawan",
    "Aulia Rahmi Nurazizah",
    "Abdul Rahman Wahid",
    "Anggiya Wisnoe Wulansarie",
    "Anglingsasi Maynar Prabawening Basuki",
    "Naufal Fathin Ar Rasyid",
  ],
  picLainnya: "Lainnya",
};

// Urutan & label kolom dipakai bersama oleh Ekspor/Impor Excel, CSV, dan Google Sheets
// agar hasilnya konsisten dan bisa saling ditukar.
const HEADER_MAP = [
  ["ID", "id"],
  ["No", "no"],
  ["Nama Penugasan", "nama_penugasan"],
  ["Nama Singkat", "shortname"],
  ["Kategori", "kategori"],
  ["Periode", "periode"],
  ["Nomor ST", "nomor_st"],
  ["Prioritas", "prioritas"],
  ["PIC", "pic"],
  ["Tanggal Mulai", "tgl_mulai"],
  ["Tanggal Selesai Kegiatan", "tgl_selesai_kegiatan"],
  ["Due Date", "due_date"],
  ["Tanggal Selesai Laporan", "tgl_selesai_laporan"],
  ["Sisa Waktu", "sisa_waktu"],
  ["Status", "status"],
  ["Progress (%)", "progress"],
  ["Status Persetujuan", "approval_status"],
  ["Disetujui/Ditolak Oleh", "approval_by"],
  ["Tanggal Keputusan", "approval_date"],
  ["Catatan Persetujuan", "approval_note"],
  ["Detail Progres", "detail_progres"],
  ["Keterangan", "keterangan"],
  ["Perihal Keterlambatan", "perihal_keterlambatan"],
  ["Nama Laporan", "nama_laporan"],
  ["Link ST & Laporan", "link_st_laporan"],
  ["Link Checklist Kode Etik", "link_checklist"],
  ["Dibuat Oleh", "created_by"],
  ["Diubah Oleh", "updated_by"],
  ["Diubah Pada", "updated_at"],
];

const state = {
  data: [],
  view: "dashboard",
  search: "",
  backupEnabled: null, // null = belum dimuat; status ON/OFF backup otomatis ke Google Drive (dibaca dari tabel app_settings, hanya Super Admin yang bisa lihat/ubah)
  backupLastRunAt: null, // waktu backup terakhir dijalankan (diisi oleh Edge Function backup-to-drive)
  backupLastStatus: null, // "success" | "error" — hasil backup terakhir
  backupLastMessage: null, // pesan/detail singkat dari backup terakhir (mis. jumlah baris, atau pesan error)
  backupRunning: false, // true selagi tombol "Backup Sekarang" sedang diproses
  backupSchedule: null, // { type: "daily"|"weekly"|"monthly", time: "HH:MM", day_of_week: 0-6, day_of_month: 1-28 } — jadwal tersimpan (dibaca dari app_settings.backup.schedule)
  backupScheduleDraft: null, // salinan draft yang sedang diedit di form (belum disimpan) — dipisah dari backupSchedule supaya tombol "Simpan Jadwal" hanya aktif kalau ada perubahan
  backupScheduleSaving: false, // true selagi tombol "Simpan Jadwal" sedang diproses
  filters: { kategori: "", periode: "", status: "", approval: "" },
  cameFromDashboardStat: false, // true kalau masuk ke Data Penugasan lewat tombol "Lihat Detail" di kartu Dashboard — mengatur tampil/sembunyi tombol "Kembali ke Dashboard"
  picGlobal: "", // PIC terpilih di header — mengubah tampilan Dashboard & Data Penugasan sekaligus
  page: 1,
  pageSize: 10,
  editingId: null,
  deletingId: null,
  approvalTargetId: null,
  settings: { googleClientId: "", googleSpreadsheetId: "", googleSheetName: "Data", googleUsersSheetName: "Users", autoSync: false },
  googleToken: null,
  googleTokenClient: null,
  syncTimer: null,
  lastSyncAt: null,
  calendar: { year: new Date().getFullYear(), month: new Date().getMonth() },
  calendarEventsCache: {},
  calendarFilters: { kategori: "", status: "", search: "" },
};

/* ---------------- Persistence ---------------- */

async function loadData() {
  if (sync.enabled) {
    const ok = await syncPullData();
    if (ok) return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { state.data = JSON.parse(raw); normalizeAll(); return; }
  } catch (e) { console.warn("Gagal membaca data tersimpan, memuat data awal.", e); }
  state.data = JSON.parse(JSON.stringify(SEED_DATA));
  normalizeAll();
  saveData();
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = { ...state.settings, ...JSON.parse(raw) };
  } catch (e) { /* noop */ }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  scheduleAutoSync();
  syncPushData();
}

// Menjadikan Google Sheets sebagai "database" bersama: setiap perubahan data
// (tambah/ubah/hapus/impor) otomatis ditulis ulang ke sheet setelah jeda singkat,
// selama Auto-Sync aktif dan akun Google sudah terhubung.
function scheduleAutoSync() {
  if (!state.settings.autoSync || !state.googleToken || !state.settings.googleSpreadsheetId) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    exportToGoogleSheet(true);
    if (typeof exportUsersToGoogleSheet === "function") exportUsersToGoogleSheet(true);
  }, 1200);
}

function nextId() {
  // Berbasis timestamp (bukan sekadar max+1) supaya dua perangkat yang
  // menambah data baru secara bersamaan (sebelum sempat tersinkron) sangat
  // kecil kemungkinannya menghasilkan id yang sama.
  const base = Date.now();
  const maxExisting = state.data.reduce((m, r) => Math.max(m, r.id || 0), 0);
  return base > maxExisting ? base : maxExisting + 1;
}

function normalizeAll() {
  state.data.forEach((r) => {
    if (r.progress === undefined || r.progress === null || r.progress === "") {
      r.progress = r.status === "Selesai" ? 100 : 0;
    }
    r.progress = Math.max(0, Math.min(100, Number(r.progress) || 0));
    if (!r.approval_status) r.approval_status = "Menunggu";
    if (!REF.approval.includes(r.approval_status)) r.approval_status = "Menunggu";
    r.approval_by = r.approval_by || "";
    r.approval_note = r.approval_note || "";
    r.approval_date = r.approval_date || "";
    r.created_by = r.created_by || "";
    r.updated_by = r.updated_by || "";
    r.updated_at = r.updated_at || "";
  });
}

/* ---------------- Helpers ---------------- */

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeEffectiveStatus(row) {
  if (row.status === "Selesai") return "Selesai";
  if (row.due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(row.due_date + "T00:00:00");
    if (!isNaN(due) && due < today) return "Terlambat";
  }
  return row.status || "Progres";
}

function statusPillClass(s) {
  if (s === "Selesai") return "pill-selesai";
  if (s === "Terlambat") return "pill-terlambat";
  return "pill-progres";
}

function prioritasPillClass(p) {
  if (p === "Tinggi") return "pill-tinggi";
  if (p === "Rendah") return "pill-rendah";
  return "pill-sedang";
}

function approvalPillClass(a) {
  if (a === "Disetujui") return "pill-disetujui";
  if (a === "Ditolak") return "pill-ditolak";
  return "pill-menunggu";
}

function progressFillClass(p) {
  if (p >= 100) return "complete";
  if (p >= 60) return "";
  if (p >= 30) return "warn";
  return "danger";
}

function progressBarHTML(p) {
  return `<div class="progress-track"><div class="progress-fill ${progressFillClass(p)}" style="width:${p}%;"></div></div>`;
}

function toast(msg, kind) {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast" + (kind === "danger" ? " danger" : "");
  el.innerHTML = `<span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.remove(); }, 3400);
}

/* ---------------- Filtering ---------------- */

// Daftar nama PIC unik yang benar-benar ada di data (bukan sekadar REF.pic statis),
// dipakai untuk mengisi dropdown filter PIC di header.
function getKnownPicNames() {
  const set = new Set();
  state.data.forEach((r) => {
    (r.pic || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((name) => set.add(name));
  });
  return [...set].sort((a, b) => a.localeCompare(b, "id"));
}

// Menerapkan filter PIC global (dari dropdown di header) ke sekumpulan baris.
// Dipakai bersama oleh Dashboard maupun Data Penugasan supaya keduanya konsisten:
// saat PIC dipilih, hanya penugasan yang melibatkan PIC tsb yang ditampilkan;
// saat kosong ("Semua PIC"), seluruh data ditampilkan.
function applyPicGlobalFilter(rows) {
  if (!state.picGlobal) return rows;
  return rows.filter((r) =>
    (r.pic || "").split(",").map((s) => s.trim()).includes(state.picGlobal)
  );
}

function populatePicGlobalFilter() {
  const sel = document.getElementById("filterPicGlobal");
  if (!sel) return;
  const current = state.picGlobal;
  sel.innerHTML = `<option value="">Semua PIC</option>` +
    getKnownPicNames().map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  // Pertahankan pilihan sebelumnya bila masih valid (mis. setelah data berubah).
  sel.value = getKnownPicNames().includes(current) ? current : "";
  state.picGlobal = sel.value;
}

function getFiltered() {
  const q = state.search.trim().toLowerCase();
  return applyPicGlobalFilter(state.data).filter((r) => {
    if (state.filters.kategori && r.kategori !== state.filters.kategori) return false;
    if (state.filters.periode && r.periode !== state.filters.periode) return false;
    if (state.filters.status && computeEffectiveStatus(r) !== state.filters.status) return false;
    if (state.filters.approval && r.approval_status !== state.filters.approval) return false;
    if (q) {
      const hay = [r.nama_penugasan, r.shortname, r.nomor_st, r.pic, r.kategori].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.id || 0) - (a.id || 0));
}

/* ---------------- Navigation ---------------- */

function setView(view) {
  if (view === "profil" && !isLoggedIn()) {
    toast("Silakan masuk untuk melihat profil Anda.", "danger");
    view = "auth";
  }
  if (view === "integrasi" && !isLoggedIn()) {
    toast("Silakan masuk terlebih dahulu untuk mengakses menu Integrasi Data.", "danger");
    view = "auth";
  }
  if (view === "usermgmt" && !isSuperAdmin()) {
    toast(isLoggedIn() ? "Hanya Super Admin yang dapat mengakses Manajemen Pengguna." : "Silakan masuk sebagai Super Admin.", "danger");
    view = isLoggedIn() ? "dashboard" : "auth";
  }
  state.view = view;
  if (typeof simanjaPreloadLibsForView === "function") simanjaPreloadLibsForView(view);
  document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  const titles = {
    dashboard: ["Dashboard Pemantauan", "Ringkasan progres, capaian, dan status persetujuan penugasan"],
    kalender: ["Kalender Penugasan", "Jadwal harian & sebaran penugasan per bulan"],
    data: ["Data Penugasan", "Kelola seluruh catatan penugasan — tambah, ubah, hapus, dan telusuri"],
    integrasi: ["Integrasi & Sinkronisasi", "Hubungkan data dengan Google Sheets atau Microsoft Excel"],
    cuti: ["Permohonan Cuti", "Formulir Permintaan dan Pemberian Cuti pegawai — ajukan, tinjau, dan kelola"],
    auth: ["Masuk", "Masuk untuk mengelola dan menyetujui data penugasan"],
    profil: ["Profil Saya", "Kelola data akun dan password Anda"],
    usermgmt: ["Manajemen Pengguna", "Kelola seluruh akun pengguna — tambah, ubah, reset password, dan hapus"],
  };
  const [t, s] = titles[view] || titles.dashboard;
  document.getElementById("pageTitle").textContent = t;
  document.getElementById("pageSubtitle").textContent = s;

  const addBtn = document.getElementById("btnAddTop");
  if (addBtn) addBtn.style.display = (view === "dashboard" || view === "kalender" || view === "data") ? "inline-flex" : "none";

  if (view === "dashboard") renderDashboard();
  if (view === "kalender") renderKalenderView();
  if (view === "data") {
    renderTable();
    const backBar = document.getElementById("backToDashboardBar");
    if (backBar) backBar.style.display = state.cameFromDashboardStat ? "block" : "none";
  }
  if (view === "integrasi") {
    renderIntegrationView();
    if (typeof loadBackupSettings === "function" && isSuperAdmin()) {
      loadBackupSettings().then(() => renderIntegrationView());
    }
  }
  if (view === "cuti" && typeof renderCutiView === "function") renderCutiView();
  if (view === "profil") renderProfilView();
  if (view === "usermgmt") renderUserMgmtView();
}

/* ---------------- Tombol "Detail" pada kartu statistik Dashboard ---------------- */
/* Menekan tombol detail di sebuah kartu statistik akan membawa pengguna
   ke halaman "Data Penugasan" dengan filter yang sudah otomatis diatur
   sesuai kartu yang diklik — memakai ULANG mekanisme filter, pencarian,
   pagination, dan keamanan (RLS Supabase) yang sudah ada di aplikasi.
   Tidak ada query database baru yang dibuat khusus untuk fitur ini. */

const STAT_FILTER_MAP = {
  all:       {},                          // Total Penugasan → semua data
  selesai:   { status: "Selesai" },       // Selesai
  progres:   { status: "Progres" },       // Dalam Progres
  terlambat: { status: "Terlambat" },     // Terlambat
  disetujui: { approval: "Disetujui" },   // Disetujui
  menunggu:  { approval: "Menunggu" },    // Menunggu Persetujuan
  ditolak:   { approval: "Ditolak" },     // Ditolak
};

function filterDashboardStat(kind) {
  const f = STAT_FILTER_MAP[kind] || {};
  goToFilteredData(f);
}

function filterDashboardKategori(kategori) {
  goToFilteredData({ kategori });
}

// Menekan salah satu nama PIC di panel "Beban Penugasan per PIC" akan
// menyalakan filter PIC global (sama seperti dropdown "Semua PIC" di
// header) lalu membawa pengguna ke halaman "Data Penugasan" yang hanya
// menampilkan penugasan milik PIC tsb. Tidak ada query database baru —
// memakai ulang mekanisme applyPicGlobalFilter() yang sudah ada.
function filterDashboardPic(picName) {
  state.picGlobal = picName;
  const picGlobalEl = document.getElementById("filterPicGlobal");
  if (picGlobalEl) picGlobalEl.value = picName;
  goToFilteredData({});
}

function goToFilteredData(filters) {
  // Reset pencarian & filter lain supaya hasilnya benar-benar
  // menampilkan SELURUH data yang cocok dengan kriteria yang diklik,
  // tanpa tersaring oleh filter lama yang mungkin masih tertinggal aktif.
  state.search = "";
  state.filters.kategori = filters.kategori || "";
  state.filters.periode = filters.periode || "";
  state.filters.status = filters.status || "";
  state.filters.approval = filters.approval || "";
  state.page = 1;
  state.cameFromDashboardStat = true;

  const searchEl = document.getElementById("searchInput");
  const kategoriEl = document.getElementById("filterKategori");
  const periodeEl = document.getElementById("filterPeriode");
  const statusEl = document.getElementById("filterStatus");
  const approvalEl = document.getElementById("filterApproval");
  if (searchEl) searchEl.value = "";
  if (kategoriEl) kategoriEl.value = state.filters.kategori;
  if (periodeEl) periodeEl.value = state.filters.periode;
  if (statusEl) statusEl.value = state.filters.status;
  if (approvalEl) approvalEl.value = state.filters.approval;

  setView("data"); // otomatis memanggil renderTable() dengan filter di atas
  const wrap = document.getElementById("tableWrap");
  if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

function backToDashboardFromStat() {
  // Filter kategori/periode/status/approval TIDAK direset di sini secara
  // sengaja — supaya kalau pengguna klik "Data Penugasan" lagi lewat menu
  // sidebar nanti, dia tidak kebingungan (filter memang baru direset saat
  // masuk lagi lewat kartu Dashboard, lihat filterDashboardStat()).
  //
  // Filter PIC global DIKECUALIKAN dari aturan di atas: khusus filter ini
  // sengaja dikembalikan ke "Semua PIC" setiap kali tombol "Kembali ke
  // Dashboard" ditekan, supaya Dashboard tidak "nyangkut" menampilkan data
  // satu PIC saja setelah pengguna selesai melihat detail penugasannya.
  state.picGlobal = "";
  const picGlobalEl = document.getElementById("filterPicGlobal");
  if (picGlobalEl) picGlobalEl.value = "";

  state.cameFromDashboardStat = false;
  setView("dashboard");
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  const data = applyPicGlobalFilter(state.data);
  const total = data.length;
  const selesai = data.filter((r) => computeEffectiveStatus(r) === "Selesai").length;
  const progres = data.filter((r) => computeEffectiveStatus(r) === "Progres").length;
  const terlambat = data.filter((r) => computeEffectiveStatus(r) === "Terlambat").length;
  const disetujui = data.filter((r) => r.approval_status === "Disetujui").length;
  const menunggu = data.filter((r) => r.approval_status === "Menunggu").length;
  const ditolak = data.filter((r) => r.approval_status === "Ditolak").length;
  const avgProgress = total ? Math.round(data.reduce((s, r) => s + (r.progress || 0), 0) / total) : 0;
  const pct = total ? Math.round((selesai / total) * 100) : 0;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statSelesai").textContent = selesai;
  document.getElementById("statProgres").textContent = progres;
  document.getElementById("statTerlambat").textContent = terlambat;
  document.getElementById("statDisetujui").textContent = disetujui;
  document.getElementById("statMenunggu").textContent = menunggu;
  document.getElementById("statDitolak").textContent = ditolak;
  document.getElementById("statAvgProgress").textContent = avgProgress + "%";

  renderSealRing(pct);
  renderKategoriBars(data);
  renderPicTable(data);
}

function renderKalenderView() {
  const data = applyPicGlobalFilter(state.data);
  renderCalendar();
  renderPeriodeChart(data);
}

function renderSealRing(pct) {
  const r = 52, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  document.getElementById("sealRingWrap").innerHTML = `
    <svg width="140" height="140" viewBox="0 0 140 140" class="seal-ring">
      <circle cx="70" cy="70" r="${r}" fill="none" style="stroke:var(--chart-track)" stroke-width="12"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="#e8a13d" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 70 70)" style="transition: stroke-dashoffset .6s ease"/>
      <text x="70" y="66" text-anchor="middle" font-family="Baloo 2, sans-serif" font-size="26" font-weight="700" style="fill:var(--ink-900)">${pct}%</text>
      <text x="70" y="84" text-anchor="middle" font-family="Nunito, sans-serif" font-size="10" style="fill:var(--ink-500)" letter-spacing="0.5">SELESAI</text>
    </svg>`;
}

function renderKategoriBars(data) {
  const counts = {};
  REF.kategori.forEach((k) => counts[k] = 0);
  data.forEach((r) => { if (r.kategori) counts[r.kategori] = (counts[r.kategori] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const colors = ["#7c6cf0","#0c8a92","#2fa7ac","#e8a13d","#2f9d68","#d54b62","#c07607","#829994"];
  const rows = Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([k, v], i) => {
    const safeK = esc(k).replace(/'/g, "\\'");
    return `
    <div class="kategori-row" role="button" tabindex="0" aria-label="Lihat detail kategori ${esc(k)}"
      onclick="filterDashboardKategori('${safeK}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterDashboardKategori('${safeK}')}">
      <div class="kategori-label">${esc(k)}</div>
      <div class="kategori-track">
        <div class="kategori-fill" style="width:${(v/max*100).toFixed(0)}%;background:${colors[i % colors.length]};"></div>
      </div>
      <div class="kategori-count">${v}</div>
      <svg class="kategori-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </div>`;
  }).join("");
  document.getElementById("kategoriBars").innerHTML = rows;
}

function renderPeriodeChart(data) {
  const counts = {};
  REF.periode.forEach((p) => counts[p] = 0);
  data.forEach((r) => { if (r.periode) counts[r.periode] = (counts[r.periode] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const w = 640, h = 150, pad = 6, bw = (w / 12) - pad;
  let bars = "";
  REF.periode.forEach((p, i) => {
    const v = counts[p];
    const bh = (v / max) * (h - 30);
    const x = i * (w / 12) + pad / 2;
    const y = h - 20 - bh;
    bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6" style="fill:${v ? '#0c8a92' : 'var(--chart-track)'}"/>`;
    bars += `<text x="${x + bw/2}" y="${h - 6}" text-anchor="middle" font-size="9" style="fill:var(--ink-500)" font-family="Nunito">${p.slice(0,3)}</text>`;
    if (v) bars += `<text x="${x + bw/2}" y="${y - 4}" text-anchor="middle" font-size="10" style="fill:var(--ink-900)" font-weight="700" font-family="Nunito">${v}</text>`;
  });
  document.getElementById("periodeChart").innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;">${bars}</svg>`;
}

function renderPicTable(data) {
  const counts = {};
  data.forEach((r) => {
    (r.pic || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 8);
  document.getElementById("picList").innerHTML = top.map(([name, v]) => {
    const safeName = esc(name).replace(/'/g, "\\'");
    return `
    <div class="pic-row" role="button" tabindex="0" aria-label="Lihat detail penugasan PIC ${esc(name)}"
      onclick="filterDashboardPic('${safeName}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterDashboardPic('${safeName}')}">
      <span class="pic-row-name">${esc(name)}</span>
      <b class="pic-row-count">${v}</b>
      <svg class="pic-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </div>`;
  }).join("") || `<p class="helper-text">Belum ada data.</p>`;
}

/* ---------------- Kalender Penugasan ---------------- */

function pad2(n) { return String(n).padStart(2, "0"); }

function sameYearMonth(date, year, month) {
  return date.getFullYear() === year && date.getMonth() === month;
}

function pushCalEvent(map, iso, r, kind) {
  if (!map[iso]) map[iso] = [];
  const label = kind === "due" ? "Due: " : kind === "mulai" ? "Mulai: " : "";
  map[iso].push({ id: r.id, title: label + (r.shortname || r.nama_penugasan), kind });
}

function buildCalendarEvents(year, month) {
  const map = {};
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const f = state.calendarFilters;
  const q = (f.search || "").trim().toLowerCase();

  const filteredData = applyPicGlobalFilter(state.data).filter((r) => {
    if (f.kategori && r.kategori !== f.kategori) return false;
    if (f.status && computeEffectiveStatus(r) !== f.status) return false;
    if (q) {
      const hay = [r.nama_penugasan, r.shortname, r.nomor_st, r.pic, r.kategori].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filteredData.forEach((r) => {
    const start = r.tgl_mulai ? new Date(r.tgl_mulai + "T00:00:00") : null;
    const due = r.due_date ? new Date(r.due_date + "T00:00:00") : null;

    if (start && due && !isNaN(start) && !isNaN(due) && due >= start) {
      const rangeStart = start < monthStart ? monthStart : start;
      const rangeEnd = due < monthEnd ? due : monthEnd;
      for (let dt = new Date(rangeStart); dt <= rangeEnd; dt.setDate(dt.getDate() + 1)) {
        const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
        let kind = "berlangsung";
        if (iso === r.due_date) kind = "due";
        else if (iso === r.tgl_mulai) kind = "mulai";
        pushCalEvent(map, iso, r, kind);
      }
    } else {
      if (start && !isNaN(start) && sameYearMonth(start, year, month)) pushCalEvent(map, r.tgl_mulai, r, "mulai");
      if (due && !isNaN(due) && sameYearMonth(due, year, month)) pushCalEvent(map, r.due_date, r, "due");
    }
  });

  return map;
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("calendarLabel");
  if (!grid || !label) return;

  const { year, month } = state.calendar;
  label.textContent = new Date(year, month, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const events = buildCalendarEvents(year, month);
  state.calendarEventsCache = events;

  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const todayStr = todayISO();

  let html = "";
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startWeekday + 1;
    let cellDate, inMonth, cellYear = year, cellMonth = month;
    if (dayNum < 1) { cellDate = daysInPrevMonth + dayNum; inMonth = false; cellMonth = month - 1; }
    else if (dayNum > daysInMonth) { cellDate = dayNum - daysInMonth; inMonth = false; cellMonth = month + 1; }
    else { cellDate = dayNum; inMonth = true; }
    if (cellMonth < 0) { cellMonth = 11; cellYear = year - 1; }
    if (cellMonth > 11) { cellMonth = 0; cellYear = year + 1; }

    const isoDate = `${cellYear}-${pad2(cellMonth + 1)}-${pad2(cellDate)}`;
    const dayEvents = inMonth ? (events[isoDate] || []) : [];
    const isToday = inMonth && isoDate === todayStr;
    const hasEvents = dayEvents.length > 0;

    html += `<div class="cal-cell ${inMonth ? "" : "cal-cell-muted"} ${isToday ? "cal-cell-today" : ""} ${hasEvents ? "has-events" : ""}"
      onclick="openDayDetail('${isoDate}')">
      <div class="cal-daynum">${cellDate}</div>
      <div class="cal-dot"></div>
      <div class="cal-events">
        ${dayEvents.slice(0, 3).map((ev) => `<div class="cal-pill cal-pill-${ev.kind}" title="${esc(ev.title)}">${esc(ev.title)}</div>`).join("")}
        ${dayEvents.length > 3 ? `<div class="cal-more">+${dayEvents.length - 3} lainnya</div>` : ""}
      </div>
    </div>`;
  }
  grid.innerHTML = html;
}

function populateCalendarFilterSelects() {
  const kSel = document.getElementById("calFilterKategori");
  const sSel = document.getElementById("calFilterStatus");
  if (kSel) kSel.innerHTML = `<option value="">Semua Kategori</option>` + REF.kategori.map((k) => `<option value="${k}">${k}</option>`).join("");
  if (sSel) sSel.innerHTML = `<option value="">Semua Status</option>` + REF.status.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function shiftCalendarMonth(delta) {
  let { year, month } = state.calendar;
  month += delta;
  if (month < 0) { month = 11; year -= 1; }
  if (month > 11) { month = 0; year += 1; }
  state.calendar = { year, month };
  renderCalendar();
}

function goToCurrentMonth() {
  const now = new Date();
  state.calendar = { year: now.getFullYear(), month: now.getMonth() };
  renderCalendar();
}

function openDayDetail(iso) {
  const events = state.calendarEventsCache[iso] || [];
  document.getElementById("dayOverlayTitle").textContent = fmtDate(iso);
  document.getElementById("dayOverlayList").innerHTML = events.length
    ? events.map((ev) => `
      <button type="button" class="day-event-item" onclick="closeDayOverlay(); openDetail(${ev.id});">
        <span>${esc(ev.title.replace(/^(Due|Mulai): /, ""))}</span>
        <span class="pill ${ev.kind === "due" ? "pill-terlambat" : ev.kind === "mulai" ? "pill-sedang" : "pill-rendah"}">${ev.kind === "due" ? "Due Date" : ev.kind === "mulai" ? "Mulai" : "Berlangsung"}</span>
      </button>`).join("")
    : `<p class="helper-text">Tidak ada penugasan terjadwal pada tanggal ini.</p>`;
  document.getElementById("dayOverlay").classList.add("open");
}

function closeDayOverlay() {
  document.getElementById("dayOverlay").classList.remove("open");
}

/* ---------------- Table (Data Penugasan) ---------------- */

function populateFilterSelects() {
  const kSel = document.getElementById("filterKategori");
  const pSel = document.getElementById("filterPeriode");
  kSel.innerHTML = `<option value="">Semua Kategori</option>` + REF.kategori.map((k) => `<option value="${k}">${k}</option>`).join("");
  pSel.innerHTML = `<option value="">Semua Periode</option>` + REF.periode.map((p) => `<option value="${p}">${p}</option>`).join("");
}

/* ---------------- Chip "filter aktif" (Data Penugasan) ---------------- */
/* Menampilkan filter & pencarian yang sedang aktif sebagai chip yang bisa
   dihapus satu-satu, supaya pengguna paham kenapa datanya cuma sebagian
   dan bisa membersihkannya tanpa harus buka tiap dropdown satu-satu. */
function clearOneFilter(key) {
  if (key === "search") {
    state.search = "";
    const el = document.getElementById("searchInput");
    if (el) el.value = "";
  } else {
    state.filters[key] = "";
    const idMap = { kategori: "filterKategori", periode: "filterPeriode", status: "filterStatus", approval: "filterApproval" };
    const el = document.getElementById(idMap[key]);
    if (el) el.value = "";
  }
  state.page = 1;
  renderTable();
}

function renderFilterChips() {
  const box = document.getElementById("activeFilterChips");
  if (!box) return;
  const chips = [];
  if (state.search.trim()) chips.push(["search", `Cari: "${state.search.trim()}"`]);
  if (state.filters.kategori) chips.push(["kategori", `Kategori: ${state.filters.kategori}`]);
  if (state.filters.periode) chips.push(["periode", `Periode: ${state.filters.periode}`]);
  if (state.filters.status) chips.push(["status", `Status: ${state.filters.status}`]);
  if (state.filters.approval) chips.push(["approval", `Persetujuan: ${state.filters.approval}`]);

  if (!chips.length) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = "flex";
  box.innerHTML =
    `<span class="active-filter-label">Filter aktif:</span>` +
    chips.map(([key, label]) => `
      <button type="button" class="filter-chip" onclick="clearOneFilter('${key}')">
        ${esc(label)}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`).join("") +
    `<button type="button" class="filter-chip filter-chip-clear-all" onclick="clearAllFilters()">Hapus semua</button>`;
}

function clearAllFilters() {
  state.search = "";
  state.filters.kategori = "";
  state.filters.periode = "";
  state.filters.status = "";
  state.filters.approval = "";
  const searchEl = document.getElementById("searchInput");
  if (searchEl) searchEl.value = "";
  ["filterKategori", "filterPeriode", "filterStatus", "filterApproval"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  state.page = 1;
  renderTable();
}

function renderTable() {
  renderFilterChips();
  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageRows = filtered.slice(start, start + state.pageSize);

  document.getElementById("resultCount").textContent =
    `${filtered.length} dari ${applyPicGlobalFilter(state.data).length} penugasan` +
    (state.picGlobal ? ` (PIC: ${state.picGlobal})` : "");

  const tbody = document.getElementById("tableBody");
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6M9 16h6M9 8h6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>
      <h4>Tidak ada data ditemukan</h4>
      <p>Coba ubah kata kunci pencarian atau filter yang digunakan.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((r) => {
      const eff = computeEffectiveStatus(r);
      return `
      <tr>
        <td class="cell-title">
          ${esc(r.shortname || r.nama_penugasan.slice(0,60))}
          <small>${esc(r.nomor_st || "Tanpa nomor ST")}</small>
        </td>
        <td>${esc(r.kategori || "—")}</td>
        <td>${esc(r.periode || "—")}</td>
        <td>${esc((r.pic || "—").split(",")[0].trim())}${(r.pic||"").split(",").length > 1 ? ` <span style="color:var(--ink-500)">+${r.pic.split(",").length - 1}</span>` : ""}</td>
        <td>
          <div class="progress-cell">
            ${progressBarHTML(r.progress)}
            <span class="progress-label">${r.progress}%</span>
          </div>
        </td>
        <td><span class="pill ${statusPillClass(eff)}">${eff}</span></td>
        <td><span class="pill ${approvalPillClass(r.approval_status)}">${esc(r.approval_status)}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Lihat detail" aria-label="Lihat detail" onclick="openDetail(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="icon-btn" title="Ubah" aria-label="Ubah penugasan" onclick="openForm(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="icon-btn danger" title="Hapus" aria-label="Hapus penugasan" onclick="confirmDelete(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  renderPager(totalPages);
}

function renderPager(totalPages) {
  const el = document.getElementById("pager");
  let html = `<button ${state.page===1?"disabled":""} aria-label="Halaman sebelumnya" onclick="gotoPage(${state.page-1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && Math.abs(i - state.page) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px;">…</span>`;
      continue;
    }
    html += `<button class="${i===state.page?"active":""}" onclick="gotoPage(${i})">${i}</button>`;
  }
  html += `<button ${state.page===totalPages?"disabled":""} aria-label="Halaman berikutnya" onclick="gotoPage(${state.page+1})">›</button>`;
  el.innerHTML = html;
}

function gotoPage(p) {
  state.page = p;
  renderTable();
  document.getElementById("tableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Detail drawer + Approval ---------------- */

function openDetail(id) {
  const r = state.data.find((x) => x.id === id);
  if (!r) return;
  const eff = computeEffectiveStatus(r);
  document.getElementById("detailBody").innerHTML = `
    <div class="detail-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;color:var(--ink-500);font-weight:600;text-transform:uppercase;letter-spacing:.04em;">${esc(r.kategori||"—")} · ${esc(r.periode||"—")}</div>
          <h2 style="font-family:var(--font-display);margin:6px 0 0;color:var(--navy-900);font-size:19px;line-height:1.4;">${esc(r.nama_penugasan)}</h2>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">
          <span class="pill ${statusPillClass(eff)}">${eff}</span>
          <span class="pill ${prioritasPillClass(r.prioritas)}">${esc(r.prioritas||"Sedang")}</span>
          <span class="pill ${approvalPillClass(r.approval_status)}">${esc(r.approval_status)}</span>
        </div>
      </div>

      <div style="margin-top:18px;">
        <div class="progress-label" style="margin-bottom:6px;">Progres Pekerjaan — ${r.progress}%</div>
        ${progressBarHTML(r.progress)}
      </div>

      <div class="detail-grid">
        <div class="detail-item"><div class="k">Nomor ST</div><div class="v">${esc(r.nomor_st||"—")}</div></div>
        <div class="detail-item"><div class="k">PIC</div><div class="v">${esc(r.pic||"—")}</div></div>
        <div class="detail-item"><div class="k">Tanggal Mulai</div><div class="v">${fmtDate(r.tgl_mulai)}</div></div>
        <div class="detail-item"><div class="k">Tanggal Selesai Kegiatan</div><div class="v">${fmtDate(r.tgl_selesai_kegiatan)}</div></div>
        <div class="detail-item"><div class="k">Due Date Laporan</div><div class="v">${fmtDate(r.due_date)}</div></div>
        <div class="detail-item"><div class="k">Tanggal Selesai Laporan</div><div class="v">${fmtDate(r.tgl_selesai_laporan)}</div></div>
        <div class="detail-item"><div class="k">Sisa / Ket. Waktu</div><div class="v">${esc(r.sisa_waktu||"—")}</div></div>
        <div class="detail-item"><div class="k">Keterangan</div><div class="v">${esc(r.keterangan||"—")}</div></div>
        <div class="detail-item"><div class="k">Perihal Keterlambatan</div><div class="v">${esc(r.perihal_keterlambatan||"—")}</div></div>
        <div class="detail-item" style="grid-column:1/-1;"><div class="k">Detail Progres</div><div class="v">${esc(r.detail_progres||"—")}</div></div>
        <div class="detail-item" style="grid-column:1/-1;"><div class="k">Nama Laporan</div><div class="v" style="white-space:pre-line;">${esc(r.nama_laporan||"—")}</div></div>
        <div class="detail-item"><div class="k">Link ST &amp; Laporan</div><div class="v">${r.link_st_laporan ? `<a href="${esc(r.link_st_laporan)}" target="_blank" rel="noopener">Buka tautan ↗</a>` : "—"}</div></div>
        <div class="detail-item"><div class="k">Link Checklist Kode Etik</div><div class="v">${r.link_checklist ? `<a href="${esc(r.link_checklist)}" target="_blank" rel="noopener">Buka tautan ↗</a>` : "—"}</div></div>
      </div>

      <div class="approval-box">
        <div class="approval-head">
          <strong style="font-size:13.5px;color:var(--navy-900);">Persetujuan Penugasan</strong>
          <span class="pill ${approvalPillClass(r.approval_status)}">${esc(r.approval_status)}</span>
        </div>
        ${r.approval_status !== "Menunggu" ? `
          <div class="approval-meta">
            <strong>${esc(r.approval_status)}</strong> oleh ${esc(r.approval_by || "—")} pada ${fmtDate(r.approval_date)}
            ${r.approval_note ? `<br>Catatan: ${esc(r.approval_note)}` : ""}
          </div>
          ${isLoggedIn() ? `
          <div class="approval-actions">
            <button class="btn btn-ghost btn-sm" onclick="resetApproval(${r.id})">Ajukan Ulang / Batalkan Keputusan</button>
          </div>` : `<p class="helper-text">Masuk untuk mengubah keputusan ini.</p>`}
        ` : isLoggedIn() ? `
          <p class="approval-meta" style="margin-top:0;">Anda akan memutuskan sebagai <strong>${esc(authState.currentUser.nama_lengkap)}</strong>.</p>
          <textarea id="approvalNoteInput" placeholder="Catatan (opsional) — wajib diisi jika menolak"></textarea>
          <div class="approval-actions">
            <button class="btn btn-approve" onclick="decideApproval(${r.id}, 'Disetujui')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
              Setujui
            </button>
            <button class="btn btn-reject" onclick="decideApproval(${r.id}, 'Ditolak')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>
              Tolak
            </button>
          </div>
        ` : `
          <p class="helper-text" style="margin-top:6px;">Silakan <button class="link-btn" onclick="closeDetail(); setView('auth');">masuk</button> untuk memberikan persetujuan.</p>
        `}
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        ${isLoggedIn() ? `
          <button class="btn btn-primary" onclick="closeDetail(); openForm(${r.id})">Ubah Data</button>
          <button class="btn btn-danger-ghost" onclick="closeDetail(); confirmDelete(${r.id})">Hapus</button>
        ` : `<p class="helper-text">Silakan <button class="link-btn" onclick="closeDetail(); setView('auth');">masuk</button> untuk mengubah atau menghapus data ini.</p>`}
      </div>
      ${(r.created_by || r.updated_by) ? `<p class="helper-text" style="margin-top:14px;">${r.created_by ? `Dibuat oleh ${esc(r.created_by)}. ` : ""}${r.updated_by ? `Terakhir diubah oleh ${esc(r.updated_by)} pada ${fmtDate(r.updated_at)}.` : ""}</p>` : ""}
    </div>`;
  document.getElementById("detailOverlay").classList.add("open");
}
function closeDetail() { document.getElementById("detailOverlay").classList.remove("open"); }

function decideApproval(id, decision) {
  if (!requireLogin("memberikan persetujuan")) return;
  const r = state.data.find((x) => x.id === id);
  if (!r) return;
  const note = document.getElementById("approvalNoteInput")?.value.trim();

  if (decision === "Ditolak" && !note) { toast("Catatan wajib diisi saat menolak penugasan.", "danger"); return; }

  r.approval_status = decision;
  r.approval_by = authState.currentUser.nama_lengkap;
  r.approval_note = note || "";
  r.approval_date = todayISO();
  saveData();
  toast(decision === "Disetujui" ? "Penugasan telah disetujui." : "Penugasan ditolak.", decision === "Ditolak" ? "danger" : undefined);
  openDetail(id);
  renderTable();
  renderDashboard();
  if (state.view === "kalender") renderKalenderView();
}

function resetApproval(id) {
  if (!requireLogin("mengubah keputusan persetujuan")) return;
  const r = state.data.find((x) => x.id === id);
  if (!r) return;
  r.approval_status = "Menunggu";
  r.approval_by = "";
  r.approval_note = "";
  r.approval_date = "";
  saveData();
  toast("Status persetujuan diajukan ulang.");
  openDetail(id);
  renderTable();
  renderDashboard();
  if (state.view === "kalender") renderKalenderView();
}

/* ---------------- Form (Create / Update) ---------------- */

function fieldRow(label, name, value, type, opts, full, hint) {
  const v = esc(value ?? "");
  let input;
  if (type === "select") {
    input = `<select id="f_${name}" name="${name}">
      <option value="">— Pilih —</option>
      ${opts.map((o) => `<option value="${esc(o)}" ${o===value?"selected":""}>${esc(o)}</option>`).join("")}
    </select>`;
  } else if (type === "textarea") {
    input = `<textarea id="f_${name}" name="${name}">${v}</textarea>`;
  } else {
    input = `<input id="f_${name}" name="${name}" type="${type}" value="${v}">`;
  }
  return `<div class="field${full?" full":""}"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label>${input}</div>`;
}

function picFieldRow(value) {
  const known = REF.pic.includes(value);
  const isLainnya = !!value && !known;
  const selected = known ? value : (isLainnya ? REF.picLainnya : "");
  const options = [...REF.pic, REF.picLainnya];
  return `
    <div class="field full">
      <label>PIC</label>
      <select id="f_pic_select" name="pic_select" onchange="onPicSelectChange()">
        <option value="">— Pilih PIC —</option>
        ${options.map((o) => `<option value="${esc(o)}" ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("")}
      </select>
      <input type="text" id="f_pic_other" name="pic_other" placeholder="Ketik nama PIC"
        value="${esc(isLainnya ? value : "")}"
        style="margin-top:8px;${isLainnya ? "" : "display:none;"}">
    </div>`;
}

function onPicSelectChange() {
  const select = document.getElementById("f_pic_select");
  const other = document.getElementById("f_pic_other");
  if (!select || !other) return;
  const isLainnya = select.value === REF.picLainnya;
  other.style.display = isLainnya ? "" : "none";
  if (!isLainnya) other.value = "";
}

function openForm(id) {
  if (!requireLogin(id ? "mengubah data penugasan" : "menambah penugasan baru")) return;
  state.editingId = id || null;
  const r = id ? state.data.find((x) => x.id === id) : {};
  document.getElementById("drawerTitle").textContent = id ? "Ubah Penugasan" : "Tambah Penugasan Baru";
  document.getElementById("drawerSub").textContent = id ? `ID #${id}` : "Lengkapi form untuk menambahkan catatan penugasan";

  const body = document.getElementById("drawerBody");
  const progressVal = r.progress ?? 0;
  body.innerHTML = `
    <div class="form-grid">
      <div class="section-divider"><span>Informasi Umum</span></div>
      ${fieldRow("Nama Penugasan (lengkap)", "nama_penugasan", r.nama_penugasan, "textarea", null, true)}
      ${fieldRow("Nama Singkat", "shortname", r.shortname, "text")}
      ${fieldRow("Nomor ST", "nomor_st", r.nomor_st, "text")}
      ${fieldRow("Kategori", "kategori", r.kategori, "select", REF.kategori)}
      ${fieldRow("Periode", "periode", r.periode, "select", REF.periode)}
      ${fieldRow("Prioritas", "prioritas", r.prioritas || "Sedang", "select", REF.prioritas)}
      ${fieldRow("Status", "status", r.status || "Progres", "select", REF.status)}

      <div class="section-divider"><span>Progres Pekerjaan</span></div>
      <div class="field full">
        <label>Progres Penyelesaian</label>
        <div class="progress-input-row">
          <input type="range" id="f_progress" name="progress" min="0" max="100" step="5" value="${progressVal}"
            oninput="document.getElementById('progressNumLabel').textContent = this.value + '%'">
          <span class="progress-num" id="progressNumLabel">${progressVal}%</span>
        </div>
      </div>

      <div class="section-divider"><span>PIC &amp; Jadwal</span></div>
      ${picFieldRow(r.pic)}
      ${fieldRow("Tanggal Mulai", "tgl_mulai", r.tgl_mulai, "date")}
      ${fieldRow("Tanggal Selesai Kegiatan", "tgl_selesai_kegiatan", r.tgl_selesai_kegiatan, "date")}
      ${fieldRow("Due Date Laporan", "due_date", r.due_date, "date")}
      ${fieldRow("Tanggal Selesai Laporan", "tgl_selesai_laporan", r.tgl_selesai_laporan, "date")}
      ${fieldRow("Sisa / Keterangan Waktu", "sisa_waktu", r.sisa_waktu, "text", null, true)}

      <div class="section-divider"><span>Progres &amp; Pelaporan</span></div>
      ${fieldRow("Detail Progres", "detail_progres", r.detail_progres, "textarea", null, true)}
      ${fieldRow("Keterangan", "keterangan", r.keterangan, "text")}
      ${fieldRow("Perihal Keterlambatan", "perihal_keterlambatan", r.perihal_keterlambatan, "text")}
      ${fieldRow("Nama Laporan", "nama_laporan", r.nama_laporan, "textarea", null, true)}
      ${fieldRow("Link ST &amp; Laporan", "link_st_laporan", r.link_st_laporan, "url", null, true)}
      ${fieldRow("Link Checklist Kode Etik", "link_checklist", r.link_checklist, "url", null, true)}
    </div>
  `;
  document.getElementById("formOverlay").classList.add("open");
}

function closeForm() {
  document.getElementById("formOverlay").classList.remove("open");
  state.editingId = null;
}

async function submitForm(e) {
  e.preventDefault();
  const body = document.getElementById("drawerBody");
  const get = (name) => body.querySelector(`[name="${name}"]`)?.value.trim() || "";

  const nama = get("nama_penugasan");
  if (!nama) {
    toast("Nama penugasan wajib diisi.", "danger");
    document.getElementById("f_nama_penugasan").focus();
    return;
  }

  const picSelect = get("pic_select");
  const picValue = picSelect === REF.picLainnya ? get("pic_other") : picSelect;

  const payload = {
    nama_penugasan: nama,
    shortname: get("shortname") || nama.slice(0, 40),
    nomor_st: get("nomor_st"),
    kategori: get("kategori"),
    periode: get("periode"),
    prioritas: get("prioritas") || "Sedang",
    status: get("status") || "Progres",
    progress: Math.max(0, Math.min(100, Number(get("progress")) || 0)),
    pic: picValue,
    tgl_mulai: get("tgl_mulai"),
    tgl_selesai_kegiatan: get("tgl_selesai_kegiatan"),
    due_date: get("due_date"),
    tgl_selesai_laporan: get("tgl_selesai_laporan"),
    sisa_waktu: get("sisa_waktu"),
    detail_progres: get("detail_progres"),
    keterangan: get("keterangan"),
    perihal_keterlambatan: get("perihal_keterlambatan"),
    nama_laporan: get("nama_laporan"),
    link_st_laporan: get("link_st_laporan"),
    link_checklist: get("link_checklist"),
  };
  if (payload.status === "Selesai") payload.progress = 100;
  const actorName = isLoggedIn() ? authState.currentUser.nama_lengkap : "";

  if (state.editingId) {
    const idx = state.data.findIndex((x) => x.id === state.editingId);
    payload.updated_by = actorName;
    payload.updated_at = todayISO();
    const before = { ...state.data[idx] }; // simpan versi lama, untuk dikembalikan kalau server menolak
    state.data[idx] = { ...state.data[idx], ...payload };
    saveData();
    closeForm();
    renderTable();
    renderDashboard();
    if (state.view === "kalender") renderKalenderView();
    updateSidebarCounts();
    if (typeof syncPushDataNow === "function" && sync.enabled) {
      const ok = await syncPushDataNow();
      if (ok) {
        toast("Perubahan data berhasil disimpan.");
      } else {
        state.data[idx] = before; // batalkan perubahan lokal, server menolak (kemungkinan tidak punya izin)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
        renderTable();
        renderDashboard();
        if (state.view === "kalender") renderKalenderView();
        updateSidebarCounts();
        toast("Perubahan DITOLAK server — kemungkinan Anda tidak punya izin mengubah tugas ini.", "danger");
      }
    } else {
      toast("Perubahan data berhasil disimpan.");
    }
    return;
  } else {
    payload.id = nextId();
    payload.no = state.data.length + 1;
    payload.approval_status = "Menunggu";
    payload.approval_by = "";
    payload.approval_note = "";
    payload.approval_date = "";
    payload.created_by = actorName;
    payload.updated_by = actorName;
    payload.updated_at = todayISO();
    state.data.push(payload);
    toast("Penugasan baru berhasil ditambahkan.");
  }
  saveData();
  closeForm();
  renderTable();
  renderDashboard();
  if (state.view === "kalender") renderKalenderView();
  updateSidebarCounts();
}

/* ---------------- Delete ---------------- */

function confirmDelete(id) {
  if (!requireLogin("menghapus data penugasan")) return;
  state.deletingId = id;
  const r = state.data.find((x) => x.id === id);
  document.getElementById("confirmText").textContent =
    `Data "${(r?.shortname || r?.nama_penugasan || "").slice(0, 60)}" akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`;
  document.getElementById("confirmOverlay").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirmOverlay").classList.remove("open");
  state.deletingId = null;
}
function doDelete() {
  state.data = state.data.filter((x) => x.id !== state.deletingId);
  saveData();
  closeConfirm();
  renderTable();
  renderDashboard();
  if (state.view === "kalender") renderKalenderView();
  updateSidebarCounts();
  toast("Data berhasil dihapus.", "danger");
}

/* ---------------- Export: JSON / Excel / CSV ---------------- */

function toExportRows() {
  return state.data.map((r) => {
    const row = {};
    HEADER_MAP.forEach(([header, field]) => { row[header] = r[field] ?? ""; });
    return row;
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `penugasan-simanja-${todayISO()}.json`);
  toast("Data berhasil diekspor ke JSON.");
}

async function exportExcel() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(toExportRows());
  ws["!cols"] = HEADER_MAP.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Penugasan");
  XLSX.writeFile(wb, `penugasan-simanja-${todayISO()}.xlsx`);
  toast("Data berhasil diekspor ke Excel (.xlsx). File ini juga bisa diunggah langsung ke Google Sheets.");
}

async function exportCSV() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(toExportRows());
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `penugasan-simanja-${todayISO()}.csv`);
  toast("Data berhasil diekspor ke CSV.");
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- Import: JSON / Excel / CSV ---------------- */

function rowsFromSheetObjects(objects) {
  const reverseMap = {};
  HEADER_MAP.forEach(([header, field]) => { reverseMap[header.toLowerCase().trim()] = field; });
  return objects.map((obj) => {
    const row = {};
    Object.entries(obj).forEach(([key, val]) => {
      const field = reverseMap[String(key).toLowerCase().trim()];
      if (field) row[field] = normalizeImportedValue(field, val);
    });
    return row;
  });
}

function normalizeImportedValue(field, val) {
  if (val === undefined || val === null) return "";
  if (["tgl_mulai","tgl_selesai_kegiatan","due_date","tgl_selesai_laporan","approval_date"].includes(field)) {
    return excelDateToISO(val);
  }
  if (field === "progress") {
    const n = Number(val);
    return isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
  }
  return String(val).trim();
}

function excelDateToISO(val) {
  if (val === "" || val === undefined || val === null) return "";
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const d = new Date(s);
  if (!isNaN(d) && /\d{4}/.test(s)) return d.toISOString().slice(0, 10);
  return s;
}

function finalizeImportedRows(rows) {
  let id = nextId();
  return rows
    .filter((r) => r.nama_penugasan && r.nama_penugasan.trim())
    .map((r, i) => ({
      id: r.id ? Number(r.id) : id + i,
      no: r.no ? Number(r.no) : i + 1,
      nama_penugasan: r.nama_penugasan || "",
      shortname: r.shortname || (r.nama_penugasan || "").slice(0, 40),
      kategori: r.kategori || "",
      periode: r.periode || "",
      nomor_st: r.nomor_st || "",
      prioritas: REF.prioritas.includes(r.prioritas) ? r.prioritas : "Sedang",
      pic: r.pic || "",
      tgl_mulai: r.tgl_mulai || "",
      tgl_selesai_kegiatan: r.tgl_selesai_kegiatan || "",
      due_date: r.due_date || "",
      tgl_selesai_laporan: r.tgl_selesai_laporan || "",
      sisa_waktu: r.sisa_waktu || "",
      status: REF.status.includes(r.status) ? r.status : "Progres",
      progress: r.progress || (r.status === "Selesai" ? 100 : 0),
      approval_status: REF.approval.includes(r.approval_status) ? r.approval_status : "Menunggu",
      approval_by: r.approval_by || "",
      approval_note: r.approval_note || "",
      approval_date: r.approval_date || "",
      detail_progres: r.detail_progres || "",
      keterangan: r.keterangan || "",
      perihal_keterlambatan: r.perihal_keterlambatan || "",
      nama_laporan: r.nama_laporan || "",
      link_st_laporan: r.link_st_laporan || "",
      link_checklist: r.link_checklist || "",
      created_by: r.created_by || "",
      updated_by: r.updated_by || "",
    }));
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error("Format tidak sesuai");
      const rows = finalizeImportedRows(parsed);
      applyImportedRows(rows, "JSON");
    } catch (err) {
      toast("Gagal mengimpor file: format JSON tidak valid.", "danger");
    }
  };
  reader.readAsText(file);
}

async function importSpreadsheetFile(file) {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka impor. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const objects = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const rows = finalizeImportedRows(rowsFromSheetObjects(objects));
      const label = file.name.toLowerCase().endsWith(".csv") ? "CSV" : "Excel";
      applyImportedRows(rows, label);
    } catch (err) {
      console.error(err);
      toast("Gagal membaca file. Pastikan format kolom sesuai template ekspor.", "danger");
    }
  };
  reader.readAsArrayBuffer(file);
}

function applyImportedRows(rows, label) {
  if (!rows.length) { toast("Tidak ada baris data valid yang ditemukan di file.", "danger"); return; }
  const mode = document.querySelector('input[name="importMode"]:checked')?.value || "replace";
  if (mode === "replace") {
    state.data = rows;
  } else {
    state.data = state.data.concat(rows);
  }
  normalizeAll();
  saveData();
  renderTable(); renderDashboard(); if (state.view === "kalender") renderKalenderView(); updateSidebarCounts();
  toast(`Berhasil mengimpor ${rows.length} data dari ${label}.`);
}

function handleImportFile(file) {
  if (!requireSuperAdmin("mengimpor file data")) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) importJSON(file);
  else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) importSpreadsheetFile(file);
  else toast("Format file tidak didukung. Gunakan .xlsx, .csv, atau .json.", "danger");
}

function openResetConfirm() {
  if (!requireSuperAdmin("mereset seluruh data penugasan")) return;
  document.getElementById("resetPasswordInput").value = "";
  document.getElementById("resetConfirmOverlay").classList.add("open");
  setTimeout(() => document.getElementById("resetPasswordInput").focus(), 50);
}

function closeResetConfirm() {
  document.getElementById("resetConfirmOverlay").classList.remove("open");
}

async function confirmResetWithPassword() {
  const pwInput = document.getElementById("resetPasswordInput");
  const pw = pwInput.value;
  const user = authState.currentUser;
  if (!user) { toast("Sesi login tidak ditemukan. Silakan masuk kembali.", "danger"); closeResetConfirm(); setView("auth"); return; }
  if (!isSuperAdmin()) { toast("Hanya Super Admin yang dapat mereset seluruh data.", "danger"); closeResetConfirm(); return; }
  if (!pw) { toast("Masukkan password Anda untuk konfirmasi.", "danger"); return; }

  const btn = document.getElementById("btnConfirmReset");
  btn.disabled = true; btn.textContent = "Memeriksa…";
  const hash = await hashPassword(pw, user.salt);
  btn.disabled = false; btn.textContent = "Ya, Reset Semua Data";

  if (hash !== user.password_hash) {
    toast("Password salah. Reset dibatalkan.", "danger");
    pwInput.value = "";
    pwInput.focus();
    return;
  }

  state.data = [];
  saveData();
  renderTable(); renderDashboard(); if (state.view === "kalender") renderKalenderView(); updateSidebarCounts();
  closeResetConfirm();
  toast("Seluruh data penugasan berhasil direset (0 data).", "danger");
}

/* ---------------- Google Sheets integration ---------------- */
/* Menggunakan Google Identity Services (OAuth token client) + Google Sheets REST API v4.
   Tidak memerlukan backend — token disimpan sementara di memori sesi browser.
   Pengguna perlu membuat OAuth Client ID sendiri di Google Cloud Console (lihat README). */

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function renderIntegrationView() {
  const s = state.settings;
  const connected = !!state.googleToken;
  const syncConfigured = typeof isSyncConfigured === "function" && isSyncConfigured();
  const syncOn = syncConfigured && sync.enabled && sync.status === "on";
  const canConfig = isSuperAdmin();
  const lockNote = canConfig ? "" : `<p class="helper-text" style="margin-top:10px;color:var(--danger,#c0392b);">🔒 Hanya Super Admin yang dapat menginput atau mengonfigurasi bagian ini. Anda dapat melihat statusnya, tetapi pengaturan dinonaktifkan.</p>`;
  const dis = canConfig ? "" : "disabled";
  document.getElementById("integrationBody").innerHTML = `
    <div class="integration-card">
      <h3>⚡ Sinkronisasi Real-time (Multi-Perangkat)</h3>
      <div class="sub">Database bersama sungguhan (Supabase) — setiap perubahan data atau akun pengguna oleh
        siapa pun, di perangkat mana pun, otomatis muncul di perangkat lain dalam hitungan detik.
        Tanpa perlu klik ekspor/impor manual.</div>
      <div class="integration-status ${syncOn ? "on" : ""}">
        <span class="status-dot"></span>
        ${!syncConfigured ? "Belum dikonfigurasi (data hanya tersimpan lokal per-perangkat)"
          : syncOn ? "Aktif — data & akun pengguna tersinkron real-time"
          : "Dikonfigurasi, tapi belum terhubung (periksa koneksi internet)"}
      </div>
      ${syncConfigured ? "" : `
      <ol class="steps-list">
        <li>Buat project gratis di <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
        <li>Buka menu <strong>SQL Editor</strong> pada project tsb, jalankan seluruh isi file
          <code>supabase-schema.sql</code> yang sudah disertakan di repo aplikasi ini.</li>
        <li>Buka <strong>Project Settings → API</strong>, salin <em>Project URL</em> dan <em>anon public key</em>.</li>
        <li>Isi keduanya ke variabel <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di awal
          file <code>js/realtime-sync.js</code>, lalu push/unggah ulang situsnya.</li>
      </ol>
      <p class="helper-text">Setelah diaktifkan, seluruh pengguna otomatis memakai server yang sama sebagai
        "database" bersama — menggantikan localStorage per-browser. Lihat catatan keamanan lengkap di
        <code>js/realtime-sync.js</code> dan README.</p>
      `}
      ${canConfig ? `<p class="helper-text" style="margin-top:10px;">Konfigurasi awal (kredensial Supabase) dilakukan langsung di berkas <code>js/realtime-sync.js</code> oleh Super Admin / pengelola teknis.</p>` : lockNote}
    </div>

    <div class="integration-card">
      <h3>Google Sheets</h3>
      <div class="sub">Impor data dari Google Spreadsheet, atau ekspor (tulis) data aplikasi langsung ke sana.</div>
      <div class="integration-status ${connected ? "on" : ""}">
        <span class="status-dot"></span> ${connected ? "Terhubung ke Google" : "Belum terhubung"}
      </div>

      <ol class="steps-list">
        <li>Buat OAuth Client ID (tipe <em>Web application</em>) di Google Cloud Console, lalu tambahkan domain tempat aplikasi ini dibuka (mis. <code>https://namaanda.github.io</code> atau <code>http://localhost:8000</code>) ke <em>Authorized JavaScript origins</em>.</li>
        <li>Buat/gunakan Google Spreadsheet, lalu salin <strong>Spreadsheet ID</strong>-nya dari URL (bagian antara <code>/d/</code> dan <code>/edit</code>).</li>
        <li>Isi kedua kolom di bawah, klik <strong>Simpan Pengaturan</strong>, lalu <strong>Hubungkan Akun Google</strong>.</li>
      </ol>

      <div class="form-grid">
        <div class="field full">
          <label>Google OAuth Client ID</label>
          <input id="gClientId" type="text" placeholder="xxxxxxxxxx-xxxxxxxxxxxxx.apps.googleusercontent.com" value="${esc(s.googleClientId)}" ${dis}>
        </div>
        <div class="field full">
          <label>Spreadsheet ID</label>
          <input id="gSpreadsheetId" type="text" placeholder="1AbCDefGhIJKLmnoPQRstuVWxyz..." value="${esc(s.googleSpreadsheetId)}" ${dis}>
        </div>
        <div class="field">
          <label>Nama Sheet / Tab (Data Penugasan)</label>
          <input id="gSheetName" type="text" placeholder="Data" value="${esc(s.googleSheetName || "Data")}" ${dis}>
        </div>
        <div class="field">
          <label>Nama Sheet / Tab (Data Pengguna)</label>
          <input id="gUsersSheetName" type="text" placeholder="Users" value="${esc(s.googleUsersSheetName || "Users")}" ${dis}>
        </div>
      </div>

      <div class="approval-actions" style="margin-top:4px;">
        <button class="btn btn-ghost" ${dis} onclick="saveGoogleSettings()">Simpan Pengaturan</button>
        <button class="btn btn-primary" ${dis} onclick="connectGoogle()">${connected ? "Sambungkan Ulang" : "Hubungkan Akun Google"}</button>
      </div>

      <div class="approval-actions">
        <button class="btn btn-gold" ${connected && canConfig ? "" : "disabled"} onclick="exportToGoogleSheet()">Ekspor ke Google Sheets</button>
        <button class="btn btn-ghost" ${connected && canConfig ? "" : "disabled"} onclick="importFromGoogleSheet()">Impor dari Google Sheets</button>
      </div>

      <div class="section-divider" style="margin-top:18px;"><span>Mode Database Bersama</span></div>
      <label style="display:flex;align-items:flex-start;gap:10px;margin-top:10px;cursor:pointer;">
        <input type="checkbox" id="gAutoSync" style="margin-top:3px;" ${s.autoSync ? "checked" : ""} ${connected && canConfig ? "" : "disabled"} onchange="saveGoogleSettings()">
        <span style="font-size:12.5px;color:var(--ink-700);line-height:1.5;">
          <strong>Aktifkan Auto-Sync</strong> — setiap kali data ditambah, diubah, dihapus, atau disetujui/ditolak,
          aplikasi otomatis menulis ulang seluruh data ke Google Sheets di atas. Dengan ini, Google Sheets berfungsi
          sebagai "database" bersama yang bisa dibaca siapa pun yang memiliki akses ke spreadsheet-nya.
          ${connected ? "" : " (Hubungkan akun Google terlebih dahulu untuk mengaktifkan.)"}
        </span>
      </label>
      ${lockNote}
    </div>

    <div class="integration-card">
      <h3>Microsoft Excel</h3>
      <div class="sub">Tidak perlu pengaturan — bekerja langsung dari file di perangkat Anda.</div>
      <div class="approval-actions" style="margin-top:0;">
        <button class="btn btn-gold" onclick="exportExcel()">Ekspor ke Excel (.xlsx)</button>
        <button class="btn btn-ghost" onclick="if (requireSuperAdmin('mengimpor file data')) document.getElementById('fileImportIntegrasi').click()">Impor dari Excel / CSV</button>
      </div>
      <p class="helper-text" style="margin-top:10px;">File .xlsx hasil ekspor bisa langsung dibuka di Microsoft Excel, atau diunggah ke Google Drive dan dibuka sebagai Google Sheets (File → Impor).</p>
    </div>

    <div class="integration-card">
      <h3>Data Pengguna (Akun Login)</h3>
      <div class="sub">Ekspor/impor daftar akun terdaftar — password tidak pernah disimpan dalam bentuk asli, hanya hash terenkripsi.</div>
      <div class="approval-actions" style="margin-top:0;">
        <button class="btn btn-gold" onclick="exportUsersExcel()">Ekspor Excel</button>
        <button class="btn btn-ghost" onclick="exportUsersCSV()">Ekspor CSV</button>
        <button class="btn btn-ghost" onclick="exportUsersJSON()">Ekspor JSON</button>
      </div>
      <div class="approval-actions">
        <button class="btn btn-ghost" ${connected && canConfig ? "" : "disabled"} onclick="exportUsersToGoogleSheet()">Ekspor ke Google Sheets</button>
        <button class="btn btn-ghost" ${connected && canConfig ? "" : "disabled"} onclick="importUsersFromGoogleSheet()">Impor dari Google Sheets</button>
        <button class="btn btn-ghost" ${dis} onclick="if (requireSuperAdmin('mengimpor file akun pengguna')) document.getElementById('fileImportUsers').click()">Impor File</button>
      </div>
      <div style="display:flex;gap:14px;font-size:11.5px;color:var(--ink-500);margin-top:6px;">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="radio" name="importUserMode" value="merge" checked ${dis}> Gabung (timpa email sama)</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="radio" name="importUserMode" value="replace" ${dis}> Ganti semua</label>
      </div>
      <p class="helper-text" style="margin-top:10px;">⚠️ Karena aplikasi ini berjalan tanpa server, skema login bersifat sederhana (hash password tersimpan lokal/di sheet). Cocok untuk kebutuhan internal — hindari untuk data yang sangat rahasia.</p>
      ${lockNote}
    </div>

    <div class="integration-card">
      <h3>💾 Backup Otomatis ke Google Drive</h3>
      <div class="sub">Menyalin seluruh data penugasan ke folder Google Drive secara terjadwal, dijalankan otomatis di server (Supabase Cron) — tidak tergantung aplikasi ini sedang dibuka atau tidak. Jadwalnya diatur terpisah di dashboard Supabase. Tombol "Backup Sekarang" di bawah memanggil proses server yang sama secara langsung, jadi statusnya selalu tersinkron dengan pengaturan Supabase Anda.</div>
      <div class="integration-status ${state.backupEnabled ? "on" : ""}">
        <span class="status-dot"></span>
        ${state.backupEnabled === null ? "Memuat status…" : state.backupEnabled ? "Aktif — backup terjadwal akan tetap berjalan" : "Nonaktif — backup terjadwal dilewati"}
      </div>
      ${state.backupLastRunAt ? `
      <div class="helper-text" style="margin-top:8px;">
        Backup terakhir: <strong>${new Date(state.backupLastRunAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</strong> —
        <span style="color:${state.backupLastStatus === "success" ? "var(--success,#2e7d32)" : "var(--danger,#c0392b)"};font-weight:600;">
          ${state.backupLastStatus === "success" ? "Berhasil" : "Gagal"}
        </span>${state.backupLastMessage ? ` — ${state.backupLastMessage}` : ""}
      </div>` : ""}
      <label style="display:flex;align-items:center;gap:10px;margin-top:10px;cursor:pointer;">
        <input type="checkbox" id="backupAutoToggle" ${state.backupEnabled ? "checked" : ""} ${(canConfig && state.backupEnabled !== null) ? "" : "disabled"} onchange="toggleBackupAuto(this.checked)">
        <span style="font-size:12.5px;color:var(--ink-700);">Aktifkan backup otomatis</span>
      </label>

      ${renderBackupScheduleFields(canConfig)}

      <div class="approval-actions" style="margin-top:10px;">
        <button class="btn btn-gold" id="backupNowBtn" ${canConfig && !state.backupRunning ? "" : "disabled"} onclick="triggerBackupNow()">
          ${state.backupRunning ? "Memproses backup…" : "🔄 Backup Sekarang"}
        </button>
      </div>
      ${lockNote}
    </div>
  `;
}

/* ---------------------------------------------------------
   Pemilihan jadwal backup otomatis (Harian / Mingguan / Bulanan).
   Disimpan di app_settings.backup.schedule (kolom "payload" yang sama
   dengan status enabled/last_run_at), jadi Edge Function "backup-to-drive"
   yang dipanggil server (Supabase Cron) membaca jadwal PERSIS dari sini —
   tidak ada pengaturan jadwal terpisah lagi di dashboard Supabase, jadi
   otomatis tersinkron begitu Super Admin klik "Simpan Jadwal" di sini.
   --------------------------------------------------------- */
const HARI_OPTIONS = [
  { v: 0, label: "Minggu" }, { v: 1, label: "Senin" }, { v: 2, label: "Selasa" },
  { v: 3, label: "Rabu" }, { v: 4, label: "Kamis" }, { v: 5, label: "Jumat" }, { v: 6, label: "Sabtu" },
];

function backupScheduleDirty() {
  const a = state.backupSchedule, b = state.backupScheduleDraft;
  if (!a || !b) return false;
  return a.type !== b.type || a.time !== b.time || a.day_of_week !== b.day_of_week || a.day_of_month !== b.day_of_month;
}

function backupScheduleSummaryText(sch) {
  if (!sch) return "";
  const jam = sch.time || "02:00";
  if (sch.type === "weekly") {
    const hari = (HARI_OPTIONS.find((h) => h.v === Number(sch.day_of_week)) || HARI_OPTIONS[1]).label;
    return `Setiap ${hari}, pukul ${jam} WIB`;
  }
  if (sch.type === "monthly") {
    return `Setiap tanggal ${sch.day_of_month || 1}, pukul ${jam} WIB`;
  }
  return `Setiap hari, pukul ${jam} WIB`;
}

function renderBackupScheduleFields(canConfig) {
  if (!state.backupScheduleDraft) state.backupScheduleDraft = defaultBackupSchedule();
  const d = state.backupScheduleDraft;
  const dis = canConfig ? "" : "disabled";
  const dirty = backupScheduleDirty();

  const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${Number(d.day_of_month) === n ? "selected" : ""}>Tanggal ${n}</option>`)
    .join("");
  const dayOfWeekOptions = HARI_OPTIONS
    .map((h) => `<option value="${h.v}" ${Number(d.day_of_week) === h.v ? "selected" : ""}>${h.label}</option>`)
    .join("");

  return `
    <div class="section-divider" style="margin-top:16px;"><span>Jadwal Backup Otomatis</span></div>
    <p class="helper-text" style="margin-top:8px;">Pilih seberapa sering backup otomatis dijalankan. Perubahan di sini langsung dibaca oleh proses backup di server (Supabase) begitu Anda klik "Simpan Jadwal" — tidak perlu mengatur apa pun lagi secara manual di dashboard Supabase.</p>

    <div class="form-grid">
      <div class="field">
        <label>Frekuensi</label>
        <select id="backupSchedType" ${dis} onchange="onBackupScheduleFieldChange('type', this.value)">
          <option value="daily" ${d.type === "daily" ? "selected" : ""}>Harian (1 hari sekali)</option>
          <option value="weekly" ${d.type === "weekly" ? "selected" : ""}>Mingguan (1 minggu sekali)</option>
          <option value="monthly" ${d.type === "monthly" ? "selected" : ""}>Bulanan (1 bulan sekali)</option>
        </select>
      </div>

      ${d.type === "weekly" ? `
      <div class="field">
        <label>Hari</label>
        <select id="backupSchedDayOfWeek" ${dis} onchange="onBackupScheduleFieldChange('day_of_week', this.value)">
          ${dayOfWeekOptions}
        </select>
      </div>` : ""}

      ${d.type === "monthly" ? `
      <div class="field">
        <label>Tanggal <span class="hint">(1–28, agar aman untuk semua bulan termasuk Februari)</span></label>
        <select id="backupSchedDayOfMonth" ${dis} onchange="onBackupScheduleFieldChange('day_of_month', this.value)">
          ${dayOfMonthOptions}
        </select>
      </div>` : ""}

      <div class="field">
        <label>Jam <span class="hint">(WIB)</span></label>
        <input id="backupSchedTime" type="time" value="${esc(d.time || "02:00")}" ${dis} onchange="onBackupScheduleFieldChange('time', this.value)">
      </div>
    </div>

    <div class="helper-text" style="margin-top:-6px;">
      Jadwal tersimpan saat ini: <strong>${esc(backupScheduleSummaryText(state.backupSchedule))}</strong>
    </div>

    <div class="approval-actions" style="margin-top:4px;">
      <button class="btn btn-ghost" ${canConfig && dirty && !state.backupScheduleSaving ? "" : "disabled"} onclick="saveBackupSchedule()">
        ${state.backupScheduleSaving ? "Menyimpan…" : "💾 Simpan Jadwal"}
      </button>
      ${dirty ? `<button class="btn btn-ghost" ${dis} onclick="state.backupScheduleDraft = {...state.backupSchedule}; renderIntegrationView();">Batalkan Perubahan</button>` : ""}
    </div>
  `;
}

function onBackupScheduleFieldChange(field, rawValue) {
  if (!requireSuperAdmin("mengubah jadwal backup otomatis")) { renderIntegrationView(); return; }
  const value = (field === "day_of_week" || field === "day_of_month") ? Number(rawValue) : rawValue;
  state.backupScheduleDraft = { ...(state.backupScheduleDraft || defaultBackupSchedule()), [field]: value };
  renderIntegrationView();
}

async function saveBackupSchedule() {
  if (!requireSuperAdmin("mengubah jadwal backup otomatis")) { renderIntegrationView(); return; }
  const draft = state.backupScheduleDraft || defaultBackupSchedule();

  // Validasi ringan di sisi klien sebelum dikirim ke server.
  if (!/^\d{2}:\d{2}$/.test(draft.time || "")) {
    toast("Jam belum valid — pilih jam menggunakan input waktu di atas.", "danger");
    return;
  }
  if (draft.type === "monthly" && (draft.day_of_month < 1 || draft.day_of_month > 28)) {
    toast("Tanggal harus antara 1–28.", "danger");
    return;
  }

  state.backupScheduleSaving = true;
  renderIntegrationView();
  try {
    // Baca payload lama dulu supaya enabled/last_run_at/last_status/last_message
    // (diisi oleh toggle di atas & Edge Function) tidak ikut tertimpa.
    const { data: existing, error: readErr } = await sync.client.from("app_settings").select("payload").eq("id", "backup").maybeSingle();
    if (readErr) throw readErr;
    const payload = { ...(existing && existing.payload), schedule: draft };
    const { error } = await sync.client
      .from("app_settings")
      .upsert({ id: "backup", payload, updated_at: new Date().toISOString() });
    if (error) throw error;

    state.backupSchedule = { ...draft };
    state.backupScheduleDraft = { ...draft };
    toast(`Jadwal backup disimpan: ${backupScheduleSummaryText(draft)}.`);
  } catch (e) {
    toast("Gagal menyimpan jadwal backup — Anda mungkin tidak punya izin.", "danger");
  } finally {
    state.backupScheduleSaving = false;
    renderIntegrationView();
  }
}

// Jadwal default kalau belum pernah diatur sama sekali: harian jam 02:00 WIB
// (dini hari, saat aplikasi biasanya sepi pengguna).
function defaultBackupSchedule() {
  return { type: "daily", time: "02:00", day_of_week: 1, day_of_month: 1 };
}

async function loadBackupSettings() {
  if (!sync.enabled || !isSuperAdmin()) return;
  try {
    const { data, error } = await sync.client.from("app_settings").select("payload").eq("id", "backup").maybeSingle();
    if (error) throw error;
    const payload = (data && data.payload) || {};
    state.backupEnabled = data ? !!payload.enabled : true;
    state.backupLastRunAt = payload.last_run_at || null;
    state.backupLastStatus = payload.last_status || null;
    state.backupLastMessage = payload.last_message || null;
    state.backupSchedule = { ...defaultBackupSchedule(), ...(payload.schedule || {}) };
    // Draft hanya diisi ulang kalau belum ada draft yang sedang diedit pengguna,
    // supaya perubahan yang belum disimpan tidak tertimpa saat data ditarik ulang.
    if (!state.backupScheduleDraft) {
      state.backupScheduleDraft = { ...state.backupSchedule };
    }
  } catch (e) {
    console.warn("SIMANJA: gagal memuat status backup otomatis.", e);
  }
}

async function toggleBackupAuto(checked) {
  if (!requireSuperAdmin("mengubah pengaturan backup otomatis")) { renderIntegrationView(); return; }
  try {
    // Baca payload lama dulu supaya last_run_at/last_status/last_message (diisi Edge
    // Function) tidak ikut tertimpa/hilang hanya karena toggle ini diubah.
    const { data: existing } = await sync.client.from("app_settings").select("payload").eq("id", "backup").maybeSingle();
    const payload = { ...(existing && existing.payload), enabled: checked };
    const { error } = await sync.client
      .from("app_settings")
      .upsert({ id: "backup", payload, updated_at: new Date().toISOString() });
    if (error) throw error;
    state.backupEnabled = checked;
    toast(checked ? "Backup otomatis diaktifkan." : "Backup otomatis dinonaktifkan.");
  } catch (e) {
    toast("Gagal mengubah pengaturan backup — Anda mungkin tidak punya izin.", "danger");
  }
  renderIntegrationView();
}

/* ---------------------------------------------------------
   Tombol "Backup Sekarang" — memanggil Edge Function "backup-to-drive"
   yang SAMA PERSIS dengan yang dipanggil oleh jadwal Supabase Cron,
   jadi hasilnya (termasuk status & waktu terakhir di atas) selalu
   tersinkron otomatis dengan pengaturan backup Supabase Anda — tidak
   ada state ganda yang bisa berbeda antara tombol ini dan cron job.
   Dikirim dengan { trigger: "manual" } supaya, kalau perlu, Edge
   Function bisa membedakan pemicu manual dari jadwal otomatis (mis.
   tetap jalan meski toggle di atas sedang nonaktif). Hanya Super Admin
   (canConfig) yang tombolnya aktif — lihat renderIntegrationView().
   --------------------------------------------------------- */
async function triggerBackupNow() {
  if (!requireSuperAdmin("menjalankan backup manual")) { renderIntegrationView(); return; }
  if (!sync.enabled || !sync.client) { toast("Sinkronisasi Supabase belum aktif.", "danger"); return; }

  state.backupRunning = true;
  renderIntegrationView();
  try {
    const { data: sessionData } = await sync.client.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) {
      throw new Error("Sesi Supabase Auth tidak ditemukan — coba keluar & masuk ulang.");
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/backup-to-drive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ trigger: "manual" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Server mengembalikan status ${res.status}`);

    toast("Backup manual berhasil dijalankan.");
    await loadBackupSettings(); // tarik ulang status/waktu terbaru yang baru saja ditulis Edge Function
  } catch (e) {
    toast("Gagal menjalankan backup manual: " + e.message, "danger");
  } finally {
    state.backupRunning = false;
    renderIntegrationView();
  }
}

function saveGoogleSettings() {
  if (!requireSuperAdmin("mengonfigurasi pengaturan Google Sheets / Sinkronisasi")) return;
  state.settings.googleClientId = document.getElementById("gClientId").value.trim();
  state.settings.googleSpreadsheetId = document.getElementById("gSpreadsheetId").value.trim();
  state.settings.googleSheetName = document.getElementById("gSheetName").value.trim() || "Data";
  state.settings.googleUsersSheetName = document.getElementById("gUsersSheetName")?.value.trim() || "Users";
  const autoSyncEl = document.getElementById("gAutoSync");
  if (autoSyncEl) state.settings.autoSync = autoSyncEl.checked;
  saveSettings();
  setSyncBadge(state.settings.autoSync ? "on" : "off");
  toast("Pengaturan Google Sheets disimpan.");
}

function connectGoogle() {
  if (!requireSuperAdmin("menghubungkan akun Google")) return;
  saveGoogleSettings();
  if (!state.settings.googleClientId) { toast("Isi Google OAuth Client ID terlebih dahulu.", "danger"); return; }
  if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
    toast("Layanan Google belum siap termuat. Periksa koneksi internet dan coba lagi.", "danger");
    return;
  }
  state.googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.settings.googleClientId,
    scope: GOOGLE_SCOPE,
    callback: (resp) => {
      if (resp && resp.access_token) {
        state.googleToken = resp.access_token;
        toast("Berhasil terhubung ke akun Google.");
        renderIntegrationView();
      } else {
        toast("Gagal mendapatkan izin akses Google.", "danger");
      }
    },
  });
  state.googleTokenClient.requestAccessToken();
}

async function sheetsApiFetch(path, options) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${state.googleToken}`, "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function exportToGoogleSheet(silent) {
  if (!silent && !requireSuperAdmin("mengekspor data ke Google Sheets")) return;
  const s = state.settings;
  if (!s.googleSpreadsheetId) { if (!silent) toast("Isi Spreadsheet ID terlebih dahulu.", "danger"); return; }
  if (!state.googleToken) { if (!silent) toast("Hubungkan akun Google terlebih dahulu.", "danger"); return; }
  setSyncBadge("syncing");
  try {
    const header = HEADER_MAP.map(([h]) => h);
    const rows = state.data.map((r) => HEADER_MAP.map(([, field]) => (r[field] ?? "").toString()));
    const values = [header, ...rows];
    const range = `${s.googleSheetName}!A1`;
    await sheetsApiFetch(
      `${s.googleSpreadsheetId}/values/${encodeURIComponent(s.googleSheetName)}!A1:Z100000:clear`,
      { method: "POST", body: "{}" }
    );
    await sheetsApiFetch(
      `${s.googleSpreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) }
    );
    state.lastSyncAt = new Date();
    setSyncBadge("on");
    if (!silent) toast(`Berhasil menulis ${state.data.length} baris ke Google Sheets.`);
  } catch (err) {
    console.error(err);
    setSyncBadge("error");
    if (!silent) toast("Gagal mengekspor ke Google Sheets: " + err.message, "danger");
  }
}

function setSyncBadge(status) {
  const el = document.getElementById("syncBadge");
  if (!el) return;
  if (status === "off" || !state.settings.autoSync) {
    el.style.display = "none";
    return;
  }
  el.style.display = "inline-flex";
  const map = {
    syncing: ["Menyinkronkan…", "syncing"],
    on: ["Tersinkron ke Google Sheets" + (state.lastSyncAt ? ` · ${state.lastSyncAt.toLocaleTimeString("id-ID")}` : ""), "on"],
    error: ["Sinkronisasi gagal", "error"],
  };
  const [label, cls] = map[status] || map.on;
  el.className = "integration-status sync-badge " + cls;
  el.innerHTML = `<span class="status-dot"></span> ${label}`;
}

async function importFromGoogleSheet() {
  if (!requireSuperAdmin("mengimpor data dari Google Sheets")) return;
  const s = state.settings;
  if (!s.googleSpreadsheetId) { toast("Isi Spreadsheet ID terlebih dahulu.", "danger"); return; }
  if (!state.googleToken) { toast("Hubungkan akun Google terlebih dahulu.", "danger"); return; }
  try {
    const range = `${s.googleSheetName}!A1:Z100000`;
    const data = await sheetsApiFetch(`${s.googleSpreadsheetId}/values/${encodeURIComponent(range)}`, { method: "GET" });
    const values = data.values || [];
    if (values.length < 2) { toast("Sheet kosong atau tidak memiliki data.", "danger"); return; }
    const [header, ...body] = values;
    const objects = body.map((rowArr) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = rowArr[i] ?? ""; });
      return obj;
    });
    const rows = finalizeImportedRows(rowsFromSheetObjects(objects));
    applyImportedRows(rows, "Google Sheets");
  } catch (err) {
    console.error(err);
    toast("Gagal mengimpor dari Google Sheets: " + err.message, "danger");
  }
}

/* ---------------- Sidebar counts ---------------- */

function updateSidebarCounts() {
  document.getElementById("navCountData").textContent = state.data.length;
  populatePicGlobalFilter(); // opsi PIC bisa berubah setelah tambah/ubah/hapus/impor/sinkron data
  const cutiNav = document.getElementById("navCountCuti");
  if (cutiNav && typeof cutiState !== "undefined") cutiNav.textContent = cutiState.data.length;
}

/* ---------------- Export dropdown ---------------- */

function toggleExportMenu() {
  document.getElementById("exportMenu").classList.toggle("open");
}
document.addEventListener("click", (e) => {
  const menu = document.getElementById("exportMenu");
  const btn = document.getElementById("btnExportToggle");
  if (menu && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
    menu.classList.remove("open");
  }
});

/* ---------------- Sidebar toggle (hamburger) ---------------- */

const SIDEBAR_PREF_KEY = "siwasdik_sidebar_hidden";
const MOBILE_NAV_BREAKPOINT = 900;

function isMobileViewport() {
  return window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`).matches;
}

function toggleSidebar() {
  if (isMobileViewport()) {
    const shell = document.querySelector(".app-shell");
    if (shell.classList.contains("mobile-nav-open")) closeMobileNav();
    else openMobileNav();
    return;
  }
  const shell = document.querySelector(".app-shell");
  shell.classList.toggle("sidebar-hidden");
  localStorage.setItem(SIDEBAR_PREF_KEY, shell.classList.contains("sidebar-hidden") ? "1" : "0");
}

function openMobileNav() {
  document.querySelector(".app-shell").classList.add("mobile-nav-open");
  document.body.classList.add("mobile-nav-locked");
  document.getElementById("btnHamburger")?.setAttribute("aria-expanded", "true");
}

function closeMobileNav() {
  document.querySelector(".app-shell").classList.remove("mobile-nav-open");
  document.body.classList.remove("mobile-nav-locked");
  document.getElementById("btnHamburger")?.setAttribute("aria-expanded", "false");
}

function initSidebarPref() {
  const shell = document.querySelector(".app-shell");
  // Preferensi "sembunyikan sidebar" hanya berlaku untuk tampilan desktop
  // (di mobile/tablet, sidebar selalu mulai dalam kondisi tertutup sebagai drawer).
  const hidden = localStorage.getItem(SIDEBAR_PREF_KEY) === "1";
  shell.classList.toggle("sidebar-hidden", hidden);
  shell.classList.remove("mobile-nav-open");
  document.body.classList.remove("mobile-nav-locked");

  document.getElementById("mobileNavBackdrop")?.addEventListener("click", closeMobileNav);

  // Saat jendela di-resize melewati breakpoint mobile↔desktop, bersihkan
  // status drawer supaya tidak "nyangkut" (mis. diputar dari HP ke tablet lanskap).
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobileViewport()) closeMobileNav();
    }, 150);
  });
}

/* ---------------- Mode terang / gelap ---------------- */

const THEME_PREF_KEY = "simanja_theme";

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  const sun = document.getElementById("themeIconSun");
  const moon = document.getElementById("themeIconMoon");
  if (sun) sun.style.display = isDark ? "none" : "block";
  if (moon) moon.style.display = isDark ? "block" : "none";
  const btn = document.getElementById("btnThemeToggle");
  if (btn) btn.setAttribute("aria-label", isDark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  localStorage.setItem(THEME_PREF_KEY, next);
  applyTheme(next);
}

function initThemePref() {
  const saved = localStorage.getItem(THEME_PREF_KEY);
  applyTheme(saved === "dark" ? "dark" : "light");
  document.getElementById("btnThemeToggle")?.addEventListener("click", toggleTheme);
}

/* ---------------- Init ---------------- */

async function init() {
  initSyncClient();
  // Perbaikan race condition: pastikan sesi Supabase Auth (kalau ada)
  // sudah selesai dipulihkan SEBELUM initAuth() memanggil loadUsers(),
  // supaya permintaan baca data ke Supabase terkirim sebagai pengguna
  // yang sudah login (authenticated), bukan tamu. Lihat catatan lengkap
  // di js/auth-supabase.js. Aman dilewati kalau file itu tidak diaktifkan.
  if (typeof restoreSupabaseSessionIfAny === "function") {
    await restoreSupabaseSessionIfAny();
  }
  await initAuth();
  if (typeof applyRestoredSupabaseSession === "function") {
    await applyRestoredSupabaseSession();
  }
  loadSettings();
  await loadData();
  populateFilterSelects();
  populateCalendarFilterSelects();
  populatePicGlobalFilter();
  if (typeof initCuti === "function") await initCuti();
  updateSidebarCounts();
  setSyncBadge(state.settings.autoSync ? "on" : "off");
  initRealtimeChannels();

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cameFromDashboardStat = false;
      setView(btn.dataset.view);
      if (isMobileViewport()) closeMobileNav();
    });
  });

  document.getElementById("btnAddTop").addEventListener("click", () => openForm(null));

  let searchDebounceTimer;
  document.getElementById("searchInput").addEventListener("input", (e) => {
    const val = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.search = val; state.page = 1; renderTable();
    }, 300);
  });
  document.getElementById("filterKategori").addEventListener("change", (e) => {
    state.filters.kategori = e.target.value; state.page = 1; renderTable();
  });
  document.getElementById("filterPeriode").addEventListener("change", (e) => {
    state.filters.periode = e.target.value; state.page = 1; renderTable();
  });
  document.getElementById("filterStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value; state.page = 1; renderTable();
  });
  document.getElementById("filterApproval").addEventListener("change", (e) => {
    state.filters.approval = e.target.value; state.page = 1; renderTable();
  });
  document.getElementById("filterPicGlobal").addEventListener("change", (e) => {
    state.picGlobal = e.target.value;
    state.page = 1;
    renderDashboard();
    if (state.view === "kalender") renderKalenderView();
    renderTable();
  });

  document.getElementById("calFilterKategori").addEventListener("change", (e) => {
    state.calendarFilters.kategori = e.target.value; renderCalendar();
  });
  document.getElementById("calFilterStatus").addEventListener("change", (e) => {
    state.calendarFilters.status = e.target.value; renderCalendar();
  });
  let calSearchDebounceTimer;
  document.getElementById("calSearchInput").addEventListener("input", (e) => {
    const val = e.target.value;
    clearTimeout(calSearchDebounceTimer);
    calSearchDebounceTimer = setTimeout(() => {
      state.calendarFilters.search = val; renderCalendar();
    }, 300);
  });

  document.getElementById("drawerForm").addEventListener("submit", submitForm);
  document.getElementById("btnCancelForm").addEventListener("click", closeForm);
  document.getElementById("btnCloseDrawer").addEventListener("click", closeForm);
  document.getElementById("formOverlay").addEventListener("click", (e) => {
    if (e.target.id === "formOverlay") closeForm();
  });

  document.getElementById("btnCloseDetail").addEventListener("click", closeDetail);
  document.getElementById("detailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "detailOverlay") closeDetail();
  });

  document.getElementById("btnCancelConfirm").addEventListener("click", closeConfirm);
  document.getElementById("btnConfirmDelete").addEventListener("click", doDelete);

  document.getElementById("btnExportToggle").addEventListener("click", toggleExportMenu);
  document.getElementById("btnExportJSON").addEventListener("click", () => { exportJSON(); toggleExportMenu(); });
  document.getElementById("btnExportExcel").addEventListener("click", () => { exportExcel(); toggleExportMenu(); });
  document.getElementById("btnExportCSV").addEventListener("click", () => { exportCSV(); toggleExportMenu(); });

  document.getElementById("btnImportFileTrigger").addEventListener("click", () => {
    if (!requireSuperAdmin("mengimpor file data")) return;
    document.getElementById("fileImport").click();
  });
  document.getElementById("fileImport").addEventListener("change", (e) => {
    if (e.target.files[0]) handleImportFile(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("fileImportIntegrasi").addEventListener("change", (e) => {
    if (e.target.files[0]) handleImportFile(e.target.files[0]);
    e.target.value = "";
  });

  document.getElementById("btnReset").addEventListener("click", openResetConfirm);
  document.getElementById("btnCancelReset").addEventListener("click", closeResetConfirm);
  document.getElementById("resetConfirmOverlay").addEventListener("click", (e) => {
    if (e.target.id === "resetConfirmOverlay") closeResetConfirm();
  });
  document.getElementById("btnConfirmReset").addEventListener("click", confirmResetWithPassword);
  document.getElementById("resetPasswordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    confirmResetWithPassword();
  });

  document.getElementById("btnCloseDayOverlay").addEventListener("click", closeDayOverlay);
  document.getElementById("dayOverlay").addEventListener("click", (e) => {
    if (e.target.id === "dayOverlay") closeDayOverlay();
  });

  document.getElementById("btnHamburger").addEventListener("click", toggleSidebar);
  initSidebarPref();
  initThemePref();
  initOnboarding();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeForm(); closeDetail(); closeConfirm(); closeResetConfirm(); closeDayOverlay();
      closeUserMgmtForm(); closeUserMgmtResetPw(); closeUserMgmtDeleteConfirm();
      closeMobileNav(); closeOnboarding();
    }
  });

  setView("dashboard");
}

/* ---------------- Onboarding: panduan singkat pengguna baru ---------------- */
const ONBOARDING_SEEN_KEY = "simanja_onboarding_seen";

function openOnboarding() {
  document.getElementById("onboardingOverlay").classList.add("open");
}
function closeOnboarding() {
  document.getElementById("onboardingOverlay").classList.remove("open");
  try { localStorage.setItem(ONBOARDING_SEEN_KEY, "1"); } catch (e) {}
}
function initOnboarding() {
  document.getElementById("btnOnboardingHelp").addEventListener("click", openOnboarding);
  document.getElementById("btnCloseOnboarding").addEventListener("click", closeOnboarding);
  document.getElementById("btnStartOnboarding").addEventListener("click", closeOnboarding);
  document.getElementById("onboardingOverlay").addEventListener("click", (e) => {
    if (e.target.id === "onboardingOverlay") closeOnboarding();
  });
  let alreadySeen = false;
  try { alreadySeen = !!localStorage.getItem(ONBOARDING_SEEN_KEY); } catch (e) {}
  if (!alreadySeen) {
    // Tampilkan sedikit setelah layar loading hilang, supaya tidak
    // bertumpuk dengan animasi transisi overlay loading.
    setTimeout(openOnboarding, 500);
  }
}

/* ---------------- Layar "Memuat SIMANJA..." ---------------- */
/* Overlay ini tampil sejak HTML dimuat (lihat index.html) dan otomatis
   disembunyikan begitu init() selesai — baik sukses maupun gagal — supaya
   pengguna tidak melihat tampilan kosong/setengah jadi saat data & sesi
   login masih dimuat. Ada juga batas waktu maksimum sebagai jaring
   pengaman kalau init() gagal total tanpa melempar error. */
function hideAppLoadingOverlay() {
  const el = document.getElementById("appLoadingOverlay");
  if (el) el.classList.add("is-hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const safetyTimer = setTimeout(hideAppLoadingOverlay, 15000);
  init()
    .catch((err) => {
      console.error("Gagal memuat SIMANJA:", err);
      toast("Terjadi masalah saat memuat aplikasi. Coba muat ulang halaman.", "danger");
    })
    .finally(() => {
      clearTimeout(safetyTimer);
      hideAppLoadingOverlay();
    });
});
