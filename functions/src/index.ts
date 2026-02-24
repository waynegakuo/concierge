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
import {genkit, z} from 'genkit';
import {
  CONCIERGE_AGENT_PROMPT,
  DAY_TRIP_AGENT_PROMPT,
  FOODIE_AGENT_PROMPT,
  TRANSPORT_AGENT_PROMPT,
  WEEKEND_GUIDE_AGENT_PROMPT,
} from './system-prompt';
import {onCallGenkit} from 'firebase-functions/https';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

// Detect if the function is running in the Firebase Emulator Suite.
const isEmulated = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';

enableFirebaseTelemetry();

// Configure Genkit
const ai = genkit({
  plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY})],
  model: googleAI.model('gemini-2.5-flash'),
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

// Schema for a single conversation message passed from the client
const conversationMessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string(),
});

type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/** Converts client-side history into Genkit MessageData parts. */
function toGenkitMessages(history: ConversationMessage[]) {
  return history.map((msg) => ({
    role: msg.role as 'user' | 'model',
    content: [{text: msg.content}],
  }));
}

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
  async ({input, history}) => {
    const response = await ai.generate({
      system: DAY_TRIP_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      config: {
        googleSearchRetrieval: {},
      },
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
    description: "Assist with finding the best restaurants based on the user's request",
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({input, history}) => {
    const response = await ai.generate({
      system: FOODIE_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      config: {
        googleSearchRetrieval: {},
      },
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
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({input, history}) => {
    const response = await ai.generate({
      system: WEEKEND_GUIDE_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      config: {
        googleSearchRetrieval: {},
      },
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
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({input, history}) => {
    const response = await ai.generate({
      system: TRANSPORT_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      config: {
        googleSearchRetrieval: {},
      },
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    return response.text;
  }
);

export const _conciergeAgentLogic = ai.defineFlow(
  {
    name: 'conciergeAgentFlow',
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.string(),
  },
  async ({input, history}) => {
    const response = await ai.generate({
      system: CONCIERGE_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      tools: [
        _dayTripAgentFlowLogic,
        _foodieAgentFlowLogic,
        _weekendGuideAgentFlowLogic,
        _findAndNavigateAgentFlowLogic,
      ],
    });

    // When tools are used, the response may not have output but will have text
    const result = response.text || response.output;

    if (!result) {
      throw new Error('No output from AI');
    }

    return result;
  }
);

export const conciergeAgentFlow = onCallGenkit(GENKIT_FUNCTION_CONFIG, _conciergeAgentLogic);
