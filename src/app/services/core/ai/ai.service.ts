import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';

export interface InterruptData {
  toolName: string;
  toolInput: unknown;
  metadata?: unknown;
}

export interface ConciergeResponse {
  text?: string;
  interrupt?: InterruptData;
  messages?: unknown[];
}

export interface InterruptResumeData {
  toolName: string;
  response: string;
}

@Injectable({
  providedIn: 'root',
})
export class AiService {
  private readonly functions = inject(Functions);

  sendMessage(
    query: string,
    messages?: unknown[],
    interruptResponse?: InterruptResumeData
  ): Observable<{ data: ConciergeResponse }> {
    const conciergeAgentFlow = httpsCallable<
      { input: string; messages?: unknown[]; interruptResponse?: InterruptResumeData },
      ConciergeResponse
    >(this.functions, 'conciergeAgentFlow');

    return from(conciergeAgentFlow({ input: query, messages, interruptResponse }));
  }
}
