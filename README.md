# Warga Survivor

Board game multiplayer satir (2–5 pemain) bertema bertahan hidup sebagai warga +62.
Semua nama, kartu, dan teks di game ini orisinal. Mekanik roll-and-move + properti adalah genre umum, bukan milik siapa pun.

## Jalankan lokal
```
npm install
npm start          # http://localhost:3000
```
Satu orang klik **Buat Ruangan**, bagikan kode 4 huruf atau link `/?room=KODE` ke teman, host klik **Mulai**.

## Agar orang lain bisa main (wajib di-hosting)
Game ini butuh server yang hidup terus karena memakai WebSocket. Hosting statis (GitHub Pages, Netlify biasa) TIDAK cukup.
Pilihan: Render, Railway, Fly.io, atau VPS.
- Render: New > Web Service > upload repo ini ke GitHub. Build command `npm install`, Start command `npm start`. HTTPS dan WebSocket otomatis jalan.
- Paket gratis Render tidur setelah idle; pemain pertama menunggu ~30-60 detik. Semua ruangan hilang saat server restart (state disimpan di memori).

## Aturan
- Modal awal Rp8.000.000. Lewat atau mendarat di Gajian: +Rp700.000.
- Lempar dadu, jalan searah jarum jam. Tanah kosong bisa dibeli (tanpa lelang). Tanah orang = bayar sewa.
- Punya 2 tanah satu warna = sewa tanah kosong x2 dan boleh bangun rumah (maks 3, dibangun merata, bisa saat giliranmu).
- Dadu kembar = lempar lagi. Kembar 3x berturut-turut = ke Bekasi.
- Bekasi: lempar kembar untuk kabur, bayar damai Rp1.000.000, atau pakai kartu "orang dalam". Gagal 3x = otomatis bayar lalu keluar.
- Kartu Takdir/Musibah, Pajak, Tilang, Pungli, Pemilu, Digoreng Netizen (langsung ke Bekasi).
- Uang tidak cukup = bangkrut, aset pindah ke penagih (atau kembali ke negara). Pemain terakhir yang tersisa menang.
- Giliran lebih dari 75 detik = aksi otomatis. Pemain offline di-autoplay cepat. Refresh halaman aman (sesi tersimpan).

## Sesuaikan
- Kartu: objek `CARDS` di `server.js`. Petak/harga: array `BOARD`.
- Keseimbangan: `START_MONEY`, `GAJIAN` (atau env `GAJIAN`), `TEBUS`.
- Tes otomatis 3 bot: `MIN_GAP=0 npm test`

## Belum ada
Lelang, gadai, tukar-menukar properti, akun/login, simpanan permanen, dan suara. Versi ini sengaja minimal.
