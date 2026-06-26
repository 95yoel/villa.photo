import { Injectable } from '@angular/core';

type AnalyticsValue = string | number | boolean;

type GtagWindow = Window & {
  gtag?: (
    command: 'event',
    eventName: string,
    params?: Record<string, AnalyticsValue>
  ) => void;
};

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  trackEvent(
    eventName: string,
    params: Record<string, AnalyticsValue> = {}
  ): void {
    const gtag = (window as GtagWindow).gtag;

    if (!gtag) {
      return;
    }

    gtag('event', eventName, params);
  }
}
