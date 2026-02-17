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
      output: {schema: z.string()}
    });

    if (!response.output) {
      throw new Error('No output from AI');
    }

    return response.output;
  }
);

export const dayTripAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _dayTripAgentFlowLogic
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
      output: {schema: z.string()}
    });

    if (!response.output) {
      throw new Error('No output from AI');
    }

    return response.output;
  }
);

export const foodieAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _foodieAgentFlowLogic
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
      output: {schema: z.string()}
    });

    if (!response.output) {
      throw new Error('No output from AI');
    }

    return response.output;
  }
);

export const weekendGuideAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _weekendGuideAgentFlowLogic
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
      output: {schema: z.string()}
      });

    if (!response.output) {
      throw new Error('No output from AI');
    }

    return response.output;
  }
);

export const findAndNavigateAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _findAndNavigateAgentFlowLogic
);

export const _conciergeAgentLogic = ai.defineFlow(
  {
    name: 'conciergeAgentFlow',
    inputSchema: z.object({input: z.string()}),
    outputSchema: z.string()
  },
  async ({input}) => {
    const response = await ai.generate({
      prompt: `${CONCIERGE_AGENT_PROMPT}\n\nUser query: ${input}`,
      tools: [_dayTripAgentFlowLogic, _foodieAgentFlowLogic, _weekendGuideAgentFlowLogic, _findAndNavigateAgentFlowLogic]
    });

    // When tools are used, the response may not have output but will have text
    const result = response.text || response.output;

    if (!result) {
      throw new Error('No output from AI');
    }

    return result;
  }
);

export const conciergeAgentFlow = onCallGenkit(
  GENKIT_FUNCTION_CONFIG,
  _conciergeAgentLogic
);

// Commented out - replaced by conciergeAgentFlow
// export const _routerAgentLogic = ai.defineFlow(
//   {
//     name: 'routerAgentFlow',
//     inputSchema: z.object({query: z.string()}),
//     outputSchema: z.string()
//   },
//   async ({query}) => {
//     const intentResponse = await ai.generate({
//       prompt: `${ROUTER_AGENT_PROMPT}\n\nUser query: ${query}`,
//       output: {schema: z.string()}
//     });
//
//     const intent = intentResponse.output;
//
//     if (intent === 'day_trip_agent') {
//       const dayTripResponse = await ai.generate({
//         prompt: DAY_TRIP_AGENT_PROMPT,
//       });
//       return dayTripResponse.output;
//     }
//
//     else if (intent === 'foodie_agent') {
//       const foodieResponse = await ai.generate({
//         prompt: FOODIE_AGENT_PROMPT,
//       });
//       return foodieResponse.output;
//     }
//
//     else if (intent === 'weekend_guide_agent') {
//       const weekendGuideResponse = await ai.generate({
//         prompt: WEEKEND_GUIDE_AGENT_PROMPT,
//         output: {schema: z.string()}
//       });
//       return weekendGuideResponse.output;
//     }
//
//     else if (intent === 'find_and_navigate_combo') {
//       const findAndNavigateResponse = await ai.generate({
//         prompt: TRANSPORT_AGENT_PROMPT
//       });
//       return findAndNavigateResponse.output;
//     }
//
//     else {
//       return 'Sorry, I could not determine how to handle your request';
//     }
//   }
// );
//
// export const routerAgentFlow = onCallGenkit(
//   {
//     secrets: [GEMINI_API_KEY],
//     region: 'africa-south1',
//     cors: isEmulated
//       ? true
//       : [
//         'http://localhost:4200',
//         'http://localhost:5001',
//         /^https:\/\/agents-concierge(--[a-z0-9-]+)?\.web\.app$/, // Matches live site (agents-concierge.web.app) and previews (agents-concierge--<channel>.web.app)
//       ],
//   },
//   _routerAgentLogic
// )


