import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type ThreatEvent = {
  id: string;
  device_id: string;
  risk: number;
  threat_type: 'phishing' | 'credential_theft' | 'malware' | 'safe';
  reason: string;
  location: string;
  action: 'block' | 'warn' | 'allow';
  timestamp: number;
  created_at: string;
};
