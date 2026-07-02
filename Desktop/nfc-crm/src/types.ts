export interface Client {
  id: string;
  businessName: string;
  ownerName?: string;
  ownerAge?: string;
  countryCode: string;
  phoneNumber: string;
  linktreeUrl: string;
  location: string;
  lastPaymentDate: string;
  shopierLink: string;
  shopierProductId?: string;
  cardStatus?: 'active' | 'inactive';
  cardId?: string;
  cards?: ClientCard[];
  createdAt: string;
  notes?: string;
  paymentHistory?: string[];
}

export interface ClientCard {
  id: string;
  slug: string;
  google_review_url: string;
  status: 'active' | 'inactive' | 'lost';
  label?: string; // "Giriş Kapısı", "Kasa" gibi
}

export interface Settings {
  waTemplate: string;
  monthlyFee: number;
  extraCardFee: number; // 2. ve sonraki kartlar için ek ücret
  theme: 'light' | 'dark';
}

// --- SaaS Platform Types ---

export interface Profile {
  id: string;
  role: 'admin' | 'business';
  full_name?: string;
  created_at: string;
}

export interface Business {
  id: string;
  owner_id: string;
  business_name: string;
  owner_name?: string;
  owner_age?: string;
  location?: string;
  notes?: string;
  email?: string;
  phone_number?: string;
  country_code?: string;
  shopier_link?: string;
  shopier_product_id?: string;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface Subscription {
  id: string;
  business_id: string;
  status: 'active' | 'past_due' | 'canceled' | 'expired';
  monthly_fee: number;
  current_period_start: string;
  current_period_end: string;
}

export interface Card {
  id: string;
  business_id: string;
  slug: string;
  google_review_url: string;
  status: 'active' | 'inactive' | 'lost';
  activation_date?: string;
}

export interface ScanLog {
  id: string;
  card_id: string;
  scanned_at: string;
  os?: string;
  browser?: string;
  device_type?: string;
}

export interface PaymentLog {
  id: string;
  business_id: string;
  amount: number;
  currency: string;
  status: string;
  paid_at: string;
}
