import React, { useState } from 'react';
import { Client } from '../types';
import { addMonths, format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, isSameDay, isToday } from 'date-fns';
import { tr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';
import { cn, generateWhatsAppLink } from '../lib/utils';
import { Settings } from '../types';

interface Props {
  clients: Client[];
  settings: Settings;
}

function getPaymentDate(client: Client): Date {
  return new Date(client.lastPaymentDate);
}

function getDayStatus(paymentDate: Date, today: Date): 'overdue' | 'soon' | 'ok' {
  const diff = Math.ceil((paymentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff <= 5) return 'soon';
  return 'ok';
}

export function PaymentCalendar({ clients, settings }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const today = new Date();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Haftanın başlangıcı Pazartesi (1) — boş günler
  const startPadding = (getDay(monthStart) + 6) % 7;

  // Her gün için müşterileri hesapla
  const clientsByDay = (day: Date) =>
    clients.filter(c => isSameDay(getPaymentDate(c), day));

  const selectedClients = selectedDay ? clientsByDay(selectedDay) : [];

  const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />Ödeme Günü</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />5 Gün İçinde</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" />Gecikmiş</span>
      </div>

      {/* Calendar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, -1))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="font-semibold text-slate-800 dark:text-white capitalize">
            {format(currentMonth, 'MMMM yyyy', { locale: tr })}
          </h2>
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day labels */}
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
          {DAYS.map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
              {d}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7">
          {/* Padding */}
          {Array.from({ length: startPadding }).map((_, i) => (
            <div key={`pad-${i}`} className="h-16 sm:h-20 border-b border-r border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-900/20" />
          ))}

          {days.map(day => {
            const dayClients = clientsByDay(day);
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            const isCurrent = isToday(day);

            // Renk önceliği: overdue > soon > ok
            let dotColor = '';
            if (dayClients.length > 0) {
              const statuses = dayClients.map(c => getDayStatus(getPaymentDate(c), today));
              if (statuses.includes('overdue')) dotColor = 'bg-red-500';
              else if (statuses.includes('soon')) dotColor = 'bg-amber-400';
              else dotColor = 'bg-green-500';
            }

            return (
              <div
                key={day.toISOString()}
                onClick={() => dayClients.length > 0 && setSelectedDay(isSelected ? null : day)}
                className={cn(
                  "h-16 sm:h-20 border-b border-r border-slate-100 dark:border-slate-700/50 p-1.5 sm:p-2 transition-colors relative",
                  !isSameMonth(day, currentMonth) && "opacity-30",
                  dayClients.length > 0 && "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50",
                  isSelected && "bg-blue-50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-500"
                )}
              >
                <span className={cn(
                  "text-xs sm:text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full",
                  isCurrent ? "bg-blue-600 text-white" : "text-slate-700 dark:text-slate-300"
                )}>
                  {format(day, 'd')}
                </span>

                {dayClients.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {dayClients.slice(0, 3).map(c => (
                      <span
                        key={c.id}
                        className={cn("w-2 h-2 rounded-full", dotColor)}
                        title={c.businessName}
                      />
                    ))}
                    {dayClients.length > 3 && (
                      <span className="text-xs text-slate-400">+{dayClients.length - 3}</span>
                    )}
                  </div>
                )}

                {dayClients.length > 0 && (
                  <div className="hidden sm:block">
                    {dayClients.slice(0, 1).map(c => (
                      <p key={c.id} className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {c.businessName}
                      </p>
                    ))}
                    {dayClients.length > 1 && (
                      <p className="text-xs text-slate-400">+{dayClients.length - 1} daha</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDay && selectedClients.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
          <h3 className="font-semibold text-slate-800 dark:text-white mb-4">
            {format(selectedDay, 'd MMMM yyyy', { locale: tr })} — Ödeme Günleri
          </h3>
          <div className="space-y-3">
            {selectedClients.map(client => {
              const status = getDayStatus(getPaymentDate(client), today);
              return (
                <div
                  key={client.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl border",
                    status === 'overdue' ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                      : status === 'soon' ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                      : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                  )}
                >
                  <div>
                    <p className="font-medium text-slate-800 dark:text-white">{client.businessName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{client.phoneNumber}</p>
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block",
                      status === 'overdue' ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                        : status === 'soon' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                    )}>
                      {status === 'overdue' ? '🔴 Gecikmiş' : status === 'soon' ? '🟡 Yaklaşıyor' : '🟢 Ödeme Günü'}
                    </span>
                  </div>
                  <a
                    href={generateWhatsAppLink(client, settings)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "p-2.5 text-white rounded-xl transition-colors flex items-center gap-1.5 text-sm font-medium",
                      status === 'overdue' ? "bg-red-500 hover:bg-red-600"
                        : status === 'soon' ? "bg-amber-500 hover:bg-amber-600"
                        : "bg-green-500 hover:bg-green-600"
                    )}
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span className="hidden sm:inline">WP Gönder</span>
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bu ayki özet */}
      <div className="grid grid-cols-3 gap-3">
        {(['overdue', 'soon', 'ok'] as const).map(status => {
          const count = clients.filter(c => getDayStatus(getPaymentDate(c), today) === status).length;
          return (
            <div key={status} className={cn(
              "rounded-xl p-4 text-center",
              status === 'overdue' ? "bg-red-50 dark:bg-red-900/20"
                : status === 'soon' ? "bg-amber-50 dark:bg-amber-900/20"
                : "bg-green-50 dark:bg-green-900/20"
            )}>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {status === 'overdue' ? '🔴 Gecikmiş' : status === 'soon' ? '🟡 Bu Hafta' : '🟢 Normal'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
