import { cfg } from './db.js';

const G = 'https://generativelanguage.googleapis.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `Bu videoyu izle ve dinle. Türkiye'deki izleyici için Instagram Reels, YouTube Shorts ve TikTok paylaşım metni yaz.

KURALLAR:
- Sadece videoda gerçekten görüp duyduklarına dayan. Videoda olmayan olay, isim, rakam, ürün, yer veya iddia UYDURMA.
- Emin olmadığın bir şeyi yazma. Video belirsizse bunu "warnings" alanına yaz.
- Viral olacağını vaat etme, "garanti" gibi ifadeler kullanma.
- Hashtag'ler videonun gerçek konusuyla ilgili olsun (5-8 adet). Güncel trend verisine erişimin yok; bir etiketin trend olduğunu iddia etme.
- İlk cümle (kanca) dikkat çeksin ama yalan veya tıklama tuzağı olmasın.
- Dil: videonun dili neyse o (Türkçe ise Türkçe).

Sadece şu JSON'u döndür:
{"summary":"videoda ne gördüğünü ve duyduğunu 1-2 cümleyle anlat (kullanıcı doğrulayacak)",
"hook":"ilk cümle",
"youtube_title":"en fazla 70 karakter",
"caption":"kanca + 1-2 cümle + kısa çağrı, hashtag olmadan",
"hashtags":["etiket1","etiket2"],
"platform_notes":{"instagram":"bu videonun bu platforma uyumu, 1 cümle","youtube":"...","tiktok":"..."},
"warnings":["varsa uyarılar"]}`;

async function j(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export async function analyzeVideo(buf, mime = 'video/mp4') {
  const key = cfg('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY yok');
  const model = cfg('GEMINI_MODEL') || 'gemini-2.5-flash';
  const h = { 'x-goog-api-key': key };

  const start = await fetch(`${G}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...h,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buf.length),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'social-bot-video' } }),
  });
  if (!start.ok) throw new Error(`Gemini yükleme ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const up = await j(start.headers.get('x-goog-upload-url'), {
    method: 'POST',
    headers: { 'Content-Length': String(buf.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: buf,
  });
  let file = up.file;
  for (let i = 0; i < 40 && file.state === 'PROCESSING'; i++) {
    await sleep(3000);
    file = await j(`${G}/v1beta/${file.name}`, { headers: h });
  }
  if (file.state !== 'ACTIVE') throw new Error('Gemini videoyu işleyemedi (' + file.state + ')');

  const out = await j(`${G}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ file_data: { mime_type: mime, file_uri: file.uri } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  fetch(`${G}/v1beta/${file.name}`, { method: 'DELETE', headers: h }).catch(() => {});
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error('Gemini boş yanıt verdi: ' + JSON.stringify(out.promptFeedback ?? out).slice(0, 200));
  return JSON.parse(text);
}

async function generateJson(prompt) {
  const key = cfg('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY yok');
  const model = cfg('GEMINI_MODEL') || 'gemini-2.5-flash';
  const out = await j(`${G}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
  });
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) throw new Error('Gemini boş yanıt verdi');
  return JSON.parse(text);
}

const PERF = `Aşağıda sosyal medya hesaplarının GERÇEK performans verisi var (JSON). Bu veriye bakarak analiz yap.

KURALLAR:
- Sadece verideki sayılara dayan. Veride olmayan rakam, trend, sektör ortalaması UYDURMA.
- Örneklem küçükse (10'dan az gönderi gibi) bunu açıkça yaz, kesin hüküm verme.
- Her bulgu için "evidence" alanına verideki hangi gönderi (id) veya sayıya dayandığını yaz.
- Korelasyon nedensellik değildir: "şu yüzden oldu" yerine "şu gönderilerde daha yüksekti" de.
- Önerilen içerik fikirleri, en iyi performans gösteren gönderilerin konularına ve biçimine dayansın. Hangi tür (konu/biçim/uzunluk) daha çok izlenmiş karşılaştır.
- Platformlar arası karşılaştırma yaparken izlenme tanımlarının platformlara göre farklı olabileceğini belirt.
- Türkçe yaz.

Sadece şu JSON'u döndür:
{"headline":"tek cümle genel durum","findings":[{"text":"","evidence":""}],"next_posts":[{"idea":"","why":""}],"platform_advice":{"instagram":"","youtube":"","tiktok":""},"caveats":[""]}

VERİ:
`;

export const analyzePerformance = (summary) => generateJson(PERF + JSON.stringify(summary));
