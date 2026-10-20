import {
  bearerToken,
  corsHeaders,
  corsOrigin,
  firebaseJwtClaimError,
  firebaseUidFromClaims,
  readJwtHeaderAndClaims,
  splitJwt,
} from '../workers/web-api/src/authn';

const PROJECT = 'nest-app';
const NOW = 1_700_000_000;

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(header: unknown, claims: unknown, sig = 'sig'): string {
  return `${b64url(header)}.${b64url(claims)}.${sig}`;
}

const goodHeader = { alg: 'RS256', kid: 'abc' };
const goodClaims = {
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  exp: NOW + 60,
  sub: 'uid-1',
};

describe('splitJwt / readJwtHeaderAndClaims', () => {
  it('rejects tokens that are missing a header, payload, or signature segment', () => {
    expect(splitJwt('')).toBeNull();
    expect(splitJwt('onlyone')).toBeNull();
    expect(splitJwt('header.payload')).toBeNull();
    expect(splitJwt('.payload.sig')).toBeNull();
    expect(splitJwt('header..sig')).toBeNull();
    expect(readJwtHeaderAndClaims('not-json.also-not.sig')).toBeNull();
  });

  it('decodes header and claims from a well-formed token', () => {
    const t = token(goodHeader, goodClaims);
    const parsed = readJwtHeaderAndClaims(t);
    expect(parsed?.header).toEqual(goodHeader);
    expect(parsed?.claims).toEqual(goodClaims);
    expect(parsed?.signingInput).toBe(t.slice(0, t.lastIndexOf('.')));
  });
});

describe('firebaseJwtClaimError', () => {
  it('accepts a Firebase ID token for this project that is not expired', () => {
    expect(firebaseJwtClaimError(goodHeader, goodClaims, PROJECT, NOW)).toBeNull();
    expect(firebaseUidFromClaims(goodHeader, goodClaims, PROJECT, NOW)).toBe('uid-1');
    // exp == now is still valid (the Worker uses exp < now, not <=)
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, exp: NOW }, PROJECT, NOW)).toBeNull();
  });

  it('rejects the wrong algorithm, audience, or issuer', () => {
    expect(firebaseJwtClaimError({ alg: 'HS256', kid: 'abc' }, goodClaims, PROJECT, NOW)).toBe('alg');
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, aud: 'other-project' }, PROJECT, NOW)).toBe(
      'aud',
    );
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, aud: [PROJECT] }, PROJECT, NOW)).toBe('aud');
    expect(
      firebaseJwtClaimError(
        goodHeader,
        { ...goodClaims, iss: 'https://securetoken.google.com/other-project' },
        PROJECT,
        NOW,
      ),
    ).toBe('iss');
  });

  it('rejects an expired token and a missing or empty uid', () => {
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, exp: NOW - 1 }, PROJECT, NOW)).toBe('exp');
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, exp: 'soon' }, PROJECT, NOW)).toBe('exp');
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, sub: '' }, PROJECT, NOW)).toBe('sub');
    expect(firebaseJwtClaimError(goodHeader, { ...goodClaims, sub: 123 }, PROJECT, NOW)).toBe('sub');
    expect(firebaseUidFromClaims(goodHeader, { ...goodClaims, sub: '' }, PROJECT, NOW)).toBeNull();
  });
});

describe('bearerToken', () => {
  it('strips a Bearer prefix case-insensitively and treats a missing header as empty', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken(null)).toBe('');
    expect(bearerToken(undefined)).toBe('');
  });
});

describe('corsOrigin', () => {
  const allowed = 'https://app.example.com, https://www.example.com';

  it('echoes an Origin that is on the allow-list (trim-aware)', () => {
    expect(corsOrigin('https://www.example.com', allowed)).toBe('https://www.example.com');
    expect(corsOrigin('https://app.example.com', allowed)).toBe('https://app.example.com');
  });

  it('falls back to the first allowed origin when Origin is missing or unknown', () => {
    expect(corsOrigin('', allowed)).toBe('https://app.example.com');
    expect(corsOrigin('https://evil.example', allowed)).toBe('https://app.example.com');
  });

  it('sets the CORS headers the Worker returns on every response', () => {
    expect(corsHeaders('https://www.example.com', allowed)).toEqual({
      'Access-Control-Allow-Origin': 'https://www.example.com',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    });
  });
});
