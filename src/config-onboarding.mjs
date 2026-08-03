export const API_ONBOARDING_SEEN_KEY = 'api_onboarding_seen';

export function shouldShowApiOnboarding({ apiKey = '', seen = false } = {}) {
  return !String(apiKey || '').trim() && !Boolean(seen);
}
