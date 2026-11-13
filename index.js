import express from 'express';
import {createApp} from './dist/app.js';

// Vercel's Express entry point. Local development continues to use src/server.ts.
const application=express();
application.disable('x-powered-by');
application.use(createApp().app);
export default application;
