import { AfterViewInit, ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, ViewChild, effect, input } from '@angular/core';


declare const google: {
  maps: {
    importLibrary: (library: string) => Promise<unknown>;
    places: {
      PlaceContextualElement: new (options: { contextToken: string }) => HTMLElement;
    };
  };
};

@Component({
  selector: 'app-maps-widget',
  imports: [],
  templateUrl: './maps-widget.html',
  styleUrl: './maps-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class MapsWidget implements AfterViewInit {
  @ViewChild('mapElement') mapElement!: ElementRef;

  readonly token = input<string>('');

  private libraryLoaded = false;

  // Store a reference to the element to update the token later
  private placeContextualElement?: any;

  constructor() {
    effect(() => {
      const token = this.token();

      if (this.libraryLoaded && token) {
        this.applyToken(token);
      }
    });
  }

  async ngAfterViewInit() {
    this.libraryLoaded = true;
    await this.applyToken(this.token());
  }

  private async applyToken(token: string) {
    if (this.mapElement?.nativeElement && token) {
      try {
        // 1. Ensure the 'places' library is loaded to register the custom element
        await google.maps.importLibrary('places');

        // const placeContextualElement = new google.maps.places.PlaceContextualElement({ contextToken: token });

        // 2. Create the element using the custom tag name
        // This avoids the "is not a constructor" error
        const placeContextualElement = document.createElement('gmp-place-contextual') as any;

        // 3. Assign properties directly to the element
        if (token) {
          placeContextualElement.contextToken = token;
        }
        // 4. Append to the Angular-managed DOM element
        this.mapElement.nativeElement.appendChild(placeContextualElement);

        // Store reference for later updates
        this.placeContextualElement = placeContextualElement;

        console.log('✅ Contextual Map Element created and appended.');

        this.checkIfAppended();
        this.checkTokenState();

      } catch (error) {
        console.error('❌ Error loading Maps library:', error);
      }
    }
  }

  checkIfAppended() {
    if (this.mapElement && this.placeContextualElement) {
      const isAppended = this.mapElement.nativeElement.contains(this.placeContextualElement);
      console.log('Is map appended?', isAppended);
    }
  }

  checkTokenState() {
    const currentToken = this.mapElement.nativeElement.contextToken;

    console.log('Check DOM', this.mapElement.nativeElement);
    if (currentToken) {
      console.log('Token is active:', currentToken.substring(0, 20) + '...');
    } else {
      console.warn('No token assigned to gmp-place-contextual.');
    }
  }

}
