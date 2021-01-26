import {registerBidder} from '../src/adapters/bidderFactory.js';
import {ajax} from '../src/ajax.js';
import {BANNER, VIDEO} from '../src/mediaTypes.js';
import * as utils from '../src/utils.js';

// Do not import POLYFILLS from core-js. Most likely until next major update (v4).
// Prebid.js committers updated core-js to version 3 on v3.19.0 release (9/5/2020).
// This broke imports. We need to be backwards compatible since this adapter is copied into
// other prebids that may be older than the latest version. Try use alternative
// implementation or put polyfill directly at the end of this file as we did for 'find' function.
// import find from 'core-js-pure/features/array/find.js';

const BIDDER_CODE = 'stroeerCore';
const DEFAULT_HOST = 'hb.adscale.de';
const DEFAULT_PATH = '/dsh';
const DEFAULT_PORT = '';

const _externalCrypter = new Crypter('c2xzRWh5NXhpZmxndTRxYWZjY2NqZGNhTW1uZGZya3Y=', 'eWRpdkFoa2tub3p5b2dscGttamIySGhkZ21jcmg0Znk=');
const _internalCrypter = new Crypter('1AE180CBC19A8CFEB7E1FCC000A10F5D892A887A2D9=', '0379698055BD41FD05AC543A3AAAD6589BC6E1B3626=');

const isSecureWindow = () => utils.getWindowSelf().location.protocol === 'https:';
const isMainPageAccessible = () => getMostAccessibleTopWindow() === utils.getWindowTop();

function getTopWindowReferrer() {
  try {
    return utils.getWindowTop().document.referrer;
  } catch (e) {
    return utils.getWindowSelf().referrer;
  }
}

function getStroeerCore() {
  let win = utils.getWindowSelf();

  try {
    while (!win.stroeerCore && utils.getWindowTop() !== win && win.parent.location.href.length) {
      win = win.parent;
    }
  } catch (ignore) {
  }

  win.stroeerCore = win.stroeerCore || {};
  return win.stroeerCore;
}

function getMostAccessibleTopWindow() {
  let res = utils.getWindowSelf();

  try {
    while (utils.getWindowTop().top !== res && res.parent.location.href.length) {
      res = res.parent;
    }
  } catch (ignore) {
  }

  return res;
}

function elementInView(elementId) {
  const resolveElement = (elId) => {
    let slotInfo;
    let win = utils.getWindowSelf();
    if (win.SDG && (slotInfo = win.SDG.getCN().getSlotByPosition(elId)) !== null) {
      return slotInfo.getContainer();
    } else {
      return win.document.getElementById(elId);
    }
  };

  const visibleInWindow = (el, win) => {
    const rect = el.getBoundingClientRect();
    const inView = (rect.top + rect.height >= 0) && (rect.top <= win.innerHeight);

    if (win !== win.parent) {
      return inView && visibleInWindow(win.frameElement, win.parent);
    }

    return inView;
  };

  try {
    return visibleInWindow(resolveElement(elementId), utils.getWindowSelf());
  } catch (e) {
    // old browser, element not found, cross-origin etc.
  }
  return undefined;
}

function buildUrl({host: hostname = DEFAULT_HOST, port = DEFAULT_PORT, securePort, path: pathname = DEFAULT_PATH}) {
  if (securePort) {
    port = securePort;
  }

  return utils.buildUrl({protocol: 'https', hostname, port, pathname});
}

function setupGlobalNamespace(anyBid) {
  const stroeerCore = getStroeerCore();
  // Used to lookup publisher's website settings on server-side.
  stroeerCore.anySid = stroeerCore.anySid || anyBid.params.sid;
  // Can be overridden for testing
  stroeerCore.userConnectJsUrl = stroeerCore.userConnectJsUrl || anyBid.params.connectjsurl;
}

function initUserConnect() {
  const stroeerCore = getStroeerCore();

  const sid = stroeerCore.anySid;
  const userConnectJsUrl = (stroeerCore.userConnectJsUrl || 'https://js.adscale.de/userconnect.js');

  const scriptElement = getMostAccessibleTopWindow().document.createElement('script');

  if (sid) {
    scriptElement.setAttribute('data-container-config', JSON.stringify({slotId: sid}));
  }

  scriptElement.src = userConnectJsUrl;

  utils.insertElement(scriptElement);
}

function hasBanner(bidReq) {
  return (!bidReq.mediaTypes && !bidReq.mediaType) ||
    (bidReq.mediaTypes && bidReq.mediaTypes.banner) ||
    bidReq.mediaType === BANNER;
}

function hasInstreamVideoOnly(bidReq) {
  const mediaTypes = bidReq.mediaTypes;
  return !hasBanner(bidReq) &&
    mediaTypes &&
    Object.keys(mediaTypes).length === 1 &&
    mediaTypes.video &&
    mediaTypes.video.context === 'instream';
}

function splitBidRequests(bidRequests) {
  const groupBy = {
    'params.ssat': value => value !== 1,
    'mediaTypes.video': value => value != null
  };
  const keys = Object.keys(groupBy);
  const bidRequestGroups = [];

  bidRequests.forEach(bidRequest => {
    let bidRequestsGroup = find(bidRequestGroups, bidGroup => {
      return keys.every(name => bidGroup.key[name] === groupBy[name](utils.deepAccess(bidRequest, name)));
    });
    if (!bidRequestsGroup) {
      const key = {};
      keys.forEach(name => key[name] = groupBy[name](utils.deepAccess(bidRequest, name)));
      bidRequestsGroup = {key, bidRequests: []}
      bidRequestGroups.push(bidRequestsGroup);
    }
    bidRequestsGroup.bidRequests.push(bidRequest);
  });

  return bidRequestGroups.map(group => group.bidRequests);
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, VIDEO],
  gvlid: 136,

  isBidRequestValid: (function () {
    const validators = [];

    const createValidator = (checkFn, errorMsgFn) => {
      return (bidRequest) => {
        if (checkFn(bidRequest)) {
          return true;
        } else {
          utils.logError(`invalid bid in ${BIDDER_CODE}: ${errorMsgFn(bidRequest)}`, 'WARN');
          return false;
        }
      }
    };

    function hasValidMediaType(bidReq) {
      return hasBanner(bidReq) || hasInstreamVideoOnly(bidReq);
    }

    validators.push(createValidator((bidReq) => hasValidMediaType(bidReq),
      bidReq => `bid request ${bidReq.bidId} does not have a valid media type`));
    validators.push(createValidator((bidReq) => typeof bidReq.params === 'object',
      bidReq => `bid request ${bidReq.bidId} does not have custom params`));
    validators.push(createValidator((bidReq) => utils.isStr(bidReq.params.sid),
      bidReq => `bid request ${bidReq.bidId} does not have a sid string field`));
    validators.push(createValidator((bidReq) => bidReq.params.ssat === undefined || [1, 2].indexOf(bidReq.params.ssat) > -1,
      bidReq => `bid request ${bidReq.bidId} does not have a valid ssat value (must be 1 or 2)`));

    return function (bidRequest) {
      return validators.every(f => f(bidRequest));
    }
  }()),

  buildRequests: function (validBidRequests = [], bidderRequest) {
    const anyBid = bidderRequest.bids[0];
    const win = utils.getWindowSelf();

    setupGlobalNamespace(anyBid);

    const groupedBidRequests = splitBidRequests(validBidRequests);

    const commonPayload = {
      id: bidderRequest.auctionId,
      ref: getTopWindowReferrer(),
      ssl: isSecureWindow(),
      mpa: isMainPageAccessible(),
      timeout: bidderRequest.timeout - (Date.now() - bidderRequest.auctionStart),
      ab: win['yieldlove_ab'],
    };

    const userIds = anyBid.userId;
    if (!utils.isEmpty(userIds)) {
      commonPayload.user = {
        euids: userIds
      };
    }

    const gdprConsent = bidderRequest.gdprConsent;
    if (gdprConsent && gdprConsent.consentString != null && gdprConsent.gdprApplies != null) {

      commonPayload.gdpr = {
        consent: gdprConsent.consentString, applies: gdprConsent.gdprApplies
      };
    }

    const globalKeyValues = getGlobalKeyValues();
    if (globalKeyValues !== undefined) {
      commonPayload.kvg = globalKeyValues;
    }

    function createPayload(bidRequests) {
      const bidRequestWithSsat = find(bidRequests, bidRequest => bidRequest.params.ssat);
      const bidRequestWithYl2 = find(bidRequests, bidRequest => bidRequest.params.yl2);

      const payload = Object.assign({
        ssat: bidRequestWithSsat ? bidRequestWithSsat.params.ssat : undefined,
        yl2: bidRequestWithYl2 ? bidRequestWithYl2.params.yl2 : (getFromLocalStorage('sdgYieldtest') === '1'),
      }, commonPayload);

      payload.bids = bidRequests.map(bidRequest => ({
        // siz: [] - Still supported on the backend for backwards compatibility (size of banner bid)
        bid: bidRequest.bidId,
        sid: bidRequest.params.sid,
        viz: elementInView(bidRequest.adUnitCode),
        vid: createVideoObject(bidRequest),
        ban: createBannerObject(bidRequest),
        ctx: getContextFromSDG(bidRequest)
      }));

      return payload;
    }

    function getFromLocalStorage(itemName) {
      let result;
      try {
        // Browser may restrict access by throwing error
        result = localStorage[itemName];
      } catch (ignore) {}
      return result;
    }

    function getContextFromSDG(bidRequest) {
      if (win.SDG) {
        return {
          position: bidRequest.adUnitCode,
          adUnits: getAdUnits(bidRequest.adUnitCode),
          zone: getZone(bidRequest.adUnitCode),
          pageType: getPageType(bidRequest.adUnitCode),
        }
      }
    }

    function bannerBidSizes(bid) {
      return utils.deepAccess(bid, 'mediaTypes.banner.sizes') || bid.sizes /* for prebid < 3 */ || [];
    }

    function createVideoObject (bidRequest) {
      if (hasInstreamVideoOnly(bidRequest)) {
        const video = bidRequest.mediaTypes.video;
        return {
          ctx: video.context,
          siz: video.playerSize,
          mim: video.mimes
        }
      }
      return undefined;
    }

    function createBannerObject (bidRequest) {
      return hasBanner(bidRequest) ? {
        siz: bannerBidSizes(bidRequest),
      } : undefined
    }

    const endpointUrl = buildUrl(anyBid.params);

    const serverRequestInfos = [];

    groupedBidRequests.forEach(bidRequests => {
      if (bidRequests.length > 0) {
        serverRequestInfos.push({
          method: 'POST', url: endpointUrl, data: createPayload(bidRequests)
        });
      }
    });

    return serverRequestInfos;

    function getPageType(position) {
      try {
        return win.SDG.getCN().getSlotByPosition(position).getPageType()
      } catch (e) {
        return undefined;
      }
    }

    function getZone(position) {
      try {
        return win.SDG.getCN().getSlotByPosition(position).getZone()
      } catch (e) {
        return undefined;
      }
    }

    function getAdUnits(position) {
      try {
        return win.SDG.getCN().getSlotByPosition(position).getAdUnits()
      } catch (e) {
        return undefined;
      }
    }

    function getGlobalKeyValues() {
      try {
        return win.SDG.Publisher.getConfig().getKeyValues()
      } catch (e) {
        return undefined;
      }
    }
  },

  interpretResponse: function (serverResponse) {
    const bids = [];

    if (serverResponse.body && typeof serverResponse.body === 'object') {
      if (serverResponse.body.tep) {
        ajax(serverResponse.body.tep, () => {
        });
      }

      serverResponse.body.bids.forEach(bidResponse => {
        const cpm = bidResponse.cpm || 0;
        const mediaType = bidResponse.vastXml != null ? VIDEO : BANNER;

        const bid = {
          // Prebid fields
          requestId: bidResponse.bidId,
          cpm: cpm,
          width: bidResponse.width || 0,
          height: bidResponse.height || 0,
          ttl: 300 /* 5 minutes */,
          currency: 'EUR',
          netRevenue: true,
          creativeId: '',
          mediaType,

          // Custom fields
          cpm2: bidResponse.cpm2 || 0,
          floor: bidResponse.floor || cpm,
          maxprice: bidResponse.maxprice || cpm,
          exchangeRate: bidResponse.exchangeRate,
          nurl: bidResponse.nurl,
          originalAd: bidResponse.ad,
          tracking: bidResponse.tracking,
          generateAd: function ({auctionPrice, firstBid, secondBid, thirdBid}) {
            let sspAuctionPrice = auctionPrice;

            if (this.exchangeRate && this.exchangeRate !== 1) {
              auctionPrice = (parseFloat(auctionPrice) * this.exchangeRate).toFixed(4);
            }

            auctionPrice = tunePrice(auctionPrice);
            sspAuctionPrice = tunePrice(sspAuctionPrice);

            const sspFirstBid = firstBid == null ? '' : _internalCrypter.encrypt(this.adId, tunePrice(firstBid).toString());
            const sspSecondBid = secondBid == null ? '' : _internalCrypter.encrypt(this.adId, tunePrice(secondBid).toString());
            const sspThirdBid = thirdBid == null ? '' : _internalCrypter.encrypt(this.adId, tunePrice(thirdBid).toString());

            // note: adId provided by prebid elsewhere (same as bidId)
            return this.originalAd
              .replace(/\${AUCTION_PRICE:ENC}/g, _externalCrypter.encrypt(this.adId, auctionPrice.toString()))
              .replace(/\${SSP_AUCTION_PRICE:ENC}/g, _internalCrypter.encrypt(this.adId, sspAuctionPrice.toString()))
              .replace(/\${FIRST_BID:ENC}/g, sspFirstBid)
              .replace(/\${SECOND_BID:ENC}/g, sspSecondBid)
              .replace(/\${THIRD_BID:ENC}/g, sspThirdBid)
              .replace(/\${AUCTION_PRICE}/g, auctionPrice);
          }
        };

        if (mediaType === VIDEO) {
          bid.vastXml = bidResponse.vastXml;
        } else {
          bid.ad = bidResponse.ad;
        }

        if (bidResponse.bidPriceOptimisation) {
          bids.push(Object.assign(bid, bidResponse.bidPriceOptimisation))
        } else {
          bids.push(bid);
        }
      });
    }

    return bids;
  },

  getUserSyncs: function (syncOptions, serverResponses) {
    // WARNING: we are breaking rules by inserting sync elements ourselves instead of prebid.
    // This is ok as we are using our own prebid.js build. This is not an official adapter yet.
    // To make official we need to revisit how we do user matching along with adex, nuggad, etc.

    if (serverResponses.length > 0) {
      // We have a response so almost guaranteed we have cookie, etc.
      initUserConnect();
    }

    return [];
  }
};

registerBidder(spec);

function tunePrice(price) {
  const ENCRYPTION_SIZE_LIMIT = 8;
  const str = String(price);
  if (str.length <= ENCRYPTION_SIZE_LIMIT) {
    return price;
  }

  const throwError = () => {
    throw new Error(`unable to truncate ${price} to fit into 8 bytes`);
  };
  const sides = str.split('.');

  if (sides.length === 2) {
    const integerPart = sides[0].trim();
    let fractionalPart = sides[1].trim();

    const bytesRemaining = ENCRYPTION_SIZE_LIMIT - integerPart.length;

    // room '.' and at least two fraction digits
    if (bytesRemaining > 2) fractionalPart = fractionalPart.substring(0, bytesRemaining - 1);
    // room for '.' and first fraction digit. Can only accept if second fraction digit is zero.
    else if (bytesRemaining === 2 && (fractionalPart.charAt(1) === '0')) fractionalPart = fractionalPart.charAt(0);
    // no more room for '.' or fraction digit. Only accept if first and second fraction digits are zero.
    else if (bytesRemaining >= 0 && bytesRemaining < 2 && fractionalPart.charAt(0) === '0' && fractionalPart.charAt(1) === '0') fractionalPart = '';
    else throwError();

    const newPrice = integerPart + (fractionalPart.length > 0 ? '.' + fractionalPart : '');
    utils.logWarn(`truncated price ${price} to ${newPrice} to fit into 8 bytes`);
    return newPrice;
  }

  throwError();
}

function Crypter(encKey, intKey) {
  this.encKey = atob(encKey); // padEnd key
  this.intKey = atob(intKey); // signature key
}

Crypter.prototype.encrypt = function (anyRandomString, data) {
  const CIPHERTEXT_SIZE = 8;
  const SIGNATURE_SIZE = 4;
  let paddedImpressionId = padEnd(anyRandomString, 16, '0').substring(0, 16);

  if (data.length > CIPHERTEXT_SIZE) {
    throw new Error('data to encrypt is too long');
  }

  let encryptionPad = str_hmac_sha1(this.encKey, paddedImpressionId);

  let encryptedPrice = '';

  for (let i = 0; i < CIPHERTEXT_SIZE; i++) {
    let priceCharCode = (i >= data.length) ? '\x00' : data.charCodeAt(i);
    encryptedPrice = encryptedPrice + String.fromCharCode(0xff & (priceCharCode ^ convertSignedByte(encryptionPad.charCodeAt(i))));
  }

  // Integrity

  data = padEnd(data, CIPHERTEXT_SIZE, '\u0000');
  data += paddedImpressionId;

  const signature = str_hmac_sha1(this.intKey, data).substring(0, SIGNATURE_SIZE);

  return base64EncodeUrlFriendly(paddedImpressionId + encryptedPrice + signature);
};

function base64EncodeUrlFriendly(str) {
  return btoa(str)
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=+$/, ''); // Remove ending '='
}

function convertSignedByte(value) {
  if (value >= 128) {
    return value - 256;
  } else {
    return value;
  }
}

function padEnd(str, targetLength, paddingChar) {
  const remainder = targetLength - str.length;
  for (let i = 0; i < remainder; i++) {
    str += paddingChar;
  }
  return str;
}

/* eslint-disable camelcase */
// Code taken from http://pajhome.org.uk/crypt/md5/sha1.js
/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */
const chrsz = 8; // bits per input character. 8 - ASCII; 16 - Unicode

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function str_hmac_sha1(key, data) {
  return binb2str(core_hmac_sha1(key, data));
}

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function core_sha1(x, len) {
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  let w = Array(80);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  let e = -1009589776;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;
    const olde = e;

    for (let j = 0; j < 80; j++) {
      if (j < 16) {
        w[j] = x[i + j];
      } else {
        w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }
      const t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)), safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return [a, b, c, d, e]; // Was Array(a, b, c, d, e)
}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d) {
  if (t < 20) {
    return (b & c) | ((~b) & d);
  }
  if (t < 40) {
    return b ^ c ^ d;
  }
  if (t < 60) {
    return (b & c) | (b & d) | (c & d);
  }
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t) {
  return (t < 20) ? 1518500249 : (t < 40) ? 1859775393 : (t < 60) ? -1894007588 : -899497514;
}

/*
 * Calculate the HMAC-SHA1 of a key and some data
 */
function core_hmac_sha1(key, data) {
  let bkey = str2binb(key);
  if (bkey.length > 16) {
    bkey = core_sha1(bkey, key.length * chrsz);
  }

  const ipad = Array(16);
  const opad = Array(16);
  for (let i = 0; i < 16; i++) {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  const hash = core_sha1(ipad.concat(str2binb(data)), 512 + data.length * chrsz);
  return core_sha1(opad.concat(hash), 512 + 160);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y) {
  const lsw = (x & 0xFFFF) + (y & 0xFFFF);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function rol(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

/*
 * Convert an 8-bit or 16-bit string to an array of big-endian words
 * In 8-bit function, characters >255 have their hi-byte silently ignored.
 */
function str2binb(str) {
  const bin = []; // was Array()
  const mask = (1 << chrsz) - 1;
  for (let i = 0; i < str.length * chrsz; i += chrsz) {
    bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << (32 - chrsz - i % 32);
  }
  return bin;
}

/*
 * Convert an array of big-endian words to a string
 */
function binb2str(bin) {
  let str = '';
  const mask = (1 << chrsz) - 1;
  for (let i = 0; i < bin.length * 32; i += chrsz) {
    str += String.fromCharCode((bin[i >> 5] >>> (32 - chrsz - i % 32)) & mask);
  }
  return str;
}

/* eslint-enable camelcase */

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find#Polyfill
function find(obj, predicate) {
  // 1. Let O be ? ToObject(this value).
  var o = Object(obj);

  // 2. Let len be ? ToLength(? Get(O, "length")).
  var len = o.length >>> 0;

  // 3. If IsCallable(predicate) is false, throw a TypeError exception.
  if (typeof predicate !== 'function') {
    throw TypeError('predicate must be a function');
  }

  // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
  var thisArg = arguments[1];

  // 5. Let k be 0.
  var k = 0;

  // 6. Repeat, while k < len
  while (k < len) {
    // a. Let Pk be ! ToString(k).
    // b. Let kValue be ? Get(O, Pk).
    // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
    // d. If testResult is true, return kValue.
    var kValue = o[k];
    if (predicate.call(thisArg, kValue, k, o)) {
      return kValue;
    }
    // e. Increase k by 1.
    k++;
  }

  // 7. Return undefined.
  return undefined;
}
