import React, { useEffect, useState } from 'react';
import { Settings, ScanLog, PaymentLog, Business, Subscription } from '../types';
import { supabase } from '../lib/supabase';
import { Users, AlertCircle, CreditCard, TrendingUp, Clock, Info, SmartphoneNfc } from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format, subMonths, isSameMonth, getDate, getDaysInMonth, addMonths, differenceInDays, startOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';

interface DashboardProps {
  clients?: any[];
  settings: Settings;
}

export function Dashboard({ settings }: DashboardProps) {
  // Real-time states
  const [payments, setPayments] = useState<PaymentLog[]>([]);
  const [scans, setScans] = useState<ScanLog[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  useEffect(() => {
    fetchSaaSDashboardData();
    
    // Subscribe to real-time events for SaaS tables
    const channels = supabase.channel('custom-all-channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_logs' }, payload => {
        setPayments(prev => [...prev, payload.new as PaymentLog]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_logs' }, payload => {
        setScans(prev => [...prev, payload.new as ScanLog]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channels);
    };
  }, []);

  const fetchSaaSDashboardData = async () => {
    // In a real app, you would query just what you need (e.g. by business_id for the logged-in user)
    // For admin view, we fetch aggregates.
    const { data: pData } = await supabase.from('payment_logs').select('*');
    const { data: sData } = await supabase.from('scan_logs').select('*');
    const { data: bData } = await supabase.from('businesses').select('*');
    const { data: subData } = await supabase.from('subscriptions').select('*');

    if (pData) setPayments(pData);
    if (sData) setScans(sData);
    if (bData) setBusinesses(bData);
    if (subData) setSubscriptions(subData);
  };

  const today = new Date();
  const activeSubs = subscriptions.filter(s => s.status === 'active');
  const mrr = activeSubs.reduce((acc, sub) => acc + Number(sub.monthly_fee), 0);
  
  // Calculate this month's payments
  const thisMonthPayments = payments.filter(p => isSameMonth(new Date(p.paid_at), today));
  const revenueThisMonth = thisMonthPayments.reduce((acc, p) => acc + Number(p.amount), 0);

  // 6 Months Revenue Data
  const last6MonthsData = Array.from({ length: 6 }).map((_, i) => {
    const d = subMonths(today, 5 - i);
    const monthPayments = payments.filter(p => isSameMonth(new Date(p.paid_at), d));
    const revenue = monthPayments.reduce((acc, p) => acc + Number(p.amount), 0);
    return {
      name: format(d, 'MMM', { locale: tr }),
      gelir: revenue
    };
  });

  // 6 Months Scans Data
  const scansChartData = Array.from({ length: 6 }).map((_, i) => {
    const d = subMonths(today, 5 - i);
    const monthScans = scans.filter(s => isSameMonth(new Date(s.scanned_at), d));
    return {
      name: format(d, 'MMM', { locale: tr }),
      tarama: monthScans.length
    };
  });

  // Pie Chart: Active vs Inactive Subscriptions
  const expiredSubs = subscriptions.filter(s => s.status !== 'active');
  const pieData = [
    { name: 'Aktif Aboneler', value: activeSubs.length, color: '#10B981' },
    { name: 'Süresi Dolanlar', value: expiredSubs.length, color: '#EF4444' }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-start space-x-4 transition-colors">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Toplam İşletme</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{businesses.length}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-start space-x-4 transition-colors">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Aylık Tahsilat (MRR)</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">₺{mrr.toLocaleString('tr-TR')}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-start space-x-4 transition-colors">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
            <SmartphoneNfc className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Toplam Kart Okutma</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{scans.length}</h3>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-start space-x-4 transition-colors">
          <div className="p-3 bg-orange-50 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 rounded-lg">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Bu Ay Ödenen</p>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">₺{revenueThisMonth.toLocaleString('tr-TR')}</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 6-Month Revenue Bar Chart */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col transition-colors">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-2">Aylık Gelir Trendi (Son 6 Ay)</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Başarılı abonelik ödemelerinden elde edilen toplam gelir.</p>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last6MonthsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={settings.theme === 'dark' ? '#334155' : '#F1F5F9'} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: settings.theme === 'dark' ? '#94A3B8' : '#64748B', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: settings.theme === 'dark' ? '#94A3B8' : '#64748B', fontSize: 12 }} tickFormatter={(val) => `₺${val}`} />
                <Tooltip 
                  cursor={{ fill: settings.theme === 'dark' ? '#334155' : '#F1F5F9' }}
                  contentStyle={{ 
                    borderRadius: '8px', 
                    border: settings.theme === 'dark' ? '1px solid #334155' : '1px solid #E2E8F0', 
                    backgroundColor: settings.theme === 'dark' ? '#1E293B' : '#ffffff',
                    color: settings.theme === 'dark' ? '#F8FAFC' : '#0F172A'
                  }}
                  formatter={(value: number) => [`₺${value.toLocaleString('tr-TR')}`, 'Aylık Gelir']}
                />
                <Bar dataKey="gelir" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 6-Month Scan Area Chart */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col transition-colors">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-2">Kart Okutma İstatistikleri</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Google Review yönlendirme sayıları.</p>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={scansChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTarama" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={settings.theme === 'dark' ? '#334155' : '#F1F5F9'} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: settings.theme === 'dark' ? '#94A3B8' : '#64748B', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: settings.theme === 'dark' ? '#94A3B8' : '#64748B', fontSize: 12 }} />
                <Tooltip 
                  cursor={{ stroke: settings.theme === 'dark' ? '#475569' : '#94A3B8', strokeWidth: 1, strokeDasharray: '4 4' }}
                  contentStyle={{ 
                    borderRadius: '8px', 
                    border: settings.theme === 'dark' ? '1px solid #334155' : '1px solid #E2E8F0', 
                    backgroundColor: settings.theme === 'dark' ? '#1E293B' : '#ffffff',
                    color: settings.theme === 'dark' ? '#F8FAFC' : '#0F172A'
                  }}
                  formatter={(value: number) => [value, 'Tarama Sayısı']}
                />
                <Area type="monotone" dataKey="tarama" stroke="#3B82F6" strokeWidth={3} fillOpacity={1} fill="url(#colorTarama)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
