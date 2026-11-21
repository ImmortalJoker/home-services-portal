export type RedirectUriSpec = { env: string; matchingMode: 'strict'; type: 'authorization' | 'logout' };

type BaseProviderSpec = {
  key: string;
  conditions: string[];
  requiredWhenEnabled: string[];
  providerName: string;
  slug: string;
  metaHide: boolean;
  bindings: string[];
};

export type ProxyProviderSpec = BaseProviderSpec & {
  kind: 'proxy';
  internalHost: { literal: string } | { env: string };
  externalHostEnv: string;
  basicAuth: null | {
    userAttribute: string;
    passwordAttribute: string;
    userEnv: string;
    passwordEnv: string;
    group: string;
  };
  propertyMappings: Array<{ name: string; expression: string }>;
};

export type OAuth2ProviderSpec = BaseProviderSpec & {
  kind: 'oauth2';
  clientId: string;
  clientSecretEnv: string;
  redirectUris: RedirectUriSpec[];
  optionalRedirectGroups: RedirectUriSpec[][];
  scopes: string[];
  customMappings: Array<{ name: string; scopeName: string; expression: string }>;
  forbiddenClaims: string[];
};

export type OptionalProviderSpec = ProxyProviderSpec | OAuth2ProviderSpec;

export const PORTAL_GROUP_NAMES: string[];
export const OPTIONAL_PROVIDERS: OptionalProviderSpec[];
export function normalizeExpression(text: unknown): string;
export function buildOptionalProviderVerification(): string;
