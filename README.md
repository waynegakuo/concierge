# Concierge - Multi-Agent AI System with Tool Calling

A demonstration application showcasing how to build **multi-agent systems** using **Angular** and **Genkit**, implementing the **tool calling agentic pattern**. This project serves as a hands-on codelab for understanding how specialized AI agents can work together to solve complex user requests.

## 🎯 What This App Demonstrates

This application demonstrates a **multi-agent system** architecture where a central orchestrator (concierge agent) coordinates multiple specialized agents to handle different types of user requests. It implements the **tool calling** agentic pattern, one of the key patterns described in the [Genkit Agentic Patterns documentation](https://genkit.dev/docs/agentic-patterns/).

### Understanding Tool Calling as an Agentic Pattern

**Tool calling** is an agentic pattern that extends the capabilities of Large Language Models (LLMs) by allowing them to invoke external functions or APIs. Instead of relying solely on the model's training data, the LLM can:

1. **Analyze** the user's request
2. **Decide** which tool(s) to use
3. **Execute** the appropriate tool(s) with the right parameters
4. **Synthesize** the results into a coherent response

This pattern transforms a static LLM into a dynamic agent that can access real-time information, perform calculations, query databases, or delegate to specialized sub-agents.

### Multi-Agent Architecture

This app implements a **hierarchical multi-agent system** with:

- **1 Orchestrator Agent** (Concierge): Routes requests and coordinates responses
- **4 Specialized Agents**: Each expert in a specific domain
  - 🚗 **Day Trip Agent**: Plans full-day itineraries with real-time information
  - 🍽️ **Foodie Agent**: Recommends restaurants and culinary experiences
  - 🎉 **Weekend Guide Agent**: Finds events, concerts, and festivals
  - 🗺️ **Transport Agent**: Provides navigation and route guidance

## 🏗️ Architecture Overview

```
User Query → Angular Frontend → Firebase Function → Concierge Agent
                                                           ↓
                                        [Tool Calling Decision]
                                                           ↓
                                    ┌──────────────────────┴──────────────────────┐
                                    ↓                      ↓                      ↓
                            Day Trip Agent        Foodie Agent        Weekend Guide Agent
                                    ↓                      ↓                      ↓
                            [Google Search]        [Google Search]        [Google Search]
                                    ↓                      ↓                      ↓
                                    └──────────────────────┬──────────────────────┘
                                                           ↓
                                            Synthesized Response → User
```

## 📚 Code Walkthrough

### 1. Defining Specialized Agent Tools

Each specialized agent is defined as a **tool** that the concierge can call. Here's how the Day Trip Agent is implemented:

```typescript
// functions/src/index.ts

export const _dayTripAgentFlowLogic = ai.defineTool(
  {
    name: 'dayTripAgentFlow',
    description: 'Assists with planning day trips',
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
      config: {
        googleSearchRetrieval: {}, // Enables real-time web search
      },
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);
```

**What's happening here:**
- `ai.defineTool()` creates a callable function that the LLM can invoke
- The `description` helps the LLM understand when to use this tool
- `inputSchema` and `outputSchema` define the data contract using Zod
- `googleSearchRetrieval` enables the agent to fetch real-time information from the web
- The agent combines its specialized prompt with the user's query

### 2. The Concierge Orchestrator

The concierge agent acts as the orchestrator, deciding which specialized agent(s) to invoke:

```typescript
// functions/src/index.ts

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

    const result = response.text || response.output;

    if (!result) {
      throw new Error('No output from AI');
    }

    return result;
  }
);
```

**What's happening here:**
- `ai.defineFlow()` creates a workflow that can use multiple tools
- The `tools` array provides all available specialized agents
- The LLM automatically decides which tool(s) to call based on the user's query
- Genkit handles the tool invocation, parameter passing, and response aggregation
- The concierge synthesizes the final response for the user

### 3. Agent System Prompts

Each agent has a specialized system prompt that defines its expertise and behavior:

```typescript
// functions/src/system-prompt.ts

export const CONCIERGE_AGENT_PROMPT = `
  You are a helpful concierge AI assistant. Your role is to answer user questions 
  by intelligently using the tools provided to you.

  Guidelines:
    1. **Use Available Tools**: When a user asks a question, analyze which tools 
       are available and use the most appropriate one(s) to gather information.
    2. **Be Comprehensive**: Combine information from multiple tools if needed 
       to provide a complete answer.
    3. **Be Conversational**: Present the information in a friendly, helpful 
       manner as a concierge would.
    4. **Clarify When Needed**: If a user's request is unclear, ask clarifying 
       questions before using tools.
    5. **Provide Context**: When presenting results from tools, add helpful 
       context and recommendations.
`;

export const DAY_TRIP_AGENT_PROMPT = `
  You are the "Spontaneous Day Trip" Generator 🚗 - a specialized AI assistant 
  that creates engaging full-day itineraries.

  Your Mission:
  Transform a simple mood or interest into a complete day-trip adventure with 
  real-time details, while respecting a budget.

  Guidelines:
    1. **Budget-Aware**: Pay close attention to budget hints like 'cheap', 
       'affordable', or 'splurge'.
    2. **Full-Day Structure**: Create morning, afternoon, and evening activities.
    3. **Real-Time Focus**: Search for current operating hours and special events.
    4. **Mood Matching**: Align suggestions with the requested mood.
`;
```

**What's happening here:**
- System prompts define each agent's personality, expertise, and behavior
- The concierge prompt emphasizes tool usage and coordination
- Specialized agent prompts focus on domain-specific expertise
- Clear guidelines ensure consistent, high-quality responses

### 4. Frontend Integration

The Angular frontend communicates with the multi-agent system through Firebase Functions:

```typescript
// src/app/services/core/ai/ai.service.ts

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
```

**What's happening here:**
- The service uses Angular's `inject()` function for dependency injection
- `httpsCallable` creates a typed function that calls the Firebase backend
- The entire multi-agent orchestration happens server-side
- The `history` array carries prior conversation turns so agents have full context
- RxJS observables provide reactive, asynchronous communication

## 💬 Conversation Context

Agents can ask follow-up questions and remember the user's answers across turns. The Angular client maintains the full conversation history in memory and sends it with every request, keeping the backend stateless and scalable.

```typescript
// ChatComponent — snapshot history before each send
const historySnapshot = this.conversationHistory();
this.conversationHistory.update((h) => [...h, { role: 'user', content: query }]);

this.aiService.sendMessage(query, historySnapshot).subscribe({
  next: (response) => {
    // Append AI reply so the next turn has full context
    this.conversationHistory.update((h) => [...h, { role: 'model', content: response.data }]);
  },
});
```

> 📄 For a deep-dive into the design decisions, data flow, and full implementation details, see [documentation/conversation-context.md](documentation/conversation-context.md).

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Angular CLI (`npm install -g @angular/cli`)
- Firebase CLI (`npm install -g firebase-tools`)
- A Google Cloud project with Gemini API access

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd concierge
```

2. Install dependencies:
```bash
npm install
cd functions
npm install
cd ..
```

3. Set up Firebase:
```bash
firebase login
firebase init
```

4. Configure your Gemini API key:
```bash
firebase functions:secrets:set GEMINI_API_KEY
```

### Development

#### Run the Angular development server:
```bash
ng serve
```
Navigate to `http://localhost:4200/`

#### Run Firebase Functions locally:
```bash
cd functions
npm run serve
```

#### Run both concurrently:
```bash
npm run dev
```

## 🧪 Testing the Multi-Agent System

Try these example queries to see different agents in action:

- **Day Trip Agent**: "Plan a budget-friendly day trip in San Francisco with an artsy vibe"
- **Foodie Agent**: "Where can I find the best sushi in Tokyo?"
- **Weekend Guide Agent**: "What events are happening in New York this weekend?"
- **Transport Agent**: "How do I get from Times Square to Central Park?"
- **Multi-Agent**: "Find me a great Italian restaurant in Rome and tell me how to get there from the Colosseum"

## 📖 Key Concepts for Codelab Attendees

### 1. Tool Definition
Tools are functions that extend LLM capabilities. Each tool needs:
- A descriptive name and description
- Input/output schemas (using Zod)
- An implementation function

### 2. Flow Definition
Flows orchestrate multiple tools and define complete workflows:
- Can use multiple tools
- Handle complex multi-step processes
- Accept conversation history to maintain context across turns

### 3. Prompt Engineering
Effective system prompts are crucial:
- Define agent personality and expertise
- Provide clear guidelines and constraints
- Specify output format and style

### 4. Tool Calling Decision Process
The LLM automatically:
- Analyzes the user's intent
- Selects appropriate tool(s)
- Extracts parameters from the query
- Invokes tools with correct arguments
- Synthesizes results into natural language

## 🏗️ Building Your Own Multi-Agent System

To extend this system with a new agent:

1. **Define the agent's prompt** in `system-prompt.ts`
2. **Create the tool** using `ai.defineTool()` in `index.ts`
3. **Add the tool** to the concierge's tools array
4. **Test** with relevant queries

## 📚 Additional Resources

- [Genkit Agentic Patterns Documentation](https://genkit.dev/docs/agentic-patterns/)
- [Firebase Genkit Documentation](https://firebase.google.com/docs/genkit)
- [Angular Documentation](https://angular.dev)
- [Firebase Functions Documentation](https://firebase.google.com/docs/functions)
- [Conversation Context Implementation](documentation/conversation-context.md) — how multi-turn context is managed in this project

## 🛠️ Built With

- **Angular 21** - Frontend framework
- **Genkit** - Google's open-source AI orchestration framework
- **Firebase Functions** - Serverless backend
- **Google Gemini** - Large Language Model
- **TypeScript** - Type-safe development

## 📝 License

This project is intended for educational purposes as part of a codelab session on building multi-agent systems.
