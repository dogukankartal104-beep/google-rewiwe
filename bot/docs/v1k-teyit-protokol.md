# v1k ikinci motor adayı: kayan pencere tetik + geri çekilme teyidi (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı, commit'lendi. Plan sonradan değişmez; ek fikir "EK"e tarihle.

## Fikir ve dürüst not
`v1k-1dk-rapor.md`: kayan pencere kuralı R'nin, saate hizalı 15m kuralının hiç ateşlemediği sinyalleri iyi sonuç verdi (n=535, ortalama
+%2.82, sınavda +%6.54), ama o sınıf SONRADAN, geleceğe bakarak tanımlandı ("15m kuralı sonraki 30 dakikada ateşlemedi"). Doğrudan işlem
yapılamaz. Bu protokol, o sınıfın olası ortak özelliğini (tetikten sonra fiyatın tepeden geri çekilmesi) sinyal anında bilinen bir kurala çevirir.
Bu bir hipotezdir; sonuç görülmeden dondurulmuş eşiklerle sınanır.

## Tetik ve giriş
- Tetik: `v1k-1dk-protokol.md` kural R (her 1m kapanışta son 15 dk ≥ +%4, 24s ≥ +%50, BTC 24s ≤ −%1, 24s hacim ≥ 1M $, 4 saat soğuma), sinyal anı t0
  = tetik mumunun kapanışı. Sinyal fiyatı = t0'dan sonraki ilk 1m açılış (v1k ile aynı).
- Tetikten sonraki en çok 30 dakikada, tetik mumu dahil en yüksek fiyatı H olarak izle. İlk 1m kapanış ≤ H × (1 − p) olduğunda, bir sonraki 1m
  açılışta SHORT gir. 30 dakikada olmazsa işlem yok.
- Stop = sinyal fiyatı × 1.50 (tüm hücrelerde aynı); süre sinyal anından 24 saat; masraf %0.10 + %0.05, stopta +%0.20, funding; hacmi 0 mumlar tetikleyemez.
- Filtre F: tetik anında son 15 dk OI artışı ≤ %6.01 (v1k ile aynı tanım).

## Hücreler (4, sabit)
- P1: p = %1.5. P2: p = %3. P1F: P1 + F. P2F: P2 + F.
Karşılaştırma: C'nin K0 ve K1 hücreleri (`v1k-motor-protokol.md`). Dönem 2022-01 → bugün; KEŞİF/DOĞRULAMA bölmesi sabit tarih 2026-03-02.

## Rapor
Her hücre: n, ortalama, ortanca, kazanma, en kötü, %90 aralık (hafta-kümeli), KEŞİF / DOĞRULAMA ayrı, 15 dk gecikme, takipçi (1000 $, %5, 1x,
günde en çok 2 ve aynı anda en çok 3). v1k ile ilişki: aday sinyallerin kaçı v1k (K1) ile aynı coinde ±1 saat içinde, günlük getiri korelasyonu ve
v1k K1 + aday akışlarının birleşik takipçi hesabı (aynı anda en çok 3 açık) ile K1 tek başına.

## Geçme şartı (ikinci motor olarak) — sonuç görülmeden sabit
Bir hücre **ikinci motor olabilir** ancak hepsi birden: DOĞRULAMA n ≥ 100; ortalama > 0; %90 alt uç > 0; DOĞRULAMA'nın iki yarısında da ortalama > 0;
15 dk gecikmede ortalama > 0; günde en çok 2 kuralıyla getiri > 0 ve düşüş ≤ %30; sinyallerinin en çok yarısı v1k K1 ile aynı coin ve ±1 saat
(yani gerçekten ayrı bir motor); birleşik hesapta (K1 + aday, aynı anda en çok 3) getiri K1 tek başına getiriden yüksek ve düşüş ≤ %30. 4 hücrenin
"K0 / K1'den farklı" testleri Benjamini-Hochberg (q = 0.10) ile düzeltilir ve raporlanır. Birden fazla hücre geçerse en yüksek DOĞRULAMA ortalamalısı değil,
en sade olan (filtresiz P1 < P2 < P1F < P2F, en az bileşen) seçilir. Geçmezse ikinci motor eklenmez.

## Çıktı
`bot/docs/v1k-teyit-rapor.md`, betik `bot/bt/v1/teyit.js`.

## EK
- EK-1 (2026-11-04, sonuç görüldükten SONRA ama aşağıdaki sonuç hesaplanmadan ÖNCE yazıldı; yeni, ayrı bir hipotez): "v1p yalnız hiçbir v1k pozisyonu açık değilken
  girer" kuralı. Gerekçe: ilk testte v1p, v1k ile aynı olayları yakalayıp hesabı bozdu (günlük korelasyon 0.6+). Eşzamanlı pozisyonu yasaklamak bunu
  önleyebilir. Kural: bir v1p sinyali, girişi anında v1k K1 akışında (herhangi bir coin) açık pozisyon varsa atlanır; yoksa alınır. Dönem ve bölme aynı
  (DOĞRULAMA 2026-03-02 sonrası). Geçme şartı (sabit): DOĞRULAMA'da kabul edilen v1p sinyali n ≥ 60; ortalama > 0; %90 alt uç > 0; iki yarıda da ortalama
  > 0; 15 dk gecikmede ortalama > 0; birleşik hesapta (v1k K1 + kabul edilen v1p, aynı anda en çok 3) getiri > v1k K1 tek başına getirisi ve düşüş ≤ %30.
  4 hücre denendiği için şans payı vardır (BH raporlanır). Birden fazla hücre geçerse en sade (P1 < P2 < P1F < P2F). Geçmezse v1p yayına alınmaz.
