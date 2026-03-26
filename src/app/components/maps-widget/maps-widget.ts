import { AfterViewInit, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, PLATFORM_ID, ViewChild, effect, inject, input } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GoogleMapsLoaderService } from '../../services/core/google-maps-loader/google-maps-loader.service';


@Component({
  selector: 'app-maps-widget',
  imports: [],
  templateUrl: './maps-widget.html',
  styleUrl: './maps-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MapsWidget implements AfterViewInit {
  @ViewChild('mapElement') container!: ElementRef<HTMLElement>;

  readonly token = input<string>('');

  private readonly platformId = inject(PLATFORM_ID);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private libraryLoaded = false;
  private placeContextualElement: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const token = this.token();
      if (this.libraryLoaded && token) {
        this.renderWidget(token);
      }
    });
  }

  async ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      await this.mapsLoader.importLibrary('places');
      this.libraryLoaded = true;
      const token = this.token();
      if (token) {
        this.renderWidget(token);
      }
    } catch (err) {
      console.error('[MapsWidget] Failed to load Maps places library:', err);
    }
  }

  private renderWidget(token: string) {
    if (!this.container?.nativeElement) return;

    // Remove previous element if token changed
    if (this.placeContextualElement) {
      this.placeContextualElement.remove();
      this.placeContextualElement = null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places = (window as any)['google']?.maps?.places;
    let el: HTMLElement;
    if (places?.PlaceContextualElement) {
      el = new places.PlaceContextualElement({ contextToken: token });
    } else {
      el = document.createElement('gmp-place-contextual');
      (el as HTMLElement & { contextToken: string }).contextToken = token;
    }
    this.placeContextualElement = el;
    this.container.nativeElement.appendChild(el);
  }
}
