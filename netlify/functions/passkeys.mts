import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getUser } from '@netlify/identity';
import { and, eq, gt, lt } from 'drizzle-orm';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { db } from '../../db/index.js';
import { challenges, passkeys } from '../../db/schema.js';

const cookieName = '__Host-quiz-passkey';
const patternDigest = 'ef5070e24b2e2672270986e72d77e59a0923dcd59392fd4ac18a99fe35e99b00';
const reply = (data: object, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export default async (req: Request, context: any) => {
  const url = new URL(req.url);
  if (req.method !== 'POST') return reply({ error: 'Nur POST erlaubt.' }, 405);
  if (req.headers.get('origin') !== url.origin) return reply({ error: 'Anfrage nicht erlaubt.' }, 403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'JSON erforderlich.' }, 415);
  try {
    const text = await req.text();
    if (text.length > 32768) return reply({ error: 'Anfrage zu groß.' }, 413);
    const body = JSON.parse(text);
    const rpID = url.hostname;
    const now = new Date();
    if (body.action === 'register-options' || body.action === 'login-options') {
      const register = body.action === 'register-options';
      if (register) {
        const digest = createHash('sha256').update(String(body.pattern || '')).digest();
        if (!timingSafeEqual(digest, Buffer.from(patternDigest, 'hex'))) return reply({ error: 'Bitte zuerst das richtige Muster zeichnen.' }, 403);
      }
      // An Identity account is optional; no new account is required for this gate.
      const account = register ? await getUser() : null;
      const userId = account?.id || randomUUID();
      const options = register
        ? await generateRegistrationOptions({
            rpName: 'Coding Quiz', rpID, userName: 'Quiz-Muster',
            userDisplayName: 'Coding Quiz – Musterzugang',
            userID: new TextEncoder().encode(userId),
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
          })
        : await generateAuthenticationOptions({ rpID, userVerification: 'required' });
      await db.delete(challenges).where(lt(challenges.expiresAt, now));
      const previous = context.cookies.get(cookieName);
      if (previous) await db.delete(challenges).where(eq(challenges.id, previous));
      const id = randomUUID();
      await db.insert(challenges).values({ id, challenge: options.challenge,
        kind: register ? 'register' : 'login', userId,
        expiresAt: new Date(Date.now() + 5 * 60_000) });
      context.cookies.set({ name: cookieName, value: id, httpOnly: true, secure: true,
        sameSite: 'Strict', path: '/', maxAge: 300 });
      return reply({ options });
    }
    if (body.action !== 'register-verify' && body.action !== 'login-verify') return reply({ error: 'Unbekannte Aktion.' }, 400);
    const id = context.cookies.get(cookieName);
    if (!id) return reply({ error: 'Anfrage abgelaufen. Bitte erneut versuchen.' }, 400);
    // Consume once, before verification, so captured responses cannot be replayed.
    const [challenge] = await db.delete(challenges).where(and(eq(challenges.id, id),
      eq(challenges.kind, body.action === 'register-verify' ? 'register' : 'login'),
      gt(challenges.expiresAt, now))).returning();
    context.cookies.delete(cookieName);
    if (!challenge) return reply({ error: 'Anfrage abgelaufen. Bitte erneut versuchen.' }, 400);
    if (body.action === 'register-verify') {
      const result = await verifyRegistrationResponse({ response: body.response,
        expectedChallenge: challenge.challenge, expectedOrigin: url.origin,
        expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
      if (!result.verified) return reply({ error: 'Passkey wurde nicht bestätigt.' }, 400);
      const credential = result.registrationInfo.credential;
      await db.insert(passkeys).values({ id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter, transports: credential.transports || [], userId: challenge.userId });
    } else {
      const [stored] = await db.select().from(passkeys).where(eq(passkeys.id, String(body.response?.id))).limit(1);
      if (!stored) return reply({ error: 'Dieser Passkey ist hier nicht registriert. Verwende das Muster.' }, 401);
      const result = await verifyAuthenticationResponse({ response: body.response,
        expectedChallenge: challenge.challenge, expectedOrigin: url.origin, expectedRPID: rpID,
        requireUserVerification: true,
        credential: { id: stored.id, publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
          counter: stored.counter, transports: stored.transports as any } });
      if (!result.verified) return reply({ error: 'Passkey wurde nicht bestätigt.' }, 401);
      const updated = await db.update(passkeys).set({ counter: result.authenticationInfo.newCounter })
        .where(and(eq(passkeys.id, stored.id), eq(passkeys.counter, stored.counter))).returning({ id: passkeys.id });
      if (!updated.length) return reply({ error: 'Bitte die Anmeldung erneut versuchen.' }, 409);
    }
    // Completes only the pattern step, never the host-code step.
    return reply({ verified: true });
  } catch {
    return reply({ error: 'Passkey konnte nicht geprüft werden. Versuche es erneut oder verwende das Muster.' }, 400);
  }
};
export const config = { path: '/api/passkeys' };
