/* =========================================================
   SIMANJA — lazy-libs.js
   Memuat pustaka besar (SheetJS/xlsx ~950KB & JSZip ~95KB) HANYA saat
   benar-benar dibutuhkan, bukan otomatis di awal saat aplikasi dibuka.
   Ini mempercepat waktu muat pertama SIMANJA, terutama untuk pengguna
   yang cuma melihat Dashboard/Kalender dan tidak pernah ekspor/impor
   Excel atau cetak formulir cuti ke Word.

   Cara pakai di kode lain: panggil `await ensureXlsxLoaded()` sebelum
   memakai variabel global `XLSX`, atau `await ensureJszipLoaded()`
   sebelum memakai `JSZip`. Aman dipanggil berkali-kali — pustaka hanya
   diunduh sekali (permintaan berikutnya memakai unduhan yang sama yang
   sedang/sudah berjalan).
   ========================================================= */

const SIMANJA_LIB_URLS = {
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
};

const _simanjaLibPromises = {};

function _simanjaLoadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) { existing.addEventListener("load", () => resolve()); existing.addEventListener("error", reject); return; }
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat pustaka dari " + url));
    document.head.appendChild(s);
  });
}

function ensureXlsxLoaded() {
  if (typeof XLSX !== "undefined") return Promise.resolve();
  if (!_simanjaLibPromises.xlsx) _simanjaLibPromises.xlsx = _simanjaLoadScript(SIMANJA_LIB_URLS.xlsx);
  return _simanjaLibPromises.xlsx;
}

function ensureJszipLoaded() {
  if (typeof JSZip !== "undefined") return Promise.resolve();
  if (!_simanjaLibPromises.jszip) _simanjaLibPromises.jszip = _simanjaLoadScript(SIMANJA_LIB_URLS.jszip);
  return _simanjaLibPromises.jszip;
}

/* Pra-muat di latar belakang (tanpa memblokir apa pun) begitu pengguna
   membuka salah satu halaman yang biasanya butuh Excel/Word, supaya saat
   tombol Ekspor/Impor/Cetak ditekan, pustakanya kemungkinan besar sudah
   siap dan terasa instan. Kalau gagal (mis. offline), dibiarkan saja —
   fungsi ensureXlsxLoaded/ensureJszipLoaded akan mencoba lagi saat
   benar-benar dipakai (lihat pemanggilnya di app.js/auth.js/cuti.js).   */
function simanjaPreloadLibsForView(view) {
  if (["data", "integrasi", "usermgmt"].includes(view)) ensureXlsxLoaded().catch(() => {});
  if (view === "cuti") { ensureXlsxLoaded().catch(() => {}); ensureJszipLoaded().catch(() => {}); }
}
