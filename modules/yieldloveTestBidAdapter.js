/**
 * For test purpose ONLY!
 * More details see yieldlove/live-test/test-bids-server as the test bid server for it
 */
import {registerBidder} from '../src/adapters/bidderFactory.js';
import { deepAccess, logInfo} from '../src/utils.js';
import {BANNER, NATIVE, VIDEO} from '../src/mediaTypes.js';

const ENDPOINT_URL = 'https://wip6xvaygwndcll47o2jhmamjq0hdqhh.lambda-url.eu-central-1.on.aws';

const DEFAULT_BID_TTL = 30000;
const DEFAULT_CURRENCY = 'EUR';

const NATIVE_IMAGE = {
  image: {
    required: true
  },
  title: {
    required: true
  },
  sponsoredBy: {
    required: true
  },
  clickUrl: {
    required: true
  },
  body: {
    required: false
  },
  icon: {
    required: false
  },
  cta: {
    required: false
  }
};

export const spec = {
  gvlid: 251,
  code: 'yieldloveTest',
  aliases: ['yltest'],
  supportedMediaTypes: [BANNER, NATIVE, VIDEO],
  bidRequestIdCache: [],

  isBidRequestValid: function (bid) {
    return !!bid.params.placementId
  },

  buildRequests: function (validBidRequests, bidderRequest) {
    if (!validBidRequests || !bidderRequest) {
      return;
    }

    const impressions = validBidRequests.map(bidRequest => {
      let mediatype = getMediatype(bidRequest);

      const request = {
        id: bidRequest.bidId,
        placementId: bidRequest.params.placementId,
        adUnitCode: bidRequest.adUnitCode,
        nobid: bidRequest.nobid,
        cpm: bidRequest.params.cpm,
        sizes: bidRequest.sizes,
        tracking: bidRequest.params.tracking,
        adFormat: bidRequest.params.adFormat
      }

      if (mediatype === NATIVE) {
        let nativeReq = bidRequest.mediaTypes.native;
        if (nativeReq.type === 'image') {
          nativeReq = Object.assign({}, NATIVE_IMAGE, nativeReq);
        }
        // click url is always mandatory even if not specified by publisher
        nativeReq.clickUrl = {
          required: true
        };
        request.native = nativeReq;

        request.width = bidRequest.params.sizes && bidRequest.params.sizes[0] ? bidRequest.params.sizes[0][0] : 0
        request.height = bidRequest.params.sizes && bidRequest.params.sizes[0] ? bidRequest.params.sizes[0][1] : 0
      } else if (mediatype === BANNER) {
        const sizes = bidRequest.sizes.map(sizeArr => ({
          width: sizeArr[0],
          height: sizeArr[1],
        }))
        if (sizes.length > 0) {
          Object.assign(request, sizes[0])
        }
      }

      return request
    });

    const trbRequest = {
      auctionId: validBidRequests[0].auctionId,
      imp: impressions
    }

    return {
      method: 'POST',
      url: ENDPOINT_URL,
      data: JSON.stringify(trbRequest),
      options: {
        contentType: 'application/json',
        withCredentials: false,
        crossOrigin: false,
      }
    }
  },

  interpretResponse: function (serverResponse, request) {
    const bidResponses = [];
    let bidRequests = {};

    try {
      bidRequests = JSON.parse(request.data).imp;
    } catch (err) {
      // json error initial request can't be read
    }

    const response = (serverResponse || {}).body;
    // response is always one seat (exchange) with (optional) bids for each impression
    if (response && response.bids) {
      response.bids.forEach(bid => {
        const request = bidRequests && bidRequests.find( b => b.id === bid.requestId);

        const newBid = {
          requestId: bid.requestId,
          cpm: bid.cpm,
          width: bid.width,
          height: bid.height,
          ad: bid.content,
          ttl: DEFAULT_BID_TTL,
          creativeId: bid.creativeId,
          placementId: bid.placementId,
          netRevenue: DEFAULT_CURRENCY,
          currency: DEFAULT_CURRENCY,
          tracking: bid.tracking,
          format: bid.format,
        }

        if (bid.native) {
          newBid.native = getNativeAssets(bid, request.native);
          newBid.mediaType = 'native';
        }

       if(bid.adUnitCode.includes('outstream-video-yieldlove-autogen')) {
         newBid.mediaType = 'video';
       }

        bidResponses.push(newBid)
      })
    } else {
      logInfo('yieldlove.interpretResponse :: no valid responses to interpret');
    }
    return bidResponses;
  },
  getUserSyncs: function () {

  },

};

/* Get mediatype from bidRequest */
function getMediatype(bidRequest) {
  if (deepAccess(bidRequest, 'mediaTypes.banner')) {
    return BANNER;
  }
  if (deepAccess(bidRequest, 'mediaTypes.video')) {
    return VIDEO;
  }
  if (deepAccess(bidRequest, 'mediaTypes.native')) {
    return NATIVE;
  }
}

function getNativeAssets(response, nativeConfig) {
  if (typeof response.native === 'object') {
    return response.native;
  }
  const native = {};

  var adJson = {};
  var textsJson = {};
  if (typeof response.Ad === 'string') {
    adJson = JSON.parse(response.Ad.match(/\/\*PREBID\*\/(.*)\/\*PREBID\*\//)[1]);
    textsJson = adJson.Content.Preview.Text;

    var impressionUrl = adJson.TrackingPrefix +
            '/pixel?event_kind=IMPRESSION&attempt=' + adJson.Attempt;
    var insertionUrl = adJson.TrackingPrefix +
            '/pixel?event_kind=INSERTION&attempt=' + adJson.Attempt;

    if (adJson.Campaign) {
      impressionUrl += '&campaign=' + adJson.Campaign;
      insertionUrl += '&campaign=' + adJson.Campaign;
    }

    native.clickUrl = adJson.TrackingPrefix + '/ar?event_kind=CLICK&attempt=' + adJson.Attempt +
      '&campaign=' + adJson.Campaign + '&url=' + encodeURIComponent(adJson.Content.Landing.Url);

    if (adJson.OnEvents) {
      native.clickTrackers = getTrackers(adJson.OnEvents['CLICK']);
      native.impressionTrackers = getTrackers(adJson.OnEvents['IMPRESSION']);
      native.javascriptTrackers = getTrackers(adJson.OnEvents['IMPRESSION'], true);
    } else {
      native.impressionTrackers = [];
    }

    native.impressionTrackers.push(impressionUrl, insertionUrl);
  }

  Object.keys(nativeConfig).map(function(key, index) {
    switch (key) {
      case 'title':
        native[key] = textsJson.TITLE;
        break;
      case 'body':
        native[key] = textsJson.DESCRIPTION;
        break;
      case 'cta':
        native[key] = textsJson.CALLTOACTION;
        break;
      case 'sponsoredBy':
        native[key] = adJson.Content.Preview.Sponsor.Name;
        break;
      case 'image':
        // main image requested size
        const imgSize = nativeConfig.image.sizes || [];
        if (!imgSize.length) {
          imgSize[0] = response.Width || 300;
          imgSize[1] = response.Height || 250;
        }

        const url = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Thumbnail.Image'), imgSize[0], imgSize[1]);
        if (url) {
          native[key] = {
            url,
            width: imgSize[0],
            height: imgSize[1]
          };
        }

        break;
      case 'icon':
        // icon requested size
        const iconSize = nativeConfig.icon.sizes || [];
        if (!iconSize.length) {
          iconSize[0] = 50;
          iconSize[1] = 50;
        }

        const icurl = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Sponsor.Logo.Resource'), iconSize[0], iconSize[1]);

        if (icurl) {
          native[key] = {
            url: icurl,
            width: iconSize[0],
            height: iconSize[1]
          };
        }
        break;
      case 'privacyIcon':
        native[key] = getImageUrl(adJson, deepAccess(adJson, 'Content.Preview.Credit.Logo.Resource'), 25, 25);
        break;
      case 'privacyLink':
        native[key] = deepAccess(adJson, 'Content.Preview.Credit.Url');
        break;
    }
  });

  return native;
}

registerBidder(spec);
