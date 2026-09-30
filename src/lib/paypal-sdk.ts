// ---------------------------------------------------------------------
//  PayPal JavaScript SDK v6.
//
//  This is the one script that cannot be bundled — PayPal requires their
//  hosted copy so they can update fraud and compliance logic without a
//  redeploy from us. Everything else in this app ships in app.js.
//
//  v6 is a different product from the classic Buttons SDK at
//  paypal.com/sdk/js. The core script is loaded from /web-sdk/v6/core,
//  then authenticated with createInstance({ clientId }). Orders are still
//  created and captured with the REST Orders v2 API on the server.
// ---------------------------------------------------------------------

import { paypalConfig, type PayPalEnvironment } from '../config/paypal.js';

export interface PayPalV6CreateInstanceOptions {
  clientId: string;
  components?: string[];
  pageType?: string;
}

export interface PayPalEligibleMethods {
  isEligible: (method: string) => boolean;
}

export interface PayPalOnApproveData {
  orderId: string;
  payerId?: string;
}

export interface PayPalPaymentSessionOptions {
  onApprove: (data: PayPalOnApproveData) => void | Promise<void>;
  onCancel?: (data?: { orderId?: string }) => void;
  onError?: (error: unknown) => void;
}

export interface PayPalPaymentSession {
  start: (
    options: { presentationMode?: string },
    orderPromise: Promise<{ orderId: string }>
  ) => Promise<void>;
  hasReturned?: () => boolean;
  resume?: () => Promise<void>;
}

export interface PayPalSdkInstance {
  findEligibleMethods: (options?: { currencyCode?: string }) => Promise<PayPalEligibleMethods>;
  createPayPalOneTimePaymentSession: (options: PayPalPaymentSessionOptions) => PayPalPaymentSession;
}

export interface PayPalV6Namespace {
  createInstance: (options: PayPalV6CreateInstanceOptions) => Promise<PayPalSdkInstance>;
}

declare global {
  interface Window {
    paypal?: PayPalV6Namespace;
  }
}

/** Duck-typed so tests can load the script without a browser document. */
export type PayPalScriptElement = {
  src: string;
  async: boolean;
  onload: ((this: unknown, ev?: Event) => unknown) | null;
  onerror: ((this: unknown, ev?: Event) => unknown) | null;
};

export type PayPalSdkHost = {
  getPaypal: () => PayPalV6Namespace | undefined;
  createScript: () => PayPalScriptElement;
  appendScript: (script: PayPalScriptElement) => void;
};

export function paypalV6CoreUrl(env: PayPalEnvironment): string {
  return env === 'live'
    ? 'https://www.paypal.com/web-sdk/v6/core'
    : 'https://www.sandbox.paypal.com/web-sdk/v6/core';
}

function browserHost(): PayPalSdkHost {
  return {
    getPaypal: () => window.paypal,
    createScript: () => document.createElement('script') as PayPalScriptElement,
    appendScript: (script) => {
      document.head.appendChild(script as HTMLScriptElement);
    },
  };
}

let sdk: Promise<PayPalV6Namespace> | null = null;

/** Test hook: a failed or swapped host must not reuse a previous promise. */
export function resetPayPalSdkCache(): void {
  sdk = null;
}

/**
 * Load the v6 core script once, lazily, on first use.
 *
 * The promise is cached module-wide so reopening the paywall — or React
 * re-running an effect — does not add another <script> tag.
 */
export function loadPayPalSdk(host: PayPalSdkHost = browserHost()): Promise<PayPalV6Namespace> {
  if (sdk) return sdk;

  sdk = new Promise<PayPalV6Namespace>((resolve, reject) => {
    const existing = host.getPaypal();
    if (existing?.createInstance) {
      resolve(existing);
      return;
    }

    const script = host.createScript();
    script.src = paypalV6CoreUrl(paypalConfig.PAYPAL_ENV);
    script.async = true;
    script.onload = () => {
      const loaded = host.getPaypal();
      if (loaded?.createInstance) resolve(loaded);
      else reject(new Error('PayPal SDK v6 loaded but window.paypal.createInstance is missing.'));
    };
    script.onerror = () => reject(new Error('Could not reach PayPal.'));
    host.appendScript(script);
  });

  // A failed load must not be cached, or the dialog stays broken until a
  // full page reload.
  sdk.catch(() => {
    sdk = null;
  });

  return sdk;
}
