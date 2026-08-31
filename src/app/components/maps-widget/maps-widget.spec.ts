import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapsWidget } from './maps-widget';
import { GoogleMapsLoaderService } from '../../services/core/google-maps-loader/google-maps-loader.service';

describe('MapsWidget', () => {
  let component: MapsWidget;
  let fixture: ComponentFixture<MapsWidget>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapsWidget],
      providers: [
        {
          provide: GoogleMapsLoaderService,
          useValue: {
            importLibrary: async () => ({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MapsWidget);
    fixture.componentRef.setInput('places', []);
    fixture.componentRef.setInput('route', undefined);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
