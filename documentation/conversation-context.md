# Conversation Context in the Multi-Agent System

## Overview

This document explains how conversation context (history) is maintained across turns in the Concierge multi-agent system, enabling AI agents to ask follow-up questions and retain the user's answers as context for subsequent responses.

---

## The Problem

Every call to the `conciergeAgentFlow` Firebase Function was originally **stateless**. Only the current user message was sent to the AI. This meant:

- If an agent asked a clarifying question (e.g., _"What city are you in?"_), the user's answer in the next turn was invisible to the agent.
- The agent had no memory of prior exchanges within the same chat session.

---

## The Solution: Client-Managed Conversation History

Rather than storing history server-side (e.g., in Firestore), the **Angular client maintains the conversation history** in memory and sends it with every request. The backend is kept stateless and scalable.

### Data Flow

```
User types message
       │
       ▼
ChatComponent snapshots current history
       │
       ▼
AiService.sendMessage(query, historySnapshot)
       │
       ▼
Firebase Callable Function: conciergeAgentFlow({ input, history })
       │
       ▼
Genkit ai.generate({ system, messages: [...history, currentUserMessage], tools })
       │
       ▼
Concierge Agent picks a sub-agent tool (if needed)
       │
       ▼
Sub-agent tool receives { input, history } and calls ai.generate with same history
       │
       ▼
Response returned → client appends both user turn and AI turn to history
```

---

## Implementation Details

### 1. Shared Message Schema (`functions/src/index.ts`)

A Zod schema defines the shape of a single conversation turn:

```typescript
const conversationMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string(),
});

type ConversationMessage = z.infer<typeof conversationMessageSchema>;
```

A helper converts this client-side format into Genkit's `MessageData` format:

```typescript
function toGenkitMessages(history: ConversationMessage[]) {
  return history.map((msg) => ({
    role: msg.role as 'user' | 'model',
    content: [{ text: msg.content }],
  }));
}
```

### 2. Concierge Agent Flow (`functions/src/index.ts`)

The main flow accepts an optional `history` array and passes it to `ai.generate` via the `messages` field. The system prompt is kept separate in the `system` field:

```typescript
export const _conciergeAgentLogic = ai.defineFlow(
  {
    name: 'conciergeAgentFlow',
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({ input, history }) => {
    const response = await ai.generate({
      system: CONCIERGE_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        { role: 'user', content: [{ text: input }] },
      ],
      tools: [
        _dayTripAgentFlowLogic,
        _foodieAgentFlowLogic,
        _weekendGuideAgentFlowLogic,
        _findAndNavigateAgentFlowLogic,
      ],
    });
    // ...
  }
);
```

### 3. Sub-Agent Tools (`functions/src/index.ts`)

Each of the four sub-agent tools (`dayTripAgentFlow`, `foodieAgentFlow`, `weekendGuideAgentFlow`, `findAndNavigateAgentFlow`) also accepts and forwards the `history` array, so they too have full context when generating their responses:

```typescript
export const _dayTripAgentFlowLogic = ai.defineTool(
  {
    name: 'dayTripAgentFlow',
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({ input, history }) => {
    const response = await ai.generate({
      system: DAY_TRIP_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        { role: 'user', content: [{ text: input }] },
      ],
      config: { googleSearchRetrieval: {} },
    });
    // ...
  }
);
```

### 4. AI Service (`src/app/services/core/ai/ai.service.ts`)

The `ConversationMessage` interface is exported so it can be shared with the component. The `sendMessage` method accepts and forwards the history:

```typescript
export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly functions = inject(Functions);

  sendMessage(query: string, history: ConversationMessage[] = []): Observable<{ data: string }> {
    const conciergeAgentFlow = httpsCallable<
      { input: string; history: ConversationMessage[] },
      string
    >(this.functions, 'conciergeAgentFlow');
    return from(conciergeAgentFlow({ input: query, history }));
  }
}
```

### 5. Chat Component (`src/app/components/chat/chat.component.ts`)

The component holds the conversation history as a signal. On each send, a snapshot of the **prior** history is passed to the service (before the new user turn is appended), ensuring the current message is not duplicated in the history:

```typescript
conversationHistory = signal<ConversationMessage[]>([]);

sendMessage(): void {
  const query = this.queryControl.value.trim();

  // Snapshot history BEFORE appending the new user turn
  const historySnapshot = this.conversationHistory();

  // Append user turn to history
  this.conversationHistory.update((h) => [...h, { role: 'user', content: query }]);

  this.aiService.sendMessage(query, historySnapshot).subscribe({
    next: (response) => {
      // Append AI turn to history
      this.conversationHistory.update((h) => [
        ...h,
        { role: 'model', content: response.data },
      ]);
    },
  });
}
```

---

## Agent Architecture

The system uses a **hierarchical multi-agent** pattern:

```
User
 └── Concierge Agent (orchestrator)
       ├── Day Trip Agent Tool       — full-day itinerary planning
       ├── Foodie Agent Tool         — restaurant & food recommendations
       ├── Weekend Guide Agent Tool  — events, concerts, festivals
       └── Find & Navigate Agent Tool — routes & transportation
```

The **Concierge Agent** acts as the orchestrator. It receives the user's message along with the full conversation history, decides which specialist tool to invoke (if any), and returns a consolidated response.

Each **sub-agent tool** is a `ai.defineTool` that also receives the conversation history, so it can understand the full context of the request — including any clarifying answers the user provided in earlier turns.

---

## Why Client-Side History?

| Approach | Pros | Cons |
|---|---|---|
| **Client-managed (chosen)** | Simple, stateless backend; no DB reads per request; no session management | History lost on page refresh; grows with conversation length |
| Server-side (Firestore) | Persistent across sessions/devices | Requires session IDs, DB reads on every call, more complex |

For a single-session chat UI, client-managed history is the simplest and most performant approach.

---

## Sequence Diagram

```
Client                        Firebase Function              Genkit / Gemini
  │                                  │                              │
  │── sendMessage(query, history) ──►│                              │
  │                                  │── ai.generate(system,        │
  │                                  │     messages=[...history,    │
  │                                  │     currentMsg], tools) ────►│
  │                                  │                              │
  │                                  │◄── response (or tool call) ──│
  │                                  │                              │
  │                                  │  [if tool call]              │
  │                                  │── subAgent({ input,          │
  │                                  │     history }) ─────────────►│
  │                                  │◄── subAgent response ────────│
  │                                  │                              │
  │◄── final response ───────────────│                              │
  │                                  │                              │
  │ append user + AI turns           │                              │
  │ to conversationHistory           │                              │
```
