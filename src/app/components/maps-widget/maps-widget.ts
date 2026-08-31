import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GoogleMapsLoaderService } from '../../services/core/google-maps-loader/google-maps-loader.service';
import { MapsPlace } from '../../models/chat.model';

const MAP_ID = 'DEMO_MAP_ID';

@Component({
  selector: 'app-maps-widget',
  imports: [],
  templateUrl: './maps-widget.html',
  styleUrl: './maps-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MapsWidget {
  readonly places = input<MapsPlace[]>([]);
  readonly isLoading = signal(true);
  readonly librariesReady = signal(false);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly mapElement = viewChild<ElementRef<HTMLElement>>('mapElement');

  private renderedKey = '';

  constructor() {
    afterRenderEffect({
      write: () => {
        if (!isPlatformBrowser(this.platformId) || !this.librariesReady()) {
          return;
        }
        const places = this.places();
        const container = this.mapElement()?.nativeElement;
        if (!places.length || !container) {
          return;
        }
        void this.renderMap(container, places);
      },
    });

    if (isPlatformBrowser(this.platformId)) {
      void this.loadLibraries();
    } else {
      this.isLoading.set(false);
    }
  }

  private async loadLibraries(): Promise<void> {
    try {
      await Promise.all([
        this.mapsLoader.importLibrary('maps'),
        this.mapsLoader.importLibrary('marker'),
        this.mapsLoader.importLibrary('places'),
      ]);
      this.isLoading.set(false);
      this.librariesReady.set(true);
    } catch (err) {
      console.error('[MapsWidget] Failed to load Maps libraries:', err);
      this.isLoading.set(false);
    }
  }

  private async renderMap(container: HTMLElement, places: MapsPlace[]): Promise<void> {
    const key = places.map((place) => place.placeId).join(',');
    if (key === this.renderedKey) {
      return;
    }
    this.renderedKey = key;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const googleMaps = (window as any)['google']?.maps;
    if (!googleMaps?.Map) {
      console.error('[MapsWidget] Google Maps JS API is not available');
      this.renderedKey = '';
      return;
    }

    try {
      const locations = await this.resolvePlaceLocations(googleMaps, places);
      if (!locations.length) {
        container.replaceChildren();
        return;
      }

      const map = new googleMaps.Map(container, {
        mapId: MAP_ID,
        center: locations[0].position,
        zoom: locations.length === 1 ? 15 : 12,
        clickableIcons: false,
      });

      const bounds = new googleMaps.LatLngBounds();
      for (const location of locations) {
        this.createMarker(googleMaps, map, location.position, location.title);
        bounds.extend(location.position);
      }

      if (locations.length > 1) {
        map.fitBounds(bounds, 64);
      }
    } catch (err) {
      console.error('[MapsWidget] Failed to render map:', err);
      this.renderedKey = '';
    }
  }

  private async resolvePlaceLocations(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleMaps: any,
    places: MapsPlace[],
  ): Promise<Array<{ position: unknown; title: string }>> {
    const Place = googleMaps.places?.Place;
    if (!Place) {
      return [];
    }

    const resolved = await Promise.all(
      places.map(async (place) => {
        try {
          const mapsPlace = new Place({ id: place.placeId });
          await mapsPlace.fetchFields({ fields: ['displayName', 'location'] });
          if (!mapsPlace.location) {
            return null;
          }
          return {
            position: mapsPlace.location,
            title: mapsPlace.displayName || place.title || 'Place',
          };
        } catch (err) {
          console.error(`[MapsWidget] Failed to load place ${place.placeId}:`, err);
          return null;
        }
      }),
    );

    return resolved.filter((item): item is { position: unknown; title: string } => item !== null);
  }

  private createMarker(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleMaps: any,
    map: unknown,
    position: unknown,
    title: string,
  ): void {
    const AdvancedMarkerElement = googleMaps.marker?.AdvancedMarkerElement;
    if (AdvancedMarkerElement) {
      new AdvancedMarkerElement({ map, position, title });
      return;
    }
    new googleMaps.Marker({ map, position, title });
  }
}
