import React, { useState } from 'react';
import { Client, Settings } from '../types';
import { generateWhatsAppLink, cn } from '../lib/utils';
import { X, Send, CheckCircle2, ExternalLink } from 'lucide-react';

interface BulkWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  settings: Settings;
}

export function BulkWhatsAppModal({ isOpen, onClose, clients, settings }: BulkWhatsAppModalProps) {
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleSend = (client: Client) => {
    const url = generateWhatsAppLink(client, settings);
    window.open(url, '_blank');
    setSentIds(prev => new Set(prev).add(client.id));
  };

  const allSent = clients.length > 0 && sentIds.size === clients.length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

        <div className="inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-slate-800 shadow-xl rounded-2xl relative z-10 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Toplu WhatsApp Hatırlatması
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Seçili {clients.length} müşteriye ödeme hatırlatması gönderin.
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-sm p-4 rounded-lg mb-4 border border-blue-100 dark:border-blue-800">
            <strong>Bilgi:</strong> WhatsApp web/uygulama kısıtlamaları nedeniyle mesajları tek tek göndermeniz gerekmektedir. Aşağıdaki listeden sırayla gönderim yapabilirsiniz.
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
            {clients.map(client => {
              const isSent = sentIds.has(client.id);
              return (
                <div key={client.id} className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                  <div>
                    <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      {client.businessName}
                      {isSent && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    </h4>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">{client.phoneNumber}</p>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center">
                      <ExternalLink className="w-3 h-3 mr-1" />
                      Shopier: {client.shopierLink}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleSend(client)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      isSent 
                        ? "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900" 
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    )}
                  >
                    {isSent ? 'Tekrar Gönder' : 'Gönder'}
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Durum: {sentIds.size} / {clients.length} gönderildi
            </span>
            <button
              onClick={onClose}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-colors text-white",
                allSent ? "bg-green-600 hover:bg-green-700" : "bg-slate-800 hover:bg-slate-700"
              )}
            >
              {allSent ? 'Tümü Tamamlandı - Kapat' : 'Kapat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
