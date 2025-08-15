// polyfills.js
// Load FIRST (from index.js). Safe for Expo + Hermes on iOS/Android.

import 'react-native-url-polyfill/auto';      // URL, fetch, etc.
import 'react-native-get-random-values';      // crypto.getRandomValues()

import { decode as _atob, encode as _btoa } from 'base-64';
if (!global.atob) global.atob = _atob;
if (!global.btoa) global.btoa = _btoa;

import { Buffer as _Buffer } from 'buffer';
global.Buffer = _Buffer; // force-assign

// ---- Force override TextEncoder/TextDecoder (ignore requested encodings) ----
class UTF8TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    // Intentionally ignore label/options; always decode as UTF-8
    this.encoding = 'utf-8';
  }
  decode(input = new Uint8Array()) {
    // Normalize input to a Uint8Array
    let u8;
    if (input instanceof ArrayBuffer) {
      u8 = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (typeof input === 'string') {
      return input;
    } else {
      u8 = Uint8Array.from(input);
    }
    // Hermes-safe: always decode as UTF-8
    return _Buffer.from(u8).toString('utf8');
  }
}
class UTF8TextEncoder {
  encode(str = '') {
    return _Buffer.from(String(str), 'utf8');
  }
}

// Force replace any existing polyfills that RN/libs may have registered
global.TextDecoder = UTF8TextDecoder;
global.TextEncoder = UTF8TextEncoder;

// ---- Extra guards: coerce "utf-16le" → "utf8" if any lib asks Buffer directly ----
const _origFrom = _Buffer.from;
_Buffer.from = function (value, enc, ...rest) {
  if (typeof enc === 'string' && enc.toLowerCase() === 'utf-16le') enc = 'utf8';
  return _origFrom(value, enc, ...rest);
};
const _origToString = _Buffer.prototype.toString;
_Buffer.prototype.toString = function (enc, ...rest) {
  if (typeof enc === 'string' && enc.toLowerCase() === 'utf-16le') enc = 'utf8';
  return _origToString.call(this, enc, ...rest);
};

// Optional: a tiny process shim some libs expect
if (!global.process) global.process = {};
if (!global.process.env) global.process.env = {};
