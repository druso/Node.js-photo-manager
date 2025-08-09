const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (input.length % 4);
  if (pad !== 4) input = input + '='.repeat(pad);
  return Buffer.from(input, 'base64').toString('utf8');
}

function signPayload(payload, secret) {
  const data = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

function verifyToken(token, secret) {
  try {
    const [data, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (sig !== expectedSig) return { ok: false, reason: 'bad_signature' };
    const payload = JSON.parse(base64urlDecode(data));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }
}

module.exports = {
  signPayload,
  verifyToken,
};
