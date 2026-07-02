import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format, parseISO, getHours, differenceInDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { SmartphoneNfc, Clock, Star, TrendingUp, CalendarDays, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export function CustomerPortal() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!id) { setNotFound(true); return; }

      const { data: business, error } = await supabase
        .from('businesses')
        .select(`*, subscriptions(*), cards(*)`)
        .eq('id', id)
        .single();

      if (error || !business) { setNotFound(true); setLoading(false); return; }

      // Tüm kartların scan loglarını çek
      const cardIds = (business.cards || []).map((c: any) => c.id);
      const { data: scanLogs } = await supabase
        .from('scan_logs')
        .select('*')
        .in('card_id', cardIds)
        .order('scanned_at', { ascending: true });

      setData({ business, scanLogs: scanLogs || [] });
      setLoading(false);
    };
    fetch();
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <p className="text-slate-500">İşletme bulunamadı.</p>
    </div>
  );

  const { business, scanLogs } = data;
  const sub = business.subscriptions?.[0];
  const cards = business.cards || [];

  const endDate = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  const today = new Date();
  const daysLeft = endDate ? differenceInDays(endDate, today) : null;
  const isActive = endDate ? endDate > today : false;

  // Bu ay scan sayısı
  const thisMonth = scanLogs.filter((s: any) => {
    const d = new Date(s.scanned_at);
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  }).length;

  // Saatlik dağılım
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    saat: `${h}:00`,
    okutma: scanLogs.filter((s: any) => getHours(parseISO(s.scanned_at)) === h).length
  }));

  // Son 7 günlük trend
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      gun: format(d, 'dd MMM', { locale: tr }),
      okutma: scanLogs.filter((s: any) => {
        const sd = new Date(s.scanned_at);
        return sd.toDateString() === d.toDateString();
      }).length
    };
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <SmartphoneNfc className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">{business.business_name}</h1>
              <p className="text-sm text-slate-500">NFC Google Review Paneli</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* Abonelik durumu */}
        <div className={cn(
          "rounded-2xl p-5 border",
          isActive
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isActive
                ? <CheckCircle className="w-5 h-5 text-green-600" />
                : <XCircle className="w-5 h-5 text-red-600" />}
              <span className={cn("font-semibold", isActive ? "text-green-800" : "text-red-800")}>
                {isActive ? 'Abonelik Aktif' : 'Abonelik Sona Erdi'}
              </span>
            </div>
            {endDate && (
              <span className={cn("text-sm font-medium", isActive ? "text-green-700" : "text-red-700")}>
                {isActive
                  ? daysLeft === 0 ? 'Bugün bitiyor!' : `${daysLeft} gün kaldı`
                  : `${Math.abs(daysLeft!)} gün geçti`}
              </span>
            )}
          </div>
          {endDate && (
            <p className={cn("text-xs mt-1.5", isActive ? "text-green-600" : "text-red-600")}>
              {isActive ? 'Bitiş tarihi:' : 'Sona erdi:'} {format(endDate, 'd MMMM yyyy', { locale: tr })}
            </p>
          )}
        </div>

        {/* Özet kartlar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{scanLogs.length}</p>
            <p className="text-xs text-slate-500 mt-0.5">Toplam Okutma</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{thisMonth}</p>
            <p className="text-xs text-slate-500 mt-0.5">Bu Ay</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{cards.length}</p>
            <p className="text-xs text-slate-500 mt-0.5">Aktif Kart</p>
          </div>
        </div>

        {/* Kartlar listesi */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <SmartphoneNfc className="w-4 h-4 text-blue-600" />
            Kartlarınız
          </h2>
          <div className="space-y-2">
            {cards.map((card: any, i: number) => (
              <div key={card.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {card.label || `Kart ${i + 1}`}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-[180px]">
                    {card.id.slice(0, 8)}...
                  </p>
                </div>
                <span className={cn(
                  "text-xs font-medium px-2.5 py-1 rounded-full",
                  card.status === 'active'
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                )}>
                  {card.status === 'active' ? '✅ Aktif' : '🔴 Pasif'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Son 7 gün trendi */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            Son 7 Gün
          </h2>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={last7}>
              <defs>
                <linearGradient id="colorOk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="gun" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="okutma" stroke="#3b82f6" fill="url(#colorOk)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Saatlik yoğunluk */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            Saatlik Yoğunluk
          </h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hourly.filter((_, i) => i % 2 === 0)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="saat" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="okutma" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-semibold text-slate-600">ApexMedya</span> · NFC Google Review Sistemi
          </p>
          <a
            href="https://wa.me/905522107342"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-600 hover:underline mt-1 inline-block"
          >
            Destek için WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
