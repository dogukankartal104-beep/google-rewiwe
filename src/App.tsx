import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './hooks/useStore';
import { Dashboard } from './components/Dashboard';
import { ClientTable } from './components/ClientTable';
import { ClientModal } from './components/ClientModal';
import { SettingsModal } from './components/SettingsModal';
import { CustomerPortal } from './components/CustomerPortal';
import { CardManager } from './components/CardManager';
import { CustomerDashboard } from './components/CustomerDashboard';
import { CardRedirect } from './components/CardRedirect';
import { Login } from './components/Login';
import { PaymentCalendar } from './components/PaymentCalendar';
import { LayoutDashboard, Users, Settings as SettingsIcon, Plus, CreditCard, Moon, Sun, CalendarDays } from 'lucide-react';
import { Client } from './types';
import { cn } from './lib/utils';

type Tab = 'dashboard' | 'clients' | 'calendar';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(
    sessionStorage.getItem('isAuthenticated') === 'true'
  );

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return <>{children}</>;
}

function AdminApp() {
  const { 
    clients, 
    settings, 
    setSettings, 
    addClient, 
    updateClient, 
    deleteClient, 
    markAsPaid,
    toggleCard,
    addCard,
    removeCard,
    toggleSingleCard,
    loading
  } = useStore();

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [cardManagerClient, setCardManagerClient] = useState<Client | null>(null);

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setIsClientModalOpen(true);
  };

  const handleSaveClient = (clientData: Omit<Client, 'createdAt'>) => {
    if (editingClient) {
      updateClient(editingClient.id, clientData);
    } else {
      addClient(clientData);
    }
    setEditingClient(null);
  };

  const handleOpenNewClientModal = () => {
    setEditingClient(null);
    setIsClientModalOpen(true);
  };

  const toggleTheme = () => {
    setSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header / Navbar */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex overflow-x-auto">
              <div className="flex-shrink-0 flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">NFC CRM</span>
              </div>
              <nav className="ml-4 sm:ml-8 flex space-x-2 my-auto">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
                    activeTab === 'dashboard' 
                      ? "bg-slate-100 dark:bg-slate-700 text-blue-700 dark:text-blue-400" 
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  <LayoutDashboard className="w-4 h-4 hidden sm:block" />
                  Pano
                </button>
                <button
                  onClick={() => setActiveTab('clients')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
                    activeTab === 'clients' 
                      ? "bg-slate-100 dark:bg-slate-700 text-blue-700 dark:text-blue-400" 
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  <Users className="w-4 h-4 hidden sm:block" />
                  Müşteriler
                </button>
                <button
                  onClick={() => setActiveTab('calendar')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
                    activeTab === 'calendar'
                      ? "bg-slate-100 dark:bg-slate-700 text-blue-700 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                >
                  <CalendarDays className="w-4 h-4 hidden sm:block" />
                  Takvim
                </button>
              </nav>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <button
                onClick={toggleTheme}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="Tema Değiştir"
              >
                {settings.theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="Ayarlar"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handleOpenNewClientModal}
                className="inline-flex items-center px-3 py-2 sm:px-4 sm:py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Yeni Müşteri</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <div className="fade-in">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Genel Bakış</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">İşletmenizin güncel durumu ve ödeme takibi.</p>
            </div>
            <Dashboard clients={clients} settings={settings} />
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="fade-in">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Müşteri Yönetimi</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Tüm NFC kart müşterilerinizi ve ödeme durumlarını yönetin.</p>
              </div>
            </div>
            <ClientTable 
              clients={clients} 
              settings={settings}
              onEdit={handleEditClient}
              onDelete={deleteClient}
              onMarkPaid={markAsPaid}
              onToggleCard={toggleCard}
              onManageCards={(client) => setCardManagerClient(client)}
            />
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="fade-in">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ödeme Takvimi</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Tüm müşterilerin ödeme günleri — yeşil: ödeme günü, sarı: 5 gün kaldı, kırmızı: gecikmiş.</p>
            </div>
            <PaymentCalendar clients={clients} settings={settings} />
          </div>
        )}
      </main>

      {/* Modals */}
      <ClientModal 
        isOpen={isClientModalOpen}
        onClose={() => {
          setIsClientModalOpen(false);
          setEditingClient(null);
        }}
        onSave={handleSaveClient}
        client={editingClient}
      />

      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSave={setSettings}
      />
      {cardManagerClient && (
        <CardManager
          client={cardManagerClient}
          settings={settings}
          onClose={() => setCardManagerClient(null)}
          onAddCard={addCard}
          onRemoveCard={removeCard}
          onToggleCard={toggleSingleCard}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProtectedRoute><AdminApp /></ProtectedRoute>} />
        <Route path="/analytics/:id" element={<ProtectedRoute><CustomerDashboard /></ProtectedRoute>} />
        <Route path="/musteri/:id" element={<CustomerPortal />} />
        <Route path="/card/:id" element={<CardRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
