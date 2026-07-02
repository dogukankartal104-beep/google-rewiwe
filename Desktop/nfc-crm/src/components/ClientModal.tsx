import React, { useState, useEffect } from 'react';
import { Client } from '../types';
import { X, Copy, CheckCircle, ArrowRight, Link } from 'lucide-react';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (client: Omit<Client, 'createdAt'>) => void;
  client?: Client | null;
}

const countryCodes = [
  { code: '+90', label: 'TR (+90)' },
  { code: '+1', label: 'US (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+49', label: 'DE (+49)' },
  { code: '+33', label: 'FR (+33)' },
  { code: '+31', label: 'NL (+31)' },
  { code: '+971', label: 'AE (+971)' },
  { code: '+359', label: 'BG (+359)' },
  { code: '+994', label: 'AZ (+994)' },
];

export function ClientModal({ isOpen, onClose, onSave, client }: ClientModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [formData, setFormData] = useState({
    id: '',
    businessName: '',
    ownerName: '',
    ownerAge: '',
    countryCode: '+90',
    phoneNumber: '',
    linktreeUrl: '',
    location: '',
    shopierLink: '',
    shopierProductId: '',
    lastPaymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (client) {
      setFormData({
        id: client.id,
        businessName: client.businessName,
        ownerName: client.ownerName || '',
        ownerAge: client.ownerAge || '',
        countryCode: client.countryCode || '+90',
        phoneNumber: client.phoneNumber,
        linktreeUrl: client.linktreeUrl,
        location: client.location || '',
        shopierLink: client.shopierLink,
        shopierProductId: client.shopierProductId || '',
        lastPaymentDate: new Date(client.lastPaymentDate).toISOString().split('T')[0],
        notes: client.notes || '',
      });
      setStep(2);
    } else if (isOpen) {
      setFormData({
        id: crypto.randomUUID(), // Generate a unique ID for the new client
        businessName: '',
        ownerName: '',
        ownerAge: '',
        countryCode: '+90',
        phoneNumber: '',
        linktreeUrl: '',
        location: '',
        shopierLink: '',
        shopierProductId: '',
        lastPaymentDate: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        notes: '',
      });
      setStep(1);
    }
    setCopied(false);
  }, [client, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      lastPaymentDate: new Date(formData.lastPaymentDate).toISOString(),
    });
    onClose();
  };

  const nfcLink = `${window.location.origin}/card/${formData.id}`;

  const copyNfcLink = () => {
    navigator.clipboard.writeText(nfcLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

        <div className="inline-block w-full max-w-2xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-slate-800 shadow-xl rounded-2xl relative z-10 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-medium leading-6 text-slate-900 dark:text-white">
              {client ? 'Müşteriyi Düzenle' : step === 1 ? 'Adım 1: NFC Linkini Oluştur' : 'Adım 2: İşletme Bilgileri'}
            </h3>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {step === 1 ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  İşletmenin Orijinal Google Review Linkini Girin
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Link className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="url"
                    required
                    value={formData.linktreeUrl}
                    onChange={e => setFormData({ ...formData, linktreeUrl: e.target.value })}
                    className="block w-full pl-10 pr-3 py-3 border border-slate-300 dark:border-slate-600 rounded-xl shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    placeholder="https://g.page/r/..."
                  />
                </div>
              </div>

              {formData.linktreeUrl && (
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-xl p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div>
                    <h4 className="text-sm font-bold text-blue-900 dark:text-blue-300 flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                      NFC Linkiniz Hazır!
                    </h4>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                      Lütfen aşağıdaki linki kopyalayıp <strong>NFC Tools</strong> vb. bir uygulama ile karta yazın.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3 rounded-lg border border-blue-100 dark:border-blue-700">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate w-full" title={nfcLink}>
                      {nfcLink}
                    </span>
                    <button
                      type="button"
                      onClick={copyNfcLink}
                      className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors w-full sm:w-auto shrink-0"
                    >
                      {copied ? (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          <span>Kopyalandı</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Kopyala</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-6 flex justify-end space-x-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  İptal
                </button>
                <button
                  type="button"
                  disabled={!formData.linktreeUrl || !copied}
                  onClick={() => setStep(2)}
                  className="px-4 py-2 flex items-center space-x-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <span>Karta Yazdım, Devam Et</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
              {client && (
                <div className="md:col-span-2 mb-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-1">Müşteriye Özel NFC Linki</p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 truncate max-w-xs sm:max-w-md" title={nfcLink}>
                      {nfcLink}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyNfcLink}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors shadow-sm whitespace-nowrap"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Kopyalandı</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Kopyala</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Google Review Linki (Orijinal)</label>
                <input
                  type="url"
                  required
                  value={formData.linktreeUrl}
                  onChange={e => setFormData({ ...formData, linktreeUrl: e.target.value })}
                  className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                  placeholder="https://g.page/r/..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">İşletme Adı</label>
              <input
                type="text"
                required
                value={formData.businessName}
                onChange={e => setFormData({ ...formData, businessName: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Örn: Kahve Dünyası"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">İşletme Sahibi Adı Soyadı</label>
              <input
                type="text"
                value={formData.ownerName}
                onChange={e => setFormData({ ...formData, ownerName: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Örn: Ahmet Yılmaz"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">İşletme Sahibi Yaşı</label>
              <input
                type="number"
                value={formData.ownerAge}
                onChange={e => setFormData({ ...formData, ownerAge: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Örn: 35"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Telefon Numarası</label>
              <div className="mt-1 flex gap-2">
                <select
                  value={formData.countryCode}
                  onChange={e => setFormData({ ...formData, countryCode: e.target.value })}
                  className="block w-28 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                >
                  {countryCodes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
                <input
                  type="tel"
                  required
                  value={formData.phoneNumber}
                  onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
                  className="block flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                  placeholder="555 555 5555"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Konum</label>
              <input
                type="text"
                value={formData.location}
                onChange={e => setFormData({ ...formData, location: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Örn: Kadıköy, İstanbul"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Shopier Ödeme Linki</label>
              <input
                type="url"
                required
                value={formData.shopierLink}
                onChange={e => setFormData({ ...formData, shopierLink: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="https://shopier.com/..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Shopier Ürün ID <span className="text-xs text-slate-400 font-normal">(otomatik ödeme eşleştirme için)</span>
              </label>
              <input
                type="text"
                value={formData.shopierProductId || ''}
                onChange={e => setFormData({ ...formData, shopierProductId: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Shopier panelinde ürünün ID'si (örn: 12345678)"
              />
              <p className="mt-1 text-xs text-slate-400">
                Bu müşteri için ayrı bir Shopier ürünü/linki oluşturduysan, o ürünün ID'sini buraya yaz.
                Ödeme geldiğinde sistem bu ID ile hangi müşterinin ödediğini otomatik anlar.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Özel Notlar</label>
              <textarea
                rows={3}
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
                placeholder="Müşteri hakkında notlar..."
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Son Ödeme Tarihi</label>
              <input
                type="date"
                required
                value={formData.lastPaymentDate}
                onChange={e => setFormData({ ...formData, lastPaymentDate: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:text-sm"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Gelecek ödeme tarihi bu tarihten 1 ay sonrası olarak hesaplanır.
              </p>
            </div>

            <div className="md:col-span-2 pt-4 flex justify-end space-x-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={!client && step === 2 ? () => setStep(1) : onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {!client && step === 2 ? 'Geri Dön' : 'İptal'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Kaydet
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}
