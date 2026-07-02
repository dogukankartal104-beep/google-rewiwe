import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Client, Settings } from '../types';
import { addMonths, isBefore, startOfDay, addDays, differenceInDays } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isPaymentOverdue(lastPaymentDate: string): boolean {
  if (!lastPaymentDate) return true;
  const endDate = new Date(lastPaymentDate);
  const today = startOfDay(new Date());
  return isBefore(endDate, today);
}

export function isPaymentUpcoming(lastPaymentDate: string, daysWarning: number = 5): boolean {
  if (!lastPaymentDate) return false;
  const endDate = new Date(lastPaymentDate);
  const today = startOfDay(new Date());
  const warningDate = addDays(today, daysWarning);
  return !isBefore(endDate, today) && isBefore(endDate, warningDate);
}

export function daysUntilPayment(lastPaymentDate: string): number {
  if (!lastPaymentDate) return -999;
  const endDate = new Date(lastPaymentDate);
  const today = startOfDay(new Date());
  return differenceInDays(endDate, today);
}

export function downloadCSV(clients: Client[]) {
  const headers = ['İşletme Adı', 'Ülke Kodu', 'Telefon Numarası', 'Konum', 'Google Review Linki', 'Shopier Link', 'Son Ödeme Tarihi', 'Kayıt Tarihi', 'Notlar'];
  const rows = clients.map(c => [
    `"${c.businessName.replace(/"/g, '""')}"`,
    `"${c.countryCode || '+90'}"`,
    `"${c.phoneNumber.replace(/"/g, '""')}"`,
    `"${c.location.replace(/"/g, '""')}"`,
    `"${c.linktreeUrl.replace(/"/g, '""')}"`,
    `"${c.shopierLink.replace(/"/g, '""')}"`,
    `"${c.lastPaymentDate}"`,
    `"${c.createdAt}"`,
    `"${(c.notes || '').replace(/"/g, '""')}"`
  ]);
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `musteriler_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

// Ödeme durumuna göre otomatik şablon seçimi
export function generateWhatsAppLink(client: Client, settings: Settings, templateType?: 'overdue' | 'upcoming' | 'reminder' | 'setup'): string {
  if (!client.phoneNumber) return '#';

  const code = (client.countryCode || '+90').replace(/\D/g, '');
  let cleanPhone = client.phoneNumber.replace(/\D/g, '');
  cleanPhone = cleanPhone.replace(/^0+/, '');
  const formattedPhone = `${code}${cleanPhone}`;

  const days = daysUntilPayment(client.lastPaymentDate);
  const overdue = days < 0;
  const upcoming = days >= 0 && days <= 5;

  // Tip belirtilmemişse otomatik belirle
  let type = templateType;
  if (!type) {
    if (overdue) type = 'overdue';
    else if (upcoming) type = 'upcoming';
    else type = 'reminder';
  }

  let message = '';
  const nextDate = new Date(client.lastPaymentDate);
  const dateStr = nextDate.toLocaleDateString('tr-TR');

  if (type === 'setup') {
    // İlk kurulum mesajı
    const nfcLink = typeof window !== 'undefined'
      ? `${window.location.origin}/card/${client.id}`
      : `/card/${client.id}`;
    message = `Merhaba ${client.businessName}! 👋\n\nNFC Google Review kartınız hazır! 🚀\n\nMüşterileriniz kartı okuttuğunda direkt Google yorum sayfanıza yönlendirilecek.\n\n📌 NFC Kartınızın Linki: ${nfcLink}\n(Bu linki NFC Tools uyg. ile karta yazdırınız)\n\n💳 Aylık abonelik ödemeniz için: ${client.shopierLink}\n\nHerhangi bir sorunuzda bize ulaşabilirsiniz. İyi çalışmalar! 🙏`;
  } else if (type === 'overdue') {
    // Gecikmiş ödeme
    message = settings.waTemplate
      .replace(/\{\{name\}\}/g, client.businessName)
      .replace(/\{\{isletme\}\}/g, client.businessName)
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{link\}\}/g, client.shopierLink)
      .replace(/\{\{days\}\}/g, String(Math.abs(days)));

    // Eğer şablon değiştirilmemişse default gecikmiş şablon
    if (!settings.waTemplate.includes('{{')) {
      message = `⚠️ Merhaba ${client.businessName},\n\nNFC kart aboneliğinizin süresi ${Math.abs(days)} gün önce dolmuştur.\n\nKartınız şu an aktif değil — müşterileriniz yorum sayfanıza ulaşamıyor.\n\n✅ Hemen aktifleştirmek için ödemenizi yapın:\n${client.shopierLink}\n\nİyi çalışmalar dileriz.`;
    }
  } else if (type === 'upcoming') {
    // Yaklaşan ödeme (3-5 gün kaldı)
    message = `📅 Merhaba ${client.businessName},\n\nNFC kart aboneliğinizin bitiş tarihi ${dateStr} — yani ${days} gün sonra.\n\nKesintisiz hizmet için ödemenizi önceden yapmanızı öneririz:\n${client.shopierLink}\n\nİyi çalışmalar! 🙏`;
  } else {
    // Normal hatırlatma
    message = settings.waTemplate
      .replace(/\{\{name\}\}/g, client.businessName)
      .replace(/\{\{isletme\}\}/g, client.businessName)
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{link\}\}/g, client.shopierLink)
      .replace(/\{\{days\}\}/g, String(days));
  }

  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}
