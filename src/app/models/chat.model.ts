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

export interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'ai';
  timestamp: Date;
  mapsPlaces?: MapsPlace[];
}

export interface ConciergeResponse {
  text: string;
  mapsPlaces?: MapsPlace[];
}

export interface WelcomeCapability {
  icon: string;
  title: string;
  description: string;
}
