import { useState, useEffect } from 'react';
import { Client, ClientCard, Settings } from '../types';
import { supabase } from '../lib/supabase';

export function useStore() {
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<Settings>({
    waTemplate: "Merhaba {{name}}, aylık NFC kart ödemeniz gelmiştir. Son ödeme tarihiniz: {{date}}. İşleminizi tamamlamak için ödeme linkiniz: {{link}}\n\nİyi çalışmalar dileriz.",
    monthlyFee: 500,
    extraCardFee: 200,
    theme: 'light'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: bData, error: bError } = await supabase
          .from('businesses')
          .select(`
            *,
            subscriptions (*),
            cards (*),
            payment_logs (*)
          `);
          
        if (!bError && bData) {
          const mappedClients: Client[] = bData.map(b => {
            const sub = b.subscriptions?.[0];
            const allCards: ClientCard[] = (b.cards || []).map((c: any) => ({
              id: c.id,
              slug: c.slug,
              google_review_url: c.google_review_url,
              status: c.status,
              label: c.label || '',
            }));
            const firstCard = allCards[0];
            const payments = b.payment_logs || [];
            
            return {
              id: b.id,
              businessName: b.business_name,
              ownerName: b.owner_name || '',
              ownerAge: b.owner_age || '',
              location: b.location || '',
              notes: b.notes || '',
              phoneNumber: b.phone_number || '',
              countryCode: b.country_code || '+90',
              shopierLink: b.shopier_link || '',
              shopierProductId: b.shopier_product_id || '',
              linktreeUrl: firstCard?.google_review_url || '',
              cardStatus: firstCard?.status || 'active',
              cardId: firstCard?.id || '',
              cards: allCards,
              lastPaymentDate: sub?.current_period_end || new Date().toISOString(),
              paymentHistory: payments.map((p: any) => p.paid_at),
              createdAt: b.created_at
            };
          });
          setClients(mappedClients);
        }

        const { data: settingsData, error: settingsError } = await supabase
          .from('settings')
          .select('*')
          .eq('key', 'global')
          .single();

        if (!settingsError && settingsData) {
          setSettings(prev => ({ ...prev, ...settingsData.value as Settings }));
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const channel = supabase.channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Theme listener
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  const updateSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    await supabase.from('settings').upsert({ key: 'global', value: newSettings });
  };

  const addClient = async (client: Omit<Client, 'createdAt'>) => {
    // 1. Insert Business
    const { data: bData, error: bError } = await supabase.from('businesses').insert([{
      id: client.id,
      business_name: client.businessName,
      owner_name: client.ownerName,
      owner_age: client.ownerAge,
      location: client.location,
      notes: client.notes,
      phone_number: client.phoneNumber,
      country_code: client.countryCode,
      shopier_link: client.shopierLink,
      shopier_product_id: client.shopierProductId || null,
    }]).select().single();

    if (bError || !bData) {
      console.error("Error creating business:", bError);
      return;
    }

    const businessId = bData.id;

    // 2. Insert Subscription (30 days from now)
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (30 * 24 * 60 * 60 * 1000));
    
    await supabase.from('subscriptions').insert([{
      business_id: businessId,
      status: 'active',
      monthly_fee: settings.monthlyFee,
      current_period_start: startDate.toISOString(),
      current_period_end: endDate.toISOString()
    }]);

    // 3. Insert Card
    await supabase.from('cards').insert([{
      business_id: businessId,
      slug: businessId, // using businessId as default slug, can be updated later
      google_review_url: client.linktreeUrl,
      status: 'active'
    }]);
  };

  const updateClient = async (id: string, updates: Partial<Client>) => {
    // 1. Update Business
    if (updates.businessName !== undefined || updates.ownerName !== undefined || updates.ownerAge !== undefined || updates.location !== undefined || updates.notes !== undefined || updates.phoneNumber !== undefined || updates.countryCode !== undefined || updates.shopierLink !== undefined || updates.shopierProductId !== undefined) {
      await supabase.from('businesses').update({
        business_name: updates.businessName,
        owner_name: updates.ownerName,
        owner_age: updates.ownerAge,
        location: updates.location,
        notes: updates.notes,
        phone_number: updates.phoneNumber,
        country_code: updates.countryCode,
        shopier_link: updates.shopierLink,
        shopier_product_id: updates.shopierProductId,
      }).eq('id', id);
    }

    // 2. Update Card (google_review_url is mapped to linktreeUrl in the UI)
    if (updates.linktreeUrl) {
      await supabase.from('cards').update({
        google_review_url: updates.linktreeUrl
      }).eq('business_id', id);
    }
    
    // 3. Update Subscription (lastPaymentDate)
    if (updates.lastPaymentDate) {
       await supabase.from('subscriptions').update({
         current_period_end: updates.lastPaymentDate,
         status: 'active' // assuming they just paid
       }).eq('business_id', id);
    }
  };

  const deleteClient = async (id: string) => {
    // RLS ON DELETE CASCADE will handle cards, subscriptions, and logs
    await supabase.from('businesses').delete().eq('id', id);
  };

  const markAsPaid = async (id: string) => {
    // Log Payment
    await supabase.from('payment_logs').insert([{
      business_id: id,
      amount: settings.monthlyFee,
      currency: 'TRY',
      status: 'success'
    }]);
    
    // Update Subscription (extend by 30 days)
    const client = clients.find(c => c.id === id);
    if (!client) return;
    
    const currentEnd = new Date(client.lastPaymentDate || new Date());
    const now = new Date();
    const baseDate = currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(baseDate.getTime() + (30 * 24 * 60 * 60 * 1000));
    
    await updateClient(id, { 
      lastPaymentDate: newEndDate.toISOString()
    });
  };

  const toggleCard = async (businessId: string, active: boolean) => {
    const client = clients.find(c => c.id === businessId);
    if (!client?.cardId) return;
    await supabase
      .from('cards')
      .update({ status: active ? 'active' : 'inactive' })
      .eq('id', client.cardId);
    setClients(prev => prev.map(c =>
      c.id === businessId ? { ...c, cardStatus: active ? 'active' : 'inactive' } : c
    ));
  };

  const toggleSingleCard = async (businessId: string, cardId: string, active: boolean) => {
    await supabase
      .from('cards')
      .update({ status: active ? 'active' : 'inactive' })
      .eq('id', cardId);
    setClients(prev => prev.map(c => {
      if (c.id !== businessId) return c;
      return {
        ...c,
        cards: c.cards?.map(card =>
          card.id === cardId ? { ...card, status: active ? 'active' : 'inactive' } : card
        ),
        cardStatus: cardId === c.cardId ? (active ? 'active' : 'inactive') : c.cardStatus,
      };
    }));
  };

  const addCard = async (businessId: string, googleReviewUrl: string, label: string) => {
    const cardId = crypto.randomUUID();
    const { error } = await supabase.from('cards').insert([{
      id: cardId,
      business_id: businessId,
      slug: cardId,
      google_review_url: googleReviewUrl,
      status: 'active',
      label,
    }]);
    if (!error) {
      setClients(prev => prev.map(c => {
        if (c.id !== businessId) return c;
        const newCard = { id: cardId, slug: cardId, google_review_url: googleReviewUrl, status: 'active' as const, label };
        return { ...c, cards: [...(c.cards || []), newCard] };
      }));
    }
    return error;
  };

  const removeCard = async (businessId: string, cardId: string) => {
    const client = clients.find(c => c.id === businessId);
    if (client?.cardId === cardId) return; // ilk kartı silme
    await supabase.from('cards').delete().eq('id', cardId);
    setClients(prev => prev.map(c => {
      if (c.id !== businessId) return c;
      return { ...c, cards: c.cards?.filter(card => card.id !== cardId) };
    }));
  };

  return {
    clients,
    settings,
    setSettings: updateSettings,
    addClient,
    updateClient,
    deleteClient,
    markAsPaid,
    toggleCard,
    toggleSingleCard,
    addCard,
    removeCard,
    loading
  };
}

