-- Aylık abonelik ücretini 500 TL olarak güncelle
UPDATE public.settings
SET value = jsonb_set(value, '{monthlyFee}', '500')
WHERE key = 'global';
