/* =========================================================
   SIMANJA — js/auth-supabase.js  (OPSIONAL — TIDAK AKTIF SECARA OTOMATIS)

   Ini adalah "Langkah 4" dari panduan keamanan lanjutan di README:
   memindahkan pemeriksaan password dari browser ke server Supabase
   (Supabase Auth), supaya password tidak pernah benar-benar
   dicocokkan di sisi pengunjung.

   ==========================================================
   JANGAN AKTIFKAN FILE INI SEBELUM MENYELESAIKAN LANGKAH 1 & 2
   DI README ("Langkah Keamanan Lanjutan"):
     1. Supabase Auth (Authentication → Providers → Email) sudah ON.
     2. Setiap pengguna di menu "Manajemen Pengguna" SUDAH punya
        akun kembar di Supabase Auth (Authentication → Users) dengan
        EMAIL YANG SAMA PERSIS.
   Kalau langkah 1–2 belum selesai, login lewat file ini akan selalu
   gagal (karena Supabase belum mengenal akunnya), meski password
   yang diketik sudah benar di tabel app_users.

   JANGAN JALANKAN SQL "Langkah 3" (memperketat RLS jadi
   auth.role() = 'authenticated') SEBELUM FILE INI AKTIF & TERUJI.
   Kalau RLS sudah diperketat duluan sementara file ini belum aktif,
   aplikasi tidak akan bisa baca/tulis data sama sekali untuk siapa pun.

   ==========================================================
   CARA MENGAKTIFKAN (setelah langkah 1 & 2 README selesai):
     1. Pastikan js/realtime-sync.js sudah diisi SUPABASE_URL dan
        SUPABASE_ANON_KEY (fitur sinkronisasi real-time sudah aktif) —
        file ini numpang lewat koneksi yang sama, tidak buat koneksi baru.
     2. Di index.html, cari baris:
          <!-- <script src="js/auth-supabase.js"></script> -->
        Hapus tanda komentar (<!-- dan -->) di baris itu SAJA, sehingga
        menjadi:
          <script src="js/auth-supabase.js"></script>
        Pastikan baris ini diletakkan SETELAH <script src="js/auth.js">.
     3. Simpan, push ke GitHub, coba login dengan salah satu akun yang
        SUDAH didaftarkan di Supabase Auth (langkah 2 README).
     4. Uji dulu di project Supabase percobaan (lihat "Langkah 5" README)
        sebelum dipakai di project yang sungguhan dipakai pengguna.

   File ini TIDAK MENGHAPUS sistem login lama di js/auth.js — ia hanya
   "menyisipkan diri" di depan proses login. Jika koneksi ke Supabase
   Auth gagal/belum siap, file ini otomatis diam saja dan sistem lama
   tetap berfungsi seperti biasa (lihat isSupabaseAuthReady() di bawah).
   ========================================================= */

const supaAuth = {
  ready: false, // true kalau Supabase client tersedia & bisa dipakai untuk login
};

function isSupabaseAuthReady() {
  return !!(sync && sync.client && sync.enabled);
}

/* ---------------------------------------------------------
   LOGIN lewat Supabase Auth.
   Menggantikan bagian "cocokkan hash password di browser" pada
   loginUser() di js/auth.js — sekarang Supabase-lah yang memeriksa
   password, di servernya sendiri, bukan di browser pengunjung.
   --------------------------------------------------------- */
async function loginViaSupabaseAuth(email, password) {
  if (!isSupabaseAuthReady()) {
    throw new Error("Supabase Auth belum siap/terhubung. Coba lagi sebentar, atau hubungi admin.");
  }

  const { data, error } = await sync.client.auth.signInWithPassword({
    email: (email || "").trim(),
    password,
  });

  if (error) {
    // Supabase sendiri yang sudah membatasi percobaan gagal beruntun untuk
    // akun ini, jadi kita tidak perlu lagi rate-limiting manual di browser.
    throw new Error("Email atau password salah.");
  }

  // Login ke Supabase Auth berhasil. Baca ulang daftar user SEKARANG —
  // percobaan baca sebelumnya (sebelum login) pasti gagal/kosong karena
  // RLS membatasi baca data untuk yang belum authenticated. Sekarang kita
  // sudah authenticated, jadi baca ulang supaya authState.users terisi
  // benar sebelum mencari profil pegawainya.
  if (typeof syncPullUsers === "function") {
    await syncPullUsers();
  }

  // Cari data profil pegawai yang cocok (nama, NIP, role, dst) di
  // authState.users berdasarkan email, karena data profil itu masih
  // disimpan terpisah di tabel app_users.
  const authedEmail = (data.user.email || "").toLowerCase();
  const profil = authState.users.find((u) => (u.email || "").toLowerCase() === authedEmail);

  if (!profil) {
    // Ini terjadi kalau akunnya sudah ada di Supabase Auth tapi BELUM
    // didaftarkan lewat menu "Manajemen Pengguna" di aplikasi — dua
    // sistem ini memang sengaja dipisah (lihat catatan di README).
    await sync.client.auth.signOut();
    throw new Error(
      "Akun Anda sudah terdaftar untuk login, tapi belum ada profil pegawainya di aplikasi. " +
      "Hubungi Super Admin untuk didaftarkan lewat menu Manajemen Pengguna (gunakan email yang sama)."
    );
  }

  authState.currentUser = profil;
  saveSession(profil.id);
  return profil;
}

/* ---------------------------------------------------------
   LOGOUT — pastikan sesi di server Supabase juga ikut diakhiri,
   bukan cuma menghapus data sesi lokal di browser.
   --------------------------------------------------------- */
async function logoutViaSupabaseAuth() {
  if (isSupabaseAuthReady()) {
    try { await sync.client.auth.signOut(); } catch (e) { /* noop */ }
  }
  logoutUser(); // fungsi lama dari js/auth.js, tetap dipakai untuk beres-beres data lokal
}

/* ---------------------------------------------------------
   Menyambung ke sistem yang sudah ada di js/auth.js:
   - Menimpa handleLoginSubmit supaya memakai Supabase Auth dulu.
   - Menimpa doLogout supaya ikut logout dari Supabase Auth.
   - Mencoba memulihkan sesi Supabase yang masih aktif saat halaman
     dibuka ulang (mis. pengguna menutup tab tanpa logout).
   Ditulis sebagai "penimpaan" (bukan mengedit ulang js/auth.js) supaya
   gampang dinonaktifkan lagi kalau perlu: tinggal beri komentar ulang
   baris <script> di index.html, dan semuanya kembali ke sistem lama.
   --------------------------------------------------------- */
(function wireSupabaseAuthIntoExistingFlow() {
  const originalHandleLoginSubmit = handleLoginSubmit;

  handleLoginSubmit = async function (e) {
    e.preventDefault();
    if (!isSupabaseAuthReady()) {
      // Supabase belum terhubung → jatuhkan kembali ke sistem lama supaya
      // aplikasi tidak "mati total" hanya karena koneksi lagi bermasalah.
      return originalHandleLoginSubmit(e);
    }

    const typedValue = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("btnDoLogin");
    btn.disabled = true; btn.textContent = "Memproses…";
    try {
      // Supabase Auth hanya mengenal EMAIL, tidak mengenal "Nama Lengkap".
      // Kalau yang diketik bukan format email, cari dulu email aslinya
      // dari profil pegawai yang cocok (authState.users) berdasarkan nama —
      // supaya kolom "Email atau Nama Lengkap" tetap berfungsi seperti dulu.
      let email = typedValue;
      if (!email.includes("@")) {
        const profilByName = authState.users.find(
          (u) => (u.nama_lengkap || "").toLowerCase() === typedValue.trim().toLowerCase()
        );
        if (profilByName && profilByName.email) {
          email = profilByName.email;
        } else {
          // Belum ketemu secara lokal (kemungkinan besar karena ini login
          // pertama di sesi ini, authState.users masih kosong). Coba
          // terjemahkan nama -> email lewat fungsi database khusus yang
          // aman dipanggil tamu (lihat email-by-nama-function.sql).
          try {
            const { data: emailFromDb, error: rpcErr } = await sync.client.rpc(
              "email_by_nama_lengkap",
              { p_nama: typedValue.trim() }
            );
            if (rpcErr || !emailFromDb) throw new Error("Email atau password salah.");
            email = emailFromDb;
          } catch (e) {
            throw new Error("Email atau password salah.");
          }
        }
      }
      const user = await loginViaSupabaseAuth(email, password);
      completeLoginFlow(user); // fungsi lama dari js/auth.js: urus tampilan setelah login
    } catch (err) {
      toast(err.message, "danger");
    } finally {
      btn.disabled = false; btn.textContent = "Masuk";
    }
  };

  const originalDoLogout = doLogout;
  doLogout = function () {
    if (isSupabaseAuthReady()) {
      logoutViaSupabaseAuth().then(() => {
        updateAuthNav();
        resetLoginFormToDefault();
        toast("Anda telah keluar.");
        setView("dashboard");
      });
    } else {
      originalDoLogout();
    }
  };

})();

/* ---------------------------------------------------------
   PERBAIKAN RACE CONDITION (penting — baca ini kalau mengubah urutan
   pemanggilan di js/app.js):

   Sebelumnya, pemulihan sesi Supabase Auth dilakukan lewat
   `setTimeout(..., 800)` yang berjalan TERPISAH dan LEBIH LAMBAT
   daripada `initAuth()` (yang memanggil `loadUsers()` lalu
   `ensureSuperAdmin()`) di js/app.js. Akibatnya, `loadUsers()` selalu
   sempat jalan duluan SEBELUM sesi Supabase Auth siap — request ke
   Supabase pun terkirim sebagai tamu (anon), yang begitu RLS diperketat
   ke `authenticated`-only, otomatis gagal. Ini yang menyebabkan modal
   "Akun Super Admin dibuat" muncul berulang setiap refresh dan proses
   login jadi kacau.

   Sekarang pemulihan sesi dipecah jadi dua fungsi yang dipanggil
   BERURUTAN dan DI-AWAIT oleh init() di js/app.js:
     1. restoreSupabaseSessionIfAny() — dipanggil SEBELUM initAuth(),
        supaya sync.client sudah pasti tahu ada/tidaknya sesi aktif
        sebelum loadUsers() mengirim request apa pun.
     2. applyRestoredSupabaseSession() — dipanggil SETELAH initAuth(),
        supaya authState.users sudah terisi saat kita mencari profil
        yang cocok dengan sesi tsb.
   --------------------------------------------------------- */

let _restoredSupabaseSession = null;

async function restoreSupabaseSessionIfAny() {
  if (!isSupabaseAuthReady()) return;
  try {
    const { data } = await sync.client.auth.getSession();
    _restoredSupabaseSession = (data && data.session) || null;
  } catch (e) {
    _restoredSupabaseSession = null;
  }
}

async function applyRestoredSupabaseSession() {
  if (!_restoredSupabaseSession || isLoggedIn()) return;
  try {
    const email = (_restoredSupabaseSession.user.email || "").toLowerCase();
    const profil = authState.users.find((u) => (u.email || "").toLowerCase() === email);
    if (profil) {
      authState.currentUser = profil;
      saveSession(profil.id);
      completeLoginFlow(profil);
    }
  } catch (e) { /* noop — biarkan pengguna login manual */ }
}

/* ---------------------------------------------------------
   Memanggil Edge Function "admin-sync-auth-user" supaya akun Supabase
   Auth otomatis dibuat/diupdate begitu Super Admin menambah pengguna
   atau reset password lewat aplikasi — tidak perlu lagi daftar manual
   di dashboard Supabase satu-satu.

   Dipanggil dari js/auth.js (adminCreateUser, submitUserMgmtResetPw).
   Kalau gagal (mis. Edge Function belum di-deploy), fungsi ini hanya
   mencatat peringatan di Console — TIDAK membatalkan penyimpanan akun
   di app_users, supaya aplikasi tetap bisa dipakai seperti biasa
   (tinggal daftarkan manual di dashboard sebagai cadangan).
   --------------------------------------------------------- */
async function syncAuthUserViaEdgeFunction(action, email, password) {
  if (!isSupabaseAuthReady()) return;
  try {
    const { data: sessionData } = await sync.client.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) return; // pemanggil sendiri belum login lewat Supabase Auth — lewati saja

    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-sync-auth-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn("SIMANJA: gagal menyinkronkan akun Supabase Auth otomatis.", json.error || res.status);
      toast(
        "Akun disimpan, tapi sinkronisasi login otomatis gagal. Daftarkan manual di Supabase Dashboard → Authentication → Users kalau perlu.",
        "danger"
      );
    }
  } catch (e) {
    console.warn("SIMANJA: gagal memanggil Edge Function sinkronisasi akun.", e);
  }
}
