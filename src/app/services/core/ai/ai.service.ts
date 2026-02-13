import {inject, Injectable} from '@angular/core';
import {Functions, httpsCallable} from '@angular/fire/functions';
import {from, Observable} from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AiService {

  private readonly functions = inject(Functions);

  sendMessage(query: string): Observable<{ data: string }> {
    const routerAgentFlow = httpsCallable<{ query: string }, string>(this.functions, 'routerAgentFlow');
    return from(routerAgentFlow({ query }));
  }
}
