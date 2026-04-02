import {EnvironmentInjector, inject, Injectable, runInInjectionContext} from '@angular/core';
import {Functions, httpsCallable} from '@angular/fire/functions';
import {from, Observable} from 'rxjs';
import {ConversationMessage, ConciergeResponse} from '../../../models/chat.model';

@Injectable({
  providedIn: 'root',
})
export class AiService {

  private readonly functions = inject(Functions);
  private environmentInjector = inject(EnvironmentInjector);

  sendMessage(query: string, history: ConversationMessage[] = []): Observable<{ data: ConciergeResponse }> {
    return runInInjectionContext(this.environmentInjector, () => {
      const conciergeAgentFlow = httpsCallable<{ input: string; history: ConversationMessage[] }, ConciergeResponse>(
        this.functions,
        'conciergeAgentFlow'
      );
      return from(conciergeAgentFlow({ input: query, history }));
    })

  }
}
