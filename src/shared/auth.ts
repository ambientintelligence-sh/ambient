export type AuthMethod = 'oauth' | 'api_key';

export type AuthProvider = Readonly<{
  id: string;
  name: string;
  configured: boolean;
  configuredType: AuthMethod | null;
  methods: readonly AuthMethod[];
}>;

export type DelegationModel = Readonly<{
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
}>;

export type DelegationSelection = Readonly<{ provider: string; model: string }>;

export type AuthState = Readonly<{
  providers: readonly AuthProvider[];
  models: readonly DelegationModel[];
  selection: DelegationSelection | null;
}>;

export type LoginPrompt = Readonly<{
  id: string;
  type: 'text' | 'secret' | 'select' | 'manual_code';
  message: string;
  placeholder?: string;
  options?: readonly Readonly<{ id: string; label: string; description?: string }>[];
}>;

export type LoginNotice =
  | Readonly<{ type: 'auth_url'; url: string; instructions?: string }>
  | Readonly<{
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }>
  | Readonly<{ type: 'info'; message: string; links?: readonly Readonly<{ url: string; label?: string }>[] }>
  | Readonly<{ type: 'progress'; message: string }>;

export type AuthEvent =
  | Readonly<{ type: 'prompt'; prompt: LoginPrompt }>
  | Readonly<{ type: 'notice'; notice: LoginNotice }>
  | Readonly<{ type: 'complete'; providerId: string }>
  | Readonly<{ type: 'cancelled' }>
  | Readonly<{ type: 'error'; message: string }>;
