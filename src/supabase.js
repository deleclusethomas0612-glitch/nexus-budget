import { createClient } from '@supabase/supabase-js';

// On utilise des variables d'environnement pour la sécurité
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);