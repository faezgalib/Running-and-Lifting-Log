# Roadmap — Lift Run Journey menjadi aplikasi native (Play Store + App Store, untuk pemilik & keluarga)

_Disepakati 17 Nov 2026. Perbarui dokumen ini setiap kali sebuah fase selesai atau target berubah._

## Context
v2.3 sudah terasa seperti aplikasi, tapi secara teknis masih **web app** yang berjalan di atas Chrome (dipasang dari link, logo Chrome sekilas saat dibuka). Pemilik ingin tahu bedanya dengan Hevy dan aplikasi lain, dan punya target jelas menuju aplikasi yang dipasang dari **Play Store dan App Store**, gratis, untuk dirinya dan keluarga (belum dijual).

---

## 1. Apa bedanya Lift Run Journey dengan Hevy (dari mendasar sampai besar)

| # | Aspek | Lift Run Journey sekarang | Hevy / aplikasi "sesungguhnya" |
|---|---|---|---|
| 1 | **Bentuk** | Web app (PWA) yang dijalankan Chrome | Aplikasi native, dipasang dari Play Store / App Store |
| 2 | **Cara pasang** | Buka link → Install app | Cari di store → Install |
| 3 | **Saat dibuka** | Kadang logo Chrome sekilas | Logo aplikasi sendiri |
| 4 | **Update** | Otomatis dari internet / tombol Check for updates | Lewat store |
| 5 | **Data** | Hanya di HP, backup manual | Akun + server, otomatis tersinkron ke HP lain |
| 6 | **Login** | Tidak ada | Ada (email/Google/Apple) |
| 7 | **Integrasi** | Tidak ada | Apple Health / Health Connect, jam tangan, Strava |
| 8 | **Konten** | Daftar gerakan sederhana | Library gerakan dengan animasi |
| 9 | **Sosial** | Tidak ada | Feed, follow, berbagi workout |
| 10 | **Operasional** | Gratis, tanpa server | Server, tim support, kebijakan privasi, badan usaha, langganan |

**Kelebihan Lift Run Journey yang tidak dimiliki Hevy:** konteks Offshore/Home/Gym, kanan-kiri terpisah, target per set berbasis RIR, rekomendasi yang memperhitungkan urutan gerakan dan long run, mobility per sisi, peta otot, offline penuh, tanpa langganan, data tidak keluar dari HP.

**Yang perlu untuk target Anda** hanya baris 1–4. Baris 5–10 adalah urusan aplikasi yang dijual ke publik, belum perlu.

---

## 2. Pendekatan: satu code, dua aplikasi native
Code yang sekarang (HTML/CSS/JS) **tidak ditulis ulang**. Code itu dibungkus menjadi aplikasi Android dan iPhone dengan **Capacitor**, alat gratis yang umum dipakai untuk ini.
- Aplikasi punya logo dan layar pembuka sendiri; tidak ada logo Chrome.
- Data disimpan di dalam aplikasi itu sendiri, tetap hanya di HP, tetap offline.
- Nanti bisa menambah fitur native (notifikasi, Health Connect / Apple Health) tanpa ganti teknologi.
- **Konsekuensi:** update tidak lagi otomatis dari internet; setiap versi baru diunggah ke store (beberapa menit untuk jalur testing keluarga).

**Distribusi untuk keluarga tanpa rilis publik:**
- **Android:** jalur *Internal testing* Play Store — undang sampai 100 email, mereka pasang dari Play Store seperti biasa. Tidak perlu syarat rilis publik.
- **iPhone:** **TestFlight** — aplikasi resmi Apple untuk versi uji; keluarga dipasang lewat undangan. Satu versi berlaku 90 hari, jadi perlu diunggah ulang paling lambat tiap ~3 bulan (bisa diotomatisasi).

---

## 3. Biaya dan registrasi (perkiraan; cek ulang di situs resmi sebelum mendaftar)

| Item | Biaya | Registrasi | Catatan |
|---|---|---|---|
| Google Play Console | **US$25 sekali bayar** (~Rp400 rb) | Akun pribadi + verifikasi identitas (KTP), nomor HP | Verifikasi bisa beberapa hari |
| Apple Developer Program | **US$99 per tahun** (~Rp1,6 jt/tahun) | Apple ID dengan 2FA, nama sesuai identitas, kartu pembayaran | Wajib untuk TestFlight/App Store |
| Komputer Mac | **Tidak perlu** | — | Build iPhone dikerjakan di server macOS milik GitHub (gratis untuk repo public) |
| Domain sendiri | Opsional, ~Rp150–500 rb/tahun | — | Tidak wajib |
| Server/database | **Rp0** | — | Data tetap di HP |
| Kebijakan privasi | Rp0 | — | Wajib oleh kedua store; satu halaman sederhana ("data tidak keluar dari HP") |

**Total tahun pertama:** sekitar **US$124 (~Rp2 jt)**, lalu **US$99/tahun** untuk Apple. Tanpa iPhone: hanya US$25 sekali.

---

## 4. Roadmap

| Fase | Isi | Waktu | Biaya | Siapa |
|---|---|---|---|---|
| **0. Stabil** | Pakai harian, catat bug dan keinginan; v2.x | Sekarang – akhir Des 2026 | Rp0 | Anda pakai, saya perbaiki |
| **1. Uji iPhone gratis** | Coba versi web di iPhone keluarga lewat Safari → Add to Home Screen; perbaiki tampilan iPhone kalau ada | ~1 minggu | Rp0 | Anda/keluarga coba, saya perbaiki |
| **2. Persiapan native** | Bungkus dengan Capacitor (folder `android/`, `ios/`), ID aplikasi, ikon & layar pembuka, halaman kebijakan privasi, pengujian ditambah, uji pindah data via Share backup → Restore | 2–3 minggu | Rp0 | Saya |
| **3. Android di Play Store** | Daftar Play Console, unggah ke Internal testing, undang email keluarga, pindahkan data Anda (backup → restore) | 1–3 minggu (termasuk verifikasi akun) | US$25 | Anda daftar & klik, saya pandu dan siapkan file |
| **4. iPhone via TestFlight** | Daftar Apple Developer, build otomatis di server macOS GitHub, undang keluarga di TestFlight | 2–4 minggu | US$99/tahun | Anda daftar, saya siapkan build |
| **5. Fitur native (opsional)** | Pengingat backup lewat notifikasi; impor lari dari Health Connect / Apple Health (mengurangi input ganda dari Suunto) | per fitur 1–3 minggu | Rp0 | Saya, setelah diskusi |
| **6. Nanti (di luar target ini)** | Rilis publik, dijual, atau versi gym | — | — | Diputuskan terpisah |

**Target realistis:** Android dari Play Store sekitar **Januari–Februari 2027**, iPhone via TestFlight sekitar **Februari–Maret 2027**, menyesuaikan jadwal kerja pemilik (pendaftaran dan langkah di store dilakukan saat ada internet stabil).

---

## 5. Risiko yang perlu diketahui sejak awal
- **Pindah data sekali:** aplikasi dari store tidak bisa membaca data versi web. Wajib Share backup → Restore di aplikasi baru. Sudah ada dan teruji.
- **Kunci tanda tangan aplikasi:** Play Store dan Apple memakai kunci digital milik Anda. Disimpan di pengaturan rahasia GitHub, bukan di code. Hilang kunci = repot memperbarui aplikasi.
- **Review Apple:** aplikasi yang hanya "membungkus" web kadang ditolak untuk rilis publik. Untuk TestFlight internal keluarga, risikonya kecil.
- **TestFlight 90 hari:** versi iPhone kedaluwarsa kalau tidak diperbarui.
- **Versi web tetap ada** selama transisi sebagai cadangan; dimatikan atau dipertahankan setelah aplikasi store stabil.

---

## 6. Status
- [ ] Fase 0 — Stabil (berjalan, v2.3)
- [ ] Fase 1 — Uji iPhone gratis
- [ ] Fase 2 — Persiapan native
- [ ] Fase 3 — Android di Play Store
- [ ] Fase 4 — iPhone via TestFlight
- [ ] Fase 5 — Fitur native (opsional)

## Target tercapai bila
Roadmap dianggap tercapai bila: (1) Anda memasang Lift Run Journey dari Play Store tanpa logo Chrome, (2) keluarga dengan iPhone memasangnya dari TestFlight, (3) data Anda pindah utuh, (4) semua pengujian di `tests/` tetap lolos untuk versi native.
