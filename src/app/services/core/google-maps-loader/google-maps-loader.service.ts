import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

const MAPS_API_KEY = 'AIzaSyB3rTCREFqI2dX3B53vrG47vTve8NJ1--4';

@Injectable({
  providedIn: 'root',
})
export class GoogleMapsLoaderService {
  private readonly platformId = inject(PLATFORM_ID);
  private initialized = false;

  private ensureInitialized(): void {
    if (!this.initialized) {
      setOptions({ key: MAPS_API_KEY, v: 'alpha', libraries: ['places'] });
      this.initialized = true;
    }
  }

  async importLibrary(library: string): Promise<unknown> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(null);
    }
    this.ensureInitialized();
    return importLibrary(library);
  }
}
