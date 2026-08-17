/* =========================================================
   SIMANJA — cuti.js
   Menu "Permohonan Cuti" — mengikuti struktur Formulir Permintaan
   dan Pemberian Cuti (I. Data Pegawai s.d. VIII. Keputusan Pejabat
   yang Berwenang Memberikan Cuti) dari dokumen contoh yang dilampirkan.

   Penyimpanan: localStorage terpisah dari data penugasan (belum
   terhubung ke sinkronisasi Google Sheets / Supabase — lihat README
   bila ingin menambahkannya di kemudian hari).

   Aturan akses:
   - Melihat daftar & detail permohonan cuti: TERBUKA untuk siapa saja,
     termasuk pengunjung yang belum masuk (lihat requireLogin()).
   - Mengajukan, mengubah, menghapus, mengimpor data, serta mengisi
     Pertimbangan Atasan Langsung / Keputusan Pejabat Berwenang: HANYA
     untuk pengguna yang sudah masuk.
   ========================================================= */

const CUTI_STORAGE_KEY = "siwasdik_cuti_v1";

// Kop surat — identik dengan kepala dokumen formulir cuti yang dilampirkan.
// Konstan untuk seluruh instansi (tidak berbeda per permohonan), dipakai di
// tampilan formulir, detail, dan halaman Cetak Formulir.
const CUTI_KOP_BARIS1 = "KEMENTERIAN KETENAGAKERJAAN REPUBLIK INDONESIA";
const CUTI_KOP_BARIS2 = "INSPEKTORAT JENDERAL";
const CUTI_JUDUL_FORMULIR = "FORMULIR PERMINTAAN DAN PEMBERIAN CUTI";

// Catatan kaki — disalin persis dari bagian bawah dokumen formulir cuti.
const CUTI_FOOTNOTES = [
  ["*", "Coret yang tidak perlu"],
  ["**", "Pilih salah satu dengan memberi tanda centang (✔)"],
  ["***", "diisi oleh pejabat yang menangani bidang kepegawaian sebelum PNS mengajukan cuti"],
  ["****", "diberi tanda centang dan alasannya"],
  ["N", "Cuti tahun berjalan"],
  ["N-1", "Sisa cuti 1 tahun sebelumnya"],
  ["N-2", "Sisa cuti 2 tahun sebelumnya"],
];

const REF_CUTI = {
  jenis: [
    "Cuti Tahunan",
    "Cuti Besar",
    "Cuti Sakit",
    "Cuti Melahirkan",
    "Cuti Karena Alasan Penting",
    "Cuti di Luar Tanggungan Negara",
  ],
  // Field "Catatan Cuti" (bagian V) untuk kelima jenis cuti selain Cuti
  // Tahunan — pada dokumen asli masing-masing berupa satu kotak keterangan.
  jenisKeteranganField: {
    "Cuti Besar": "ket_cuti_besar",
    "Cuti Sakit": "ket_cuti_sakit",
    "Cuti Melahirkan": "ket_cuti_melahirkan",
    "Cuti Karena Alasan Penting": "ket_cuti_alasan_penting",
    "Cuti di Luar Tanggungan Negara": "ket_cuti_luar_tanggungan",
  },
  satuan: ["hari", "bulan", "tahun"],
  pertimbanganAtasan: ["Disetujui", "Perubahan", "Ditangguhkan", "Tidak Setuju"],
  keputusanPejabat: ["Disetujui", "Perubahan", "Ditangguhkan", "Tidak Disetujui"],
};

// Urutan & label kolom untuk Ekspor/Impor (Excel, CSV, JSON) — mengikuti
// persis urutan bagian "Kepada" dan I–VIII pada Formulir Permintaan dan
// Pemberian Cuti di dokumen contoh, agar file hasil ekspor bisa diimpor
// kembali secara utuh (round-trip) maupun dibuka langsung sebagai arsip.
const CUTI_HEADER_MAP = [
  ["ID", "id"],
  ["No", "no"],
  ["Kota Surat", "kota_surat"],
  ["Ditujukan Kepada Yth. (Jabatan)", "tujuan_yth"],
  ["Instansi Tujuan", "tujuan_instansi"],
  ["Kota Tujuan (di ...)", "tujuan_kota"],
  ["Nama Pegawai", "nama_pegawai"],
  ["NIP", "nip"],
  ["Jabatan", "jabatan"],
  ["Masa Kerja", "masa_kerja"],
  ["Unit Kerja", "unit_kerja"],
  ["Jenis Cuti", "jenis_cuti"],
  ["Alasan Cuti", "alasan_cuti"],
  ["Lama Cuti", "lama_cuti"],
  ["Satuan Lama Cuti", "satuan_cuti"],
  ["Tanggal Mulai", "tgl_mulai"],
  ["Tanggal Selesai", "tgl_selesai"],
  ["Sisa Cuti Tahun N-2 (hari)", "sisa_n2"],
  ["Keterangan Cuti Tahun N-2", "ket_n2"],
  ["Sisa Cuti Tahun N-1 (hari)", "sisa_n1"],
  ["Keterangan Cuti Tahun N-1", "ket_n1"],
  ["Sisa Cuti Tahun N (hari)", "sisa_n"],
  ["Keterangan Cuti Tahun N", "ket_n"],
  ["Keterangan Cuti Besar", "ket_cuti_besar"],
  ["Keterangan Cuti Sakit", "ket_cuti_sakit"],
  ["Keterangan Cuti Melahirkan", "ket_cuti_melahirkan"],
  ["Keterangan Cuti Karena Alasan Penting", "ket_cuti_alasan_penting"],
  ["Keterangan Cuti di Luar Tanggungan Negara", "ket_cuti_luar_tanggungan"],
  ["Alamat Selama Cuti", "alamat_cuti"],
  ["Telepon Selama Cuti", "telp_cuti"],
  ["Pertimbangan Atasan Langsung", "pertimbangan_atasan"],
  ["Jabatan Atasan Langsung", "jabatan_atasan"],
  ["Nama Atasan Langsung", "nama_atasan"],
  ["NIP Atasan Langsung", "nip_atasan"],
  ["Catatan Atasan Langsung", "catatan_atasan"],
  ["Keputusan Pejabat Berwenang", "keputusan_pejabat"],
  ["Jabatan Pejabat Berwenang", "jabatan_pejabat"],
  ["Nama Pejabat Berwenang", "nama_pejabat"],
  ["NIP Pejabat Berwenang", "nip_pejabat"],
  ["Catatan Pejabat Berwenang", "catatan_pejabat"],
  ["Tanggal Pengajuan", "tanggal_pengajuan"],
  ["Diajukan Oleh", "created_by"],
  ["Diubah Oleh", "updated_by"],
  ["Diubah Pada", "updated_at"],
];

// Contoh data awal — persis mengikuti isi formulir cuti yang dilampirkan
// (termasuk kop, tujuan surat, dan tanda tangan atasan/pejabat), supaya
// struktur menu langsung terlihat sesuai. Hanya dipakai sekali saat belum
// ada data cuti tersimpan di perangkat ini.
const CUTI_SEED_DATA = [
  {
    id: 1, no: 1,
    kota_surat: "Jakarta",
    tujuan_yth: "Sekretaris Inspektorat Jenderal",
    tujuan_instansi: "Kementerian Ketenagakerjaan RI",
    tujuan_kota: "Jakarta",
    nama_pegawai: "Kgs. M. Ilham Kurniawan, S.Kom.",
    nip: "19930909 202505 1 001",
    jabatan: "Penata Kelola Sistem dan Teknologi Informasi",
    masa_kerja: "1 tahun 2 bulan",
    unit_kerja: "Sekretariat Inspektorat Jenderal",
    jenis_cuti: "Cuti Tahunan",
    alasan_cuti: "Mendampingi istri tes sertifikasi",
    lama_cuti: 2, satuan_cuti: "hari",
    tgl_mulai: "2026-08-03", tgl_selesai: "2026-08-03",
    sisa_n2: "", ket_n2: "",
    sisa_n1: "", ket_n1: "",
    sisa_n: "2", ket_n: "Sisa 7 hari",
    ket_cuti_besar: "", ket_cuti_sakit: "", ket_cuti_melahirkan: "",
    ket_cuti_alasan_penting: "", ket_cuti_luar_tanggungan: "",
    alamat_cuti: "Jalan Cendana, RT.2/RW.5, Kelurahan Rawa Kalong, Kecamatan Gunung Sindur, Kabupaten Bogor, Jawa Barat 16340",
    telp_cuti: "0812-9281-3668",
    pertimbangan_atasan: "Disetujui", jabatan_atasan: "Kepala Bagian Kepatuhan dan Manajemen Risiko", nama_atasan: "Asep Noor Hasan, S.Si., M.M.", nip_atasan: "19790901 200912 1 001", catatan_atasan: "",
    keputusan_pejabat: "Disetujui", jabatan_pejabat: "Sekretaris Inspektorat Jenderal", nama_pejabat: "Eva Trisiana", nip_pejabat: "19700504 199903 2 001", catatan_pejabat: "",
    tanggal_pengajuan: "2026-08-10",
    created_by: "", updated_by: "", updated_at: "",
  },
];

const cutiState = {
  data: [],
  search: "",
  filters: { jenis: "", status: "" },
  page: 1,
  pageSize: 10,
  editingId: null,
  deletingId: null,
};

/* ---------------- Persistence ---------------- */

function loadCutiData() {
  try {
    const raw = localStorage.getItem(CUTI_STORAGE_KEY);
    if (raw) { cutiState.data = JSON.parse(raw); return; }
  } catch (e) { console.warn("Gagal membaca data cuti tersimpan, memuat data contoh.", e); }
  cutiState.data = JSON.parse(JSON.stringify(CUTI_SEED_DATA));
  saveCutiData();
}

function saveCutiData() {
  localStorage.setItem(CUTI_STORAGE_KEY, JSON.stringify(cutiState.data));
}

function nextCutiId() {
  const base = Date.now();
  const maxExisting = cutiState.data.reduce((m, r) => Math.max(m, r.id || 0), 0);
  return base > maxExisting ? base : maxExisting + 1;
}

/* ---------------- Status efektif ---------------- */

// Status ditentukan oleh keputusan pejabat berwenang (VIII); bila belum diisi,
// jatuh ke pertimbangan atasan langsung (VII); bila keduanya kosong, "Menunggu".
function cutiEffectiveStatus(r) {
  const map = { "Disetujui": "Disetujui", "Tidak Disetujui": "Ditolak", "Tidak Setuju": "Ditolak", "Ditangguhkan": "Ditangguhkan", "Perubahan": "Perubahan" };
  if (r.keputusan_pejabat && map[r.keputusan_pejabat]) return map[r.keputusan_pejabat];
  if (r.pertimbangan_atasan && map[r.pertimbangan_atasan]) return map[r.pertimbangan_atasan];
  return "Menunggu";
}

function cutiStatusPillClass(s) {
  if (s === "Disetujui") return "pill-disetujui";
  if (s === "Ditolak") return "pill-ditolak";
  if (s === "Ditangguhkan" || s === "Perubahan") return "pill-sedang";
  return "pill-menunggu";
}

/* ---------------- Filtering ---------------- */

function getCutiFiltered() {
  const q = cutiState.search.trim().toLowerCase();
  return cutiState.data.filter((r) => {
    if (cutiState.filters.jenis && r.jenis_cuti !== cutiState.filters.jenis) return false;
    if (cutiState.filters.status && cutiEffectiveStatus(r) !== cutiState.filters.status) return false;
    if (q) {
      const hay = [r.nama_pegawai, r.nip, r.jabatan, r.unit_kerja, r.alasan_cuti].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.id || 0) - (a.id || 0));
}

function populateCutiFilterSelects() {
  const sel = document.getElementById("cutiFilterJenis");
  if (!sel) return;
  sel.innerHTML = `<option value="">Semua Jenis Cuti</option>` +
    REF_CUTI.jenis.map((j) => `<option value="${esc(j)}">${esc(j)}</option>`).join("");
}

/* ---------------- Render: daftar ---------------- */

function renderCutiView() {
  const addBtn = document.getElementById("btnCutiAddTop");
  const hint = document.getElementById("cutiLoginHint");
  if (addBtn) addBtn.style.display = isLoggedIn() ? "inline-flex" : "none";
  if (hint) hint.style.display = isLoggedIn() ? "none" : "block";
  renderCutiTable();
}

function renderCutiTable() {
  const filtered = getCutiFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / cutiState.pageSize));
  cutiState.page = Math.min(cutiState.page, totalPages);
  const start = (cutiState.page - 1) * cutiState.pageSize;
  const pageRows = filtered.slice(start, start + cutiState.pageSize);

  const countEl = document.getElementById("cutiResultCount");
  if (countEl) countEl.textContent = `${filtered.length} dari ${cutiState.data.length} permohonan cuti`;

  const tbody = document.getElementById("cutiTableBody");
  if (!tbody) return;

  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6M9 16h6M9 8h6M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>
      <h4>Belum ada permohonan cuti</h4>
      <p>${isLoggedIn() ? 'Klik &ldquo;Ajukan Cuti&rdquo; untuk menambahkan permohonan baru.' : 'Silakan masuk untuk mengajukan cuti.'}</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((r) => {
      const eff = cutiEffectiveStatus(r);
      return `
      <tr>
        <td class="cell-title">
          ${esc(r.nama_pegawai || "—")}
          <small>${esc(r.jabatan || "—")}</small>
        </td>
        <td>${esc(r.nip || "—")}</td>
        <td>${esc(r.jenis_cuti || "—")}</td>
        <td>${esc(r.lama_cuti || "—")} ${esc(r.satuan_cuti || "")}</td>
        <td>${fmtDate(r.tgl_mulai)} s/d ${fmtDate(r.tgl_selesai)}</td>
        <td><span class="pill ${cutiStatusPillClass(eff)}">${eff}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Lihat detail" aria-label="Lihat detail cuti" onclick="openCutiDetail(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            ${isLoggedIn() ? `
            <button class="icon-btn" title="Ubah" aria-label="Ubah permohonan cuti" onclick="openCutiForm(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="icon-btn danger" title="Hapus" aria-label="Hapus permohonan cuti" onclick="confirmCutiDelete(${r.id})">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            </button>` : ""}
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  renderCutiPager(totalPages);
}

function renderCutiPager(totalPages) {
  const el = document.getElementById("cutiPager");
  if (!el) return;
  let html = `<button ${cutiState.page === 1 ? "disabled" : ""} aria-label="Halaman sebelumnya" onclick="gotoCutiPage(${cutiState.page - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && Math.abs(i - cutiState.page) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px;">…</span>`;
      continue;
    }
    html += `<button class="${i === cutiState.page ? "active" : ""}" onclick="gotoCutiPage(${i})">${i}</button>`;
  }
  html += `<button ${cutiState.page === totalPages ? "disabled" : ""} aria-label="Halaman berikutnya" onclick="gotoCutiPage(${cutiState.page + 1})">›</button>`;
  el.innerHTML = html;
}

function gotoCutiPage(p) {
  cutiState.page = p;
  renderCutiTable();
  document.getElementById("cutiTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- Form (Ajukan / Ubah) — mengikuti kepala surat & bagian I–VI ---------------- */

function cutiFieldRow(label, name, value, type, opts, full, hint) {
  const v = esc(value ?? "");
  let input;
  if (type === "select") {
    input = `<select id="cf_${name}" name="${name}">
      <option value="">— Pilih —</option>
      ${opts.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select>`;
  } else if (type === "textarea") {
    input = `<textarea id="cf_${name}" name="${name}">${v}</textarea>`;
  } else {
    input = `<input id="cf_${name}" name="${name}" type="${type}" value="${v}">`;
  }
  return `<div class="field${full ? " full" : ""}"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label>${input}</div>`;
}

// Grid checkbox II. Jenis Cuti — meniru tata letak 2 kolom x 3 baris pada
// dokumen asli (1. Cuti Tahunan … 6. Cuti di Luar Tanggungan Negara), dengan
// tanda centang (✔) pada pilihan yang aktif, persis seperti cara pengisian manualnya.
function cutiJenisGrid(selected) {
  return `
    <div class="field full">
      <label>Jenis Cuti yang Diambil <span class="hint">pilih salah satu dengan memberi tanda centang (✔)</span></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${REF_CUTI.jenis.map((j, i) => `
          <label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:var(--radius-sm);background:var(--paper);box-shadow:var(--shadow-press);font-size:13px;cursor:pointer;">
            <input type="radio" name="jenis_cuti" value="${esc(j)}" ${j === selected ? "checked" : ""} onchange="onCutiJenisChange()">
            <span>${i + 1}. ${esc(j)}</span>
          </label>`).join("")}
      </div>
    </div>`;
}

function onCutiJenisChange() {
  const body = document.getElementById("cutiDrawerBody");
  const selected = body.querySelector('input[name="jenis_cuti"]:checked')?.value;
  body.querySelectorAll(".cuti-jenis-ket-row").forEach((row) => {
    row.style.display = row.dataset.jenis === selected ? "" : "none";
  });
  const tahunanRow = body.querySelector(".cuti-tahunan-block");
  if (tahunanRow) tahunanRow.style.display = selected === "Cuti Tahunan" ? "" : "none";
}

function openCutiForm(id) {
  if (!requireLogin(id ? "mengubah permohonan cuti" : "mengajukan cuti baru")) return;
  cutiState.editingId = id || null;
  const isNew = !id;
  const r = id ? cutiState.data.find((x) => x.id === id) : {};
  if (id && !r) return;

  document.getElementById("cutiDrawerTitle").textContent = id ? "Ubah Permohonan Cuti" : "Ajukan Cuti Baru";
  document.getElementById("cutiDrawerSub").textContent = id ? `ID #${id}` : CUTI_JUDUL_FORMULIR;

  const u = authState.currentUser;
  const selectedJenis = r.jenis_cuti || "";
  const body = document.getElementById("cutiDrawerBody");
  body.innerHTML = `
    <div class="form-grid">
      <div class="section-divider"><span>Kepada</span></div>
      ${cutiFieldRow("Kota Surat", "kota_surat", r.kota_surat || (isNew ? "Jakarta" : ""), "text", null, false, "cth. Jakarta, [tanggal diisi otomatis]")}
      ${cutiFieldRow("Yth. (Jabatan Penerima)", "tujuan_yth", r.tujuan_yth || (isNew ? "Sekretaris Inspektorat Jenderal" : ""), "text")}
      ${cutiFieldRow("Instansi Tujuan", "tujuan_instansi", r.tujuan_instansi || (isNew ? "Kementerian Ketenagakerjaan RI" : ""), "text")}
      ${cutiFieldRow("di (Kota Tujuan)", "tujuan_kota", r.tujuan_kota || (isNew ? "Jakarta" : ""), "text")}

      <div class="section-divider"><span>I. Data Pegawai</span></div>
      ${cutiFieldRow("Nama Pegawai", "nama_pegawai", r.nama_pegawai || (isNew && u ? u.nama_lengkap : ""), "text")}
      ${cutiFieldRow("NIP", "nip", r.nip || (isNew && u ? u.nip : ""), "text")}
      ${cutiFieldRow("Jabatan", "jabatan", r.jabatan, "text")}
      ${cutiFieldRow("Masa Kerja", "masa_kerja", r.masa_kerja, "text", null, false, "cth. 1 tahun 2 bulan")}
      ${cutiFieldRow("Unit Kerja", "unit_kerja", r.unit_kerja, "text", null, true)}

      <div class="section-divider"><span>II. Jenis Cuti yang Diambil</span></div>
      ${cutiJenisGrid(selectedJenis)}

      <div class="section-divider"><span>III. Alasan Cuti</span></div>
      ${cutiFieldRow("Alasan Cuti", "alasan_cuti", r.alasan_cuti, "textarea", null, true)}

      <div class="section-divider"><span>IV. Lamanya Cuti</span></div>
      ${cutiFieldRow("Lama Cuti", "lama_cuti", r.lama_cuti, "number", null, false, "coret yang tidak perlu →")}
      ${cutiFieldRow("Satuan (hari/bulan/tahun)", "satuan_cuti", r.satuan_cuti || "hari", "select", REF_CUTI.satuan)}
      ${cutiFieldRow("Mulai Tanggal", "tgl_mulai", r.tgl_mulai, "date")}
      ${cutiFieldRow("Sampai Dengan Tanggal", "tgl_selesai", r.tgl_selesai, "date")}

      <div class="section-divider"><span>V. Catatan Cuti <span class="hint">*** diisi oleh pejabat kepegawaian sebelum PNS mengajukan cuti</span></span></div>
      <div class="field full cuti-tahunan-block" style="display:${selectedJenis === "Cuti Tahunan" || !selectedJenis ? "" : "none"};">
        <label>1. Cuti Tahunan</label>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
          <div>
            <label class="hint">Sisa Tahun N-2 (hari)</label>
            <input name="sisa_n2" value="${esc(r.sisa_n2 ?? "")}" style="margin-top:4px;">
            <input name="ket_n2" placeholder="Keterangan" value="${esc(r.ket_n2 ?? "")}" style="margin-top:6px;">
          </div>
          <div>
            <label class="hint">Sisa Tahun N-1 (hari)</label>
            <input name="sisa_n1" value="${esc(r.sisa_n1 ?? "")}" style="margin-top:4px;">
            <input name="ket_n1" placeholder="Keterangan" value="${esc(r.ket_n1 ?? "")}" style="margin-top:6px;">
          </div>
          <div>
            <label class="hint">Sisa Tahun N (hari)</label>
            <input name="sisa_n" value="${esc(r.sisa_n ?? "")}" style="margin-top:4px;">
            <input name="ket_n" placeholder="Keterangan" value="${esc(r.ket_n ?? "")}" style="margin-top:6px;">
          </div>
        </div>
      </div>
      ${Object.entries(REF_CUTI.jenisKeteranganField).map(([label, field], i) => `
        <div class="field full cuti-jenis-ket-row" data-jenis="${esc(label)}" style="display:${selectedJenis === label ? "" : "none"};">
          ${cutiFieldRow(`${i + 2}. ${label}`, field, r[field], "text")}
        </div>`).join("")}

      <div class="section-divider"><span>VI. Alamat Selama Menjalankan Cuti</span></div>
      ${cutiFieldRow("Alamat", "alamat_cuti", r.alamat_cuti, "textarea", null, true)}
      ${cutiFieldRow("Telepon", "telp_cuti", r.telp_cuti, "text")}

      <div class="section-divider"><span>Catatan</span></div>
      <div class="field full">
        ${CUTI_FOOTNOTES.map(([mark, text]) => `<div class="hint" style="margin-bottom:2px;">${esc(mark)} &nbsp;${esc(text)}</div>`).join("")}
      </div>
    </div>
  `;
  document.getElementById("cutiFormOverlay").classList.add("open");
}

function closeCutiForm() {
  document.getElementById("cutiFormOverlay").classList.remove("open");
  cutiState.editingId = null;
}

function submitCutiForm(e) {
  e.preventDefault();
  if (!requireLogin(cutiState.editingId ? "mengubah permohonan cuti" : "mengajukan cuti baru")) return;

  const body = document.getElementById("cutiDrawerBody");
  const get = (name) => body.querySelector(`[name="${name}"]`)?.value.trim() || "";
  const jenis = body.querySelector('input[name="jenis_cuti"]:checked')?.value || "";

  const nama = get("nama_pegawai");
  if (!nama) { toast("Nama pegawai wajib diisi.", "danger"); document.getElementById("cf_nama_pegawai").focus(); return; }
  if (!jenis) { toast("Jenis cuti wajib dipilih.", "danger"); return; }

  const payload = {
    kota_surat: get("kota_surat") || "Jakarta",
    tujuan_yth: get("tujuan_yth"),
    tujuan_instansi: get("tujuan_instansi"),
    tujuan_kota: get("tujuan_kota"),
    nama_pegawai: nama,
    nip: get("nip"),
    jabatan: get("jabatan"),
    masa_kerja: get("masa_kerja"),
    unit_kerja: get("unit_kerja"),
    jenis_cuti: jenis,
    alasan_cuti: get("alasan_cuti"),
    lama_cuti: get("lama_cuti"),
    satuan_cuti: get("satuan_cuti") || "hari",
    tgl_mulai: get("tgl_mulai"),
    tgl_selesai: get("tgl_selesai"),
    sisa_n2: get("sisa_n2"), ket_n2: get("ket_n2"),
    sisa_n1: get("sisa_n1"), ket_n1: get("ket_n1"),
    sisa_n: get("sisa_n"), ket_n: get("ket_n"),
    ket_cuti_besar: get("ket_cuti_besar"),
    ket_cuti_sakit: get("ket_cuti_sakit"),
    ket_cuti_melahirkan: get("ket_cuti_melahirkan"),
    ket_cuti_alasan_penting: get("ket_cuti_alasan_penting"),
    ket_cuti_luar_tanggungan: get("ket_cuti_luar_tanggungan"),
    alamat_cuti: get("alamat_cuti"),
    telp_cuti: get("telp_cuti"),
  };
  const actorName = isLoggedIn() ? authState.currentUser.nama_lengkap : "";

  if (cutiState.editingId) {
    const idx = cutiState.data.findIndex((x) => x.id === cutiState.editingId);
    payload.updated_by = actorName;
    payload.updated_at = todayISO();
    cutiState.data[idx] = { ...cutiState.data[idx], ...payload };
    toast("Perubahan permohonan cuti berhasil disimpan.");
  } else {
    payload.id = nextCutiId();
    payload.no = cutiState.data.length + 1;
    payload.pertimbangan_atasan = "";
    payload.jabatan_atasan = "";
    payload.nama_atasan = "";
    payload.nip_atasan = "";
    payload.catatan_atasan = "";
    payload.keputusan_pejabat = "";
    payload.jabatan_pejabat = "";
    payload.nama_pejabat = "";
    payload.nip_pejabat = "";
    payload.catatan_pejabat = "";
    payload.tanggal_pengajuan = todayISO();
    payload.created_by = actorName;
    payload.updated_by = actorName;
    payload.updated_at = todayISO();
    cutiState.data.push(payload);
    toast("Permohonan cuti berhasil diajukan.");
  }
  saveCutiData();
  closeCutiForm();
  renderCutiTable();
  updateSidebarCounts();
}

/* ---------------- Hapus ---------------- */

function confirmCutiDelete(id) {
  if (!requireLogin("menghapus permohonan cuti")) return;
  cutiState.deletingId = id;
  const r = cutiState.data.find((x) => x.id === id);
  document.getElementById("cutiConfirmText").textContent =
    `Permohonan cuti "${(r?.nama_pegawai || "").slice(0, 60)}" akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`;
  document.getElementById("cutiConfirmOverlay").classList.add("open");
}

function closeCutiConfirm() {
  document.getElementById("cutiConfirmOverlay").classList.remove("open");
  cutiState.deletingId = null;
}

function doCutiDelete() {
  cutiState.data = cutiState.data.filter((x) => x.id !== cutiState.deletingId);
  saveCutiData();
  closeCutiConfirm();
  renderCutiTable();
  updateSidebarCounts();
  toast("Permohonan cuti berhasil dihapus.", "danger");
}

/* ---------------- Detail + VII. Pertimbangan Atasan + VIII. Keputusan Pejabat ---------------- */

function openCutiDetail(id) {
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  const eff = cutiEffectiveStatus(r);

  const approvalBlock = (title, currentValue, jabatanField, nameField, nipField, noteField, options, saveFn, resetFn, jabatanId, selectId, noteId) => `
    <div class="approval-box">
      <div class="approval-head">
        <strong style="font-size:13.5px;color:var(--navy-900);">${title}</strong>
        <span class="pill ${currentValue ? cutiStatusPillClass(cutiEffectiveStatus({ keputusan_pejabat: currentValue })) : "pill-menunggu"}">${esc(currentValue || "Menunggu")}</span>
      </div>
      ${currentValue ? `
        <div class="approval-meta">
          <strong>${esc(currentValue)}</strong> oleh ${esc(r[nameField] || "—")}${r[jabatanField] ? ` — ${esc(r[jabatanField])}` : ""}${r[nipField] ? ` (NIP. ${esc(r[nipField])})` : ""}
          ${r[noteField] ? `<br>Catatan: ${esc(r[noteField])}` : ""}
        </div>
        ${isSuperAdmin() ? `<div class="approval-actions"><button class="btn btn-ghost btn-sm" onclick="${resetFn}(${r.id})">Ajukan Ulang / Batalkan</button></div>` : `<p class="helper-text">Hanya Super Admin yang dapat mengubah ini.</p>`}
      ` : isSuperAdmin() ? `
        <p class="approval-meta" style="margin-top:0;">Anda akan mengisi sebagai <strong>${esc(authState.currentUser.nama_lengkap)}</strong>.</p>
        <input id="${jabatanId}" placeholder="Jabatan (cth. Sekretaris Inspektorat Jenderal)" style="width:100%;border:none;border-radius:var(--radius-sm);padding:9px 11px;font-size:13px;font-family:var(--font-body);background:var(--paper-raised);box-shadow:var(--shadow-press);margin-bottom:8px;">
        <select id="${selectId}" style="margin-bottom:8px;">
          <option value="">— Pilih —</option>
          ${options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
        </select>
        <textarea id="${noteId}" placeholder="Catatan (wajib bila bukan Disetujui)"></textarea>
        <div class="approval-actions">
          <button class="btn btn-primary btn-sm" onclick="${saveFn}(${r.id})">Simpan</button>
        </div>
      ` : `<p class="helper-text" style="margin-top:6px;">Bagian persetujuan ini hanya dapat diisi oleh akun dengan status <strong>Super Admin</strong>.</p>`}
    </div>`;

  const jenisIndex = REF_CUTI.jenis.indexOf(r.jenis_cuti);
  const catatanCutiHTML = r.jenis_cuti === "Cuti Tahunan"
    ? `<div class="detail-grid">
        <div class="detail-item"><div class="k">Sisa Cuti N-2</div><div class="v">${esc(r.sisa_n2 || "—")} hari — ${esc(r.ket_n2 || "—")}</div></div>
        <div class="detail-item"><div class="k">Sisa Cuti N-1</div><div class="v">${esc(r.sisa_n1 || "—")} hari — ${esc(r.ket_n1 || "—")}</div></div>
        <div class="detail-item"><div class="k">Sisa Cuti N</div><div class="v">${esc(r.sisa_n || "—")} hari — ${esc(r.ket_n || "—")}</div></div>
      </div>`
    : `<div class="detail-item"><div class="k">${jenisIndex >= 0 ? jenisIndex + 1 : ""}. ${esc(r.jenis_cuti || "—")}</div><div class="v">${esc(REF_CUTI.jenisKeteranganField[r.jenis_cuti] ? (r[REF_CUTI.jenisKeteranganField[r.jenis_cuti]] || "—") : "—")}</div></div>`;

  document.getElementById("cutiDetailBody").innerHTML = `
    <div class="detail-card">
      <div style="text-align:center;margin-bottom:14px;">
        <div style="font-weight:700;font-size:12.5px;color:var(--navy-900);line-height:1.5;">${esc(CUTI_KOP_BARIS1)}<br>${esc(CUTI_KOP_BARIS2)}</div>
      </div>
      <div class="detail-grid" style="grid-template-columns:1fr;">
        <div class="detail-item"><div class="k">Kepada</div><div class="v">${esc(r.kota_surat || "—")}, ${fmtDate(r.tanggal_pengajuan)}<br>Yth. <strong>${esc(r.tujuan_yth || "—")}</strong><br>${esc(r.tujuan_instansi || "—")}<br>di ${esc(r.tujuan_kota || "—")}</div></div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-top:16px;">
        <div>
          <div style="font-size:11px;color:var(--ink-500);font-weight:600;text-transform:uppercase;letter-spacing:.04em;">${esc(r.jenis_cuti || "—")}</div>
          <h2 style="font-family:var(--font-display);margin:6px 0 0;color:var(--navy-900);font-size:19px;line-height:1.4;">${esc(r.nama_pegawai)}</h2>
        </div>
        <span class="pill ${cutiStatusPillClass(eff)}">${eff}</span>
      </div>

      <div class="section-divider" style="margin-top:16px;"><span>I. Data Pegawai</span></div>
      <div class="detail-grid">
        <div class="detail-item"><div class="k">NIP</div><div class="v">${esc(r.nip || "—")}</div></div>
        <div class="detail-item"><div class="k">Jabatan</div><div class="v">${esc(r.jabatan || "—")}</div></div>
        <div class="detail-item"><div class="k">Masa Kerja</div><div class="v">${esc(r.masa_kerja || "—")}</div></div>
        <div class="detail-item"><div class="k">Unit Kerja</div><div class="v">${esc(r.unit_kerja || "—")}</div></div>
      </div>

      <div class="section-divider"><span>III. Alasan Cuti</span></div>
      <p style="font-size:13px;color:var(--ink-700);white-space:pre-line;margin:0;">${esc(r.alasan_cuti || "—")}</p>

      <div class="section-divider"><span>IV. Lamanya Cuti</span></div>
      <div class="detail-grid">
        <div class="detail-item"><div class="k">Lama Cuti</div><div class="v">${esc(r.lama_cuti || "—")} ${esc(r.satuan_cuti || "")}</div></div>
        <div class="detail-item"><div class="k">Mulai Tanggal</div><div class="v">${fmtDate(r.tgl_mulai)}</div></div>
        <div class="detail-item"><div class="k">Sampai Dengan</div><div class="v">${fmtDate(r.tgl_selesai)}</div></div>
      </div>

      <div class="section-divider"><span>V. Catatan Cuti</span></div>
      ${catatanCutiHTML}

      <div class="section-divider"><span>VI. Alamat Selama Menjalankan Cuti</span></div>
      <div class="detail-grid">
        <div class="detail-item" style="grid-column:1/-1;"><div class="k">Alamat</div><div class="v">${esc(r.alamat_cuti || "—")}</div></div>
        <div class="detail-item"><div class="k">Telepon</div><div class="v">${esc(r.telp_cuti || "—")}</div></div>
        <div class="detail-item"><div class="k">Hormat Saya</div><div class="v">${esc(r.nama_pegawai || "—")}<br>NIP. ${esc(r.nip || "—")}</div></div>
      </div>

      <div class="section-divider"><span>VII &amp; VIII. Persetujuan</span></div>
      ${approvalBlock("VII. Pertimbangan Atasan Langsung", r.pertimbangan_atasan, "jabatan_atasan", "nama_atasan", "nip_atasan", "catatan_atasan", REF_CUTI.pertimbanganAtasan, "saveCutiAtasan", "resetCutiAtasan", "cutiAtasanJabatan", "cutiAtasanPilihan", "cutiAtasanCatatan")}
      ${approvalBlock("VIII. Keputusan Pejabat yang Berwenang Memberikan Cuti", r.keputusan_pejabat, "jabatan_pejabat", "nama_pejabat", "nip_pejabat", "catatan_pejabat", REF_CUTI.keputusanPejabat, "saveCutiPejabat", "resetCutiPejabat", "cutiPejabatJabatan", "cutiPejabatPilihan", "cutiPejabatCatatan")}

      <div class="section-divider"><span>Catatan</span></div>
      <div style="font-size:11px;color:var(--ink-500);line-height:1.6;">
        ${CUTI_FOOTNOTES.map(([mark, text]) => `<div>${esc(mark)} &nbsp;${esc(text)}</div>`).join("")}
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-ghost" onclick="exportCutiWord(${r.id})">📄 Ekspor Word (.docx)</button>
        <button class="btn btn-ghost" onclick="printCutiForm(${r.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>
          Cetak Formulir (format asli)
        </button>
        ${isLoggedIn() ? `
        <button class="btn btn-primary" onclick="closeCutiDetail(); openCutiForm(${r.id})">Ubah Data</button>
        <button class="btn btn-danger-ghost" onclick="closeCutiDetail(); confirmCutiDelete(${r.id})">Hapus</button>
        ` : ""}
      </div>
      ${!isLoggedIn() ? `<p class="helper-text" style="margin-top:10px;">Silakan <button class="link-btn" onclick="closeCutiDetail(); setView('auth');">masuk</button> untuk mengubah atau menghapus permohonan ini.</p>` : ""}
      ${(r.created_by || r.updated_by) ? `<p class="helper-text" style="margin-top:14px;">${r.created_by ? `Diajukan oleh ${esc(r.created_by)}${r.tanggal_pengajuan ? ` pada ${fmtDate(r.tanggal_pengajuan)}` : ""}. ` : ""}${r.updated_by ? `Terakhir diubah oleh ${esc(r.updated_by)} pada ${fmtDate(r.updated_at)}.` : ""}</p>` : ""}
    </div>`;
  document.getElementById("cutiDetailOverlay").classList.add("open");
}

function closeCutiDetail() {
  document.getElementById("cutiDetailOverlay").classList.remove("open");
}

function saveCutiAtasan(id) {
  if (!requireSuperAdmin("mengisi pertimbangan atasan langsung")) return;
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  const pilihan = document.getElementById("cutiAtasanPilihan")?.value;
  const jabatan = document.getElementById("cutiAtasanJabatan")?.value.trim();
  const catatan = document.getElementById("cutiAtasanCatatan")?.value.trim();
  if (!pilihan) { toast("Pilih salah satu pertimbangan terlebih dahulu.", "danger"); return; }
  if (pilihan !== "Disetujui" && !catatan) { toast("Catatan wajib diisi bila bukan Disetujui.", "danger"); return; }
  r.pertimbangan_atasan = pilihan;
  r.jabatan_atasan = jabatan || "";
  r.nama_atasan = authState.currentUser.nama_lengkap;
  r.nip_atasan = authState.currentUser.nip;
  r.catatan_atasan = catatan || "";
  r.updated_by = authState.currentUser.nama_lengkap;
  r.updated_at = todayISO();
  saveCutiData();
  toast("Pertimbangan atasan langsung berhasil disimpan.");
  openCutiDetail(id);
  renderCutiTable();
}

function resetCutiAtasan(id) {
  if (!requireSuperAdmin("mengubah pertimbangan atasan langsung")) return;
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  r.pertimbangan_atasan = ""; r.jabatan_atasan = ""; r.nama_atasan = ""; r.nip_atasan = ""; r.catatan_atasan = "";
  saveCutiData();
  toast("Pertimbangan atasan langsung diajukan ulang.");
  openCutiDetail(id);
  renderCutiTable();
}

function saveCutiPejabat(id) {
  if (!requireSuperAdmin("mengisi keputusan pejabat berwenang")) return;
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  const pilihan = document.getElementById("cutiPejabatPilihan")?.value;
  const jabatan = document.getElementById("cutiPejabatJabatan")?.value.trim();
  const catatan = document.getElementById("cutiPejabatCatatan")?.value.trim();
  if (!pilihan) { toast("Pilih salah satu keputusan terlebih dahulu.", "danger"); return; }
  if (pilihan !== "Disetujui" && !catatan) { toast("Catatan wajib diisi bila bukan Disetujui.", "danger"); return; }
  r.keputusan_pejabat = pilihan;
  r.jabatan_pejabat = jabatan || "";
  r.nama_pejabat = authState.currentUser.nama_lengkap;
  r.nip_pejabat = authState.currentUser.nip;
  r.catatan_pejabat = catatan || "";
  r.updated_by = authState.currentUser.nama_lengkap;
  r.updated_at = todayISO();
  saveCutiData();
  toast("Keputusan pejabat berwenang berhasil disimpan.");
  openCutiDetail(id);
  renderCutiTable();
}

function resetCutiPejabat(id) {
  if (!requireSuperAdmin("mengubah keputusan pejabat berwenang")) return;
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  r.keputusan_pejabat = ""; r.jabatan_pejabat = ""; r.nama_pejabat = ""; r.nip_pejabat = ""; r.catatan_pejabat = "";
  saveCutiData();
  toast("Keputusan pejabat berwenang diajukan ulang.");
  openCutiDetail(id);
  renderCutiTable();
}

/* ---------------- Cetak Formulir — replika layout asli untuk cetak/simpan PDF ---------------- */

function cutiCheckCell(isChecked) {
  return isChecked ? `<span style="font-weight:700;">✔</span>` : "";
}

function printCutiForm(id) {
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;

  const jenisRows = [
    ["1. Cuti Tahunan", "2. Cuti Besar"],
    ["3. Cuti Sakit", "4. Cuti Melahirkan"],
    ["5. Cuti Karena Alasan Penting", "6. Cuti di Luar Tanggungan Negara"],
  ];
  const jenisCell = (label) => {
    const name = label.replace(/^\d+\.\s*/, "");
    const checked = r.jenis_cuti === name;
    return `<td style="width:34%;">${esc(label)}</td><td style="width:16%;text-align:center;">${cutiCheckCell(checked)}</td>`;
  };

  const catatanOtherRows = Object.entries(REF_CUTI.jenisKeteranganField).map(([label, field], i) => {
    const num = i + 2;
    return `<tr><td style="padding:4px 8px;">${num}. ${esc(label.toUpperCase())}</td><td style="padding:4px 8px;">${esc(r[field] || "")}</td></tr>`;
  }).join("");

  const pertRow = (options, current) => options.map((o) => {
    const checked = current === o;
    const label = o === "Tidak Setuju" || o === "Tidak Disetujui" ? o.toUpperCase() + "****" : (o === "Disetujui" ? "DISETUJUI" : o.toUpperCase() + "****");
    return `<td style="width:25%;vertical-align:top;padding:6px 8px;"><div>${label}</div><div style="height:26px;text-align:center;font-weight:700;">${checked ? "✔" : ""}</div></td>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8">
<title>Formulir Cuti — ${esc(r.nama_pegawai || "")}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12.5px; color: #111; margin: 0; }
  .kop { text-align: center; font-weight: 700; font-size: 14px; line-height: 1.4; }
  .kop-rule { border: none; border-top: 2px solid #111; margin: 6px 0 16px; }
  .kepada { display: flex; justify-content: flex-end; margin-bottom: 4px; }
  .kepada-box { width: 60%; }
  .kepada-row { display: flex; }
  .kepada-row .label { width: 60px; flex-shrink: 0; }
  .judul { text-align: center; font-weight: 700; font-size: 13.5px; margin: 14px 0 12px; }
  table.frm { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.frm th, table.frm td { border: 1px solid #111; padding: 5px 8px; vertical-align: top; }
  .sec-title { font-weight: 700; background: #fff; }
  .hint-note { font-size: 10.5px; font-style: italic; }
  .sig-block { text-align: center; font-weight: 700; margin-top: 6px; }
  .footnotes { margin-top: 16px; font-size: 10.5px; }
  .footnotes .fn-row { display: flex; gap: 8px; margin-bottom: 2px; }
  .footnotes .fn-mark { width: 32px; flex-shrink: 0; }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
  <div class="no-print" style="text-align:center;padding:10px;background:#f4f4f4;">
    <button onclick="window.print()" style="padding:8px 16px;font-size:13px;cursor:pointer;">🖨️ Cetak / Simpan sebagai PDF</button>
  </div>

  <div class="kop">${esc(CUTI_KOP_BARIS1)}<br>${esc(CUTI_KOP_BARIS2)}</div>
  <hr class="kop-rule">

  <div class="kepada">
    <div class="kepada-box">
      <div style="text-align:right;">${esc(r.kota_surat || "Jakarta")}, ${fmtDate(r.tanggal_pengajuan)}</div>
      <div class="kepada-row"><div class="label">Kepada</div><div></div></div>
      <div class="kepada-row"><div class="label">Yth.</div><div><strong>${esc(r.tujuan_yth || "—")}</strong><br>${esc(r.tujuan_instansi || "—")}<br>di ${esc(r.tujuan_kota || "—")}</div></div>
    </div>
  </div>

  <div class="judul">${esc(CUTI_JUDUL_FORMULIR)}</div>

  <table class="frm">
    <tr><td colspan="4" class="sec-title">I. DATA PEGAWAI</td></tr>
    <tr><td style="width:14%;">Nama</td><td style="width:36%;"><strong>${esc(r.nama_pegawai || "")}</strong></td><td style="width:14%;">NIP</td><td style="width:36%;">${esc(r.nip || "")}</td></tr>
    <tr><td>Jabatan</td><td>${esc(r.jabatan || "")}</td><td>Masa Kerja</td><td>${esc(r.masa_kerja || "")}</td></tr>
    <tr><td>Unit Kerja</td><td colspan="3">${esc(r.unit_kerja || "")}</td></tr>
  </table>

  <table class="frm">
    <tr><td colspan="4" class="sec-title">II. JENIS CUTI YANG DIAMBIL**</td></tr>
    ${jenisRows.map((pair) => `<tr>${jenisCell(pair[0])}${jenisCell(pair[1])}</tr>`).join("")}
  </table>

  <table class="frm">
    <tr><td class="sec-title">III. ALASAN CUTI</td></tr>
    <tr><td style="min-height:40px;">${esc(r.alasan_cuti || "")}</td></tr>
  </table>

  <table class="frm">
    <tr><td colspan="5" class="sec-title">IV. LAMANYA CUTI</td></tr>
    <tr>
      <td style="width:14%;">Selama</td>
      <td style="width:20%;"><strong>${esc(r.lama_cuti || "")}</strong> (${esc(r.satuan_cuti || "hari")})<span class="hint-note">*</span></td>
      <td style="width:14%;">Mulai tanggal</td>
      <td style="width:20%;"><strong>${fmtDate(r.tgl_mulai)}</strong></td>
      <td style="width:8%;">s/d</td>
      <td><strong>${fmtDate(r.tgl_selesai)}</strong></td>
    </tr>
  </table>

  <table class="frm">
    <tr><td colspan="2" class="sec-title">V. CATATAN CUTI***</td></tr>
    <tr>
      <td style="width:55%;padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td colspan="3" style="border:1px solid #111;padding:4px 8px;font-weight:700;">1. CUTI TAHUNAN</td></tr>
          <tr><td style="border:1px solid #111;padding:4px 8px;">Tahun</td><td style="border:1px solid #111;padding:4px 8px;">Sisa</td><td style="border:1px solid #111;padding:4px 8px;">Keterangan</td></tr>
          <tr><td style="border:1px solid #111;padding:4px 8px;">N-2</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.sisa_n2 || "-")} hari</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.ket_n2 || "-")}</td></tr>
          <tr><td style="border:1px solid #111;padding:4px 8px;">N-1</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.sisa_n1 || "-")} hari</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.ket_n1 || "-")}</td></tr>
          <tr><td style="border:1px solid #111;padding:4px 8px;">N</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.sisa_n || "-")} hari</td><td style="border:1px solid #111;padding:4px 8px;">${esc(r.ket_n || "-")}</td></tr>
        </table>
      </td>
      <td style="width:45%;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">${catatanOtherRows}</table>
      </td>
    </tr>
  </table>

  <table class="frm">
    <tr><td colspan="2" class="sec-title">VI. ALAMAT SELAMA MENJALANKAN CUTI</td></tr>
    <tr>
      <td style="width:60%;">${esc(r.alamat_cuti || "")}<br><br>TELP. ${esc(r.telp_cuti || "")}</td>
      <td style="width:40%;text-align:center;">
        <div class="sig-block">Hormat saya</div>
        <div style="height:50px;"></div>
        <div class="sig-block">${esc(r.nama_pegawai || "")}<br>NIP. ${esc(r.nip || "")}</div>
      </td>
    </tr>
  </table>

  <table class="frm">
    <tr><td colspan="4" class="sec-title">VII. PERTIMBANGAN ATASAN LANGSUNG **</td></tr>
    <tr>${pertRow(REF_CUTI.pertimbanganAtasan, r.pertimbangan_atasan)}</tr>
    <tr><td colspan="4" style="text-align:right;">
      <div class="sig-block">${esc(r.jabatan_atasan || "")}</div>
      <div style="height:44px;"></div>
      <div class="sig-block">${esc(r.nama_atasan || "")}<br>${r.nip_atasan ? `NIP. ${esc(r.nip_atasan)}` : ""}</div>
      ${r.catatan_atasan ? `<div style="text-align:left;margin-top:6px;font-size:11px;">Catatan: ${esc(r.catatan_atasan)}</div>` : ""}
    </td></tr>
  </table>

  <table class="frm">
    <tr><td colspan="4" class="sec-title">VIII. KEPUTUSAN PEJABAT YANG BERWENANG MEMBERIKAN CUTI **</td></tr>
    <tr>${pertRow(REF_CUTI.keputusanPejabat, r.keputusan_pejabat)}</tr>
    <tr><td colspan="4" style="text-align:right;">
      <div class="sig-block">${esc(r.jabatan_pejabat || "")}</div>
      <div style="height:44px;"></div>
      <div class="sig-block">${esc(r.nama_pejabat || "")}<br>${r.nip_pejabat ? `NIP. ${esc(r.nip_pejabat)}` : ""}</div>
      ${r.catatan_pejabat ? `<div style="text-align:left;margin-top:6px;font-size:11px;">Catatan: ${esc(r.catatan_pejabat)}</div>` : ""}
    </td></tr>
  </table>

  <div class="footnotes">
    <div style="font-weight:700;margin-bottom:4px;">Catatan :</div>
    ${CUTI_FOOTNOTES.map(([mark, text]) => `<div class="fn-row"><div class="fn-mark">${esc(mark)}</div><div>${esc(text)}</div></div>`).join("")}
  </div>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) { toast("Popup diblokir browser. Izinkan popup untuk mencetak formulir.", "danger"); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* ---------------- Ekspor: JSON / Excel / CSV ---------------- */

function cutiToExportRows() {
  return cutiState.data.map((r) => {
    const row = {};
    CUTI_HEADER_MAP.forEach(([header, field]) => { row[header] = r[field] ?? ""; });
    return row;
  });
}

function exportCutiJSON() {
  const blob = new Blob([JSON.stringify(cutiState.data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `permohonan-cuti-simanja-${todayISO()}.json`);
  toast("Data cuti berhasil diekspor ke JSON.");
}

async function exportCutiExcel() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(cutiToExportRows());
  ws["!cols"] = CUTI_HEADER_MAP.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Permohonan Cuti");
  XLSX.writeFile(wb, `permohonan-cuti-simanja-${todayISO()}.xlsx`);
  toast("Data cuti berhasil diekspor ke Excel (.xlsx).");
}

async function exportCutiCSV() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(cutiToExportRows());
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `permohonan-cuti-simanja-${todayISO()}.csv`);
  toast("Data cuti berhasil diekspor ke CSV.");
}

function toggleCutiExportMenu() {
  document.getElementById("cutiExportMenu").classList.toggle("open");
}

/* ---------------- Impor: JSON / Excel / CSV ---------------- */
/* Format kolom mengikuti CUTI_HEADER_MAP di atas — sama persis dengan
   header hasil "Ekspor Data Cuti", yang disusun dari struktur formulir
   cuti terlampir. Import.xlsx/.csv boleh hanya berisi sebagian kolom. */

function cutiRowsFromSheetObjects(objects) {
  const reverseMap = {};
  CUTI_HEADER_MAP.forEach(([header, field]) => { reverseMap[header.toLowerCase().trim()] = field; });
  return objects.map((obj) => {
    const row = {};
    Object.entries(obj).forEach(([key, val]) => {
      const field = reverseMap[String(key).toLowerCase().trim()];
      if (field) row[field] = normalizeCutiImportedValue(field, val);
    });
    return row;
  });
}

function normalizeCutiImportedValue(field, val) {
  if (val === undefined || val === null) return "";
  if (["tgl_mulai", "tgl_selesai", "tanggal_pengajuan"].includes(field)) {
    return typeof excelDateToISO === "function" ? excelDateToISO(val) : String(val).trim();
  }
  return String(val).trim();
}

function finalizeImportedCutiRows(rows) {
  let id = nextCutiId();
  return rows
    .filter((r) => r.nama_pegawai && r.nama_pegawai.trim())
    .map((r, i) => ({
      id: r.id ? Number(r.id) : id + i,
      no: r.no ? Number(r.no) : i + 1,
      kota_surat: r.kota_surat || "Jakarta",
      tujuan_yth: r.tujuan_yth || "",
      tujuan_instansi: r.tujuan_instansi || "",
      tujuan_kota: r.tujuan_kota || "",
      nama_pegawai: r.nama_pegawai || "",
      nip: r.nip || "",
      jabatan: r.jabatan || "",
      masa_kerja: r.masa_kerja || "",
      unit_kerja: r.unit_kerja || "",
      jenis_cuti: REF_CUTI.jenis.includes(r.jenis_cuti) ? r.jenis_cuti : (r.jenis_cuti || ""),
      alasan_cuti: r.alasan_cuti || "",
      lama_cuti: r.lama_cuti || "",
      satuan_cuti: REF_CUTI.satuan.includes(r.satuan_cuti) ? r.satuan_cuti : "hari",
      tgl_mulai: r.tgl_mulai || "",
      tgl_selesai: r.tgl_selesai || "",
      sisa_n2: r.sisa_n2 || "", ket_n2: r.ket_n2 || "",
      sisa_n1: r.sisa_n1 || "", ket_n1: r.ket_n1 || "",
      sisa_n: r.sisa_n || "", ket_n: r.ket_n || "",
      ket_cuti_besar: r.ket_cuti_besar || "",
      ket_cuti_sakit: r.ket_cuti_sakit || "",
      ket_cuti_melahirkan: r.ket_cuti_melahirkan || "",
      ket_cuti_alasan_penting: r.ket_cuti_alasan_penting || "",
      ket_cuti_luar_tanggungan: r.ket_cuti_luar_tanggungan || "",
      alamat_cuti: r.alamat_cuti || "",
      telp_cuti: r.telp_cuti || "",
      pertimbangan_atasan: REF_CUTI.pertimbanganAtasan.includes(r.pertimbangan_atasan) ? r.pertimbangan_atasan : "",
      jabatan_atasan: r.jabatan_atasan || "",
      nama_atasan: r.nama_atasan || "",
      nip_atasan: r.nip_atasan || "",
      catatan_atasan: r.catatan_atasan || "",
      keputusan_pejabat: REF_CUTI.keputusanPejabat.includes(r.keputusan_pejabat) ? r.keputusan_pejabat : "",
      jabatan_pejabat: r.jabatan_pejabat || "",
      nama_pejabat: r.nama_pejabat || "",
      nip_pejabat: r.nip_pejabat || "",
      catatan_pejabat: r.catatan_pejabat || "",
      tanggal_pengajuan: r.tanggal_pengajuan || "",
      created_by: r.created_by || "",
      updated_by: r.updated_by || "",
      updated_at: r.updated_at || "",
    }));
}

function importCutiJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error("Format tidak sesuai");
      const rows = finalizeImportedCutiRows(parsed);
      applyImportedCutiRows(rows, "JSON");
    } catch (err) {
      toast("Gagal mengimpor file: format JSON tidak valid.", "danger");
    }
  };
  reader.readAsText(file);
}

async function importCutiSpreadsheetFile(file) {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka impor. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const objects = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const rows = finalizeImportedCutiRows(cutiRowsFromSheetObjects(objects));
      const label = file.name.toLowerCase().endsWith(".csv") ? "CSV" : "Excel";
      applyImportedCutiRows(rows, label);
    } catch (err) {
      console.error(err);
      toast("Gagal membaca file. Pastikan format kolom sesuai template ekspor data cuti.", "danger");
    }
  };
  reader.readAsArrayBuffer(file);
}

function applyImportedCutiRows(rows, label) {
  if (!rows.length) { toast("Tidak ada baris data cuti valid yang ditemukan di file.", "danger"); return; }
  const mode = document.querySelector('input[name="cutiImportMode"]:checked')?.value || "replace";
  if (mode === "replace") {
    cutiState.data = rows;
  } else {
    cutiState.data = cutiState.data.concat(rows);
  }
  saveCutiData();
  renderCutiTable();
  updateSidebarCounts();
  toast(`Berhasil mengimpor ${rows.length} data cuti dari ${label}.`);
}

function handleCutiImportFile(file) {
  if (!requireLogin("mengimpor data cuti")) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) importCutiJSON(file);
  else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) importCutiSpreadsheetFile(file);
  else toast("Format file tidak didukung. Gunakan .xlsx, .csv, atau .json.", "danger");
}

/* ---------------- Init ---------------- */

async function initCuti() {
  loadCutiData();
  populateCutiFilterSelects();

  document.getElementById("btnCutiAddTop")?.addEventListener("click", () => openCutiForm(null));

  document.getElementById("cutiSearchInput")?.addEventListener("input", (e) => {
    cutiState.search = e.target.value; cutiState.page = 1; renderCutiTable();
  });
  document.getElementById("cutiFilterJenis")?.addEventListener("change", (e) => {
    cutiState.filters.jenis = e.target.value; cutiState.page = 1; renderCutiTable();
  });
  document.getElementById("cutiFilterStatus")?.addEventListener("change", (e) => {
    cutiState.filters.status = e.target.value; cutiState.page = 1; renderCutiTable();
  });

  document.getElementById("cutiDrawerForm")?.addEventListener("submit", submitCutiForm);
  document.getElementById("btnCancelCutiForm")?.addEventListener("click", closeCutiForm);
  document.getElementById("btnCloseCutiDrawer")?.addEventListener("click", closeCutiForm);
  document.getElementById("cutiFormOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "cutiFormOverlay") closeCutiForm();
  });

  document.getElementById("btnCloseCutiDetail")?.addEventListener("click", closeCutiDetail);
  document.getElementById("cutiDetailOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "cutiDetailOverlay") closeCutiDetail();
  });

  document.getElementById("btnCancelCutiConfirm")?.addEventListener("click", closeCutiConfirm);
  document.getElementById("btnConfirmCutiDelete")?.addEventListener("click", doCutiDelete);

  document.getElementById("btnCutiExportToggle")?.addEventListener("click", toggleCutiExportMenu);
  document.getElementById("btnCutiExportJSON")?.addEventListener("click", () => { exportCutiJSON(); toggleCutiExportMenu(); });
  document.getElementById("btnCutiExportExcel")?.addEventListener("click", () => { exportCutiExcel(); toggleCutiExportMenu(); });
  document.getElementById("btnCutiExportCSV")?.addEventListener("click", () => { exportCutiCSV(); toggleCutiExportMenu(); });
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("cutiExportMenu");
    const btn = document.getElementById("btnCutiExportToggle");
    if (menu && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
      menu.classList.remove("open");
    }
  });

  document.getElementById("btnCutiImportTrigger")?.addEventListener("click", () => {
    if (!requireLogin("mengimpor data cuti")) return;
    document.getElementById("fileImportCuti").click();
  });
  document.getElementById("fileImportCuti")?.addEventListener("change", (e) => {
    if (e.target.files[0]) handleCutiImportFile(e.target.files[0]);
    e.target.value = "";
  });
}
