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
import {onCall, onCallGenkit} from 'firebase-functions/https';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const MAPS_API_KEY = defineSecret('MAPS_API_KEY');
const MAPS_API_KEY_DEV = defineSecret('MAPS_API_KEY_DEV');

// Detect if the function is running in the Firebase Emulator Suite.
const isEmulated = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';

enableFirebaseTelemetry();

// Configure Genkit
const ai = genkit({
  plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY})],
  model: googleAI.model('gemini-3.1-flash-lite', {contextCache: true}),
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

const mapsPlaceSchema = z.object({
  placeId: z.string(),
  title: z.string().optional(),
  uri: z.string().optional(),
});

type MapsPlace = z.infer<typeof mapsPlaceSchema>;

// Schema for the concierge agent response
const conciergeResponseSchema = z.object({
  text: z.string(),
  mapsPlaces: z.array(mapsPlaceSchema).optional(),
});

/** Converts client-side history into Genkit MessageData parts. */
function toGenkitMessages(history: ConversationMessage[]) {
  return history.map((msg) => ({
    role: msg.role as 'user' | 'model',
    content: [{text: msg.content}],
  }));
}

function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, '');
}

function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

type GeminiGroundingPayload = {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{
        maps?: {placeId?: string; title?: string; uri?: string};
      }>;
    };
  }>;
};

/** Reads Maps grounding sources from the raw Gemini payload. Widget tokens are no longer returned. */
function extractMapsPlacesFromResponse(response: {raw?: unknown; custom?: unknown}): MapsPlace[] {
  const rawPayload = response.raw as GeminiGroundingPayload | undefined;
  const customPayload = response.custom as GeminiGroundingPayload | undefined;
  const chunks =
    rawPayload?.candidates?.[0]?.groundingMetadata?.groundingChunks ??
    customPayload?.candidates?.[0]?.groundingMetadata?.groundingChunks ??
    [];
  const places: MapsPlace[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const maps = chunk?.maps;
    if (!maps?.placeId) continue;
    const placeId = normalizePlaceId(String(maps.placeId));
    if (!placeId || seen.has(placeId)) continue;
    seen.add(placeId);
    places.push({
      placeId,
      title: maps.title,
      uri: maps.uri,
    });
  }

  return places;
}

function mapsPlacesFromToolOutput(output: unknown): MapsPlace[] | undefined {
  const record = coerceRecord(output);
  if (!record) return undefined;

  const nested = coerceRecord(record.content);
  const candidate = record.mapsPlaces ?? nested?.mapsPlaces;
  if (!Array.isArray(candidate) || candidate.length === 0) return undefined;
  return candidate as MapsPlace[];
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
      throw new Error(`No output from AI. Finish reason: ${response.finishReason}, message: ${response.finishMessage}`);
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
      throw new Error(`No output from AI. Finish reason: ${response.finishReason}, message: ${response.finishMessage}`);
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
      throw new Error(`No output from AI. Finish reason: ${response.finishReason}, message: ${response.finishMessage}`);
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
      mapsPlaces: z.array(mapsPlaceSchema).optional(),
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
        tools: [{googleMaps: {}}],
      },
    });

    if (!response.text) {
      throw new Error(`No output from AI. Finish reason: ${response.finishReason}, message: ${response.finishMessage}`);
    }

    const mapsPlaces = extractMapsPlacesFromResponse(response);

    return {
      text: response.text,
      mapsPlaces: mapsPlaces.length ? mapsPlaces : undefined,
    };
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
      throw new Error(`No output from AI. Finish reason: ${response.finishReason}, message: ${response.finishMessage}`);
    }

    // Extract Maps grounding places if the find-and-navigate tool was used
    let mapsPlaces: MapsPlace[] | undefined;

    for (const msg of response.messages) {
      if (msg.role === 'tool') {
        for (const part of msg.content) {
          if (part.toolResponse?.name === 'findAndNavigateAgentTool') {
            mapsPlaces = mapsPlacesFromToolOutput(part.toolResponse.output);
            if (mapsPlaces) break;
          }
        }
      }
      if (mapsPlaces) break;
    }

    return {text: resultText, mapsPlaces};
  }
);

export const conciergeAgentFlow = onCallGenkit(GENKIT_FUNCTION_CONFIG, _conciergeAgentLogic);

export const loadGoogleMaps = onCall(
  {
    ...GENKIT_FUNCTION_CONFIG,
    secrets: [MAPS_API_KEY, MAPS_API_KEY_DEV],
  },
  (request) => {
    // Determine the environment based on the request origin
    const origin = request.rawRequest.get('origin') || '';
    const isPRPreview = /^https:\/\/agents-concierge--pr[a-z0-9-]+\.web\.app$/.test(origin);
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    if (isPRPreview || isLocalhost) {
      return {key: MAPS_API_KEY_DEV.value()};
    }

    return {key: MAPS_API_KEY.value()};
  }
);
