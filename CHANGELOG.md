# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/) formatını,
ve [Semantic Versioning](https://semver.org/lang/tr/) kurallarını kullanır.

## [1.3.0] - 2026-08-03

### Eklendi
- **Kullanım Metrikleri**: Anket bazında ziyaret sayısı ve "oy vermeden ayrılan" sayısı takibi; admin panelinde anket listesi ve düzenleyicide canlı gösterim, CSV dışa aktarımında özet satırlar.
- **Oylama ve Sonuç Ekranı Animasyonları**: Oylama ekranında seçeneklerin sırayla belirmesi ve seçim anında geri bildirim animasyonu; sonuç ekranında çubukların artık gerçekten akıcı biçimde büyümesi (önceden CSS geçişi tanımlıydı ama grafik her güncellemede sıfırdan çizildiği için hiç çalışmıyordu).
- **Uçuşan Emoji Efekti**: Bir kullanıcı oy verdiğinde hem oylama ekranında hem de canlı sonuçları izleyenlerin ekranında uçuşan emoji patlaması gösteriliyor.

### Değiştirildi
- Uygulama genelinde koyu temadan açık (light) renk paletine geçildi.

## [1.2.0] - 2026-08-03

### Kaldırıldı
- **Anket Ağırlıkları**: Seçeneklere ağırlık atama ve "Genel Ortalama" hesaplama özelliği kaldırıldı; seçenekler artık düz metin olarak saklanıyor.

### Düzeltildi
- CSV dışa aktarımında seçenek metni yerine `[object Object]` yazdıran hata giderildi.

### Değiştirildi
- Giriş sayfasındaki başlık animasyonu performans için `requestAnimationFrame` ile optimize edildi.

## [1.1.0] - 2026-03-06

### Eklendi
- **Anket Ağırlıkları**: Anket seçeneklerine rakamsal değerler atama ve "Genel Ortalama" hesaplama özelliği eklendi.
- **GitHub Release Otomasyonu**: Yeni versiyonlarda otomatik GitHub Release oluşturma akışı eklendi.

## [1.0.5] - 2026-03-06

### Eklendi
- Admin panelinde anket seçildiğinde seçeneklerin doldurulması düzeltildi.

## [1.0.4] - 2026-03-03

### Eklendi
- Versiyon değişikliğinde otomatik tagleme workflowu eklendi.
- DockerHub'da versiyon düzeltilmesi için güncelleme yapıldı.

## [1.0.2] - 2026-03-03

### Eklendi
- Github workflow akışı düzeltildi.

## [1.0.1] - 2026-03-03

### Eklendi
- Giriş sayfası animasyonu düzeltildi.
- Sonuç sayfasında dikey/yatay gösterim yeteneği eklendi.

## [1.0.0] - 2026-02-19

### Eklendi
- Çoklu anket desteği — her anket benzersiz 4 haneli rakam koduyla tanımlanır
- Admin paneli: anket listesi + anket düzenleyici iki paneli
- Oy sayfası: kod giriş ekranı, tek oy sınırı (localStorage), oy sonrası otomatik yönlendirme
- Sonuç sayfası: yatay / dikey grafik modu toggle'ı
- Docker imajı yayınlama (GitHub Actions)
