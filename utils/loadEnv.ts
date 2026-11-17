import dotenv from 'dotenv';

// Environment-dependent modules are evaluated before server.ts itself. Load both
// supported env files here, before those modules capture any configuration.
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
