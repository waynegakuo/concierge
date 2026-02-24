/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {defineSecret} from 'firebase-functions/params';
import {enableFirebaseTelemetry} from '@genkit-ai/firebase';
import {googleAI} from '@genkit-ai/google-genai';
import {genkit, z} from "genkit";
import type {MessageData} from '@genkit-ai/ai';
import {
  CONCIERGE_AGENT_PROMPT,
  DAY_TRIP_AGENT_PROMPT,
  FOODIE_AGENT_PROMPT, TRANSPORT_AGENT_PROMPT,
  WEEKEND_GUIDE_AGENT_PROMPT
} from './system-prompt';
import {onCallGenkit} from 'firebase-functions/https';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// Detect if the function is running in the Firebase Emulator Suite.
const isEmulated = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';

enableFirebaseTelemetry();

// Configure Genkit
const ai = genkit({
  plugins: [
    googleAI({ apiKey: process.env.GEMINI_API_KEY }),
  ],
  model: googleAI.model('gemini-2.5-flash'), // Using a stable model name
});

const GENKIT_FUNCTION_CONFIG = {
  secrets: [GEMINI_API_KEY],
  region: 'africa-south1',
  cors: isEmulated
    ? true
    : [
      'http://localhost:4200',
      'http://localhost:5001',
      /^https:\/\/agents-concierge(--[a-z0-9-]+)?\.web\.app$/,
    ],
};

export const _dayTripAgentFlowLogic = ai.defineTool(
  {
    name: 'dayTripAgentFlow',
    description: 'Assists with planning day trips',
    inputSchema: z.object({input: z.string()}),
    outputSchema: z.string()
  },
  async ({input}) => {
    const response = await ai.generate({
      prompt: `${DAY_TRIP_AGENT_PROMPT}\n\nUser query: ${input}`,
      config: {
        googleSearchRetrieval: {}
      }
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);

export const _foodieAgentFlowLogic = ai.defineTool(
  {
    name: 'foodieAgentFlow',
    description: 'Assist with finding the best restaurants based on the user\'s request',
    inputSchema: z.object({input: z.string()}),
    outputSchema: z.string()
  },
  async ({input}) => {
    const response = await ai.generate({
      prompt: `${FOODIE_AGENT_PROMPT}\n\nUser query: ${input}`,
      config: {
        googleSearchRetrieval: {}
      }
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);

export const _weekendGuideAgentFlowLogic = ai.defineTool(
  {
    name: 'weekendGuideAgentFlow',
    description: 'Assists in finding interesting events, concerts, festivals, and activities happening on a specific weekend',
    inputSchema: z.object({input: z.string()}),
    outputSchema: z.string()
  },
  async ({input}) => {
    const response = await ai.generate({
      prompt: `${WEEKEND_GUIDE_AGENT_PROMPT}\n\nUser query: ${input}`,
      config: {
        googleSearchRetrieval: {}
      }
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);

export const _findAndNavigateAgentFlowLogic = ai.defineTool(
  {
    name: 'findAndNavigateAgentFlow',
    description: 'Assists with finding the best routes and transportation options',
    inputSchema: z.object({input: z.string()}),
    outputSchema: z.string()
  },
  async ({input}) => {
    const response = await ai.generate({
      prompt: `${TRANSPORT_AGENT_PROMPT}\n\nUser query: ${input}`,
      config: {
        googleSearchRetrieval: {}
      }
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);

const InterruptDataSchema = z.object({
  toolName: z.string(),
  toolInput: z.unknown(),
  metadata: z.unknown().optional(),
});

const ConciergeInputSchema = z.object({
  input: z.string(),
  messages: z.array(z.any()).optional(),
  interruptResponse: z.object({
    toolName: z.string(),
    response: z.string(),
  }).optional(),
});

const ConciergeOutputSchema = z.object({
  text: z.string().optional(),
  interrupt: InterruptDataSchema.optional(),
  messages: z.array(z.any()).optional(),
});

export const _conciergeAgentLogic = ai.defineFlow(
  {
    name: 'conciergeAgentFlow',
    inputSchema: ConciergeInputSchema,
    outputSchema: ConciergeOutputSchema,
  },
  async ({input, messages: prevMessages, interruptResponse}) => {
    const tools = [
      _dayTripAgentFlowLogic,
      _foodieAgentFlowLogic,
      _weekendGuideAgentFlowLogic,
      _findAndNavigateAgentFlowLogic,
    ];

    // If resuming from an interrupt, build resume options
    if (interruptResponse && prevMessages?.length) {
      const lastModelMessage = [...prevMessages].reverse().find(
        (m: MessageData) => m.role === 'model'
      );

      const interruptPart = lastModelMessage?.content?.find(
        (p: Record<string, unknown>) =>
          p.toolRequest &&
          (p.toolRequest as Record<string, unknown>).name === interruptResponse.toolName &&
          p.metadata &&
          (p.metadata as Record<string, unknown>).interrupt
      );

      if (interruptPart) {
        const matchingTool = tools.find(
          (t) => t.__action.name.endsWith(interruptResponse.toolName)
        );

        if (matchingTool) {
          const response = await ai.generate({
            prompt: `${CONCIERGE_AGENT_PROMPT}\n\nUser query: ${input}`,
            messages: prevMessages as MessageData[],
            tools,
            resume: {
              respond: matchingTool.respond(interruptPart, interruptResponse.response),
            },
          });

          if (response.interrupts?.length) {
            const interrupt = response.interrupts[0];
            return {
              interrupt: {
                toolName: interrupt.toolRequest.name,
                toolInput: interrupt.toolRequest.input,
                metadata: interrupt.metadata?.interrupt,
              },
              messages: response.messages,
            };
          }

          const result = response.text || response.output;
          return {
            text: result || undefined,
            messages: response.messages,
          };
        }
      }
    }

    // Standard generation
    const response = await ai.generate({
      prompt: `${CONCIERGE_AGENT_PROMPT}\n\nUser query: ${input}`,
      tools,
    });

    // Check for interrupts
    if (response.interrupts?.length) {
      const interrupt = response.interrupts[0];
      return {
        interrupt: {
          toolName: interrupt.toolRequest.name,
          toolInput: interrupt.toolRequest.input,
          metadata: interrupt.metadata?.interrupt,
        },
        messages: response.messages,
      };
    }

    const result = response.text || response.output;

    if (!result) {
      throw new Error('No output from AI');
    }

    return {
      text: result,
      messages: response.messages,
    };
  }
);

export const conciergeAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _conciergeAgentLogic
);


