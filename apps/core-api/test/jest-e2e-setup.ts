import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from project root (.../apps/core-api/test → .../)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
