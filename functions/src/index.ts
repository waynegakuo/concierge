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
import {
  DAY_TRIP_AGENT_PROMPT,
  FOODIE_AGENT_PROMPT,
  ROUTER_AGENT_PROMPT, TRANSPORT_AGENT_PROMPT,
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

export const _routerAgentLogic = ai.defineFlow({
    name: 'routerAgentFlow',
    inputSchema: z.object({query: z.string()}),
    outputSchema: z.string(),
  },

  async ({query}) => {
    const intentResponse = await ai.generate({
      prompt: `${ROUTER_AGENT_PROMPT}\n\nUser query: ${query}`,
      output: {schema: z.string()}
    });

    const intent = intentResponse.output;

    if (intent === 'day_trip_agent') {
      const dayTripResponse = await ai.generate({
        prompt: DAY_TRIP_AGENT_PROMPT,
      });
      return dayTripResponse.output;
    }

    else if (intent === 'foodie_agent') {
      const foodieResponse = await ai.generate({
        prompt: FOODIE_AGENT_PROMPT,
      });
      return foodieResponse.output;
    }

    else if (intent === 'weekend_guide_agent') {
      const weekendGuideResponse = await ai.generate({
        prompt: WEEKEND_GUIDE_AGENT_PROMPT,
      });
      return weekendGuideResponse.output;
    }

    else if (intent === 'find_and_navigate_combo') {
      const findAndNavigateResponse = await ai.generate({
        prompt: TRANSPORT_AGENT_PROMPT
      });
      return findAndNavigateResponse.output;
    }

    else {
      return 'Sorry, I could not determine how to handle your request';
    }
  }
);

export const routerAgentFlow = onCallGenkit(
  {
    secrets: [GEMINI_API_KEY],
    region: 'africa-south1',
    cors: isEmulated
      ? true
      : [
        'http://localhost:4200',
        'http://localhost:5001',
        /^https:\/\/agents-concierge(--[a-z0-9-]+)?\.web\.app$/, // Matches live site (agents-concierge.web.app) and previews (agents-concierge--<channel>.web.app)
      ],
  },
  _routerAgentLogic
)


