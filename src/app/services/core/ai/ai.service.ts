import {inject, Injectable} from '@angular/core';
import {Functions, httpsCallable} from '@angular/fire/functions';
import {from, Observable} from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AiService {

  private readonly functions = inject(Functions);

  sendMessage(query: string): Observable<{ data: string }> {
    const conciergeAgentFlow = httpsCallable<{ input: string }, string>(this.functions, 'conciergeAgentFlow');
    return from(conciergeAgentFlow({ input: query }));
  }
}
