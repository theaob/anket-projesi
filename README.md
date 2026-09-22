# 📊 Premium Poll System (Mentimeter Clone)

Kapalı ağlarda (Intranet) çalışmak üzere tasarlanmış, ultra profesyonel görünümlü, canlı anket uygulaması. 

[![Build and Push to DockerHub](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml)

## ✨ Özellikler

* **💎 Premium UI:** Glassmorphism ve modern animasyonlarla donatılmış akıcı arayüz.
* **📡 Canlı Sonuçlar:** Socket.io ile anlık grafik güncellemeleri.
* **🛠 Admin Paneli:** Anketi anlık düzenleme ve sonuçları sıfırlama yetkisi.
* **⚖️ Ağırlıklı Puanlama:** Seçeneklere rakamsal değer atayabilme ve sonuçlarda genel ortalama takibi.
* **🚀 GitHub Otomasyonu:** Versiyon kontrolü ve otomatik GitHub Release yayını.
* **📊 Excel Export:** Sonuçları tek tıkla CSV/Excel formatında indirme.
* **🔒 Kapalı Ağ Uyumu:** İnternet bağımlılığı olmadan %100 offline çalışma.
* **🐳 Docker Ready:** Tek komutla her ortamda tutarlı kurulum.

## 🚀 Hızlı Başlangıç

### Yerel Kurulum (Geliştirici Modu)
1. Bağımlılıkları yükleyin: `npm install`
2. Sunucuyu başlatın: `node server.js` (Node.js 22.13+)
3. Tarayıcıda açın: `http://localhost:3000`

### Docker ile Kurulum
```bash
docker build -t poll-app .
docker run -d -p 80:3000 -v anket-data:/app/data --restart unless-stopped --name poll-system poll-app
```

### Veri Kalıcılığı
Anketler, seçenekler, ziyaretçiler ve oylar bir SQLite veritabanında (`data/anket.db`) saklanır ve sunucu yeniden başlatıldığında geri yüklenir. Konum `DATA_DIR` ortam değişkeniyle değiştirilebilir. Node.js'in yerleşik `node:sqlite` modülü kullanıldığı için ek bir veritabanı sunucusu veya derlenmesi gereken bir paket yoktur; **Node.js 22.13 veya üzeri** gerekir.

Docker'da verinin kaybolmaması için yukarıdaki gibi `/app/data` dizinine bir volume bağlayın. Yedek almak için sunucu çalışırken bile `sqlite3 data/anket.db ".backup yedek.db"` kullanılabilir.

Önceki sürümün `data/polls.json` dosyası varsa, ilk açılışta veritabanına otomatik olarak aktarılır ve dosya `polls.json.imported` olarak yeniden adlandırılır.
