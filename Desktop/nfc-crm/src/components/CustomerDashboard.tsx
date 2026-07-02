import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Business, ScanLog, Card } from '../types';
import { SmartphoneNfc, Clock, CalendarDays, Activity } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { format, parseISO, getHours, getDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '../lib/utils';

export function CustomerDashboard() {
  const { id } = useParams<{ id: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [scans, setScans] = useState<ScanLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterDays, setFilterDays] = useState<7 | 30 | null>(30);

  useEffect(() => {
    if (id) {
      fetchCustomerData(id);
    }
  }, [id]);

  const fetchCustomerData = async (businessId: string) => {
    try {
      // For this simple MVP, we fetch directly by ID. In production, this should have auth or a secret token.
      
      // Fetch Business
      const { data: bData } = await supabase.from('businesses').select('*').eq('id', businessId).single();
      if (bData) setBusiness(bData);

      // Fetch Cards for this business
      const { data: cData } = await supabase.from('cards').select('*').eq('business_id', businessId);
      if (cData) {
        setCards(cData);
        
        // Fetch Scans for these cards
        const cardIds = cData.map(c => c.id);
        if (cardIds.length > 0) {
          const { data: sData } = await supabase.from('scan_logs').select('*').in('card_id', cardIds);
          if (sData) setScans(sData);
        }
      }
    } catch (error) {
      console.error("Error fetching customer data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">İşletme Bulunamadı</h1>
        <p className="text-slate-500">Geçersiz bir analiz linki kullanıyorsunuz.</p>
      </div>
    );
  }

  // Analytics Processing
  const now = new Date();
  
  const filteredScans = scans.filter(scan => {
    if (filterDays === null) return true;
    const scanDate = new Date(scan.scanned_at);
    const diffTime = Math.abs(now.getTime() - scanDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= filterDays;
  });
  
  // 1. Scans by Hour (0-23)
  const hourlyData = Array.from({ length: 24 }).map((_, i) => ({
    hour: `${i.toString().padStart(2, '0')}:00`,
    count: 0
  }));
  
  // 2. Scans by Day of Week
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const dailyData = days.map(day => ({ name: day, count: 0 }));

  filteredScans.forEach(scan => {
    const date = new Date(scan.scanned_at);
    
    // Hour
    const hour = getHours(date);
    hourlyData[hour].count += 1;

    // Day
    const dayIndex = getDay(date);
    dailyData[dayIndex].count += 1;
  });

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-900">Müşteri Paneli</span>
            </div>
            <div className="text-sm font-medium text-slate-500">
              {business.business_name}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <div className="mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">NFC Kart İstatistikleri</h1>
            <p className="text-slate-500 mt-2">Müşterilerinizin Google Review sayfanızı ne sıklıkla ziyaret ettiğini inceleyin.</p>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
            <button
              onClick={() => setFilterDays(7)}
              className={cn("px-4 py-2 text-sm font-medium rounded-md transition-colors", filterDays === 7 ? "bg-slate-100 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            >
              Son 7 Gün
            </button>
            <button
              onClick={() => setFilterDays(30)}
              className={cn("px-4 py-2 text-sm font-medium rounded-md transition-colors", filterDays === 30 ? "bg-slate-100 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            >
              Son 30 Gün
            </button>
            <button
              onClick={() => setFilterDays(null)}
              className={cn("px-4 py-2 text-sm font-medium rounded-md transition-colors", filterDays === null ? "bg-slate-100 text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
            >
              Tümü
            </button>
          </div>
        </div>

        {/* Client Info Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-4 mb-4">İşletme ve Müşteri Bilgileri</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-slate-500 mb-1">İşletme Adı</p>
              <p className="font-medium text-slate-900">{business.business_name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 mb-1">Yetkili Kişi</p>
              <p className="font-medium text-slate-900">
                {business.owner_name || '-'} {business.owner_age ? `(${business.owner_age} Yaş)` : ''}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 mb-1">İletişim</p>
              <p className="font-medium text-slate-900">
                {business.country_code} {business.phone_number || '-'}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 mb-1">Konum</p>
              <p className="font-medium text-slate-900">{business.location || '-'}</p>
            </div>
            <div className="lg:col-span-2">
              <p className="text-sm text-slate-500 mb-1">Yönlendirme Linki (Google Review)</p>
              <a href={cards[0]?.google_review_url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline break-all">
                {cards[0]?.google_review_url || '-'}
              </a>
            </div>
            <div className="lg:col-span-2">
              <p className="text-sm text-slate-500 mb-1">Shopier Linki</p>
              <a href={business.shopier_link} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline break-all">
                {business.shopier_link || '-'}
              </a>
            </div>
            {business.notes && (
              <div className="lg:col-span-4 bg-slate-50 p-4 rounded-lg">
                <p className="text-sm text-slate-500 mb-1">Özel Notlar</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{business.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
            <div className="p-4 bg-blue-50 text-blue-600 rounded-full">
              <SmartphoneNfc className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Toplam Okutulma</p>
              <h3 className="text-3xl font-bold text-slate-900">{scans.length}</h3>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
            <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full">
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Aktif Kart Sayısı</p>
              <h3 className="text-3xl font-bold text-slate-900">{cards.length}</h3>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Hourly Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-400" />
              Saatlik Yoğunluk
            </h3>
            <p className="text-sm text-slate-500 mb-6">Kartınızın günün hangi saatlerinde daha çok okutulduğunu gösterir.</p>
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorHour" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} interval={3} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip 
                    cursor={{ stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '4 4' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [value, 'Okutulma']}
                  />
                  <Area type="monotone" dataKey="count" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorHour)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-slate-400" />
              Haftalık Yoğunluk
            </h3>
            <p className="text-sm text-slate-500 mb-6">Hangi günlerde daha fazla etkileşim aldığınızı görün.</p>
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip 
                    cursor={{ fill: '#F8FAFC' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0' }}
                    formatter={(value: number) => [value, 'Okutulma']}
                  />
                  <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
