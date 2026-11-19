import { contextBridge } from 'electron';

/**
 * Runs in every page of every profile session (registered by sessions.ts), before the page's scripts.
 * Electron has no passkey UI, so a WebAuthn request would wait forever (Google's sign-in hangs on its
 * passkey step). Passkey requests (`publicKey` option) fail at once instead, so sites offer another way;
 * other credential calls (passwords, federated) are untouched.
 */
function failPasskeysFast(message: string): void {
  if (typeof CredentialsContainer === 'undefined') return; // insecure contexts have no navigator.credentials
  const proto = CredentialsContainer.prototype;
  for (const name of ['get', 'create'] as const) {
    const original = proto[name] as (this: CredentialsContainer, options?: CredentialRequestOptions) => Promise<Credential | null>;
    if (typeof original !== 'function') continue;
    const wrapped = {
      [name](this: CredentialsContainer, options?: CredentialRequestOptions & CredentialCreationOptions) {
        if (options != null && typeof options === 'object' && options.publicKey != null) {
          return Promise.reject(new DOMException(message, 'NotAllowedError'));
        }
        return Reflect.apply(original, this, arguments);
      },
    }[name];
    Object.defineProperty(proto, name, { ...Object.getOwnPropertyDescriptor(proto, name), value: wrapped });
  }
}

contextBridge.executeInMainWorld({ func: failPasskeysFast, args: ['Passkeys are not supported in Superbrowser yet'] });
