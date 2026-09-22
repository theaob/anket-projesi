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
2. Sunucuyu başlatın: `node server.js`
3. Tarayıcıda açın: `http://localhost:3000`

### Docker ile Kurulum
```bash
docker build -t poll-app .
docker run -d -p 80:3000 -v anket-data:/app/data --restart unless-stopped --name poll-system poll-app
```

### Veri Kalıcılığı
Anketler ve oylar `data/polls.json` dosyasına kaydedilir (konum `DATA_DIR` ortam değişkeniyle değiştirilebilir) ve sunucu yeniden başlatıldığında geri yüklenir. Docker'da verinin kaybolmaması için yukarıdaki gibi `/app/data` dizinine bir volume bağlayın.
