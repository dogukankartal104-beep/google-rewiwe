import React, { useState } from 'react';
import { Client, ClientCard, Settings } from '../types';
import { SmartphoneNfc, Plus, Trash2, WifiOff, Wifi, Copy, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  client: Client;
  settings: Settings;
  onClose: () => void;
  onAddCard: (businessId: string, reviewUrl: string, label: string) => Promise<any>;
  onRemoveCard: (businessId: string, cardId: string) => void;
  onToggleCard: (businessId: string, cardId: string, active: boolean) => void;
}

export function CardManager({ client, settings, onClose, onAddCard, onRemoveCard, onToggleCard }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState(client.linktreeUrl);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const cards = client.cards || [];
  const extraCards = cards.length - 1;
  const totalFee = settings.monthlyFee + (extraCards > 0 ? extraCards * (settings.extraCardFee || 200) : 0);

  const copyLink = (cardId: string) => {
    const link = `${window.location.origin}/card/${cardId}`;
    navigator.clipboard.writeText(link);
    setCopiedId(cardId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    const err = await onAddCard(client.id, newUrl.trim(), newLabel.trim() || `Kart ${cards.length + 1}`);
    if (!err) {
      setShowAddForm(false);
      setNewLabel('');
      setNewUrl(client.linktreeUrl);
    }
    setAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 sm:block sm:p-0">
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="inline-block w-full max-w-lg p-6 my-8 text-left align-middle bg-white dark:bg-slate-800 shadow-xl rounded-2xl relative z-10 border border-slate-200 dark:border-slate-700">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <SmartphoneNfc className="w-5 h-5 text-blue-600" />
                Kart Yönetimi
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{client.businessName}</p>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Ücret özeti */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Toplam Aylık Ücret</p>
              <p className="text-lg font-bold text-blue-700 dark:text-blue-300">₺{totalFee}</p>
            </div>
            <div className="text-right text-xs text-blue-600 dark:text-blue-400">
              <p>1. kart: ₺{settings.monthlyFee}</p>
              {extraCards > 0 && <p>+{extraCards} ek kart: ₺{extraCards * (settings.extraCardFee || 200)}</p>}
            </div>
          </div>

          {/* Kart listesi */}
          <div className="space-y-2 mb-4">
            {cards.map((card: ClientCard, i: number) => (
              <div key={card.id} className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  card.status === 'active' ? "bg-green-500" : "bg-red-500"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-white">
                    {card.label || `Kart ${i + 1}`}
                    {i === 0 && <span className="ml-2 text-xs text-slate-400">(Ana Kart)</span>}
                  </p>
                  <p className="text-xs text-slate-400 font-mono truncate">/card/{card.id.slice(0, 12)}...</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => copyLink(card.id)}
                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                    title="NFC Linkini Kopyala"
                  >
                    {copiedId === card.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => onToggleCard(client.id, card.id, card.status !== 'active')}
                    className={cn(
                      "p-1.5 rounded-lg transition-colors",
                      card.status === 'active'
                        ? "text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                        : "text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30"
                    )}
                    title={card.status === 'active' ? "Kartı Kapat" : "Kartı Aç"}
                  >
                    {card.status === 'active' ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
                  </button>
                  {i > 0 && (
                    <button
                      onClick={() => {
                        if (window.confirm(`"${card.label || `Kart ${i + 1}`}" silinsin mi?`)) {
                          onRemoveCard(client.id, card.id);
                        }
                      }}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      title="Kartı Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Yeni kart ekle formu */}
          {showAddForm ? (
            <div className="border border-blue-200 dark:border-blue-800 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/20 space-y-3">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Yeni Kart Ekle</p>
              <input
                type="text"
                placeholder='Kart etiketi (örn. "Kasa", "Giriş")'
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="url"
                placeholder="Google Review linki (boş bırakırsan ana link kullanılır)"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Bu kart +₺{settings.extraCardFee || 200}/ay ücrete dahil edilecek.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {adding ? 'Ekleniyor...' : 'Kart Ekle'}
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-lg hover:bg-slate-50"
                >
                  İptal
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Yeni Kart Ekle (+₺{settings.extraCardFee || 200}/ay)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
