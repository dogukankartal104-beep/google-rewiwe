import React, { useState, useEffect } from 'react';
import { Settings } from '../types';
import { X, Info, MessageCircle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (settings: Settings) => void;
}

const DEFAULT_TEMPLATES = {
  reminder: `Merhaba {{name}}, aylık NFC kart ödemeniz yaklaşmaktadır.\n\nSon ödeme tarihi: {{date}}\nÖdeme linkiniz: {{link}}\n\nİyi çalışmalar dileriz. 🙏`,
  overdue: `⚠️ Merhaba {{name}},\n\nNFC kart aboneliğinizin süresi dolmuştur.\n\nKartınız şu an aktif değil — müşterileriniz yorum sayfanıza ulaşamıyor.\n\nHemen aktifleştirin: {{link}}\n\nİyi çalışmalar.`,
  upcoming: `📅 Merhaba {{name}},\n\nNFC kart aboneliğinizin bitiş tarihi yaklaşıyor ({{date}}).\n\nKesintisiz hizmet için: {{link}}\n\nİyi çalışmalar! 🙏`,
};

export function SettingsModal({ isOpen, onClose, settings, onSave }: SettingsModalProps) {
  const [formData, setFormData] = useState<Settings>(settings);
  const [activeTab, setActiveTab] = useState<'general' | 'templates'>('general');

  useEffect(() => {
    setFormData(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="inline-block w-full max-w-xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-slate-800 shadow-xl rounded-2xl relative z-10 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-medium leading-6 text-slate-900 dark:text-white">Sistem Ayarları</h3>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-700 mb-5">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'general' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Genel
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'templates' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              WP Şablonları
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Aylık Abonelik Ücreti (₺)</label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-slate-500 dark:text-slate-400 sm:text-sm">₺</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      required
                      value={formData.monthlyFee}
                      onChange={e => setFormData({ ...formData, monthlyFee: Number(e.target.value) })}
                      className="pl-7 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                      placeholder="500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Ek Kart Ücreti (₺) <span className="text-xs text-slate-400 font-normal">— 2. ve sonraki kartlar için</span>
                  </label>
                  <div className="relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-slate-500 dark:text-slate-400 sm:text-sm">₺</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={formData.extraCardFee ?? 200}
                      onChange={e => setFormData({ ...formData, extraCardFee: Number(e.target.value) })}
                      className="pl-7 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                      placeholder="200"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'templates' && (
              <div className="space-y-5">
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-lg p-3">
                  <div className="flex items-start">
                    <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 mr-2 flex-shrink-0" />
                    <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
                      <p className="font-medium">Kullanılabilir değişkenler:</p>
                      <p><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded font-mono">{'{{name}}'}</code> İşletme adı &nbsp;
                      <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded font-mono">{'{{date}}'}</code> Bitiş tarihi &nbsp;
                      <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded font-mono">{'{{link}}'}</code> Shopier linki &nbsp;
                      <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded font-mono">{'{{days}}'}</code> Kalan/Geçen gün</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      📅 Hatırlatma Şablonu <span className="text-xs text-slate-400">(Normal ödeme hatırlatması)</span>
                    </label>
                    <button type="button" onClick={() => setFormData({ ...formData, waTemplate: DEFAULT_TEMPLATES.reminder })} className="text-xs text-blue-600 hover:underline">Sıfırla</button>
                  </div>
                  <textarea
                    rows={4}
                    value={formData.waTemplate}
                    onChange={e => setFormData({ ...formData, waTemplate: e.target.value })}
                    className="block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                  <p className="text-xs text-slate-400 mt-1">Bu şablon gecikmiş ve yaklaşan ödemeler için de otomatik uyarlanır.</p>
                </div>
              </div>
            )}

            <div className="pt-4 flex justify-end space-x-3 border-t border-slate-200 dark:border-slate-700">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
                İptal
              </button>
              <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700">
                Kaydet
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
