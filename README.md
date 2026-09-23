# 📊 Anket Projesi

Toplantı, ders ve etkinlikler için canlı anket uygulaması. Kapalı ağda (intranet) internet bağlantısı olmadan çalışır; HTTPS ters vekil arkasında internette de yayınlanabilir.

[![CI](https://github.com/theaob/anket-projesi/actions/workflows/ci.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/ci.yml)
[![Build and Push to DockerHub](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/theaob/anket-projesi/actions/workflows/docker-publish.yml)

## ✨ Özellikler

* **💎 Modern Arayüz:** Animasyonlu, telefona uygun arayüz; klavye ve ekran okuyucuyla kullanılabilir (WCAG 2 AA renk kontrastı).
* **📡 Canlı Sonuçlar:** Socket.io ile anlık grafik güncellemeleri.
* **⏱ Oylamayı Aç/Kapat ve Zamanlayıcı:** Oylamayı elle açıp kapatın, süreli başlatın ya da başlangıç ve bitiş tarih/saatini önceden planlayın; oylama zamanı gelince kendiliğinden açılır, bitişte kapanır ve sonuçlar herkese gösterilir.
* **🖥 Sunum Ekranı:** Projeksiyon için tam ekran canlı sonuçlar; katılım QR kodu ve anket kodu ekranda.
* **👥 Herkes Kendi Anketini Oluşturur:** Hesap gerekmez. Ana sayfadan anket oluşturan kişiye gizli bir yönetim bağlantısı verilir; anketi yalnızca bu bağlantıya sahip olanlar düzenleyebilir, sıfırlayabilir veya silebilir.
* **🚀 GitHub Otomasyonu:** Versiyon kontrolü ve otomatik GitHub Release yayını.
* **📊 Dışa aktarma:** Excel (özet, grafikler, oy saatleri, zaman çizelgesi), yazdırılabilir PDF raporu, CSV ve JSON.
* **📥 JSON içe aktarma ve kopyalama:** Dışa aktarılan JSON dosyasından (veya `{ "question": "...", "options": [...] }`) yeni anket oluşturma; bir anketin kopyasını oluşturma.
* **🔒 Kapalı Ağ Uyumu:** Kapalı ağda internet bağlantısı gerekmez (isteğe bağlı Cloudflare Turnstile dışında hiçbir dış servis kullanılmaz).
* **🌐 İnternette Yayın:** İmzalı katılımcı çerezleri, ağ başına hız sınırları ve isteğe bağlı bot doğrulamasıyla toplu oy kullanmaya karşı koruma.
* **🐳 Docker Ready:** Tek komutla her ortamda tutarlı kurulum.

## 🚀 Hızlı Başlangıç

### Yerel Kurulum (Geliştirici Modu)
1. Bağımlılıkları yükleyin: `npm install`
2. Sunucuyu başlatın: `node server.js` (Node.js 22.13+)
3. Tarayıcıda açın: `http://localhost:3000` (port `PORT` ortam değişkeniyle değiştirilebilir)
4. Testleri ve lint'i çalıştırın: `npm test`, `npm run lint` (her push ve pull request'te GitHub Actions'ta da çalışır)

### Sürüm Çıkarma
1. `CHANGELOG.md` içindeki `## [Unreleased]` başlığını yeni sürümle değiştirin (örn. `## [2.0.1] - 2026-09-23`) ve commit edip `main`'e gönderin.
2. `npm run release:patch` (veya `release:minor` / `release:major`) çalıştırın. Betik önce `main` dalında, temiz ve GitHub ile eşit olduğunuzu ve CHANGELOG'da yeni sürümün bölümü bulunduğunu kontrol eder; ardından sürümü artırır, etiketler ve gönderir. GitHub Actions Docker imajını ve sürüm notlarını yayınlar. Yalnızca kontrolleri çalıştırmak için: `npm run release:patch -- --dry-run`.

## 🗳 Kullanım
1. Ana sayfada **"Yeni anket oluştur"** düğmesine basın. Anketin yönetim sayfasına (`/manage#<gizli-anahtar>`) yönlendirilirsiniz.
2. Soruyu ve seçenekleri girip **Yayınla**'ya basın.
3. Katılımcılarla anket kodunu ya da katılım bağlantısını (`/?code=1234`) paylaşın. Kodlar 4 hanelidir; 4 haneli kodlar neredeyse tükendiğinde yeni anketlere 5 haneli kod verilir.
4. Yönetim sayfasında sonuçları canlı izleyin; oyları sıfırlayın, sonuçları Excel/PDF/CSV/JSON olarak dışa aktarın, anketi kopyalayın veya silin. Ana sayfadaki "JSON dosyasından içe aktar" ile kayıtlı bir anketten yeni anket oluşturabilirsiniz.
5. **Oylama** bölümünden oylamayı kapatıp açabilir ya da süreli başlatabilirsiniz (30 sn, 1, 2 veya 5 dk; süre işlerken "+30 sn" ile uzatılabilir). Süre dolunca oylama otomatik kapanır, kapalı ankette oy verilemez ve sonuçlar tüm katılımcılara gösterilir. "Tarih ve saatle planla" ile başlangıç ve/veya bitiş zamanı seçebilirsiniz (en fazla bir yıl sonrası): başlangıçtan önce katılımcılar anketi ve başlamasına kalan süreyi görür ama oy veremez; bitiş boş bırakılırsa oylama siz kapatana kadar açık kalır. "Şimdi başlat" planı beklemeden açar, elle kapatmak planı kaldırır. Yeni anketler açık olarak başlar; zamanlayıcı ve plan sunucu yeniden başlatılsa da kaldığı yerden devam eder.
6. Salondaki ekran için yönetim sayfasındaki **"Sunum ekranını aç"** bağlantısını kullanın (`/present?code=1234`).

### 🖥 Sunum Ekranı
Soruyu, canlı sonuç çubuklarını, bağlı katılımcı sayısını ve katılım için bir QR kodu ile anket kodunu gösterir. Salt okunurdur ve ziyaret olarak sayılmaz; yönetim anahtarını içermediği için projeksiyonda güvenle gösterilebilir.

* **F** — tam ekran, **H** — sonuçları gizle/göster (oylama bitene kadar katılımcıları etkilememek için). Gizlenen sonuçlar oylama kapandığında otomatik olarak gösterilir.
* Zamanlayıcı çalışırken büyük bir geri sayım görünür; son 10 saniyede kırmızıya döner. Planlanmış bir anket başlamadan önce başlangıç saati ve başlamasına kalan süre gösterilir.
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

Konteyner içindeki sunucu yetkisiz `node` kullanıcısıyla çalışır (veri dizininin sahipliği açılışta otomatik düzeltilir). İmajda `/healthz` adresini yoklayan bir `HEALTHCHECK` vardır; `docker ps` konteynerin sağlık durumunu gösterir.

### Veri Kalıcılığı
Anketler, seçenekler, ziyaretçiler ve oylar bir SQLite veritabanında (`data/anket.db`) saklanır ve sunucu yeniden başlatıldığında geri yüklenir. Konum `DATA_DIR` ortam değişkeniyle değiştirilebilir. Node.js'in yerleşik `node:sqlite` modülü kullanıldığı için ek bir veritabanı sunucusu veya derlenmesi gereken bir paket yoktur; **Node.js 22.13 veya üzeri** gerekir.

Docker'da verinin kaybolmaması için yukarıdaki gibi `/app/data` dizinine bir volume bağlayın. Yedek almak için sunucu çalışırken bile `sqlite3 data/anket.db ".backup yedek.db"` kullanılabilir.

Ortak admin panelli eski sürümden yükseltirken, sahibi olmayan mevcut anketler ve sonuçları veritabanından silinir.

## 🌐 İnternette Yayınlama

### HTTPS ve ters vekil (reverse proxy)
Uygulamayı internete doğrudan açmayın; önüne HTTPS sağlayan bir ters vekil (nginx, Caddy, Cloudflare vb.) koyun ve şu ortam değişkenlerini ayarlayın:

| Değişken | Açıklama |
|---|---|
| `PORT` | Sunucunun dinlediği port (varsayılan `3000`). |
| `TRUST_PROXY` | Önünüzdeki vekil sayısı (genellikle `1`). Ayarlanmazsa tüm ziyaretçiler vekilin adresinden geliyor sayılır ve hız sınırlarını birlikte paylaşır; sunucu bu durumda günlüğe bir uyarı yazar. Vekil yokken **ayarlamayın**, yoksa istemciler sahte `X-Forwarded-For` başlığıyla sınırları aşabilir. |
| `PUBLIC_URL` | Katılım bağlantıları ve QR kodu için genel adres, örn. `https://anket.example.com`. |
| `VOTER_ID_BURST` | Bir ağdan art arda verilebilecek yeni katılımcı kimliği sayısı (varsayılan `30`). |
| `VOTER_ID_PER_HOUR` | Bu hakkın saatte kaç kimlik hızıyla dolduğu (varsayılan `360`, yani dakikada 6). |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | İsteğe bağlı Cloudflare Turnstile bot doğrulaması (aşağıda). |

nginx örneği (Socket.IO için WebSocket başlıkları gereklidir):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Tek kişi, tek oy
Her tarayıcıya sunucu tarafından imzalı, JavaScript'in okuyamadığı (HttpOnly) bir katılımcı çerezi verilir; oy yalnızca geçerli bir çerezle kabul edilir ve her çerez bir ankette bir kez oy verebilir. Kötüye kullanımı sınırlayan asıl önlem, **yeni** çerezlerin ağ (IP adresi; IPv6'da /64 bloğu) başına sınırlı hızda verilmesidir: çerezini silip yeniden gelen biri ya da bir betik, varsayılan ayarlarla bir ağdan en fazla 30 kimlik alır, ardından dakikada 6 ile sınırlanır. Sınıra takılan ziyaretçi bir uyarı görür ve beklemesi gereken süre dolunca otomatik olarak katılır.

**Aynı Wi-Fi'yi paylaşan kalabalık etkinlikler:** Salondaki herkes tek bir genel IP adresinden çıkıyorsa bu sınır gerçek katılımcıları da bekletebilir. Bu durumda Turnstile'ı açıp `VOTER_ID_BURST` değerini katılımcı sayısına göre yükseltin (örn. `300`).

### Cloudflare Turnstile (önerilir)
Turnstile, ücretsiz ve çoğu zaman görünmez bir bot doğrulamasıdır; açıkken yeni bir katılımcı kimliği ancak doğrulamayı geçen tarayıcılara verilir, bu da betiklerle toplu oy kullanmayı büyük ölçüde engeller. Cloudflare panelinden (Turnstile → Add site) alan adınız için bir site oluşturup `TURNSTILE_SITE_KEY` ve `TURNSTILE_SECRET_KEY` değerlerini ayarlayın. Açıkken sayfalar Cloudflare'in betiğini yükler; İçerik Güvenlik Politikası buna göre otomatik genişletilir.

Bu önlemler kararlı bir saldırganı tamamen durduramaz (farklı ağlardan gelen çok sayıda cihaz gibi); gerçek anlamda "kişi başı tek oy" için kullanıcı girişi gerekir.

