-- Shopier OSB (Otomatik Sipariş Bildirimi) eşleştirmesi için
-- Her işletmenin Shopier ürün/ödeme linkindeki ürün ID'sini saklar.
-- Bu sayede ödeme bildirimi geldiğinde productid üzerinden işletme bulunabilir.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS shopier_product_id TEXT;

CREATE INDEX IF NOT EXISTS idx_businesses_shopier_product_id
  ON public.businesses (shopier_product_id);
