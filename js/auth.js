/* =========================================================
   SIMANJA — auth.js
   Registrasi, login, sesi, profil pengguna.

   CATATAN KEAMANAN PENTING:
   Aplikasi ini berjalan 100% di browser tanpa server/backend. Password TIDAK PERNAH
   disimpan atau diekspor dalam bentuk asli — hanya hash PBKDF2 (dengan salt acak per
   pengguna, 150.000 iterasi) yang disimpan di localStorage / Google Sheets / file
   ekspor. Meski begitu, skema ini tetap JAUH LEBIH LEMAH dibanding autentikasi
   berbasis server sungguhan (rawan jika perangkat/file ekspor/Google Sheets diakses
   pihak lain, tidak ada pembatasan percobaan login, dsb). Cocok untuk kebutuhan
   internal skala kecil dengan risiko rendah — bukan untuk data sangat rahasia/sensitif.

   CATATAN UPGRADE HASHING (PBKDF2):
   Versi ini mengganti hashing password dari SHA-256 satu-putaran (lemah, cepat
   di-brute-force) menjadi PBKDF2 150.000 iterasi (jauh lebih lambat di-brute-force).
   Ini BACKWARD-COMPATIBLE: akun lama yang masih punya hash format lama (64 karakter
   hex tanpa awalan) tetap bisa login seperti biasa lewat verifyPassword() di bawah.
   Begitu akun itu ganti password (lewat Profil, atau di-reset oleh Super Admin, atau
   saat wajib ganti password pertama kali), hash-nya otomatis "naik kelas" ke format
   PBKDF2 (ditandai awalan "pbkdf2$<iterasi>$..."). Tidak perlu migrasi manual —
   tapi kalau ingin SEMUA akun langsung ter-upgrade serentak tanpa menunggu tiap
   orang login/ganti password sendiri, Super Admin bisa reset password tiap akun
   lewat menu Manajemen Pengguna.
   ========================================================= */

const USERS_KEY = "siwasdik_users_v1";
const SESSION_KEY = "siwasdik_session_v1";

const USER_HEADER_MAP = [
  ["ID", "id"],
  ["Nama Lengkap", "nama_lengkap"],
  ["NIP", "nip"],
  ["Email", "email"],
  ["No HP", "no_hp"],
  ["Role", "role"],
  ["Password Hash", "password_hash"],
  ["Salt", "salt"],
  ["Tanggal Daftar", "created_at"],
  ["Terakhir Diperbarui", "updated_at"],
];

const authState = {
  users: [],
  currentUser: null,
};

const SUPERADMIN_USERNAME = "adminkmr";
// CATATAN KEAMANAN: password Super Admin TIDAK LAGI hardcoded di sini (dulu tertulis
// polos dan bisa dibaca siapa pun yang membuka source code publik). Sekarang password
// dibuat ACAK secara otomatis hanya pada saat akun ini pertama kali dibuat (lihat
// ensureSuperAdmin di bawah), ditampilkan SATU KALI lewat modal di layar, lalu pengguna
// diwajibkan menggantinya sendiri saat login pertama (lihat must_change_password).
let _justGeneratedSuperAdminPassword = null; // hanya di memori, tidak pernah disimpan

/* ---------------- Persistence ---------------- */

async function loadUsers() {
  if (sync.enabled) {
    const ok = await syncPullUsers();
    if (ok) return;
  }
  try {
    const raw = localStorage.getItem(USERS_KEY);
    authState.users = raw ? JSON.parse(raw) : [];
  } catch (e) {
    authState.users = [];
  }
}

function saveUsers() {
  localStorage.setItem(USERS_KEY, JSON.stringify(authState.users));
  scheduleAutoSync();
  syncPushUsers();
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const { userId } = JSON.parse(raw);
    const user = authState.users.find((u) => u.id === userId);
    if (user) authState.currentUser = user;
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* noop */ }
}

function saveSession(userId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, since: new Date().toISOString() }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function nextUserId() {
  // Berbasis timestamp (bukan sekadar max+1) supaya dua perangkat yang
  // menambah akun baru secara bersamaan (sebelum sempat tersinkron) sangat
  // kecil kemungkinannya menghasilkan id yang sama.
  const base = Date.now();
  const maxExisting = authState.users.reduce((m, u) => Math.max(m, u.id || 0), 0);
  return base > maxExisting ? base : maxExisting + 1;
}

function genRandomPassword(length = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let pw = "";
  for (let i = 0; i < length; i++) pw += chars[bytes[i] % chars.length];
  // Pastikan hasilnya lolos validatePasswordPolicy (huruf + angka + simbol).
  if (!/[A-Za-z]/.test(pw)) pw = "A" + pw.slice(1);
  if (!/\d/.test(pw)) pw = pw.slice(0, -2) + "7" + pw.slice(-1);
  if (!/[^A-Za-z0-9]/.test(pw)) pw = pw.slice(0, -1) + "!";
  return pw;
}

async function ensureSuperAdmin() {
  const exists = authState.users.some((u) => u.nama_lengkap.toLowerCase() === SUPERADMIN_USERNAME.toLowerCase());
  if (exists) return;

  // Kalau sinkronisasi Supabase aktif tapi kita BELUM (atau tidak) berhasil
  // memulihkan sesi Supabase Auth (mis. pengunjung belum login), jangan buat
  // akun baru — tabel app_users kemungkinan besar SUDAH berisi Super Admin,
  // hanya belum terbaca karena RLS membatasi baca data untuk yang belum
  // login. Auto-buat hanya aman kalau memang instalasi lokal murni (tanpa
  // Supabase) atau kita sudah terautentikasi.
  const supabaseSyncActive = typeof sync !== "undefined" && sync.enabled;
  const hasRestoredSession = typeof _restoredSupabaseSession !== "undefined" && !!_restoredSupabaseSession;
  if (supabaseSyncActive && !hasRestoredSession) return;

  const generatedPassword = genRandomPassword();
  const salt = genSalt();
  const password_hash = await hashPassword(generatedPassword, salt);
  const now = new Date().toISOString();
  authState.users.push({
    id: nextUserId(),
    nama_lengkap: "adminkmr",
    nip: "000000000000000000",
    email: "adminkmr@siwasdik.local",
    no_hp: "080000000000",
    role: "Super Admin",
    password_hash, salt,
    must_change_password: true,
    created_at: now,
    updated_at: now,
  });
  saveUsers();
  _justGeneratedSuperAdminPassword = generatedPassword;
}

/* ---------------- Hashing (Web Crypto PBKDF2 + salt, dengan fallback SHA-256 lama) ---------------- */

function genSalt() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const PBKDF2_ITERATIONS = 150000; // makin besar = makin lambat di-brute-force (150rb ≈ <0.1 detik di HP/laptop biasa)

// Dipakai untuk password BARU / ganti password — menghasilkan hash format baru
// yang jauh lebih tahan brute-force dibanding SHA-256 satu-putaran.
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Awalan "pbkdf2$<iterasi>$" supaya verifyPassword() tahu ini format baru dan
  // tahu berapa kali iterasi dipakai (kalau PBKDF2_ITERATIONS dinaikkan lagi nanti,
  // hash lama dengan iterasi lama tetap bisa diverifikasi dengan benar).
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hashHex}`;
}

// Hash SHA-256 lama — TETAP DISIMPAN (jangan dihapus) supaya akun lama yang belum
// pernah ganti password sejak upgrade ini tetap bisa login lewat verifyPassword().
async function hashPasswordLegacySHA256(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}::${password}`);
  const digestBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digestBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Dipakai untuk MEMERIKSA password/token yang diketik pengguna terhadap hash yang
// tersimpan — otomatis mendeteksi apakah hash itu format lama (SHA-256) atau baru
// (PBKDF2, diawali "pbkdf2$"), jadi akun lama maupun baru sama-sama bisa diverifikasi.
async function verifyPassword(password, salt, storedHash) {
  if (typeof storedHash === "string" && storedHash.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    const iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
      keyMaterial,
      256
    );
    const hashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `pbkdf2$${iterations}$${hashHex}` === storedHash;
  }
  // Format lama (64 karakter hex, SHA-256 satu putaran, tanpa awalan)
  const legacyHash = await hashPasswordLegacySHA256(password, salt);
  return legacyHash === storedHash;
}

/* ---------------- Validation ---------------- */

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validatePhoneID(phone) {
  const cleaned = phone.replace(/[\s-]/g, "");
  return /^(\+62|62|0)8[1-9][0-9]{6,10}$/.test(cleaned);
}

function validatePasswordPolicy(pw) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(pw);
}

function validateNIP(nip) {
  const cleaned = nip.replace(/\s/g, "");
  return /^\d{6,20}$/.test(cleaned);
}

/* ---------------- Auth actions ---------------- */

function isLoggedIn() { return !!authState.currentUser; }

function isSuperAdmin() { return isLoggedIn() && authState.currentUser.role === "Super Admin"; }

function requireSuperAdmin(actionLabel) {
  if (isSuperAdmin()) return true;
  toast(`Hanya Super Admin yang dapat ${actionLabel}.`, "danger");
  if (!isLoggedIn()) setView("auth");
  return false;
}

function requireLogin(actionLabel) {
  if (isLoggedIn()) return true;
  toast(`Silakan masuk terlebih dahulu untuk ${actionLabel}.`, "danger");
  setView("auth");
  return false;
}

/* Registrasi akun baru sekarang HANYA dapat dilakukan oleh Super Admin lewat menu
   Manajemen Pengguna (lihat adminCreateUser di bawah). Pendaftaran mandiri publik
   sengaja tidak lagi disediakan di halaman Masuk. */

/* ---------------- Rate limiting percobaan login (mitigasi brute-force) ----------------
   CATATAN: ini pembatasan di sisi browser (localStorage per-perangkat), jadi bukan
   pengaman sempurna — orang yang membuka Console browser masih bisa menghapus
   localStorage untuk mengatur ulang hitungannya. Untuk perlindungan brute-force yang
   sesungguhnya, autentikasi perlu dipindah ke server (lihat README bagian "Langkah
   Keamanan Lanjutan"). Namun ini tetap menaikkan biaya serangan otomatis lewat form
   login biasa. */
const LOGIN_ATTEMPTS_KEY = "siwasdik_login_attempts_v1";

function getLoginAttempts(key) {
  try {
    const all = JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || "{}");
    return all[key] || { count: 0, lockUntil: 0 };
  } catch (e) { return { count: 0, lockUntil: 0 }; }
}
function setLoginAttempts(key, data) {
  try {
    const all = JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || "{}");
    all[key] = data;
    localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(all));
  } catch (e) { /* noop */ }
}
function clearLoginAttempts(key) {
  try {
    const all = JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || "{}");
    delete all[key];
    localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(all));
  } catch (e) { /* noop */ }
}

async function loginUser(usernameOrEmail, password) {
  const key = (usernameOrEmail || "").trim().toLowerCase();
  if (!key || !password) throw new Error("Isi email/nama dan password.");

  const attempts = getLoginAttempts(key);
  if (attempts.lockUntil && Date.now() < attempts.lockUntil) {
    const sisaDetik = Math.ceil((attempts.lockUntil - Date.now()) / 1000);
    throw new Error(`Terlalu banyak percobaan gagal. Coba lagi dalam ${sisaDetik} detik.`);
  }

  const user = authState.users.find(
    (u) => u.email.toLowerCase() === key || u.nama_lengkap.toLowerCase() === key
  );
  const valid = user ? await verifyPassword(password, user.salt, user.password_hash) : false;

  if (!user || !valid) {
    const count = (attempts.count || 0) + 1;
    let lockUntil = 0;
    if (count >= 5) {
      const lockSeconds = Math.min(30 * Math.pow(2, count - 5), 3600); // 30s, 60s, 120s… maks 1 jam
      lockUntil = Date.now() + lockSeconds * 1000;
    }
    setLoginAttempts(key, { count, lockUntil });
    throw new Error(user ? "Password salah." : "Akun tidak ditemukan.");
  }

  clearLoginAttempts(key);
  authState.currentUser = user;
  saveSession(user.id);
  return user;
}

async function forceChangePassword(newPassword, confirmPassword) {
  const user = authState.currentUser;
  if (!user) throw new Error("Anda belum masuk.");
  if (!validatePasswordPolicy(newPassword)) throw new Error("Password minimal 8 karakter dan harus gabungan huruf, angka, dan simbol.");
  if (newPassword !== confirmPassword) throw new Error("Konfirmasi password tidak sama.");
  const salt = genSalt();
  user.password_hash = await hashPassword(newPassword, salt);
  user.salt = salt;
  user.must_change_password = false;
  user.updated_at = new Date().toISOString();
  saveUsers();
  if (typeof syncAuthUserViaEdgeFunction === "function") {
    syncAuthUserViaEdgeFunction("reset_password", user.email, newPassword);
  }
  return user;
}

function logoutUser() {
  authState.currentUser = null;
  clearSession();
}

async function updateProfile({ nama_lengkap, nip, email, no_hp }) {
  const user = authState.currentUser;
  if (!user) throw new Error("Anda belum masuk.");
  nama_lengkap = (nama_lengkap || "").trim();
  nip = (nip || "").trim();
  email = (email || "").trim().toLowerCase();
  no_hp = (no_hp || "").trim();

  if (!nama_lengkap) throw new Error("Nama lengkap wajib diisi.");
  if (!validateNIP(nip)) throw new Error("NIP tidak valid — gunakan 6–20 digit angka.");
  if (!validateEmail(email)) throw new Error("Format email tidak valid.");
  if (!validatePhoneID(no_hp)) throw new Error("Nomor HP tidak valid — gunakan format Indonesia, contoh 08123456789.");
  if (authState.users.some((u) => u.id !== user.id && u.email.toLowerCase() === email)) throw new Error("Email sudah dipakai akun lain.");
  if (authState.users.some((u) => u.id !== user.id && u.nip === nip)) throw new Error("NIP sudah dipakai akun lain.");

  user.nama_lengkap = nama_lengkap;
  user.nip = nip;
  user.email = email;
  user.no_hp = no_hp;
  user.updated_at = new Date().toISOString();
  saveUsers();
  return user;
}

async function changePassword(oldPassword, newPassword, confirmPassword) {
  const user = authState.currentUser;
  if (!user) throw new Error("Anda belum masuk.");
  const oldValid = await verifyPassword(oldPassword, user.salt, user.password_hash);
  if (!oldValid) throw new Error("Password lama salah.");
  if (!validatePasswordPolicy(newPassword)) throw new Error("Password baru minimal 8 karakter dan harus gabungan huruf, angka, dan simbol.");
  if (newPassword !== confirmPassword) throw new Error("Konfirmasi password baru tidak sama.");
  const salt = genSalt();
  user.password_hash = await hashPassword(newPassword, salt);
  user.salt = salt;
  user.updated_at = new Date().toISOString();
  saveUsers();
  if (typeof syncAuthUserViaEdgeFunction === "function") {
    syncAuthUserViaEdgeFunction("reset_password", user.email, newPassword);
  }
  return user;
}

/* ---------------- Nav / view wiring ---------------- */

function updateAuthNav() {
  const loggedIn = isLoggedIn();
  document.getElementById("navAuth").style.display = loggedIn ? "none" : "flex";
  document.getElementById("navProfil").style.display = loggedIn ? "flex" : "none";
  document.getElementById("navLogout").style.display = loggedIn ? "flex" : "none";
  document.getElementById("navUserMgmt").style.display = isSuperAdmin() ? "flex" : "none";
  if (loggedIn) {
    document.getElementById("navProfilName").textContent = authState.currentUser.nama_lengkap.split(" ")[0];
  }
}

/* ---------------- Remember Me ----------------
   CATATAN KEAMANAN: versi sebelumnya menyimpan password ASLI (plaintext) di
   localStorage supaya bisa mengisi ulang form otomatis — artinya siapa pun yang
   membuka DevTools di perangkat itu bisa membaca password akun asli. Sekarang
   yang disimpan adalah TOKEN ACAK sekali pakai (bukan password), dan tokennya
   diverifikasi lewat hash tersimpan di data akun (mirip cara password diverifikasi,
   tapi terpisah dari password asli). Login jadi otomatis (bukan sekadar mengisi
   ulang form) begitu token cocok, dan token bisa dicabut kapan saja lewat menu
   Profil → "Lupakan Perangkat Ini". */

const REMEMBER_KEY = "siwasdik_remember_v1";

function genRememberToken() {
  const r = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  return r() + r();
}

async function saveRememberedSession(user) {
  const token = genRememberToken();
  const salt = genSalt();
  user.remember_token_hash = await hashPassword(token, salt);
  user.remember_token_salt = salt;
  user.updated_at = new Date().toISOString();
  saveUsers();
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ userId: user.id, token }));
}

function clearRememberedCredentials() {
  localStorage.removeItem(REMEMBER_KEY);
}

async function tryAutoLoginFromRemember() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return false;
    const { userId, token } = JSON.parse(raw);
    const user = authState.users.find((u) => u.id === userId);
    if (!user || !user.remember_token_hash) { clearRememberedCredentials(); return false; }
    const tokenValid = await verifyPassword(token, user.remember_token_salt, user.remember_token_hash);
    if (!tokenValid) { clearRememberedCredentials(); return false; }
    authState.currentUser = user;
    saveSession(user.id);
    return true;
  } catch (e) {
    return false;
  }
}

// Mengembalikan form Masuk ke kondisi default (kosong) — dipanggil saat pertama
// kali dimuat (bila auto-login gagal/tidak ada) dan setiap kali pengguna logout.
// Kotak "Ingat saya" dicentang otomatis jika perangkat ini masih punya token
// tersimpan, sebagai indikator visual saja.
function resetLoginFormToDefault() {
  const userField = document.getElementById("loginUsername");
  const passField = document.getElementById("loginPassword");
  const rememberBox = document.getElementById("rememberMeCheckbox");
  if (!userField || !passField || !rememberBox) return;
  userField.value = "";
  passField.value = "";
  rememberBox.checked = !!localStorage.getItem(REMEMBER_KEY);
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;
  const remember = document.getElementById("rememberMeCheckbox")?.checked;
  const btn = document.getElementById("btnDoLogin");
  btn.disabled = true; btn.textContent = "Memproses…";
  try {
    const user = await loginUser(username, password);
    if (remember) await saveRememberedSession(user);
    else clearRememberedCredentials();
    completeLoginFlow(user);
  } catch (err) {
    toast(err.message, "danger");
  } finally {
    btn.disabled = false; btn.textContent = "Masuk";
  }
}

// Dipanggil setelah login berhasil (baik lewat form maupun auto-login "Ingat saya").
// Jika akun ini masih memakai password sementara (mis. password Super Admin yang
// baru dibuat otomatis), pengguna WAJIB menggantinya dulu sebelum lanjut.
function completeLoginFlow(user) {
  updateAuthNav();
  if (user.must_change_password) {
    openForceChangePasswordOverlay();
  } else {
    toast(`Selamat datang, ${user.nama_lengkap.split(" ")[0]}.`);
    setView("dashboard");
  }
}

function openForceChangePasswordOverlay() {
  document.getElementById("fcpNewPw").value = "";
  document.getElementById("fcpNewPw2").value = "";
  document.getElementById("forceChangePwOverlay").classList.add("open");
}

async function submitForceChangePassword(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSubmitForceChangePw");
  btn.disabled = true;
  try {
    const user = await forceChangePassword(
      document.getElementById("fcpNewPw").value,
      document.getElementById("fcpNewPw2").value
    );
    document.getElementById("forceChangePwOverlay").classList.remove("open");
    toast(`Password berhasil diganti. Selamat datang, ${user.nama_lengkap.split(" ")[0]}.`);
    setView("dashboard");
  } catch (err) {
    toast(err.message, "danger");
  } finally {
    btn.disabled = false;
  }
}

function doLogout() {
  logoutUser();
  updateAuthNav();
  resetLoginFormToDefault();
  toast("Anda telah keluar.");
  setView("dashboard");
}

/* ---------------- Profile view ---------------- */

function renderProfilView() {
  const u = authState.currentUser;
  if (!u) return;
  document.getElementById("profilBody").innerHTML = `
    <div class="integration-card">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
        <div class="avatar-circle">${esc(initialsOf(u.nama_lengkap))}</div>
        <div>
          <h3 style="margin:0;">${esc(u.nama_lengkap)}</h3>
          <div class="sub" style="margin:2px 0 0;">${esc(u.role)} · Terdaftar sejak ${fmtDate(u.created_at.slice(0,10))}</div>
        </div>
      </div>

      <div class="section-divider"><span>Data Akun</span></div>
      <div class="form-grid" style="margin-top:12px;">
        <div class="field"><label>Nama Lengkap</label><input id="pfNama" type="text" value="${esc(u.nama_lengkap)}"></div>
        <div class="field"><label>NIP</label><input id="pfNip" type="text" value="${esc(u.nip)}"></div>
        <div class="field"><label>Email</label><input id="pfEmail" type="email" value="${esc(u.email)}"></div>
        <div class="field"><label>No HP</label><input id="pfHp" type="text" value="${esc(u.no_hp)}"></div>
      </div>
      <div class="approval-actions">
        <button class="btn btn-primary" onclick="submitProfileUpdate()">Simpan Perubahan</button>
      </div>

      <div class="section-divider" style="margin-top:22px;"><span>Ubah Password</span></div>
      <div class="form-grid" style="margin-top:12px;">
        <div class="field full"><label>Password Lama</label><input id="pfOldPw" type="password" placeholder="••••••••"></div>
        <div class="field"><label>Password Baru</label><input id="pfNewPw" type="password" placeholder="Min. 8 karakter, huruf+angka+simbol"></div>
        <div class="field"><label>Konfirmasi Password Baru</label><input id="pfNewPw2" type="password" placeholder="Ulangi password baru"></div>
      </div>
      <div class="approval-actions">
        <button class="btn btn-gold" onclick="submitPasswordChange()">Ubah Password</button>
      </div>

      ${localStorage.getItem(REMEMBER_KEY) ? `
      <div class="section-divider" style="margin-top:22px;"><span>Perangkat Ini</span></div>
      <p class="helper-text" style="margin-top:10px;">Perangkat/browser ini sedang menyimpan info "Ingat saya" sehingga login otomatis tanpa perlu memasukkan password lagi.</p>
      <div class="approval-actions">
        <button class="btn btn-ghost" onclick="forgetThisDevice()">Lupakan Perangkat Ini</button>
      </div>` : ""}

      <p class="helper-text" style="margin-top:18px;">Tanggal dibuat: ${fmtDate(u.created_at.slice(0,10))} · Terakhir diperbarui: ${fmtDate(u.updated_at.slice(0,10))}</p>
    </div>`;
}

async function forgetThisDevice() {
  const user = authState.currentUser;
  if (user) {
    delete user.remember_token_hash;
    delete user.remember_token_salt;
    user.updated_at = new Date().toISOString();
    saveUsers();
  }
  clearRememberedCredentials();
  toast("Perangkat ini tidak akan lagi login otomatis.");
  renderProfilView();
}

function initialsOf(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

async function submitProfileUpdate() {
  try {
    await updateProfile({
      nama_lengkap: document.getElementById("pfNama").value,
      nip: document.getElementById("pfNip").value,
      email: document.getElementById("pfEmail").value,
      no_hp: document.getElementById("pfHp").value,
    });
    toast("Profil berhasil diperbarui.");
    updateAuthNav();
    renderProfilView();
  } catch (err) {
    toast(err.message, "danger");
  }
}

async function submitPasswordChange() {
  try {
    await changePassword(
      document.getElementById("pfOldPw").value,
      document.getElementById("pfNewPw").value,
      document.getElementById("pfNewPw2").value
    );
    toast("Password berhasil diubah.");
    renderProfilView();
  } catch (err) {
    toast(err.message, "danger");
  }
}

/* ---------------- Export / Import: Data Pengguna ---------------- */

function toUserExportRows() {
  return authState.users.map((u) => {
    const row = {};
    USER_HEADER_MAP.forEach(([header, field]) => { row[header] = u[field] ?? ""; });
    return row;
  });
}

function exportUsersJSON() {
  const blob = new Blob([JSON.stringify(authState.users, null, 2)], { type: "application/json" });
  downloadBlob(blob, `pengguna-siwasdik-${todayISO()}.json`);
  toast("Data pengguna berhasil diekspor ke JSON.");
}

async function exportUsersExcel() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(toUserExportRows());
  ws["!cols"] = USER_HEADER_MAP.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data Pengguna");
  XLSX.writeFile(wb, `pengguna-siwasdik-${todayISO()}.xlsx`);
  toast("Data pengguna berhasil diekspor ke Excel (.xlsx).");
}

async function exportUsersCSV() {
  await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka Excel. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
  const ws = XLSX.utils.json_to_sheet(toUserExportRows());
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `pengguna-siwasdik-${todayISO()}.csv`);
  toast("Data pengguna berhasil diekspor ke CSV.");
}

function usersFromSheetObjects(objects) {
  const reverseMap = {};
  USER_HEADER_MAP.forEach(([header, field]) => { reverseMap[header.toLowerCase().trim()] = field; });
  return objects.map((obj) => {
    const row = {};
    Object.entries(obj).forEach(([key, val]) => {
      const field = reverseMap[String(key).toLowerCase().trim()];
      if (field) row[field] = val === undefined || val === null ? "" : String(val).trim();
    });
    return row;
  });
}

function finalizeImportedUsers(rows) {
  let id = nextUserId();
  return rows
    .filter((r) => r.email && r.password_hash && r.salt)
    .map((r, i) => ({
      id: r.id ? Number(r.id) : id + i,
      nama_lengkap: r.nama_lengkap || "",
      nip: r.nip || "",
      email: (r.email || "").toLowerCase(),
      no_hp: r.no_hp || "",
      role: r.role || "Pegawai",
      password_hash: r.password_hash,
      salt: r.salt,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    }));
}

function applyImportedUsers(rows, label) {
  if (!rows.length) { toast("Tidak ada baris akun valid ditemukan di file (kolom Password Hash/Salt wajib ada).", "danger"); return; }
  const mode = document.querySelector('input[name="importUserMode"]:checked')?.value || "merge";
  if (mode === "replace") {
    authState.users = rows;
  } else {
    // merge: timpa berdasarkan email yang sama, tambahkan yang baru
    rows.forEach((incoming) => {
      const idx = authState.users.findIndex((u) => u.email === incoming.email);
      if (idx >= 0) authState.users[idx] = { ...authState.users[idx], ...incoming, id: authState.users[idx].id };
      else authState.users.push(incoming);
    });
  }
  saveUsers();
  toast(`Berhasil mengimpor ${rows.length} akun dari ${label}.`);
}

async function importUsersFile(file) {
  if (!requireSuperAdmin("mengimpor file akun pengguna")) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Format tidak sesuai");
        applyImportedUsers(finalizeImportedUsers(parsed), "JSON");
      } catch (err) { toast("Gagal mengimpor: format JSON tidak valid.", "danger"); }
    };
    reader.readAsText(file);
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    await ensureXlsxLoaded();
  if (typeof XLSX === "undefined") { toast("Gagal memuat pustaka impor. Periksa koneksi internet lalu coba lagi.", "danger"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const objects = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const rows = finalizeImportedUsers(usersFromSheetObjects(objects));
        applyImportedUsers(rows, name.endsWith(".csv") ? "CSV" : "Excel");
      } catch (err) { console.error(err); toast("Gagal membaca file pengguna.", "danger"); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    toast("Format file tidak didukung. Gunakan .xlsx, .csv, atau .json.", "danger");
  }
}

/* ---------------- Google Sheets: tab "Users" ---------------- */

async function exportUsersToGoogleSheet(silent) {
  if (!silent && !requireSuperAdmin("mengekspor data pengguna ke Google Sheets")) return;
  const s = state.settings;
  if (!s.googleSpreadsheetId) { if (!silent) toast("Isi Spreadsheet ID terlebih dahulu di atas.", "danger"); return; }
  if (!state.googleToken) { if (!silent) toast("Hubungkan akun Google terlebih dahulu.", "danger"); return; }
  const sheetName = s.googleUsersSheetName || "Users";
  try {
    const header = USER_HEADER_MAP.map(([h]) => h);
    const rows = authState.users.map((u) => USER_HEADER_MAP.map(([, field]) => (u[field] ?? "").toString()));
    const values = [header, ...rows];
    const range = `${sheetName}!A1`;
    await sheetsApiFetch(`${s.googleSpreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:Z100000:clear`, { method: "POST", body: "{}" });
    await sheetsApiFetch(`${s.googleSpreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    });
    if (!silent) toast(`Berhasil menulis ${authState.users.length} akun ke Google Sheets (tab "${sheetName}").`);
  } catch (err) {
    console.error(err);
    if (!silent) toast("Gagal mengekspor data pengguna: " + err.message, "danger");
  }
}

async function importUsersFromGoogleSheet() {
  if (!requireSuperAdmin("mengimpor data pengguna dari Google Sheets")) return;
  const s = state.settings;
  if (!s.googleSpreadsheetId) { toast("Isi Spreadsheet ID terlebih dahulu di atas.", "danger"); return; }
  if (!state.googleToken) { toast("Hubungkan akun Google terlebih dahulu.", "danger"); return; }
  const sheetName = s.googleUsersSheetName || "Users";
  try {
    const range = `${sheetName}!A1:Z100000`;
    const data = await sheetsApiFetch(`${s.googleSpreadsheetId}/values/${encodeURIComponent(range)}`, { method: "GET" });
    const values = data.values || [];
    if (values.length < 2) { toast("Sheet pengguna kosong atau belum ada.", "danger"); return; }
    const [header, ...body] = values;
    const objects = body.map((rowArr) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = rowArr[i] ?? ""; });
      return obj;
    });
    applyImportedUsers(finalizeImportedUsers(usersFromSheetObjects(objects)), "Google Sheets");
  } catch (err) {
    console.error(err);
    toast("Gagal mengimpor data pengguna: " + err.message, "danger");
  }
}

/* ---------------- Manajemen Pengguna (khusus Super Admin) ---------------- */

let userMgmtEditingId = null;
let userMgmtDeletingId = null;

function renderUserMgmtView() {
  if (!isSuperAdmin()) return;
  const rows = authState.users.slice().sort((a, b) => a.id - b.id);
  document.getElementById("userMgmtCount").textContent = `${rows.length} akun terdaftar`;
  document.getElementById("userMgmtBody").innerHTML = rows.length ? rows.map((u) => `
    <tr>
      <td class="cell-title">${esc(u.nama_lengkap)}<small>${esc(u.email)}</small></td>
      <td>${esc(u.nip)}</td>
      <td>${esc(u.no_hp)}</td>
      <td><span class="pill ${u.role === "Super Admin" ? "pill-tinggi" : "pill-rendah"}">${esc(u.role)}</span></td>
      <td>${fmtDate(u.created_at.slice(0, 10))}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" title="Ubah" onclick="openUserMgmtForm(${u.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" title="Reset Password" onclick="openUserMgmtResetPw(${u.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </button>
          <button class="icon-btn danger" title="Hapus" onclick="confirmUserMgmtDelete(${u.id})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("") : `<tr><td colspan="6"><div class="empty-state"><h4>Belum ada akun</h4><p>Tambahkan akun pengguna baru lewat tombol di atas.</p></div></td></tr>`;
}

function openUserMgmtForm(id) {
  if (!requireSuperAdmin("mengelola akun pengguna")) return;
  userMgmtEditingId = id || null;
  const u = id ? authState.users.find((x) => x.id === id) : null;
  const selectedPicNames = (u && Array.isArray(u.pic_names)) ? u.pic_names : [];
  const picNamesChecklist = REF.pic.map((namaPic) => `
    <label style="display:flex;align-items:center;gap:6px;font-weight:400;">
      <input type="checkbox" class="umPicName" value="${esc(namaPic)}" ${selectedPicNames.includes(namaPic) ? "checked" : ""}>
      ${esc(namaPic)}
    </label>`).join("");
  document.getElementById("userMgmtDrawerTitle").textContent = id ? "Ubah Akun Pengguna" : "Tambah Akun Pengguna Baru";
  document.getElementById("userMgmtDrawerBody").innerHTML = `
    <div class="form-grid">
      <div class="field full"><label>Nama Lengkap</label><input id="umNama" type="text" value="${esc(u?.nama_lengkap || "")}"></div>
      <div class="field"><label>NIP</label><input id="umNip" type="text" value="${esc(u?.nip || "")}"></div>
      <div class="field"><label>No HP</label><input id="umHp" type="text" value="${esc(u?.no_hp || "")}"></div>
      <div class="field full"><label>Email</label><input id="umEmail" type="email" value="${esc(u?.email || "")}"></div>
      <div class="field full">
        <label>Role</label>
        <select id="umRole">
          <option value="Pegawai" ${(!u || u.role === "Pegawai") ? "selected" : ""}>Pegawai</option>
          <option value="Super Admin" ${u?.role === "Super Admin" ? "selected" : ""}>Super Admin</option>
        </select>
      </div>
      <div class="field full">
        <label>Nama PIC yang diwakili akun ini</label>
        <p class="helper-text" style="margin-top:-4px;margin-bottom:6px;">Menentukan tugas mana saja yang boleh diubah/dihapus akun ini (selain Super Admin, yang boleh semua).</p>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;">
          ${picNamesChecklist}
        </div>
      </div>
      ${!id ? `
        <div class="field"><label>Password</label><input id="umPassword" type="password" placeholder="Min. 8 karakter"></div>
        <div class="field"><label>Konfirmasi Password</label><input id="umConfirmPassword" type="password" placeholder="Ulangi password"></div>
        <p class="helper-text full" style="grid-column:1/-1;margin-top:-8px;">Password minimal 8 karakter dan harus gabungan huruf, angka, dan simbol.</p>
      ` : ""}
    </div>`;
  document.getElementById("userMgmtFormOverlay").classList.add("open");
}

function closeUserMgmtForm() {
  document.getElementById("userMgmtFormOverlay").classList.remove("open");
  userMgmtEditingId = null;
}

async function submitUserMgmtForm(e) {
  e.preventDefault();
  const get = (id) => document.getElementById(id)?.value || "";
  const getPicNames = () => Array.from(document.querySelectorAll(".umPicName:checked")).map((el) => el.value);
  const btn = document.getElementById("btnSaveUserMgmt");
  btn.disabled = true;
  try {
    if (userMgmtEditingId) {
      await adminUpdateUser(userMgmtEditingId, {
        nama_lengkap: get("umNama"), nip: get("umNip"), email: get("umEmail"), no_hp: get("umHp"), role: get("umRole"),
        pic_names: getPicNames(),
      });
      toast("Akun pengguna berhasil diperbarui.");
    } else {
      await adminCreateUser({
        nama_lengkap: get("umNama"), nip: get("umNip"), email: get("umEmail"), no_hp: get("umHp"), role: get("umRole"),
        password: get("umPassword"), confirmPassword: get("umConfirmPassword"),
        pic_names: getPicNames(),
      });
      toast("Akun pengguna baru berhasil ditambahkan.");
    }
    closeUserMgmtForm();
    renderUserMgmtView();
    updateAuthNav();
  } catch (err) {
    toast(err.message, "danger");
  } finally {
    btn.disabled = false;
  }
}

async function adminCreateUser({ nama_lengkap, nip, email, no_hp, role, password, confirmPassword, pic_names }) {
  if (!isSuperAdmin()) throw new Error("Hanya Super Admin yang dapat menambahkan akun pengguna.");
  nama_lengkap = (nama_lengkap || "").trim();
  nip = (nip || "").trim();
  email = (email || "").trim().toLowerCase();
  no_hp = (no_hp || "").trim();
  role = role === "Super Admin" ? "Super Admin" : "Pegawai";

  if (!nama_lengkap) throw new Error("Nama lengkap wajib diisi.");
  if (!validateNIP(nip)) throw new Error("NIP tidak valid — gunakan 6–20 digit angka.");
  if (!validateEmail(email)) throw new Error("Format email tidak valid.");
  if (!validatePhoneID(no_hp)) throw new Error("Nomor HP tidak valid — gunakan format Indonesia, contoh 08123456789.");
  if (!validatePasswordPolicy(password)) throw new Error("Password minimal 8 karakter dan harus gabungan huruf, angka, dan simbol.");
  if (password !== confirmPassword) throw new Error("Konfirmasi password tidak sama.");
  if (authState.users.some((u) => u.email.toLowerCase() === email)) throw new Error("Email sudah terdaftar.");
  if (authState.users.some((u) => u.nip === nip)) throw new Error("NIP sudah terdaftar.");

  const salt = genSalt();
  const password_hash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  authState.users.push({
    id: nextUserId(), nama_lengkap, nip, email, no_hp, role,
    pic_names: Array.isArray(pic_names) ? pic_names : [],
    password_hash, salt, created_at: now, updated_at: now,
  });
  saveUsers();
  if (typeof syncAuthUserViaEdgeFunction === "function") {
    syncAuthUserViaEdgeFunction("create", email, password);
  }
}

async function adminUpdateUser(id, { nama_lengkap, nip, email, no_hp, role, pic_names }) {
  if (!isSuperAdmin()) throw new Error("Hanya Super Admin yang dapat mengubah akun pengguna.");
  const u = authState.users.find((x) => x.id === id);
  if (!u) throw new Error("Akun tidak ditemukan.");
  nama_lengkap = (nama_lengkap || "").trim();
  nip = (nip || "").trim();
  email = (email || "").trim().toLowerCase();
  no_hp = (no_hp || "").trim();
  role = role === "Super Admin" ? "Super Admin" : "Pegawai";

  if (!nama_lengkap) throw new Error("Nama lengkap wajib diisi.");
  if (!validateNIP(nip)) throw new Error("NIP tidak valid — gunakan 6–20 digit angka.");
  if (!validateEmail(email)) throw new Error("Format email tidak valid.");
  if (!validatePhoneID(no_hp)) throw new Error("Nomor HP tidak valid — gunakan format Indonesia, contoh 08123456789.");
  if (authState.users.some((x) => x.id !== id && x.email.toLowerCase() === email)) throw new Error("Email sudah dipakai akun lain.");
  if (authState.users.some((x) => x.id !== id && x.nip === nip)) throw new Error("NIP sudah dipakai akun lain.");
  if (u.role === "Super Admin" && role !== "Super Admin" && authState.users.filter((x) => x.role === "Super Admin").length <= 1) {
    throw new Error("Tidak bisa menurunkan role — ini satu-satunya akun Super Admin yang tersisa.");
  }

  u.nama_lengkap = nama_lengkap; u.nip = nip; u.email = email; u.no_hp = no_hp; u.role = role;
  u.pic_names = Array.isArray(pic_names) ? pic_names : (u.pic_names || []);
  u.updated_at = new Date().toISOString();
  saveUsers();
  if (authState.currentUser && authState.currentUser.id === id) authState.currentUser = u;
}

function openUserMgmtResetPw(id) {
  if (!requireSuperAdmin("mereset password pengguna")) return;
  userMgmtEditingId = id;
  document.getElementById("umNewPw").value = "";
  document.getElementById("umNewPw2").value = "";
  document.getElementById("userMgmtResetPwOverlay").classList.add("open");
}
function closeUserMgmtResetPw() {
  document.getElementById("userMgmtResetPwOverlay").classList.remove("open");
}
async function submitUserMgmtResetPw() {
  try {
    const newPw = document.getElementById("umNewPw").value;
    const newPw2 = document.getElementById("umNewPw2").value;
    if (!validatePasswordPolicy(newPw)) throw new Error("Password minimal 8 karakter dan harus gabungan huruf, angka, dan simbol.");
    if (newPw !== newPw2) throw new Error("Konfirmasi password tidak sama.");
    const u = authState.users.find((x) => x.id === userMgmtEditingId);
    if (!u) throw new Error("Akun tidak ditemukan.");
    const salt = genSalt();
    u.password_hash = await hashPassword(newPw, salt);
    u.salt = salt;
    u.updated_at = new Date().toISOString();
    saveUsers();
    if (typeof syncAuthUserViaEdgeFunction === "function") {
      syncAuthUserViaEdgeFunction("reset_password", u.email, newPw);
    }
    toast(`Password untuk ${u.nama_lengkap} berhasil direset.`);
    closeUserMgmtResetPw();
  } catch (err) {
    toast(err.message, "danger");
  }
}

function confirmUserMgmtDelete(id) {
  if (!requireSuperAdmin("menghapus akun pengguna")) return;
  const u = authState.users.find((x) => x.id === id);
  if (!u) return;
  if (authState.currentUser && authState.currentUser.id === id) {
    toast("Tidak bisa menghapus akun yang sedang Anda gunakan untuk login.", "danger");
    return;
  }
  if (u.role === "Super Admin" && authState.users.filter((x) => x.role === "Super Admin").length <= 1) {
    toast("Tidak bisa menghapus satu-satunya akun Super Admin yang tersisa.", "danger");
    return;
  }
  userMgmtDeletingId = id;
  document.getElementById("userMgmtDeleteText").textContent =
    `Akun "${u.nama_lengkap}" (${u.email}) beserta seluruh datanya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`;
  document.getElementById("userMgmtDeleteOverlay").classList.add("open");
}
function closeUserMgmtDeleteConfirm() {
  document.getElementById("userMgmtDeleteOverlay").classList.remove("open");
  userMgmtDeletingId = null;
}
function doUserMgmtDelete() {
  if (!isSuperAdmin()) { toast("Hanya Super Admin yang dapat menghapus akun pengguna.", "danger"); closeUserMgmtDeleteConfirm(); return; }
  authState.users = authState.users.filter((x) => x.id !== userMgmtDeletingId);
  saveUsers();
  closeUserMgmtDeleteConfirm();
  renderUserMgmtView();
  toast("Akun pengguna berhasil dihapus.", "danger");
}

function initUserMgmt() {
  document.getElementById("btnAddUserMgmt")?.addEventListener("click", () => openUserMgmtForm(null));
  document.getElementById("userMgmtDrawerForm")?.addEventListener("submit", submitUserMgmtForm);
  document.getElementById("btnCloseUserMgmtDrawer")?.addEventListener("click", closeUserMgmtForm);
  document.getElementById("btnCancelUserMgmtForm")?.addEventListener("click", closeUserMgmtForm);
  document.getElementById("userMgmtFormOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "userMgmtFormOverlay") closeUserMgmtForm();
  });

  document.getElementById("btnCancelUserMgmtResetPw")?.addEventListener("click", closeUserMgmtResetPw);
  document.getElementById("btnConfirmUserMgmtResetPw")?.addEventListener("click", submitUserMgmtResetPw);
  document.getElementById("userMgmtResetPwOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "userMgmtResetPwOverlay") closeUserMgmtResetPw();
  });

  document.getElementById("btnCancelUserMgmtDelete")?.addEventListener("click", closeUserMgmtDeleteConfirm);
  document.getElementById("btnConfirmUserMgmtDelete")?.addEventListener("click", doUserMgmtDelete);
  document.getElementById("userMgmtDeleteOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "userMgmtDeleteOverlay") closeUserMgmtDeleteConfirm();
  });
}

/* ---------------- Init ---------------- */

async function initAuth() {
  await loadUsers();
  await ensureSuperAdmin();
  loadSession();

  if (!isLoggedIn()) {
    const autoLoggedIn = await tryAutoLoginFromRemember();
    if (autoLoggedIn) completeLoginFlow(authState.currentUser);
  }

  updateAuthNav();
  resetLoginFormToDefault();

  document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
  document.getElementById("navLogout").addEventListener("click", doLogout);
  document.getElementById("forceChangePwForm")?.addEventListener("submit", submitForceChangePassword);

  document.getElementById("fileImportUsers")?.addEventListener("change", (e) => {
    if (e.target.files[0]) importUsersFile(e.target.files[0]);
    e.target.value = "";
  });

  initUserMgmt();

  // Tampilkan password Super Admin yang baru dibuat (hanya sekali, hanya jika
  // baru saja dibuat oleh ensureSuperAdmin() di atas — lihat catatan keamanan
  // di dekat deklarasi SUPERADMIN_USERNAME).
  if (_justGeneratedSuperAdminPassword) {
    document.getElementById("sapGeneratedPw").value = _justGeneratedSuperAdminPassword;
    document.getElementById("superadminPwOverlay").classList.add("open");
    document.getElementById("btnCopySuperadminPw")?.addEventListener("click", () => {
      const input = document.getElementById("sapGeneratedPw");
      input.select();
      navigator.clipboard?.writeText(input.value).catch(() => {});
      toast("Password disalin ke clipboard.");
    });
    document.getElementById("btnAckSuperadminPw")?.addEventListener("click", () => {
      document.getElementById("superadminPwOverlay").classList.remove("open");
      _justGeneratedSuperAdminPassword = null;
    });
  }
}
