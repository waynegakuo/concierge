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

const mapsTravelModeSchema = z.enum(['DRIVING', 'WALKING', 'BICYCLING', 'TRANSIT']);

const mapsRouteSchema = z.object({
  originPlaceId: z.string(),
  destinationPlaceId: z.string(),
  originTitle: z.string().optional(),
  destinationTitle: z.string().optional(),
  travelMode: mapsTravelModeSchema.optional(),
});

type MapsPlace = z.infer<typeof mapsPlaceSchema>;
type MapsRoute = z.infer<typeof mapsRouteSchema>;

// Schema for the concierge agent response
const conciergeResponseSchema = z.object({
  text: z.string(),
  mapsPlaces: z.array(mapsPlaceSchema).optional(),
  mapsRoute: mapsRouteSchema.optional(),
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

function navigateToolPayload(output: unknown): {
  mapsPlaces?: MapsPlace[];
  mapsRoute?: MapsRoute;
} | undefined {
  const record = coerceRecord(output);
  if (!record) return undefined;

  const nested = coerceRecord(record.content);
  const mapsPlaces = record.mapsPlaces ?? nested?.mapsPlaces;
  const mapsRoute = record.mapsRoute ?? nested?.mapsRoute;
  const places = Array.isArray(mapsPlaces) && mapsPlaces.length
    ? (mapsPlaces as MapsPlace[])
    : undefined;
  const route =
    mapsRoute && typeof mapsRoute === 'object'
      ? (mapsRoute as MapsRoute)
      : undefined;

  if (!places && !route) return undefined;
  return {mapsPlaces: places, mapsRoute: route};
}

function looksLikeDirectionsQuery(input: string): boolean {
  return (
    /\b(how (do|can|to) (i |we )?(get|go|reach)|directions?|route|navigate|way to|take me)\b/i.test(
      input
    ) ||
    /\bfrom\b.+\b(to|from)\b/i.test(input) ||
    /\bto get (to|from)\b/i.test(input)
  );
}

function inferTravelMode(
  input: string
): z.infer<typeof mapsTravelModeSchema> {
  if (/\b(walk|walking|on foot|pedestrian)\b/i.test(input)) return 'WALKING';
  if (/\b(bike|biking|cycling|bicycle|boda)\b/i.test(input)) return 'BICYCLING';
  if (/\b(transit|bus|train|subway|matatu)\b/i.test(input)) {
    return 'TRANSIT';
  }
  return 'DRIVING';
}

function findPlaceByQuery(query: string, places: MapsPlace[]): MapsPlace | undefined {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  let best: {place: MapsPlace; score: number} | undefined;
  for (const place of places) {
    const title = (place.title ?? '').toLowerCase();
    if (!title) continue;
    let score = 0;
    if (title.includes(normalized) || normalized.includes(title)) score += 4;
    const words = normalized.split(/\s+/).filter((word) => word.length > 2);
    score += words.filter((word) => title.includes(word)).length;
    if (!best || score > best.score) {
      best = {place, score};
    }
  }
  return best && best.score >= 2 ? best.place : undefined;
}

function inferRouteFromQuery(input: string, places: MapsPlace[]): MapsRoute | undefined {
  const toMatch = input.match(/\bto\s+(.+?)(?:\s+from\s+|$)/i);
  const fromMatches = [...input.matchAll(/\bfrom\s+(.+?)(?=\s+from\s+|\s+to\s+|$)/gi)];

  let origin: MapsPlace | undefined;
  let destination: MapsPlace | undefined;

  if (fromMatches.length === 1 && toMatch) {
    origin = findPlaceByQuery(fromMatches[0][1], places);
    destination = findPlaceByQuery(toMatch[1], places);
  } else if (fromMatches.length >= 2) {
    origin = findPlaceByQuery(fromMatches[fromMatches.length - 1][1], places);
    destination = findPlaceByQuery(fromMatches[0][1], places);
  }

  if (!origin || !destination || origin.placeId === destination.placeId) {
    return undefined;
  }

  return {
    originPlaceId: origin.placeId,
    destinationPlaceId: destination.placeId,
    originTitle: origin.title,
    destinationTitle: destination.title,
    travelMode: inferTravelMode(input),
  };
}

async function resolveMapsRoute(
  input: string,
  places: MapsPlace[]
): Promise<MapsRoute | undefined> {
  if (places.length < 2 || !looksLikeDirectionsQuery(input)) {
    return undefined;
  }

  const heuristic = inferRouteFromQuery(input, places);
  if (heuristic) return heuristic;

  const ids = places.map((place) => place.placeId);
  const idSchema = z.enum(ids as [string, ...string[]]);

  try {
    const pick = await ai.generate({
      prompt: `The user asked for directions: "${input}"

Grounded Google Maps places:
${places.map((place) => `- ${place.placeId}: ${place.title ?? 'Unknown place'}`).join('\n')}

Pick the origin and destination place IDs from that list only.
If the user said "from A to B", A is origin and B is destination.
If they used two "from" phrases (e.g. "to Second Cup from Kongowea"), treat the neighborhood or area as origin and the specific business as destination.`,
      output: {
        schema: z.object({
          originPlaceId: idSchema,
          destinationPlaceId: idSchema,
        }),
      },
    });

    const originPlaceId = pick.output?.originPlaceId;
    const destinationPlaceId = pick.output?.destinationPlaceId;
    if (!originPlaceId || !destinationPlaceId || originPlaceId === destinationPlaceId) {
      return undefined;
    }

    const origin = places.find((place) => place.placeId === originPlaceId);
    const destination = places.find((place) => place.placeId === destinationPlaceId);

    return {
      originPlaceId,
      destinationPlaceId,
      originTitle: origin?.title,
      destinationTitle: destination?.title,
      travelMode: inferTravelMode(input),
    };
  } catch (error) {
    console.warn('Failed to infer maps route from places:', error);
    return {
      originPlaceId: places[0].placeId,
      destinationPlaceId: places[places.length - 1].placeId,
      originTitle: places[0].title,
      destinationTitle: places[places.length - 1].title,
      travelMode: inferTravelMode(input),
    };
  }
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
      mapsRoute: mapsRouteSchema.optional(),
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
    const mapsRoute = await resolveMapsRoute(input, mapsPlaces);

    return {
      text: response.text,
      mapsPlaces: mapsPlaces.length ? mapsPlaces : undefined,
      mapsRoute,
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

    // Extract Maps grounding data if the find-and-navigate tool was used
    let mapsPlaces: MapsPlace[] | undefined;
    let mapsRoute: MapsRoute | undefined;

    for (const msg of response.messages) {
      if (msg.role === 'tool') {
        for (const part of msg.content) {
          if (part.toolResponse?.name === 'findAndNavigateAgentTool') {
            const payload = navigateToolPayload(part.toolResponse.output);
            mapsPlaces = payload?.mapsPlaces;
            mapsRoute = payload?.mapsRoute;
            if (mapsPlaces || mapsRoute) break;
          }
        }
      }
      if (mapsPlaces || mapsRoute) break;
    }

    return {text: resultText, mapsPlaces, mapsRoute};
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
