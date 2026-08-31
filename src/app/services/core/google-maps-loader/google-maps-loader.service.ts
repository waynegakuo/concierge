import {Injectable, PLATFORM_ID, inject, EnvironmentInjector, runInInjectionContext} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { Functions, httpsCallable } from '@angular/fire/functions';

@Injectable({
  providedIn: 'root',
})
export class GoogleMapsLoaderService {
  private readonly platformId = inject(PLATFORM_ID);
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  private readonly functions = inject(Functions);
  private environmentInjector = inject(EnvironmentInjector);

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    return runInInjectionContext(this.environmentInjector, () => {
      if (this.initializationPromise) {
        return this.initializationPromise;
      }

      this.initializationPromise = (async () => {
        try {
          const loadGoogleMaps = httpsCallable<unknown, { key: string }>(
            this.functions,
            'loadGoogleMaps',
          );
          const { data } = await loadGoogleMaps();
          setOptions({ key: data.key, libraries: ['maps', 'marker', 'places', 'routes'] });
          this.initialized = true;
        } catch (error) {
          console.error('Failed to initialize Google Maps via Cloud Function:', error);
          this.initializationPromise = null;
          throw error;
        }
      })();

      return this.initializationPromise;
    })


  }

  async importLibrary(library: string): Promise<unknown> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(null);
    }
    await this.ensureInitialized();
    return importLibrary(library);
  }
}
