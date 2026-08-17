/* =========================================================
   SIMANJA — realtime-sync.js
   Sinkronisasi lintas perangkat & lintas pengguna secara REAL-TIME,
   memakai Supabase (Postgres + Realtime) sebagai "database bersama".

   CARA MENGAKTIFKAN (sekali saja, oleh Super Admin/pengelola aplikasi):
   1. Buat project gratis di https://supabase.com
   2. Buka SQL Editor pada project tsb, jalankan isi file `supabase-schema.sql`
      (satu folder dengan file ini) — ini membuat tabel & mengaktifkan Realtime.
   3. Buka Project Settings → API, salin "Project URL" dan "anon public" key.
   4. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di bawah ini, lalu commit/push
      (atau upload ulang) perubahan tsb agar semua pengguna memakai server
      yang sama.

   Jika kedua nilai di bawah dibiarkan kosong, aplikasi tetap berjalan seperti
   sebelumnya (localStorage per-browser saja, TIDAK ada sinkronisasi lintas
   perangkat) — tidak ada yang rusak.

   CATATAN KEAMANAN: sama seperti kredensial Super Admin bawaan di auth.js,
   SUPABASE_ANON_KEY ini akan terlihat oleh siapa pun yang membuka source
   code aplikasi (karena aplikasi berjalan 100% di browser tanpa server
   rahasia). Ini BUKAN kunci rahasia (secret) — dia memang didesain publik —
   tapi karena skema di supabase-schema.sql mengizinkan baca/tulis publik ke
   tabel data, siapa pun yang tahu URL app ini juga bisa membaca/menulis data.
   Cocok untuk kebutuhan internal skala kecil, sama seperti disclaimer yang
   sudah ada di README/auth.js. Untuk kebutuhan lebih ketat, tambahkan
   Supabase Auth + kebijakan RLS berbasis user sungguhan.
   ========================================================= */

const SUPABASE_URL = "https://xldkjewrwaecnysbmllf.supabase.co";      // <-- isi: https://xxxxxxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_RC7LMjHZQf6MmLB_gWDazQ_JPxAMnFH"; // <-- isi: anon public key dari Supabase

const SYNC_TABLE_DATA = "penugasan";
const SYNC_TABLE_USERS = "app_users";
const SYNC_PUSH_DEBOUNCE_MS = 700;

const sync = {
  client: null,
  enabled: false,
  ready: false,          // true setelah pull awal berhasil sekali
  channelData: null,
  channelUsers: null,
  pushTimerData: null,
  pushTimerUsers: null,
  status: "off",          // off | connecting | on | error
};

function isSyncConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function initSyncClient() {
  if (!isSyncConfigured()) { sync.enabled = false; sync.status = "off"; return; }
  if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
    console.warn("SIMANJA: Supabase JS belum termuat (cek koneksi internet / CDN diblokir).");
    sync.enabled = false;
    sync.status = "error";
    return;
  }
  try {
    sync.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 5 } },
    });
    sync.enabled = true;
    sync.status = "connecting";
  } catch (err) {
    console.error("SIMANJA: gagal membuat klien Supabase.", err);
    sync.enabled = false;
    sync.status = "error";
  }
}

/* ---------------- Badge status di topbar ---------------- */

function setLiveSyncBadge(status) {
  sync.status = status;
  const el = document.getElementById("liveSyncBadge");
  if (!el) return;
  if (!isSyncConfigured()) {
    el.style.display = "none";
    return;
  }
  el.style.display = "inline-flex";
  const map = {
    connecting: ["Menghubungkan…", "syncing"],
    syncing: ["Menyinkronkan…", "syncing"],
    on: ["Live — tersinkron semua perangkat", "on"],
    error: ["Terputus dari server sinkronisasi", "error"],
  };
  const [label, cls] = map[status] || map.connecting;
  el.className = "integration-status sync-badge " + cls;
  el.innerHTML = `<span class="status-dot"></span> ${label}`;
}

/* ---------------- PULL: ambil data terbaru dari server ---------------- */

async function syncPullData() {
  if (!sync.enabled) return false;
  try {
    setLiveSyncBadge(sync.ready ? "syncing" : "connecting");
    const { data, error } = await sync.client
      .from(SYNC_TABLE_DATA)
      .select("id, payload")
      .order("id", { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) {
      // Bisa jadi server BENAR-BENAR kosong (instalasi baru), TAPI bisa juga
      // hasil ini kosong karena RLS memfilter semuanya sebab kita belum
      // login (tamu). Kalau sync aktif tapi kita belum punya sesi Supabase
      // Auth yang terkonfirmasi, JANGAN anggap kosong — jangan timpa dengan
      // data contoh, dan jangan coba kirim apa pun ke server (pasti gagal
      // dan hanya bikin noise di Console).
      const hasRestoredSession = typeof _restoredSupabaseSession !== "undefined" && !!_restoredSupabaseSession;
      const alreadyLoggedIn = typeof isLoggedIn === "function" && isLoggedIn();
      if (!hasRestoredSession && !alreadyLoggedIn) {
        sync.ready = true;
        setLiveSyncBadge("on");
        return true;
      }
      // Server masih kosong (pertama kali dipakai).
      if (!state.data || !state.data.length) {
        // Belum ada data lokal sama sekali (instalasi baru) → pakai data contoh awal.
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          state.data = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(SEED_DATA));
        } catch (e) {
          state.data = JSON.parse(JSON.stringify(SEED_DATA));
        }
        normalizeAll();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      }
      // Kirim data lokal/seed sbg data awal bersama ke server.
      if (state.data && state.data.length) {
        await syncPushDataNow();
      }
    } else {
      state.data = data.map((row) => row.payload);
      normalizeAll();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    }
    sync.ready = true;
    setLiveSyncBadge("on");
    return true;
  } catch (err) {
    console.error("SIMANJA: gagal menarik data penugasan dari server.", err);
    setLiveSyncBadge("error");
    return false;
  }
}

async function syncPullUsers() {
  if (!sync.enabled) return false;
  try {
    const { data, error } = await sync.client
      .from(SYNC_TABLE_USERS)
      .select("id, payload")
      .order("id", { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) {
      const hasRestoredSession = typeof _restoredSupabaseSession !== "undefined" && !!_restoredSupabaseSession;
      const alreadyLoggedIn = typeof isLoggedIn === "function" && isLoggedIn();
      if (!hasRestoredSession && !alreadyLoggedIn) return true; // tamu belum login — jangan anggap kosong, jangan kirim apa pun
      if (authState.users && authState.users.length) {
        await syncPushUsersNow();
      }
    } else {
      authState.users = data.map((row) => row.payload);
      localStorage.setItem(USERS_KEY, JSON.stringify(authState.users));
      if (authState.currentUser) {
        const stillExists = authState.users.find((u) => u.id === authState.currentUser.id);
        if (stillExists) {
          authState.currentUser = stillExists;
        } else {
          // Akun yang sedang login dihapus/diganti dari perangkat lain.
          authState.currentUser = null;
          clearSession();
        }
      }
    }
    return true;
  } catch (err) {
    console.error("SIMANJA: gagal menarik data pengguna dari server.", err);
    return false;
  }
}

/* ---------------- PUSH: kirim perubahan lokal ke server (debounced) ---------------- */

function syncPushData() {
  if (!sync.enabled) return;
  clearTimeout(sync.pushTimerData);
  sync.pushTimerData = setTimeout(syncPushDataNow, SYNC_PUSH_DEBOUNCE_MS);
}

function syncPushUsers() {
  if (!sync.enabled) return;
  clearTimeout(sync.pushTimerUsers);
  sync.pushTimerUsers = setTimeout(syncPushUsersNow, SYNC_PUSH_DEBOUNCE_MS);
}

async function syncPushDataNow() {
  if (!sync.enabled) return true;
  try {
    setLiveSyncBadge("syncing");
    const rows = state.data.map((r) => ({ id: r.id, payload: r }));
    if (rows.length) {
      const { error } = await sync.client.from(SYNC_TABLE_DATA).upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }
    const { data: remoteRows, error: selErr } = await sync.client.from(SYNC_TABLE_DATA).select("id");
    if (selErr) throw selErr;
    const localIds = new Set(state.data.map((r) => r.id));
    const toDelete = (remoteRows || []).map((r) => r.id).filter((id) => !localIds.has(id));
    if (toDelete.length) {
      const { error: delErr } = await sync.client.from(SYNC_TABLE_DATA).delete().in("id", toDelete);
      if (delErr) throw delErr;
    }
    setLiveSyncBadge("on");
    return true;
  } catch (err) {
    console.error("SIMANJA: gagal mengirim data penugasan ke server.", err);
    setLiveSyncBadge("error");
    return false;
  }
}

async function syncPushUsersNow() {
  if (!sync.enabled) return;
  try {
    const rows = authState.users.map((u) => ({ id: u.id, payload: u }));
    if (rows.length) {
      const { error } = await sync.client.from(SYNC_TABLE_USERS).upsert(rows, { onConflict: "id" });
      if (error) throw error;
    }
    const { data: remoteRows, error: selErr } = await sync.client.from(SYNC_TABLE_USERS).select("id");
    if (selErr) throw selErr;
    const localIds = new Set(authState.users.map((u) => u.id));
    const toDelete = (remoteRows || []).map((r) => r.id).filter((id) => !localIds.has(id));
    if (toDelete.length) {
      const { error: delErr } = await sync.client.from(SYNC_TABLE_USERS).delete().in("id", toDelete);
      if (delErr) throw delErr;
    }
  } catch (err) {
    console.error("SIMANJA: gagal mengirim data pengguna ke server.", err);
  }
}

/* ---------------- REALTIME: dengarkan perubahan dari perangkat/pengguna lain ---------------- */

function initRealtimeChannels() {
  if (!sync.enabled) return;

  sync.channelData = sync.client
    .channel("realtime:penugasan")
    .on("postgres_changes", { event: "*", schema: "public", table: SYNC_TABLE_DATA }, async () => {
      await syncPullData();
      if (typeof renderTable === "function") renderTable();
      if (typeof renderDashboard === "function") renderDashboard();
      if (typeof state !== "undefined" && state.view === "kalender" && typeof renderKalenderView === "function") renderKalenderView();
      if (typeof updateSidebarCounts === "function") updateSidebarCounts();
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setLiveSyncBadge("error");
      } else if (status === "SUBSCRIBED") {
        setLiveSyncBadge("on");
      }
    });

  sync.channelUsers = sync.client
    .channel("realtime:app_users")
    .on("postgres_changes", { event: "*", schema: "public", table: SYNC_TABLE_USERS }, async () => {
      const wasLoggedIn = !!authState.currentUser;
      await syncPullUsers();
      if (typeof updateAuthNav === "function") updateAuthNav();
      if (state.view === "usermgmt" && typeof renderUserMgmtView === "function") renderUserMgmtView();
      if (wasLoggedIn && !authState.currentUser) {
        toast("Sesi Anda berakhir — akun ini diubah/dihapus dari perangkat lain.", "danger");
        if (typeof setView === "function") setView("auth");
        if (typeof updateAuthNav === "function") updateAuthNav();
      } else if (state.view === "profil" && typeof renderProfilView === "function") {
        renderProfilView();
      }
    })
    .subscribe();
}
