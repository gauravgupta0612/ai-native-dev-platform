/** Prints the SHA-256 hash of an API key for PLATFORM_API_KEY_HASHES (server mode). Usage: npm run hash-key -- <key> */
import { randomBytes } from "node:crypto";
import { hashApiKey } from "../enterprise/scalable-architecture";

const key = process.argv[2] ?? randomBytes(32).toString("base64url");
if (!process.argv[2]) console.log(`Generated key (give it to the client, store it safely): ${key}`);
console.log(`Hash for PLATFORM_API_KEY_HASHES: ${hashApiKey(key)}`);
