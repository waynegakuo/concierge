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
}

export interface WelcomeCapability {
  icon: string;
  title: string;
  description: string;
}
