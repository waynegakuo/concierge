import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapsWidget } from './maps-widget';

describe('MapsWidget', () => {
  let component: MapsWidget;
  let fixture: ComponentFixture<MapsWidget>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapsWidget]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapsWidget);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
