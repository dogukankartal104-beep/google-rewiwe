// Haber motoru: RSS ayrıştırma + puanlama + mesaj şablonu.
// Gerçek feed'lere erişmez; örnek XML ile çalışır.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFeed, scoreItem, feeds } from '../src/news.js';
import * as M from '../src/messages.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Kripto</title>
  <item>
    <title><![CDATA[Binance'te büyük güvenlik açığı: 200 milyon dolar çalındı]]></title>
    <link>https://ornek.com/haber/1</link>
    <pubDate>Mon, 03 Nov 2026 12:00:00 +0300</pubDate>
  </item>
  <item>
    <title>Fed faiz kararını açıkladı, Bitcoin sert hareketlendi</title>
    <link>https://ornek.com/haber/2</link>
    <pubDate>Mon, 03 Nov 2026 11:00:00 +0300</pubDate>
  </item>
  <item>
    <title>Yeni bir NFT koleksiyonu piyasaya çıktı</title>
    <link>https://ornek.com/haber/3</link>
    <pubDate>Mon, 03 Nov 2026 10:00:00 +0300</pubDate>
  </item>
  <item>
    <title>Altcoin &amp; DeFi raporu: haftal&#305;k &quot;&#246;zet&quot;</title>
    <link>https://ornek.com/haber/4</link>
    <pubDate>Mon, 03 Nov 2026 09:00:00 +0300</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>SEC sues major exchange over unregistered securities</title>
    <link rel="alternate" href="https://ornek.com/atom/1"/>
    <published>2026-11-03T08:00:00Z</published>
  </entry>
  <entry>
    <title type="html">Ethereum &lt;b&gt;upgrade&lt;/b&gt; goes live</title>
    <link rel="alternate" href="https://ornek.com/atom/2"/>
    <updated>2026-11-03T07:00:00Z</updated>
  </entry>
</feed>`;

/* ======================= AYRIŞTIRMA ======================= */
test('parseFeed: RSS item\'larını okur', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 4);
  assert.equal(items[0].title, "Binance'te büyük güvenlik açığı: 200 milyon dolar çalındı");
  assert.equal(items[0].url, 'https://ornek.com/haber/1');
  assert.ok(Number.isFinite(items[0].at));
});

test('parseFeed: CDATA ve HTML entity çözer', () => {
  const items = parseFeed(RSS);
  assert.ok(!items[0].title.includes('CDATA'));
  const dort = items.find((x) => x.url.endsWith('/4'));
  assert.match(dort.title, /Altcoin & DeFi/, '&amp; çözülmeli');
  assert.match(dort.title, /haftalık/, 'sayısal entity çözülmeli');
  assert.match(dort.title, /"özet"/, '&quot; çözülmeli');
});

test('parseFeed: Atom entry ve href link\'i okur', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://ornek.com/atom/1');
  assert.match(items[0].title, /SEC sues/);
  assert.ok(!items[1].title.includes('<b>'), 'HTML etiketi temizlenmeli');
  assert.match(items[1].title, /Ethereum upgrade goes live/);
});

test('parseFeed: bozuk/boş girdide çökmez', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html>bu bir feed değil</html>'), []);
  assert.deepEqual(parseFeed('<rss><channel><item></item></channel></rss>'), [],
    'başlıksız item atlanmalı');
  assert.ok(Array.isArray(parseFeed(null)));
});

test('parseFeed: tarih yoksa şimdi kabul eder', () => {
  const items = parseFeed('<rss><channel><item><title>Başlıksız tarih</title></item></channel></rss>');
  assert.equal(items.length, 1);
  assert.ok(Math.abs(items[0].at - Date.now()) < 5000);
});

/* ======================= PUANLAMA ======================= */
test('scoreItem: güvenlik olayı en yüksek puanı alır', () => {
  const hack = scoreItem("Binance'te büyük güvenlik açığı: 200 milyon dolar çalındı");
  const nft = scoreItem('Yeni bir NFT koleksiyonu piyasaya çıktı');
  assert.ok(hack.score > 50, 'hack haberi yüksek puan almalı: ' + hack.score);
  assert.ok(hack.score > nft.score);
  assert.ok(hack.tags.includes('SECURITY'));
  assert.ok(hack.why, 'neden önemli açıklaması olmalı');
});

test('scoreItem: alakasız haber düşük/sıfır puan', () => {
  const s = scoreItem('Yeni bir NFT koleksiyonu piyasaya çıktı');
  assert.equal(s.score, 0);
  assert.equal(s.tags.length, 0);
});

test('scoreItem: makro haberi yakalar', () => {
  const s = scoreItem('Fed faiz kararını açıkladı, Bitcoin sert hareketlendi');
  assert.ok(s.tags.includes('MACRO'));
  assert.ok(s.score >= 35);
  assert.match(s.why, /volatility/);
});

test('scoreItem: büyük isim geçiyorsa puan artar', () => {
  const ile = scoreItem('Bitcoin borsasında hack iddiası');
  const siz = scoreItem('Küçük bir platformda hack iddiası');
  assert.ok(ile.score > siz.score, 'BTC geçen haber daha çok ilgi görür');
});

test('scoreItem: İngilizce kaynak Türkçeye göre dezavantajlı', () => {
  const tr = scoreItem('SEC dava açtı', { lang: 'tr' });
  const en = scoreItem('SEC dava açtı', { lang: 'en' });
  assert.ok(tr.score > en.score, 'Türkçe kaynak tercih edilmeli');
});

test('scoreItem: birden fazla kural eşleşirse puanlar toplanır', () => {
  const s = scoreItem('SEC soruşturması sonrası borsa iflas başvurusu yaptı');
  assert.ok(s.tags.length >= 2, 'birden fazla etiket: ' + s.tags.join(','));
  assert.ok(s.score >= 70, 'puanlar toplanmalı: ' + s.score);
});

test('scoreItem: boş/null başlıkta çökmez', () => {
  assert.equal(scoreItem('').score, 0);
  assert.equal(scoreItem(null).score, 0);
  assert.equal(scoreItem(undefined).score, 0);
});

test('puanlama sıralaması mantıklı: hack > makro > listeleme > genel', () => {
  const p = (t) => scoreItem(t).score;
  const hack = p('Binance hacklendi, fonlar çalındı');
  const makro = p('Fed faiz kararı açıklandı');
  const liste = p('Binance yeni coin listeledi');
  const genel = p('Bitcoin rekor seviyeye yaklaştı');
  assert.ok(hack > makro, `hack(${hack}) > makro(${makro})`);
  assert.ok(makro > genel, `makro(${makro}) > genel(${genel})`);
  assert.ok(liste > 0 && genel > 0);
});

/* ======================= KAYNAK LİSTESİ ======================= */
test('feeds: varsayılanlar var ve Türkçe kaynaklar öncelikli', () => {
  const f = feeds();
  assert.ok(f.length >= 4);
  assert.ok(f.filter((x) => x.lang === 'tr').length >= 3, 'çoğunluk Türkçe olmalı');
  f.forEach((x) => {
    assert.match(x.url, /^https:\/\//, 'kaynak https olmalı: ' + x.url);
    assert.ok(x.name, 'kaynak adı olmalı');
  });
});

test('feeds: NEWS_FEEDS env ile değiştirilebilir', () => {
  const saved = process.env.NEWS_FEEDS;
  process.env.NEWS_FEEDS = 'https://ornek.com/rss, https://kriptokoin.com/feed/';
  try {
    const f = feeds();
    assert.equal(f.length, 2);
    assert.equal(f[0].url, 'https://ornek.com/rss');
    assert.equal(f[0].name, 'ornek.com', 'isim alan adından türetilmeli');
    assert.equal(f[1].lang, 'tr', 'Türkçe kaynak tanınmalı');
  } finally {
    if (saved === undefined) delete process.env.NEWS_FEEDS;
    else process.env.NEWS_FEEDS = saved;
  }
});

/* ======================= MESAJ ŞABLONLARI ======================= */
const item = {
  title: "Binance'te büyük güvenlik açığı: 200 milyon dolar çalındı",
  url: 'https://ornek.com/haber/1',
  source: 'Kriptokoin',
  at: Date.now() - 12 * 60_000,
  lang: 'tr',
  score: 70,
  tags: ['SECURITY'],
  why: 'Exchange security incidents trigger a sudden flight of liquidity.',
};

test('newsFlash: başlık, kaynak, neden önemli ve piyasa durumu', () => {
  const { text } = M.newsFlash(item, { btc15: -2.1, rejim: 'aşağı rejim', shock: 1.2, openN: 2 });
  assert.match(text, /BREAKING/);
  assert.match(text, /SECURITY/);
  assert.match(text, /200 milyon dolar/);
  assert.match(text, /Kriptokoin/);
  assert.match(text, /12m ago/);
  assert.match(text, /Why it matters/);
  assert.match(text, /-2\.10%/);
  assert.match(text, /2 open position/);
  assert.match(text, /Not financial advice/);
  assert.ok(!/undefined|NaN/.test(text));
});

test('newsFlash: BTC şokunda "yeni pozisyon açmıyor" uyarısı', () => {
  const { text } = M.newsFlash(item, { btc15: -4.5, shock: 3.2, rejim: 'aşağı rejim' });
  assert.match(text, /shock 3\.2×/);
  assert.match(text, /no new positions/);
});

test('newsFlash: a non-English headline is kept in its source language', () => {
  const { text } = M.newsFlash({ ...item, lang: 'tr', title: 'SEC borsaya dava açtı' }, {});
  assert.match(text, /SEC borsaya dava açtı/);
  assert.match(text, /source language/);
});

test('newsFlash: eksik bağlamda çökmez', () => {
  const { text } = M.newsFlash({ title: 'Test', source: 'X', at: Date.now() }, {});
  assert.ok(!/undefined|NaN/.test(text));
  assert.match(text, /Test/);
});

test('newsDigest: haberleri numaralı listeler', () => {
  const { text } = M.newsDigest([item, { ...item, title: 'İkinci haber' }],
    { btc15: 0.4, rejim: 'yatay', breadth: { up: 18, dn: 7 } });
  assert.match(text, /TODAY IN CRYPTO/);
  assert.match(text, /1\./);
  assert.match(text, /2\./);
  assert.match(text, /İkinci haber/);
  assert.match(text, /18↑\/7↓/);
  assert.ok(!/undefined|NaN/.test(text));
});

test('newsDigest: haber yoksa uydurmaz', () => {
  const { text } = M.newsDigest([], {});
  assert.match(text, /Nothing market-moving/);
  assert.ok(!/1\./.test(text));
});

/* ======================= SIRA BAĞIMSIZLIĞI (regresyon) ======================= */
test('likidasyon kuralı kelime sırasından bağımsız', () => {
  // "1.2 milyar ... likidasyon" ve "likidasyon ... rekor" ikisi de yakalanmalı
  const a = scoreItem('Son 24 saatte 1.2 milyar dolarlık likidasyon yaşandı');
  const b = scoreItem('Likidasyon dalgası rekor kırdı');
  assert.ok(a.tags.includes('LIQUIDATION'), 'milyar önce gelse de yakalanmalı');
  assert.ok(b.tags.includes('LIQUIDATION'), 'rekor sonra gelse de yakalanmalı');
  assert.ok(a.score >= 40 && b.score >= 40);
  // sadece "likidasyon" geçip büyüklük belirtmeyen haber eşiği geçmemeli
  assert.ok(!scoreItem('Likidasyon nedir? Rehber').tags.includes('LIQUIDATION'));
});

test('balina kuralı sıra bağımsız ama tek başına flaş değil', () => {
  const a = scoreItem('Balina 500 milyon dolarlık BTC taşıdı');
  const b = scoreItem('500 milyon dolar transfer edildi');
  assert.ok(a.tags.includes('WHALE'));
  assert.ok(b.tags.includes('WHALE'), 'transfer + büyüklük sırası önemsiz');
  assert.ok(a.score < 38, 'balina haberi tek başına flaş olmamalı: ' + a.score);
});

test('Fed/FOMC haberi flaş eşiğini geçer', () => {
  ['Fed faiz kararını açıkladı', 'FOMC tutanakları yayımlandı', 'Enflasyon verisi beklentiyi aştı']
    .forEach((t) => {
      const s = scoreItem(t);
      assert.ok(s.score >= 38, `"${t}" flaş olmalı: ${s.score}`);
      assert.ok(s.tags.includes('MACRO'));
    });
});

test('Türkçe karakterle başlayan terimler eşleşir (regresyon)', () => {
  // JavaScript'te \b Türkçe harfleri tanımaz; bu yüzden Unicode sınırı kullanılıyor.
  const kelimeler = {
    'Fonlar çalındı': 'SECURITY',
    'Borsaya siber saldırı düzenlendi': 'SECURITY',
    'Şirket çöktü': 'INSOLVENCY',
    'Ağda güncelleme yapıldı': 'NETWORK',
    'Piyasada sert düşüş': 'MARKET',
    'Büyük dolandırıcılık iddiası': 'FRAUD',
  };
  for (const [t, tag] of Object.entries(kelimeler)) {
    assert.ok(scoreItem(t).tags.includes(tag), `"${t}" -> ${tag} bekleniyordu`);
  }
});
