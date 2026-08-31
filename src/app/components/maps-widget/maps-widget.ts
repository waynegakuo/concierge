import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GoogleMapsLoaderService } from '../../services/core/google-maps-loader/google-maps-loader.service';
import { MapsPlace, MapsRoute, MapsTravelMode } from '../../models/chat.model';

const MAP_ID = 'DEMO_MAP_ID';

const TRAVEL_MODES: Array<{ id: MapsTravelMode; label: string; icon: string }> = [
  { id: 'DRIVING', label: 'Drive', icon: '🚗' },
  { id: 'TRANSIT', label: 'Transit', icon: '🚌' },
  { id: 'WALKING', label: 'Walk', icon: '🚶' },
  { id: 'BICYCLING', label: 'Bike', icon: '🚲' },
];

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
  readonly route = input<MapsRoute | undefined>(undefined);
  readonly isLoading = signal(true);
  readonly isRouting = signal(false);
  readonly librariesReady = signal(false);
  readonly directionsError = signal<string | undefined>(undefined);
  readonly selectedTravelMode = linkedSignal<MapsTravelMode>(
    () => this.route()?.travelMode ?? 'DRIVING',
  );

  readonly travelModes = TRAVEL_MODES;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly mapElement = viewChild<ElementRef<HTMLElement>>('mapElement');
  private readonly directionsPanel = viewChild<ElementRef<HTMLElement>>('directionsPanel');

  private renderedKey = '';
  private renderGeneration = 0;

  constructor() {
    afterRenderEffect({
      write: () => {
        if (!isPlatformBrowser(this.platformId) || !this.librariesReady()) {
          return;
        }
        const places = this.places();
        const route = this.route();
        const container = this.mapElement()?.nativeElement;
        if ((!places.length && !route) || !container) {
          return;
        }
        void this.renderMap(container, places, route, this.selectedTravelMode());
      },
    });

    if (isPlatformBrowser(this.platformId)) {
      void this.loadLibraries();
    } else {
      this.isLoading.set(false);
    }
  }

  selectTravelMode(mode: MapsTravelMode): void {
    this.selectedTravelMode.set(mode);
  }

  private async loadLibraries(): Promise<void> {
    try {
      await Promise.all([
        this.mapsLoader.importLibrary('maps'),
        this.mapsLoader.importLibrary('marker'),
        this.mapsLoader.importLibrary('places'),
      ]);
      try {
        await this.mapsLoader.importLibrary('routes');
      } catch (err) {
        console.warn('[MapsWidget] routes library unavailable; using maps DirectionsService fallback.', err);
      }
      this.isLoading.set(false);
      this.librariesReady.set(true);
    } catch (err) {
      console.error('[MapsWidget] Failed to load Maps libraries:', err);
      this.isLoading.set(false);
    }
  }

  private async renderMap(
    container: HTMLElement,
    places: MapsPlace[],
    route: MapsRoute | undefined,
    travelMode: MapsTravelMode,
  ): Promise<void> {
    const key = `${route?.originPlaceId ?? ''}|${route?.destinationPlaceId ?? ''}|${travelMode}|${places.map((place) => place.placeId).join(',')}`;
    if (key === this.renderedKey) {
      return;
    }
    this.renderedKey = key;
    const generation = ++this.renderGeneration;
    this.directionsError.set(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const googleMaps = (window as any)['google']?.maps;
    if (!googleMaps?.Map) {
      console.error('[MapsWidget] Google Maps JS API is not available');
      this.renderedKey = '';
      return;
    }

    try {
      if (route) {
        this.isRouting.set(true);
        const map = new googleMaps.Map(container, {
          mapId: MAP_ID,
          center: { lat: 0, lng: 0 },
          zoom: 2,
          clickableIcons: false,
        });
        const drawn = await this.renderDirections(googleMaps, map, route, travelMode);
        if (generation !== this.renderGeneration) {
          return;
        }
        this.isRouting.set(false);
        if (drawn) {
          return;
        }
      }

      const locations = await this.resolvePlaceLocations(googleMaps, places);
      if (generation !== this.renderGeneration) {
        return;
      }
      if (!locations.length) {
        if (!route) {
          container.replaceChildren();
        }
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
      if (generation === this.renderGeneration) {
        this.renderedKey = '';
        this.isRouting.set(false);
      }
    }
  }

  private async renderDirections(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleMaps: any,
    map: unknown,
    route: MapsRoute,
    travelMode: MapsTravelMode,
  ): Promise<boolean> {
    const DirectionsService = googleMaps.DirectionsService;
    const DirectionsRenderer = googleMaps.DirectionsRenderer;
    const TravelMode = googleMaps.TravelMode;
    if (!DirectionsService || !DirectionsRenderer || !TravelMode) {
      this.directionsError.set('Directions are unavailable in this Maps build.');
      return false;
    }

    const panel = this.directionsPanel()?.nativeElement;
    if (panel) {
      panel.replaceChildren();
    }

    const renderer = new DirectionsRenderer({
      map,
      panel: panel ?? undefined,
      suppressBicyclingLayer: true,
      polylineOptions: {
        strokeColor: '#4285F4',
        strokeWeight: 6,
        strokeOpacity: 0.95,
      },
    });

    try {
      const result = await new DirectionsService().route({
        origin: { placeId: route.originPlaceId },
        destination: { placeId: route.destinationPlaceId },
        travelMode: TravelMode[travelMode] ?? TravelMode.DRIVING,
        provideRouteAlternatives: false,
      });
      renderer.setDirections(result);
      return true;
    } catch (err) {
      console.error('[MapsWidget] Directions request failed:', err);
      this.directionsError.set(
        'Could not load turn-by-turn directions for this route. The places are still shown on the map.',
      );
      return false;
    }
  }

  private async resolvePlaceLocations(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleMaps: any,
    places: MapsPlace[],
  ): Promise<Array<{ position: unknown; title: string }>> {
    const Place = googleMaps.places?.Place;
    if (!Place || !places.length) {
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
