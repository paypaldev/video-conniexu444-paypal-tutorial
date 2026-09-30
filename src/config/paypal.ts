import { CONFIGURED } from './supabase.js';

export type PayPalEnvironment = 'sandbox' | 'live';

export interface PayPalConfig {
  PAYPAL_CLIENT_ID: string;
  /** Must match the Edge Function secret PAYPAL_ENV. v6 hosts a different
   *  core script per environment; classic sdk/js inferred this from the
   *  client id and did not. */
  PAYPAL_ENV: PayPalEnvironment;
}

export const paypalConfig: PayPalConfig = {
  PAYPAL_CLIENT_ID: 'AfE_q3v6kHes_bLdsXxMK4a78CjCG-Qs1hSjLkxaOm709HTwLzYj5YluSv4pN72iwkZin6HMpsIrMdBy',
  PAYPAL_ENV: 'sandbox',
};

export const PAYMENTS_ENABLED: boolean =
  CONFIGURED && !paypalConfig.PAYPAL_CLIENT_ID.includes('YOUR-');
