# 📊 Premium Poll System (Mentimeter Clone)

Kapalı ağlarda (Intranet) çalışmak üzere tasarlanmış, ultra profesyonel görünümlü, canlı anket uygulaması. 

[![Build and Push to DockerHub](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml)

## ✨ Özellikler

* **💎 Premium UI:** Glassmorphism ve modern animasyonlarla donatılmış akıcı arayüz.
* **📡 Canlı Sonuçlar:** Socket.io ile anlık grafik güncellemeleri.
* **⏱ Oylamayı Aç/Kapat ve Zamanlayıcı:** Oylamayı elle açıp kapatın ya da süreli başlatın; süre dolunca oylama kendiliğinden kapanır ve sonuçlar herkese gösterilir.
* **🖥 Sunum Ekranı:** Projeksiyon için tam ekran canlı sonuçlar; katılım QR kodu ve anket kodu ekranda.
* **👥 Herkes Kendi Anketini Oluşturur:** Hesap gerekmez. Ana sayfadan anket oluşturan kişiye gizli bir yönetim bağlantısı verilir; anketi yalnızca bu bağlantıya sahip olanlar düzenleyebilir, sıfırlayabilir veya silebilir.
* **🚀 GitHub Otomasyonu:** Versiyon kontrolü ve otomatik GitHub Release yayını.
* **📊 Excel Export:** Sonuçları tek tıkla CSV/Excel formatında indirme.
* **🔒 Kapalı Ağ Uyumu:** İnternet bağımlılığı olmadan %100 offline çalışma.
* **🐳 Docker Ready:** Tek komutla her ortamda tutarlı kurulum.

## 🚀 Hızlı Başlangıç

### Yerel Kurulum (Geliştirici Modu)
1. Bağımlılıkları yükleyin: `npm install`
2. Sunucuyu başlatın: `node server.js` (Node.js 22.13+)
3. Tarayıcıda açın: `http://localhost:3000`

## 🗳 Kullanım
1. Ana sayfada **"Yeni anket oluştur"** düğmesine basın. Anketin yönetim sayfasına (`/manage#<gizli-anahtar>`) yönlendirilirsiniz.
2. Soruyu ve seçenekleri girip **Yayınla**'ya basın.
3. Katılımcılarla anket kodunu ya da katılım bağlantısını (`/?code=1234`) paylaşın. Kodlar 4 hanelidir; 4 haneli kodlar neredeyse tükendiğinde yeni anketlere 5 haneli kod verilir.
4. Yönetim sayfasında sonuçları canlı izleyin; oyları sıfırlayın, Excel'e aktarın veya anketi silin.
5. **Oylama** bölümünden oylamayı kapatıp açabilir ya da süreli başlatabilirsiniz (30 sn, 1, 2 veya 5 dk; süre işlerken "+30 sn" ile uzatılabilir). Süre dolunca oylama otomatik kapanır, kapalı ankette oy verilemez ve sonuçlar tüm katılımcılara gösterilir. Yeni anketler açık olarak başlar; zamanlayıcı sunucu yeniden başlatılsa da kaldığı yerden devam eder.
6. Salondaki ekran için yönetim sayfasındaki **"Sunum ekranını aç"** bağlantısını kullanın (`/present?code=1234`).

### 🖥 Sunum Ekranı
Soruyu, canlı sonuç çubuklarını, bağlı katılımcı sayısını ve katılım için bir QR kodu ile anket kodunu gösterir. Salt okunurdur ve ziyaret olarak sayılmaz; yönetim anahtarını içermediği için projeksiyonda güvenle gösterilebilir.

* **F** — tam ekran, **H** — sonuçları gizle/göster (oylama bitene kadar katılımcıları etkilememek için). Gizlenen sonuçlar oylama kapandığında otomatik olarak gösterilir.
* Zamanlayıcı çalışırken büyük bir geri sayım görünür; son 10 saniyede kırmızıya döner.
* Fare hareketsiz kaldığında düğmeler ve imleç gizlenir.
* Seçenek sayısı arttıkça yazı boyutu küçülür, gerekirse seçenekler iki sütuna bölünür.
* QR kodu sunucuda üretilir, internet bağlantısı gerekmez.

QR kodundaki adres, sunum ekranının açıldığı adresten alınır; sayfa `localhost` üzerinden açıldıysa telefonların erişebilmesi için sunucunun ağ IP adresi kullanılır. Sunucuya bir alan adı veya ters vekil (reverse proxy) üzerinden erişiliyorsa adresi `PUBLIC_URL` ortam değişkeniyle belirleyin, örneğin `PUBLIC_URL=http://anket.firma.local`.

**Yönetim bağlantısını saklayın:** anketi yönetmenin tek yolu budur ve kaybolursa geri alınamaz. Bağlantıya sahip olan herkes anketi yönetebilir, bu yüzden yalnızca birlikte yönettiğiniz kişilerle paylaşın. Aynı tarayıcıda oluşturduğunuz anketler ana sayfada "Bu tarayıcıda oluşturduğun anketler" altında listelenir. Sunucu, anahtarın yalnızca özetini (SHA-256) saklar.

Kötüye kullanımı sınırlamak için aynı adresten saatte en fazla 20 anket oluşturulabilir.

### Docker ile Kurulum
```bash
docker build -t poll-app .
docker run -d -p 80:3000 -v anket-data:/app/data --restart unless-stopped --name poll-system poll-app
```

### Veri Kalıcılığı
Anketler, seçenekler, ziyaretçiler ve oylar bir SQLite veritabanında (`data/anket.db`) saklanır ve sunucu yeniden başlatıldığında geri yüklenir. Konum `DATA_DIR` ortam değişkeniyle değiştirilebilir. Node.js'in yerleşik `node:sqlite` modülü kullanıldığı için ek bir veritabanı sunucusu veya derlenmesi gereken bir paket yoktur; **Node.js 22.13 veya üzeri** gerekir.

Docker'da verinin kaybolmaması için yukarıdaki gibi `/app/data` dizinine bir volume bağlayın. Yedek almak için sunucu çalışırken bile `sqlite3 data/anket.db ".backup yedek.db"` kullanılabilir.

Ortak admin panelli eski sürümden yükseltirken, sahibi olmayan mevcut anketler ve sonuçları veritabanından silinir.
