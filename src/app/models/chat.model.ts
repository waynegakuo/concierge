import {SafeHtml} from '@angular/platform-browser';

export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}


export interface Message {
  text: string;
  formattedText?: SafeHtml;
  sender: 'user' | 'ai';
  timestamp: Date;
  mapsWidgetToken?: string;
}

export interface ConciergeResponse {
  text: string;
  mapsWidgetToken?: string;
}

export interface WelcomeCapability {
  icon: string;
  title: string;
  description: string;
}
