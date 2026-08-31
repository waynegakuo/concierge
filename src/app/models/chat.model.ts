import {SafeHtml} from '@angular/platform-browser';

export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

export interface MapsPlace {
  placeId: string;
  title?: string;
  uri?: string;
}

export type MapsTravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';

export interface MapsRoute {
  originPlaceId: string;
  destinationPlaceId: string;
  originTitle?: string;
  destinationTitle?: string;
  travelMode?: MapsTravelMode;
}

export interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'ai';
  timestamp: Date;
  mapsPlaces?: MapsPlace[];
  mapsRoute?: MapsRoute;
}

export interface ConciergeResponse {
  text: string;
  mapsPlaces?: MapsPlace[];
  mapsRoute?: MapsRoute;
}

export interface WelcomeCapability {
  icon: string;
  title: string;
  description: string;
}
