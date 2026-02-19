# 📊 Premium Poll System (Mentimeter Clone)

Kapalı ağlarda (Intranet) çalışmak üzere tasarlanmış, ultra profesyonel görünümlü, canlı anket uygulaması. 

![Project Interface](https://via.placeholder.com/800x400?text=Premium+Poll+Interface+Preview)

## ✨ Özellikler

* **💎 Premium UI:** Glassmorphism ve modern animasyonlarla donatılmış akıcı arayüz.
* **📡 Canlı Sonuçlar:** Socket.io ile anlık grafik güncellemeleri.
* **📱 QR Kod Desteği:** Sunucu IP'sini otomatik algılayan dinamik QR kod üretimi.
* **🛠 Admin Paneli:** Anketi anlık düzenleme ve sonuçları sıfırlama yetkisi.
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
docker run -d -p 80:3000 --name poll-system poll-app