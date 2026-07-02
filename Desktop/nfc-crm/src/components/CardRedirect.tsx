import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function CardRedirect() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<'loading' | 'inactive' | 'not_found' | 'error'>('loading');

  useEffect(() => {
    const processScan = async () => {
      if (!id) { setStatus('not_found'); return; }

      try {
        const { data: cardData, error: cardError } = await supabase
          .from('cards')
          .select('*')
          .eq('business_id', id)
          .single();

        if (cardError || !cardData) { setStatus('not_found'); return; }

        // Kart manuel kapatılmışsa göster
        if (cardData.status === 'inactive') { setStatus('inactive'); return; }

        // Abonelik kontrolü
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('business_id', id)
          .single();

        if (sub && new Date(sub.current_period_end) < new Date()) {
          setStatus('inactive'); return;
        }

        // Scan logla
        await supabase.from('scan_logs').insert([{ card_id: cardData.id }]);

        // Yönlendir
        if (cardData.google_review_url) {
          window.location.href = cardData.google_review_url;
        } else {
          setStatus('not_found');
        }
      } catch {
        setStatus('error');
      }
    };

    processScan();
  }, [id]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-600 font-medium animate-pulse">Yönlendiriliyorsunuz...</p>
      </div>
    );
  }

  if (status === 'not_found' || status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <p className="text-slate-500 text-center">Bu kart bulunamadı veya geçersiz.</p>
      </div>
    );
  }

  // inactive — abonelik bitti sayfası
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 flex flex-col items-center text-center">
        {/* İkon */}
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-5">
          <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>

        {/* Başlık */}
        <h1 className="text-2xl font-bold text-slate-800 mb-2">
          Abonelik Sona Erdi
        </h1>
        <p className="text-slate-500 text-sm mb-6">
          Bu işletmenin NFC Google Review kart aboneliği sona ermiştir.
          Aboneliğinizi yenilemek için aşağıdan bizimle iletişime geçin.
        </p>

        {/* Marka */}
        <div className="bg-slate-50 rounded-xl px-5 py-3 mb-6 w-full">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Hizmet Sağlayıcı</p>
          <p className="text-lg font-bold text-slate-800">ApexMedya</p>
          <p className="text-sm text-slate-500">NFC Google Review Sistemi</p>
        </div>

        {/* WhatsApp Butonu */}
        <a
          href="https://wa.me/905522107342?text=Merhaba%2C%20NFC%20kart%20aboneliğimi%20yenilemek%20istiyorum."
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 text-white font-semibold py-4 px-6 rounded-xl transition-colors shadow-lg shadow-green-500/30"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Aboneliği Yenile (WhatsApp)
        </a>

        <p className="text-xs text-slate-400 mt-4">
          0552 210 73 42
        </p>
      </div>
    </div>
  );
}
