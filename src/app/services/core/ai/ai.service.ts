import {inject, Injectable} from '@angular/core';
import {Functions, httpsCallable} from '@angular/fire/functions';
import {from, Observable} from 'rxjs';
import {ConversationMessage} from '../../../models/chat.model';

@Injectable({
  providedIn: 'root',
})
export class AiService {

  private readonly functions = inject(Functions);

  sendMessage(query: string, history: ConversationMessage[] = []): Observable<{ data: string }> {
    const conciergeAgentFlow = httpsCallable<{ input: string; history: ConversationMessage[] }, string>(
      this.functions,
      'conciergeAgentFlow'
    );
    return from(conciergeAgentFlow({ input: query, history }));
  }
}
