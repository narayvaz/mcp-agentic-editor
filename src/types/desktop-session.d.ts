export {};
declare global {
  interface Window {
    studioDesktop?: {
      getSession: () => Promise<{ token: string; origin: string }>;
    };
  }
}
