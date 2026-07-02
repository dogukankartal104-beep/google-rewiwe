import React, { useState } from 'react';
import { Client, Settings } from '../types';
import { isPaymentOverdue, isPaymentUpcoming, daysUntilPayment, generateWhatsAppLink, downloadCSV, cn } from '../lib/utils';
import { Search, MessageCircle, Edit2, Trash2, CheckCircle, ExternalLink, MapPin, Download, FileText, X, BarChart2, WifiOff, Wifi, CalendarDays, Layers } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BulkWhatsAppModal } from './BulkWhatsAppModal';

interface ClientTableProps {
  clients: Client[];
  settings: Settings;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
  onMarkPaid: (id: string) => void;
  onToggleCard: (id: string, active: boolean) => void;
  onManageCards: (client: Client) => void;
}

export function ClientTable({ clients, settings, onEdit, onDelete, onMarkPaid, onToggleCard, onManageCards }: ClientTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [calendarPopup, setCalendarPopup] = useState<string | null>(null);
  const [viewingNotesFor, setViewingNotesFor] = useState<Client | null>(null);

  const filteredClients = clients.filter(c => 
    c.businessName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phoneNumber.includes(searchTerm) ||
    c.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredClients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredClients.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleExportCSV = () => {
    downloadCSV(clients);
  };

  const selectedClients = clients.filter(c => selectedIds.has(c.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-center">
        <div className="relative flex-1 max-w-md w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg leading-5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
            placeholder="İşletme, telefon veya konum ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setIsBulkModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 transition-colors gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Seçilenlere Hatırlat ({selectedIds.size})</span>
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg shadow-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors gap-2"
          >
            <Download className="w-4 h-4" />
            <span>CSV İndir</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 border-slate-300 dark:border-slate-600 rounded focus:ring-blue-500 bg-white dark:bg-slate-800"
                      checked={filteredClients.length > 0 && selectedIds.size === filteredClients.length}
                      onChange={toggleSelectAll}
                    />
                  </div>
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">İşletme</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">İletişim & Konum</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Bağlantılar</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ödeme Durumu</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">İşlemler</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    Müşteri bulunamadı. Yeni bir müşteri ekleyerek başlayın.
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => {
                  const overdue = isPaymentOverdue(client.lastPaymentDate);
                  const upcoming = isPaymentUpcoming(client.lastPaymentDate, 5);
                  const days = daysUntilPayment(client.lastPaymentDate);
                  const isSelected = selectedIds.has(client.id);
                  
                  return (
                    <tr 
                      key={client.id} 
                      className={cn(
                        "transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50",
                        overdue && "bg-red-50/30 dark:bg-red-900/10 hover:bg-red-50/50 dark:hover:bg-red-900/20",
                        isSelected && "bg-blue-50/50 dark:bg-blue-900/20 hover:bg-blue-50/70 dark:hover:bg-blue-900/30"
                      )}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center h-5">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 border-slate-300 dark:border-slate-600 rounded focus:ring-blue-500 bg-white dark:bg-slate-800"
                            checked={isSelected}
                            onChange={() => toggleSelect(client.id)}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full flex items-center justify-center font-bold">
                            {client.businessName.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-4">
                            <div className={cn("text-sm font-medium text-slate-900 dark:text-white", overdue && "text-red-900 dark:text-red-400")}>
                              {client.businessName}
                            </div>
                            {(client.ownerName || client.ownerAge) && (
                              <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                                {client.ownerName} {client.ownerAge ? `(${client.ownerAge})` : ''}
                              </div>
                            )}
                            <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                              Kayıt: {format(new Date(client.createdAt), 'dd MMM yyyy', { locale: tr })}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-slate-900 dark:text-slate-200 font-mono">
                          {client.countryCode || '+90'} {client.phoneNumber}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center mt-1">
                          <MapPin className="w-3.5 h-3.5 mr-1" />
                          {client.location}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col space-y-2">
                          <a 
                            href={client.linktreeUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Google Review
                          </a>
                          <button 
                            onClick={() => {
                              const nfcLink = `${window.location.origin}/card/${client.id}`;
                              navigator.clipboard.writeText(nfcLink);
                              alert('NFC Karta Yazılacak Link Kopyalandı:\n' + nfcLink);
                            }}
                            className="text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 flex items-center text-left w-full mt-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> NFC Linkini Kopyala
                          </button>
                          <button
                            onClick={() => {
                              const url = generateWhatsAppLink(client, settings, 'setup');
                              window.open(url, '_blank');
                            }}
                            className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 flex items-center text-left w-full mt-1"
                          >
                            <MessageCircle className="w-3.5 h-3.5 mr-1" /> Kurulum Mesajı Gönder (WA)
                          </button>
                          <a
                            href={`${window.location.origin}/musteri/${client.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 flex items-center mt-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Müşteri Paneli
                          </a>
                          <a
                            href={`/analytics/${client.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 flex items-center w-full mt-1"
                          >
                            <BarChart2 className="w-3.5 h-3.5 mr-1" /> Analiz Paneli
                          </a>
                          <a 
                            href={client.shopierLink} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 flex items-center"
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Shopier
                          </a>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col items-start space-y-2">
                          <span className={cn(
                            "px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full",
                            overdue ? "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300"
                              : upcoming ? "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300"
                              : "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300"
                          )}>
                            {overdue ? 'Ödeme Gecikti' : upcoming ? 'Yaklaşıyor' : 'Ödendi'}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Son: {format(new Date(client.lastPaymentDate), 'dd MMM yyyy', { locale: tr })}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          {client.notes && (
                            <button
                              onClick={() => setViewingNotesFor(client)}
                              className="p-2 text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
                              title="Notları Gör"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          )}
                          <a
                            href={generateWhatsAppLink(client, settings)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "p-2 text-white rounded-lg transition-colors",
                              overdue ? "bg-red-500 hover:bg-red-600" : upcoming ? "bg-amber-500 hover:bg-amber-600" : "bg-green-500 hover:bg-green-600"
                            )}
                            title={overdue ? "Gecikme Mesajı Gönder" : upcoming ? "Yaklaşan Ödeme Hatırlat" : "WhatsApp ile Hatırlat"}
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                          <div className="relative">
                            <button
                              onClick={() => setCalendarPopup(calendarPopup === client.id ? null : client.id)}
                              className={cn(
                                "p-2 rounded-lg transition-colors",
                                overdue ? "text-red-600 bg-red-50 dark:bg-red-900/30 hover:bg-red-100"
                                  : upcoming ? "text-amber-600 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100"
                                  : "text-green-600 bg-green-50 dark:bg-green-900/30 hover:bg-green-100"
                              )}
                              title="Ödeme Takvimi"
                            >
                              <CalendarDays className="w-4 h-4" />
                            </button>

                            {calendarPopup === client.id && (
                              <div className="absolute right-0 top-10 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-4 w-56">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Ödeme Durumu</p>
                                  <button onClick={() => setCalendarPopup(null)} className="text-slate-400 hover:text-slate-600">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className={cn(
                                  "rounded-lg p-3 mb-3 text-center",
                                  overdue ? "bg-red-50 dark:bg-red-900/20" : upcoming ? "bg-amber-50 dark:bg-amber-900/20" : "bg-green-50 dark:bg-green-900/20"
                                )}>
                                  <p className="text-2xl font-bold mb-0.5">
                                    {overdue ? '🔴' : upcoming ? '🟡' : '🟢'}
                                  </p>
                                  <p className={cn(
                                    "text-sm font-semibold",
                                    overdue ? "text-red-700 dark:text-red-400" : upcoming ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"
                                  )}>
                                    {overdue
                                      ? `${Math.abs(days)} gün gecikmiş`
                                      : upcoming
                                        ? `${days} gün kaldı`
                                        : `${days} gün kaldı`}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    {overdue ? 'Ödeme bekleniyor' : 'Sonraki ödeme'}
                                  </p>
                                </div>
                                <a
                                  href={generateWhatsAppLink(client, settings)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => setCalendarPopup(null)}
                                  className={cn(
                                    "w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-white text-sm font-medium transition-colors",
                                    overdue ? "bg-red-500 hover:bg-red-600" : upcoming ? "bg-amber-500 hover:bg-amber-600" : "bg-green-500 hover:bg-green-600"
                                  )}
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  WP Mesajı Gönder
                                </a>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => onMarkPaid(client.id)}
                            className="p-2 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-colors"
                            title="Ödendi İşaretle"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onManageCards(client)}
                            className="p-2 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                            title={`Kartlar (${client.cards?.length || 1})`}
                          >
                            <Layers className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onEdit(client)}
                            className="p-2 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                            title="Düzenle"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              const isActive = client.cardStatus !== 'inactive';
                              const msg = isActive
                                ? `"${client.businessName}" kartını kapatmak istediğine emin misin? Kart okutulduğunda abonelik bitti sayfası görünecek.`
                                : `"${client.businessName}" kartını tekrar açmak istediğine emin misin?`;
                              if (window.confirm(msg)) {
                                onToggleCard(client.id, !isActive);
                              }
                            }}
                            className={cn(
                              "p-2 rounded-lg transition-colors",
                              client.cardStatus === 'inactive'
                                ? "text-green-600 bg-green-50 dark:bg-green-900/30 hover:bg-green-100"
                                : "text-orange-600 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100"
                            )}
                            title={client.cardStatus === 'inactive' ? "Kartı Aç" : "Kartı Kapat"}
                          >
                            {client.cardStatus === 'inactive' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              if(window.confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) {
                                onDelete(client.id);
                              }
                            }}
                            className="p-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-lg transition-colors"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BulkWhatsAppModal 
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        clients={selectedClients}
        settings={settings}
      />

      {/* Notes Modal */}
      {viewingNotesFor && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-slate-900/50 backdrop-blur-sm" onClick={() => setViewingNotesFor(null)} />
            <div className="inline-block w-full max-w-sm p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-slate-800 shadow-xl rounded-2xl relative z-10 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-amber-500" /> Notlar
                </h3>
                <button
                  onClick={() => setViewingNotesFor(null)}
                  className="p-2 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">{viewingNotesFor.businessName}</p>
              <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm">
                {viewingNotesFor.notes}
              </div>
              <div className="mt-5 text-right">
                <button
                  onClick={() => setViewingNotesFor(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
