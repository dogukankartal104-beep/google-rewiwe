-- Kart etiketi (örn. "Giriş Kapısı", "Kasa")
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS label TEXT;

-- Settings'e extraCardFee ekle
UPDATE public.settings
SET value = jsonb_set(value, '{extraCardFee}', '200')
WHERE key = 'global';
