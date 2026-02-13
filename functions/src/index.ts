/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {defineSecret} from 'firebase-functions/params';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import {onCallGenkit} from 'firebase-functions/v2/https';
import { googleAI } from '@genkit-ai/google-genai';
import { genkit, z } from "genkit";

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

enableFirebaseTelemetry();

// Configure Genkit
const ai = genkit({
  plugins: [
    googleAI({ apiKey: process.env.GEMINI_API_KEY }),
  ],
  model: googleAI.model('gemini-3-flash-preview'), // Using a stable model name
});

// Detect if the function is running in the Firebase Emulator Suite.
const isEmulated = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';


