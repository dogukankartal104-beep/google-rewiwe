# v1 SHORT: "stopa gidecek" işlemi işlem SIRASINDA tanıyıp erken çıkma (protokol)

Sonuç görülmeden ve kod yazılmadan önce yazıldı, commit'lendi. Plan sonradan değişmez; ek fikir "EK" bölümüne.

## 0. Hedef ve bağlam
Hedef TOPLAM PARA'dır, kuyruk değil. Başka projeden gelen iddialar (girişten bu yana OI büyümesinin 8. saatte
AUC 0.75 olması; "+%X aleyhe → çık" kurallarının kuyruğu iyileştirip ortalamayı düşürmesi; ilk 5-15 dakikadaki
ters hareketin toparlanması) güvenilmez, kendi verimizle doğrulanır. İlk 5-15 dk kuralı denenmiştir, geçmemiştir,
burada denenmez.

## 1. Taban işlemler
- **v1 ikizi** ve **v1k kolu**: sinyal tanımı `docs/v1-tp-protokol.md` bölüm 0 ile birebir aynıdır (Finora kanal
  geçmişi erişilemediği için ikiz kullanılır ve raporda böyle yazılır).
- İşlem: SHORT, giriş alarmdan sonraki ilk 1m açılış, stop +%50, 24 saat, TP yok. Masraf %0.10 + kayma %0.05,
  stopta ek %0.20, funding dahil. Hacmi 0 mumlar stop tetikleyemez.

## 2. Kontrol anı ve ölçümler
- Kontrol yalnız takvim hizalı 15m kapanışlarında (girişten sonraki ilk kapanıştan 24. saate kadar). Tetik olursa
  çıkış bir sonraki 1m mumun açılışında.
- P = 15m kapanış fiyatının girişe göre değişimi % (pozitif = short aleyhine).
- OI = `sum_open_interest_value` (dolar OI, 5 dk). ΔOI% = kontrol anındaki son 5 dk kaydı / girişteki son 5 dk
  kaydı − 1. L/S = `count_long_short_ratio`; ΔL/S% girişe göre. Taker = `sum_taker_long_short_vol_ratio` son 12
  kaydın (1 saat) ortalaması. Veri eksikse o kontrolde tetik yok sayılır ve eksik sayısı raporlanır.
- **Yakıt (O3):** girişten sonra her 5 dk adımda dolar OI artışı (yalnız pozitif adımlar) o adımın fiyatında açılmış
  sayılır; short payı = 1/(1 + count_long_short_ratio); kaldıraç dağılımı {5, 10, 25, 50, 100}x eşit ağırlık;
  bir short'un tasfiye fiyatı = açıldığı fiyat × (1 + 1/L − 0.005); açıldıktan sonra fiyat bu seviyeyi geçmişse
  zaten tasfiye olmuş sayılır ve yakıttan çıkar. Yakıt = kontrol anındaki fiyattan stopa (giriş × 1.5) kadar
  aralığa tasfiye fiyatı düşen short dolarlarının toplamı. Yakıt oranı = yakıt / girişteki 24 saatlik hacim.
- Bybit tasfiye geçmişi bu oturumda yok: tasfiye geçmişi hücresi ölçülmez, "yalnız ileri kayıt (canlı WS
  allLiquidation)" diye işaretlenir. Hiçbir yerde uydurma değer kullanılmaz.

## 3. Hücreler (sabit liste; 8 hücre + taban)
| hücre | kural |
|---|---|
| TABAN | erken çıkış yok |
| O1 | ΔOI ≥ +%60 VE P ≥ +%15 → hepsini kapat |
| O2 | ΔOI ≥ +%100 VE P ≥ +%25 → hepsini kapat |
| O3 | O2 koşulu VE yakıt oranı ≥ 0.18 → hepsini kapat |
| L1 | ΔL/S ≤ −%15 VE P ≥ +%15 → hepsini kapat |
| T1 | Taker (son 1 saat ortalaması) ≥ 1.3 VE P ≥ +%15 → hepsini kapat |
| Y1 | O1 tetiğinde YARISINI kapat, kalan stop/24 saatle devam |
| Y2 | O2 tetiğinde yarısını kapat |
| Y3 | L1 tetiğinde yarısını kapat |
Bir işlemde tetik bir kez çalışır (ilk koşul sağlandığı kontrolde). Y hücrelerinde kalan yarı stop +%50 / 24 saat ile
devam eder; kapatılan yarı için giriş+çıkış masrafı ve funding payı hesaplanır.

## 4. Rapor (her hücre ve kol için)
Tetik sayısı ve oranı; tetiklenenlerde "çıkış ↔ tutsaydık" farkı (ortalama, bootstrap %90); toplam ortalama ve
TABAN'a fark (eşleştirilmiş, hafta-kümeli bootstrap %90); en kötü %10 ortalaması; kazanma; KEŞİF (zaman sırasına
göre ilk %60) ile DOĞRULAMA (son %40) ayrı; takipçi benzetimi (1000 $, %5, 1x) bakiye eğrisi ve düşüş.
İsabet: tetiklenenlerin kaçı TABAN'da gerçekten stopa gidecekti, kaçı kârla dönecekti (yanlış alarm), kaçı diğer
(stopa değmeden zararla bitenler). Her tabloda n.

## 5. Ayırt edicilik ölçümü (betimleyici, yeni hücre değildir)
TABAN'da stopa giden işlemlerle gitmeyenleri ayıran işlem-içi özelliklerin AUC'si, girişten sonra 1, 2, 4, 8
saatte: ΔOI%, ΔL/S%, taker ortalaması, P (fiyat girişe göre), girişten beri en yüksek P. Yalnız o ana kadarki
veriyle. KEŞİF ve DOĞRULAMA ayrı. Bu bölümden yeni eşik ya da hücre türetilmez; yalnız "ayırt eden bir şey var
mı" sorusunun cevabıdır.

## 6. Karar kuralı (sonuç görülmeden sabit)
- Bir hücre **ÖNERİLİR** ancak: DOĞRULAMA'da ortalama ≥ TABAN VE en kötü %10'un ortalaması TABAN'dan en az 5 puan
  daha iyi VE iki yarıda da (KEŞİF, DOĞRULAMA) ortalama ≥ TABAN − 0.1 puan.
- Y hücreleri ortalamayı düşürüyorsa yalnız "risk tercihi" olarak rakamıyla yazılır, önerilmez.
- 8 hücre denendiği için şans payı vardır: seçilen hücre 20 canlı tetikle doğrulanmadan kanala "ÇIK" sinyali
  olarak gönderilmez.
- İkiz ve v1k kolu ayrı karara bağlanır. TABAN'ın kendisi DOĞRULAMA'da zarar ediyorsa bu da raporun ilk satırına yazılır.

## 7. Çıktı
`bot/docs/stop-ayir-rapor.md` ve `bot/bt/v1/` altında betik. Geçmeyen hücreler aynı açıklıkla yazılır.

## EK
(boş)
