/* =========================================================
   SIMANJA — cuti-docx-export.js
   Ekspor/cetak "Formulir Permintaan dan Pemberian Cuti" per
   permohonan menjadi file Microsoft Word (.docx) yang identik
   100% dengan dokumen contoh (Lampiran 2): font Bookman Old
   Style, ukuran kop 10pt / isi 9pt / catatan kaki 6pt, tabel
   I–VIII dengan border & lebar kolom asli, tanda centang "V"
   tebal (bukan simbol ✔ — simbol itu hanya dipakai di catatan
   kaki dengan font Wingdings, persis seperti file asli), serta
   VII & VIII yang sengaja TANPA tanda centang meski disetujui
   (hanya ruang kosong untuk tanda tangan), sesuai file asli.

   Caranya: dokumen asli (Cuti_Ilham_10-08-2026.docx) disalin
   apa adanya menjadi assets/cuti-template.docx dengan setiap
   teks dinamis diganti token {{...}}. Ekspor hanya mengganti
   token tsb dengan data permohonan — SELURUH format XML lain
   (font, border, merge sel, margin halaman) tidak disentuh,
   sehingga hasilnya dijamin identik dengan file asli.
   ========================================================= */

const CUTI_DOCX_TEMPLATE_URL = "assets/cuti-template.docx";
let _cutiDocxTemplateCache = null;

async function loadCutiDocxTemplate() {
  if (_cutiDocxTemplateCache) return _cutiDocxTemplateCache;
  const res = await fetch(CUTI_DOCX_TEMPLATE_URL);
  if (!res.ok) throw new Error("Gagal memuat template Word (" + res.status + ")");
  const buf = await res.arrayBuffer();
  _cutiDocxTemplateCache = buf;
  return buf;
}

// Escape untuk teks di dalam node <w:t>...</w:t> (bukan atribut XML).
function escXmlText(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CUTI_BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// "2026-08-10" -> "10 Agustus 2026" — sama persis dengan format tanggal
// di dokumen asli (nama bulan lengkap, bukan disingkat).
function fmtDateFullID(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return String(d);
  return `${dt.getDate()} ${CUTI_BULAN_ID[dt.getMonth()]} ${dt.getFullYear()}`;
}

// "2026-08-10" -> "10-08-2026" — dipakai untuk nama file, mengikuti pola
// nama file dokumen contoh (Cuti_Ilham_10-08-2026.docx).
function fmtDateDMY(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return String(d).replace(/-/g, "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}

// Bagian nama singkat untuk nama file (kata pertama sebelum koma/gelar).
function shortNameForFile(nama) {
  if (!nama) return "Pegawai";
  const beforeComma = String(nama).split(",")[0];
  const words = beforeComma.trim().split(/\s+/).filter((w) => !/^(Dr|Kgs|Ir|Drs|H|Hj)\.?$/i.test(w));
  return (words[words.length - 1] || words[0] || "Pegawai").replace(/[^A-Za-z0-9]/g, "");
}

// Membangun peta token -> nilai (semua sudah di-escape untuk XML) dari satu
// baris data permohonan cuti (cutiState.data item).
function buildCutiDocxTokenMap(r) {
  const ck = (jenis) => (r.jenis_cuti === jenis ? "V" : "");
  const raw = {
    KOTA_TANGGAL_SURAT: `${r.kota_surat || "Jakarta"}, ${fmtDateFullID(r.tanggal_pengajuan)}`,
    TUJUAN_YTH: r.tujuan_yth || "",
    TUJUAN_INSTANSI: r.tujuan_instansi || "",
    TUJUAN_KOTA: r.tujuan_kota || "",

    NAMA_PEGAWAI: r.nama_pegawai || "",
    NIP: r.nip || "",
    JABATAN: r.jabatan || "",
    MASA_KERJA: r.masa_kerja || "",
    UNIT_KERJA: r.unit_kerja || "",

    CK_TAHUNAN: ck("Cuti Tahunan"),
    CK_BESAR: ck("Cuti Besar"),
    CK_SAKIT: ck("Cuti Sakit"),
    CK_MELAHIRKAN: ck("Cuti Melahirkan"),
    CK_ALASAN: ck("Cuti Karena Alasan Penting"),
    CK_LUAR: ck("Cuti di Luar Tanggungan Negara"),

    ALASAN_CUTI: r.alasan_cuti || "",

    LAMA_CUTI: r.lama_cuti === 0 || r.lama_cuti ? String(r.lama_cuti) : "",
    TGL_MULAI: fmtDateFullID(r.tgl_mulai),
    TGL_SELESAI: fmtDateFullID(r.tgl_selesai),

    SISA_N2: r.sisa_n2 || "-",
    KET_N2: r.ket_n2 || "-",
    SISA_N1: r.sisa_n1 || "-",
    KET_N1: r.ket_n1 || "-",
    SISA_N: r.sisa_n || "-",
    KET_N: r.ket_n || "",

    KET_CUTI_BESAR: r.ket_cuti_besar || "",
    KET_CUTI_SAKIT: r.ket_cuti_sakit || "",
    KET_CUTI_MELAHIRKAN: r.ket_cuti_melahirkan || "",
    KET_CUTI_ALASAN_PENTING: r.ket_cuti_alasan_penting || "",
    KET_CUTI_LUAR_TANGGUNGAN: r.ket_cuti_luar_tanggungan || "",

    ALAMAT_CUTI: r.alamat_cuti || "",
    TELP_CUTI: r.telp_cuti || "",

    JABATAN_ATASAN: r.jabatan_atasan || "",
    NAMA_ATASAN: r.nama_atasan || "",
    NIP_ATASAN: r.nip_atasan || "",

    JABATAN_PEJABAT: r.jabatan_pejabat || "",
    NAMA_PEJABAT: r.nama_pejabat || "",
    NIP_PEJABAT: r.nip_pejabat || "",
  };
  const escaped = {};
  Object.entries(raw).forEach(([k, v]) => { escaped[k] = escXmlText(v); });
  return escaped;
}

async function generateCutiDocxBlob(r) {
  await ensureJszipLoaded();
  if (typeof JSZip === "undefined") {
    throw new Error("Gagal memuat pustaka JSZip. Periksa koneksi internet lalu coba lagi.");
  }
  const templateBuf = await loadCutiDocxTemplate();
  const zip = await JSZip.loadAsync(templateBuf);
  const docPath = "word/document.xml";
  let xml = await zip.file(docPath).async("string");

  const tokens = buildCutiDocxTokenMap(r);
  Object.entries(tokens).forEach(([key, value]) => {
    xml = xml.split(`{{${key}}}`).join(value);
  });

  // Jaga-jaga: laporkan bila ada token yang belum diganti (seharusnya tidak
  // pernah terjadi selama template tidak diubah), supaya tidak diam-diam
  // ada teks "{{...}}" tersisa di dokumen hasil ekspor.
  const leftover = xml.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (leftover) {
    console.warn("Token belum tergantikan pada ekspor Word:", leftover);
  }

  zip.file(docPath, xml);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function exportCutiWord(id) {
  const r = cutiState.data.find((x) => x.id === id);
  if (!r) return;
  try {
    const blob = await generateCutiDocxBlob(r);
    const filename = `Cuti_${shortNameForFile(r.nama_pegawai)}_${fmtDateDMY(r.tanggal_pengajuan) || todayISO()}.docx`;
    downloadBlob(blob, filename);
    toast("Formulir cuti berhasil diekspor ke Word (.docx).");
  } catch (err) {
    console.error(err);
    toast("Gagal membuat file Word: " + err.message, "danger");
  }
}
