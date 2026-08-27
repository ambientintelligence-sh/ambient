export type BrowserMode = 'headless' | 'visible';

export type BrowserState = Readonly<{
  mode: BrowserMode;
  available: boolean;
}>;
