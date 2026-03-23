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

// Schema for the concierge agent response
const conciergeResponseSchema = z.object({
  text: z.string(),
  mapsWidgetToken: z.string().optional(),
});

/** Converts client-side history into Genkit MessageData parts. */
function toGenkitMessages(history: ConversationMessage[]) {
  return history.map((msg) => ({
    role: msg.role as 'user' | 'model',
    content: [{text: msg.content}],
  }));
}

export const _dayTripAgentToolLogic = ai.defineTool(
  {
    name: 'dayTripAgentTool',
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

export const _foodieAgentToolLogic = ai.defineTool(
  {
    name: 'foodieAgentTool',
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

export const _weekendGuideAgentToolLogic = ai.defineTool(
  {
    name: 'weekendGuideAgentTool',
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

export const _findAndNavigateAgentToolLogic = ai.defineTool(
  {
    name: 'findAndNavigateAgentTool',
    description: 'Assists with finding the best routes and transportation options',
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: z.object({
      text: z.string(),
      mapsWidgetToken: z.string().optional(),
    }),
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
        tools: [
          {
            googleMaps: {enableWidget: true}
          }
        ]
      },
    });

    if (!response.text) {
      throw new Error('No output from AI');
    }

    const mapsWidgetToken = (response.custom as any)
      ?.candidates?.[0]
      ?.groundingMetadata
      ?.googleMapsWidgetContextToken as string | undefined;

    return {text: response.text, mapsWidgetToken};
  }
);

export const _conciergeAgentLogic = ai.defineFlow(
  {
    name: 'conciergeAgentFlow',
    inputSchema: z.object({
      input: z.string(),
      history: z.array(conversationMessageSchema).optional(),
    }),
    outputSchema: conciergeResponseSchema,
  },
  async ({input, history}) => {
    const response = await ai.generate({
      system: CONCIERGE_AGENT_PROMPT,
      messages: [
        ...toGenkitMessages(history ?? []),
        {role: 'user', content: [{text: input}]},
      ],
      tools: [
        _dayTripAgentToolLogic,
        _foodieAgentToolLogic,
        _weekendGuideAgentToolLogic,
        _findAndNavigateAgentToolLogic,
      ],
    });

    // When tools are used, the response may not have output but will have text
    const resultText = response.text || (typeof response.output === 'string' ? response.output : response.output?.text);

    if (!resultText) {
      throw new Error('No output from AI');
    }

    // Extract the maps widget token if the find-and-navigate tool was used
    let mapsWidgetToken: string | undefined;

    for (const msg of response.messages) {
      if (msg.role === 'tool') {
        for (const part of msg.content) {
          if (part.toolResponse?.name === 'findAndNavigateAgentTool') {
            const toolOutput = part.toolResponse.output;
            if (typeof toolOutput === 'object' && toolOutput !== null) {
              mapsWidgetToken = (toolOutput as any).mapsWidgetToken;
              break;
            }
          }
        }
      }
      if (mapsWidgetToken) break;
    }

    return {text: resultText, mapsWidgetToken};
  }
);

export const conciergeAgentFlow = onCallGenkit(GENKIT_FUNCTION_CONFIG, _conciergeAgentLogic);
