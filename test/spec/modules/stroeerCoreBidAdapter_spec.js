import {assert} from 'chai';
import {spec} from 'modules/stroeerCoreBidAdapter.js';
import * as utils from 'src/utils.js';
import {BANNER, VIDEO} from '../../../src/mediaTypes.js';
import * as prebidGlobal from '../../../src/prebidGlobal';

describe('stroeerCore bid adapter', function () {
  let sandbox;
  let fakeServer;
  let bidderRequest;
  let clock;

  beforeEach(() => {
    bidderRequest = buildBidderRequest();
    sandbox = sinon.sandbox.create();
    fakeServer = sandbox.useFakeServer();
    clock = sandbox.useFakeTimers();
    delete localStorage.sdgYieldtest;
  });

  afterEach(() => {
    sandbox.restore();
  });

  function assertStandardFieldsBid(bidObject, bidId, width, height, cpm) {
    assert.propertyVal(bidObject, 'requestId', bidId);
    assert.propertyVal(bidObject, 'width', width);
    assert.propertyVal(bidObject, 'height', height);
    assert.propertyVal(bidObject, 'cpm', cpm);
    assert.propertyVal(bidObject, 'currency', 'EUR');
    assert.propertyVal(bidObject, 'netRevenue', true);
    assert.propertyVal(bidObject, 'creativeId', '');
  }

  function assertStandardFieldsOnBannerBid(bidObject, bidId, ad, width, height, cpm) {
    assertStandardFieldsBid(bidObject, bidId, width, height, cpm);
    assertBannerAdMarkup(bidObject, ad);
  }

  function assertStandardFieldsOnVideoBid(bidObject, bidId, vastXml, width, height, cpm) {
    assertStandardFieldsBid(bidObject, bidId, width, height, cpm);
    assertVideoVastXml(bidObject, vastXml);
  }

  function assertBannerAdMarkup(bidObject, ad) {
    assert.propertyVal(bidObject, 'ad', ad);
    assert.notProperty(bidObject, 'vastXml');
  }

  function assertVideoVastXml(bidObject, vastXml) {
    assert.propertyVal(bidObject, 'vastXml', vastXml);
    assert.notProperty(bidObject, 'ad');
  }

  function assertCustomFieldsOnBid(bidObject, cpm2, floor, exchangeRate, nurl, originalAd, maxprice, tracking) {
    assert.propertyVal(bidObject, 'cpm2', cpm2);
    assert.propertyVal(bidObject, 'floor', floor);
    assert.propertyVal(bidObject, 'exchangeRate', exchangeRate);
    assert.propertyVal(bidObject, 'nurl', nurl);
    assert.propertyVal(bidObject, 'originalAd', originalAd);
    assert.isFunction(bidObject.generateAd);
    assert.propertyVal(bidObject, 'maxprice', maxprice);
    if (tracking) {
      assert.deepEqual(bidObject['tracking'], tracking);
    }
  }

  // Vendor user ids and associated data
  const userIds = Object.freeze({
    criteoId: 'criteo-user-id',
    digitrustid: {
      data: {
        id: 'encrypted-user-id==',
        keyv: 4,
        privacy: {optout: false},
        producer: 'ABC',
        version: 2
      }
    },
    lipb: {
      lipbid: 'T7JiRRvsRAmh88',
      segments: ['999']
    }
  });

  const buildBidderRequest = () => ({
    bidderRequestId: 'bidder-request-id-123',
    bidderCode: 'stroeerCore',
    timeout: 5000,
    auctionStart: 10000,
    refererInfo: {
      referer: 'https://www.example.com/index.html'
    },
    bids: [{
      bidId: 'bid1',
      bidder: 'stroeerCore',
      adUnitCode: '137',
      mediaTypes: {
        banner: {
          sizes: [[300, 600], [160, 60]]
        }
      },
      params: {
        sid: 'NDA='
      },
      userId: userIds
    }, {
      bidId: 'bid2',
      bidder: 'stroeerCore',
      adUnitCode: '248',
      mediaTypes: {
        banner: {
          sizes: [[728, 90]],
        }
      },
      params: {
        sid: 'ODA='
      },
      userId: userIds
    }],
  });

  const buildBidderRequestPreVersion3 = () => {
    const request = buildBidderRequest();
    request.bids.forEach((bid) => {
      bid.sizes = bid.mediaTypes.banner.sizes;
      delete bid.mediaTypes;
      bid.mediaType = 'banner';
    });
    return request;
  };

  const buildBidderResponse = () => ({
    'bids': [{
      'bidId': 'bid1', 'cpm': 4.0, 'width': 300, 'height': 600, 'ad': '<div>tag1</div>', 'tracking': {'brandId': 123}
    }, {
      'bidId': 'bid2', 'cpm': 7.3, 'width': 728, 'height': 90, 'ad': '<div>tag2</div>'
    }]
  });

  const buildBidderResponseWithVideo = () => ({
    'bids': [{
      'bidId': 'bid1', 'cpm': 4.0, 'width': 800, 'height': 250, 'vastXml': '<vast>video</vast>'
    }]
  });

  const buildBidderResponseWithTep = () => ({
    'tep': '//hb.adscale.de/sspReqId/5f465360-cb11-44ee-b0be-b47a4f583521/39000',
    'bids': [{
      'bidId': 'bid1', 'cpm': 4.0, 'width': 300, 'height': 600, 'ad': '<div>tag1</div>'
    }]
  });

  const buildBidderResponseWithBidPriceOptimisation = () => ({
    'bids': [{
      'bidId': 'bid1',
      'cpm': 4.0,
      'width': 300,
      'height': 600,
      'ad': '<div>tag1</div>',
      'bidPriceOptimisation': {
        'cp': 4,
        'rop': {
          '0.0': 4, '2.0': 6, '5.3': 8.2, '7.0': 10
        },
        'ropFactor': 1.2
      }
    }]
  });

  const buildBidderResponseWithBidPriceOptimisationButNoBids = () => ({
    'bids': [{
      'ad': 'xyz',
      'bidId': 'bid1',
      'bidPriceOptimisation': {
        'cp': 4,
        'rop': {
          '0.0': 4, '2.0': 6, '5.3': 8.2, '7.0': 10
        },
        'ropFactor': 1.2
      }
    }]
  });

  const buildBidderResponseSecondPriceAuction = () => {
    const response = buildBidderResponse();

    const bid1 = response.bids[0];
    bid1.cpm2 = 3.8;
    bid1.floor = 2.0;
    bid1.exchangeRate = 1.0;
    bid1.nurl = 'www.something.com';
    bid1.ssat = 2;
    bid1.maxprice = 2.38;

    const bid2 = response.bids[1];
    bid2.floor = 1.0;
    bid2.exchangeRate = 0.8;
    bid2.nurl = 'www.something-else.com';
    bid2.ssat = 2;

    return response;
  };

  const buildFakeYLHH = (positionByAdUnitCode) => ({
    bidder: {
      tag: {
        getMetaTagPositionBy(adUnitCode) {
          return positionByAdUnitCode[adUnitCode];
        }
      }
    }
  });

  const createWindow = (href, params = {}) => {
    let {parent, referrer, top, frameElement, placementElements = []} = params;
    const protocol = href.startsWith('https') ? 'https:' : 'http:';
    const win = {
      frameElement,
      parent,
      top,
      location: {
        protocol, href
      },
      document: {
        createElement: function () {
          return {
            setAttribute: function () {
            }
          }
        },
        referrer,
        getElementById: id => placementElements.find(el => el.id === id)
      }
    };

    win.self = win;

    if (!parent) {
      win.parent = win;
    }

    if (!top) {
      win.top = win;
    }

    return win;
  };

  function createElement(id, offsetTop = 0) {
    return {
      id,
      getBoundingClientRect: function () {
        return {
          top: offsetTop, height: 1
        }
      }
    }
  }

  function setupSingleWindow(sandBox, placementElements = [createElement('div-1', 17), createElement('div-2', 54)]) {
    const win = createWindow('http://www.xyz.com/', {
      parent: win, top: win, frameElement: createElement(undefined, 304), placementElements: placementElements
    });

    win.innerHeight = 200;

    sandBox.stub(utils, 'getWindowSelf').returns(win);
    sandBox.stub(utils, 'getWindowTop').returns(win);

    return win;
  }

  function setupNestedWindows(sandBox, placementElements = [createElement('div-1', 17), createElement('div-2', 54)]) {
    const topWin = createWindow('http://www.abc.org/', {referrer: 'http://www.google.com/?query=monkey'});
    topWin.innerHeight = 800;

    const midWin = createWindow('http://www.abc.org/', {parent: topWin, top: topWin, frameElement: createElement()});
    midWin.innerHeight = 400;

    const win = createWindow('http://www.xyz.com/', {
      parent: midWin, top: topWin, frameElement: createElement(undefined, 304), placementElements
    });

    win.innerHeight = 200;

    sandBox.stub(utils, 'getWindowSelf').returns(win);
    sandBox.stub(utils, 'getWindowTop').returns(topWin);

    return {topWin, midWin, win};
  }

  describe('slot location uses SDG API if available', () => {
    let queriedUnitCodes = [];
    beforeEach(() => {
      const visibleElements = [createElement('div-1', 17), createElement('div-2', 54)];
      const invisibleElement = createElement('invisible-div-1', -10);
      const win = setupSingleWindow(sandbox, visibleElements);
      win.SDG = {
        getCN: function () {
          return {
            getSlotByPosition: function (elementId) {
              queriedUnitCodes.push(elementId);
              return {
                getContainer: () => invisibleElement
              }
            }
          }
        }
      };
      win.YLHH = buildFakeYLHH({
        '137': 'div-1-alpha',
        '248': 'div-2-alpha',
      });
    });

    it('visibility of both slots should be determined based on SDG ad unit codes', () => {
      bidderRequest = {
        bidderRequestId: 'bidder-request-id-123',
        bidderCode: 'stroeerCore',
        timeout: 5000,
        auctionStart: 10000,
        bids: [{
          bidId: 'bid1',
          bidder: 'stroeerCore',
          adUnitCode: '137',
          mediaTypes: {
            banner: {
              sizes: [[300, 600], [160, 60]],
            }
          },
          params: {
            sid: 'NDA='
          }
        }, {
          bidId: 'bid2',
          bidder: 'stroeerCore',
          adUnitCode: '248',
          mediaTypes: {
            banner: {
              sizes: [[728, 90]],
            }
          },
          params: {
            sid: 'ODA='
          }
        }],
      };

      const requests = spec.buildRequests(bidderRequest.bids, bidderRequest)[0];

      requests.data.bids.forEach((bid) => {
        assert.isFalse(bid.viz);
      });

      assert.deepInclude(queriedUnitCodes, 'div-1-alpha');
      assert.deepInclude(queriedUnitCodes, 'div-2-alpha');
    });
  });

  it('should support BANNER and VIDEO mediaType', function () {
    assert.deepEqual(spec.supportedMediaTypes, [BANNER, VIDEO]);
  });

  it('should have GDPR vendor list id (gvlid) set on the spec', function () {
    assert.equal(spec.gvlid, 136);
  });

  describe('bid validation entry point', () => {
    let bidRequest;

    beforeEach(() => {
      bidRequest = buildBidderRequest().bids[0];
    });

    it('should have \"isBidRequestValid\" function', () => {
      assert.isFunction(spec.isBidRequestValid);
    });

    it('should pass a valid bid', () => {
      assert.isTrue(spec.isBidRequestValid(bidRequest));
    });

    const invalidSsatSamples = [-1, 0, 3, 4];
    invalidSsatSamples.forEach((type) => {
      it(`server side auction type ${type} should be invalid`, () => {
        bidRequest.params.ssat = type;
        assert.isFalse(spec.isBidRequestValid(bidRequest));
      })
    });

    it('should include bids with valid ssat value', () => {
      bidRequest.params.ssat = 1;
      assert.isTrue(spec.isBidRequestValid(bidRequest));

      bidRequest.params.ssat = 2;
      assert.isTrue(spec.isBidRequestValid(bidRequest));

      delete bidRequest.params.ssat;
      assert.isUndefined(bidRequest.params.ssat);
      assert.isTrue(spec.isBidRequestValid(bidRequest));
    });

    it('should exclude bids without slot id param', () => {
      bidRequest.params.sid = undefined;
      assert.isFalse(spec.isBidRequestValid(bidRequest));
    });

    it('should allow instream video bids', () => {
      delete bidRequest.mediaTypes.banner;
      bidRequest.mediaTypes.video = {
        playerSize: [640, 480],
        context: 'instream'
      };

      assert.isTrue(spec.isBidRequestValid(bidRequest));
    });

    it('should allow outstream video bids', () => {
      delete bidRequest.mediaTypes.banner;
      bidRequest.mediaTypes.video = {
        playerSize: [640, 480],
        context: 'outstream'
      };

      assert.isTrue(spec.isBidRequestValid(bidRequest));
    });

    it('should allow multi-format bid that has banner and instream video', () => {
      assert.isTrue('banner' in bidRequest.mediaTypes);

      // Allowed because instream video component of the bid will be ignored in buildRequest()
      bidRequest.mediaTypes.video = {
        playerSize: [640, 480],
        context: 'instream'
      };

      assert.isTrue(spec.isBidRequestValid(bidRequest))
    });

    it('should exclude multi-format bid that has no format of interest', () => {
      bidRequest.mediaTypes = {
        video: {
          playerSize: [640, 480],
          context: 'adpod'
        },
        native: {
          image: {
            required: true,
            sizes: [150, 50]
          },
          title: {
            required: true,
            len: 80
          },
          sponsoredBy: {
            required: true
          },
          clickUrl: {
            required: true
          },
          privacyLink: {
            required: false
          },
          body: {
            required: true
          },
          icon: {
            required: true,
            sizes: [50, 50]
          }
        }
      };

      assert.isFalse(spec.isBidRequestValid(bidRequest));
    });

    it('should exclude video bids without context', () => {
      delete bidRequest.mediaTypes.banner;
      bidRequest.mediaTypes.video = {
        playerSize: [640, 480],
        context: undefined
      };

      assert.isFalse(spec.isBidRequestValid(bidRequest));
    });

    it('should exclude video, pre-version 3 bids', () => {
      delete bidRequest.mediaTypes;
      bidRequest.mediaType = VIDEO;
      assert.isFalse(spec.isBidRequestValid(bidRequest));
    });
  });

  describe('build request entry point', () => {
    it('should have \"buildRequests\" function', () => {
      assert.isFunction(spec.buildRequests);
    });

    describe('url on server request info object', () => {
      let win;
      beforeEach(() => {
        win = setupSingleWindow(sandbox);
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should use hardcoded url as default endpoint', () => {
        const bidReq = buildBidderRequest();
        let serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

        assert.equal(serverRequestInfo.method, 'POST');
        assert.isObject(serverRequestInfo.data);
        assert.equal(serverRequestInfo.url, 'https://hb.adscale.de/dsh');
      });

      describe('should use custom url if provided', () => {
        const samples = [{
          protocol: 'http:',
          params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'},
          expected: 'https://other.com:234/xyz'
        }, {
          protocol: 'https:',
          params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'},
          expected: 'https://other.com:234/xyz'
        }, {
          protocol: 'https:',
          params: {sid: 'ODA=', host: 'other.com', port: '234', securePort: '871', path: '/xyz'},
          expected: 'https://other.com:871/xyz'
        }, {
          protocol: 'http:', params: {sid: 'ODA=', port: '234', path: '/xyz'}, expected: 'https://hb.adscale.de:234/xyz'
        }, ];

        samples.forEach(sample => {
          it(`should use ${sample.expected} as endpoint when given params ${JSON.stringify(sample.params)} and protocol ${sample.protocol}`,
            function () {
              win.location.protocol = sample.protocol;

              const bidReq = buildBidderRequest();
              bidReq.bids[0].params = sample.params;
              bidReq.bids.length = 1;

              let serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

              assert.equal(serverRequestInfo.method, 'POST');
              assert.isObject(serverRequestInfo.data);
              assert.equal(serverRequestInfo.url, sample.expected);
            });
        });
      });
    });

    describe('payload on server request info object', () => {
      let topWin;
      let win;

      let placementElements;
      beforeEach(() => {
        placementElements = [createElement('div-1', 17), createElement('div-2', 54)];
        ({topWin, win} = setupNestedWindows(sandbox, placementElements));
        win.YLHH = buildFakeYLHH({
          '137': 'div-1',
          '248': 'div-2'
        })
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should have expected JSON structure', () => {
        clock.tick(13500);
        const bidReq = buildBidderRequest();

        const UUID = 'fb6a39e3-083f-424c-9046-f1095e15f3d5';

        const generateUUIDStub = sinon.stub(utils, 'generateUUID').returns(UUID);

        const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

        const expectedTimeout = bidderRequest.timeout - (13500 - bidderRequest.auctionStart);

        assert.equal(expectedTimeout, 1500);

        const expectedJsonPayload = {
          'id': UUID,
          'timeout': expectedTimeout,
          'ref': topWin.document.referrer,
          'mpa': true,
          'ssl': false,
          'yl2': false,
          'url': 'https://www.example.com/index.html',
          'bids': [{
            'sid': 'NDA=',
            'bid': 'bid1',
            'viz': true,
            'ban': {
              'siz': [[300, 600], [160, 60]]
            }
          }, {
            'sid': 'ODA=',
            'bid': 'bid2',
            'viz': true,
            'ban': {
              'siz': [[728, 90]]
            }
          }],
          'ver': {},
          'user': {
            'euids': userIds
          }
        };

        // trim away fields with undefined
        const actualJsonPayload = JSON.parse(JSON.stringify(serverRequestInfo.data));

        assert.deepEqual(actualJsonPayload, expectedJsonPayload);

        generateUUIDStub.restore();
      });

      describe('and metatag is available', () => {
        it('should have expected global key values', () => {
          win.SDG = buildFakeSDGForGlobalKeyValues({
            adset: ['brsl'],
            browserapp: ['chrome'],
          });

          const bidReq = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.deepEqual(serverRequestInfo.data.kvg, {
            adset: ['brsl'],
            browserapp: ['chrome'],
          });
        });

        it('should filter out invalid global key values', () => {
          win.SDG = buildFakeSDGForGlobalKeyValues({
            validString: ['brsl'],
            validNumber: [1],
            validMixed: ['brsl', 1],
            invalidOne: [true],
            invalidTwo: [['string']],
            invalidThree: [[1]],
            invalidFour: {a: 1},
            invalidFive: [{a: 1}],
            invalidSix: true,
            invalidSeven: 'string',
            invalidEight: 1,
          });

          const bidReq = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.deepEqual(serverRequestInfo.data.kvg, {
            validString: ['brsl'],
            validNumber: [1],
            validMixed: ['brsl', 1],
          });
        });

        function buildFakeSDGForGlobalKeyValues(keyValues) {
          return {
            Publisher: {
              getConfig: function () {
                return {
                  getFilteredKeyValues: function () {
                    return keyValues;
                  }
                }
              }
            }
          }
        }

        it('should have expected local key values', () => {
          win.SDG = buildFakeSDGForLocalKeyValues({
            'div-1': {
              as: ['banner'],
              hb_unit: ['banner'],
              pc: ['1'],
            },
            'div-2': {
              as: ['bannerer'],
              hb_unit: ['bannerer'],
              pc: ['2'],
            }
          });

          const bidReq = buildBidderRequest();
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.deepEqual(serverRequestInfo.data.bids[0].kvl, {
            as: ['banner'],
            hb_unit: ['banner'],
            pc: ['1'],
          });

          assert.deepEqual(serverRequestInfo.data.bids[1].kvl, {
            as: ['bannerer'],
            hb_unit: ['bannerer'],
            pc: ['2'],
          });
        });

        it('should filter out invalid local key values', () => {
          win.SDG = buildFakeSDGForLocalKeyValues({
            'div-1': {
              validString: ['brsl'],
              validNumber: [1],
              validMixed: ['brsl', 1],
              invalidOne: [true],
              invalidTwo: [['string']],
              invalidThree: [[1]],
              invalidFour: {a: 1},
              invalidFive: [{a: 1}],
              invalidSix: true,
              invalidSeven: 'string',
              invalidEight: 1,
            }
          });

          const bidReq = buildBidderRequest();
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.deepEqual(serverRequestInfo.data.bids[0].kvl, {
            validString: ['brsl'],
            validNumber: [1],
            validMixed: ['brsl', 1],
          });
        });

        function buildFakeSDGForLocalKeyValues(localTargeting) {
          return {
            getCN: function () {
              return {
                getSlotByPosition: function (position) {
                  return {
                    getFilteredKeyValues: () => localTargeting[position]
                  };
                }
              };
            }
          }
        }

        it('should have expected context', () => {
          win.SDG = buildFakeSDGContext({
            'div-1': {
              adUnits: ['adUnit-1', 'adUnit-2'],
              zone: 'zone-1',
              pageType: 'pageType-1'
            },
            'div-2': {
              adUnits: ['adUnit-3', 'adUnit-4', 'adUnit-5'],
              zone: 'zone-2',
              pageType: 'pageType-2'
            }
          });
          const bidReq = buildBidderRequest();

          win.YLHH = buildFakeYLHH({
            '137': 'div-1',
            '248': 'div-2'
          });

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.deepEqual(serverRequestInfo.data.bids[0].ctx, {
            'position': 'div-1',
            'adUnits': ['adUnit-1', 'adUnit-2'],
            'zone': 'zone-1',
            'pageType': 'pageType-1'
          });

          assert.deepEqual(serverRequestInfo.data.bids[1].ctx, {
            'position': 'div-2',

            'adUnits': ['adUnit-3', 'adUnit-4', 'adUnit-5'],
            'zone': 'zone-2',
            'pageType': 'pageType-2'
          });

          function buildFakeSDGContext(config) {
            return {
              getCN: function () {
                return {
                  getSlotByPosition: function (position) {
                    return {
                      getAdUnits: function () {
                        return config[position].adUnits;
                      },
                      getZone: function () {
                        return config[position].zone;
                      },
                      getPageType: function () {
                        return config[position].pageType;
                      },
                    };
                  }
                };
              }
            }
          }
        });
      });

      it('should handle banner sizes for pre version 3', () => {
        // Version 3 changes the way how banner sizes are accessed.
        // We can support backwards compatibility with version 2.x
        const bidReq = buildBidderRequestPreVersion3();
        const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
        assert.deepEqual(serverRequestInfo.data.bids[0].ban.siz, [[300, 600], [160, 60]]);
        assert.deepEqual(serverRequestInfo.data.bids[1].ban.siz, [[728, 90]]);
      });

      describe('video bids', () => {
        it('should be able to build instream video bid', () => {
          bidderRequest.bids = [{
            bidId: 'bid1',
            bidder: 'stroeerCore',
            adUnitCode: 'div-1',
            mediaTypes: {
              video: {
                context: 'instream',
                playerSize: [640, 480],
                mimes: ['video/mp4', 'video/quicktime']
              }
            },
            params: {
              sid: 'NDA='
            },
            userId: userIds
          }];

          const expectedBids = [{
            'sid': 'NDA=',
            'bid': 'bid1',
            'viz': true,
            'vid': {
              'ctx': 'instream',
              'siz': [640, 480],
              'mim': ['video/mp4', 'video/quicktime']
            }
          }];

          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest)[0];

          const bids = JSON.parse(JSON.stringify(serverRequestInfo.data.bids));
          assert.deepEqual(bids, expectedBids);
        });
      });

      describe('when Metatag is not present on webpage', () => {
        it('should not build context into bid property ctx', () => {
          win.SDG = undefined;

          const bidReq = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.isUndefined(serverRequestInfo.data.bids[0].ctx);
        });
      });

      describe('optional fields', () => {
        describe('version fields', () => {
          let pbVerStub
          let mtVerStub

          beforeEach(() => {
            pbVerStub = sinon.stub(prebidGlobal, 'getGlobal')
            win.SDG = {version: () => {
              return ''
            }}
            mtVerStub = sinon.stub(win.SDG, 'version')
          });

          afterEach(() => {
            pbVerStub.restore()
            mtVerStub.restore()
          });

          it('gets version variables', () => {
            pbVerStub.returns({version: '1.2'});
            mtVerStub.returns('1.8');
            win.YLHH.bidder.settings = {version: '1.1'};
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'yl': '1.1', 'pb': '1.2', 'mt': '1.8'});
          });
          it('functions with no pb value', () => {
            pbVerStub.returns({version: undefined});
            win.YLHH.bidder.settings = {version: '1.1'};
            mtVerStub.returns('1.8');
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'yl': '1.1', 'pb': undefined, 'mt': '1.8'});
          });
          it('functions with no yl value', () => {
            pbVerStub.returns({version: '2'});
            mtVerStub.returns('1.8');
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'pb': '2', 'yl': undefined, 'mt': '1.8'});
          });
          it('functions with no mt value', () => {
            pbVerStub.returns({version: '1.2'});
            win.YLHH.bidder.settings = {version: '1.1'};
            mtVerStub.returns(undefined);
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'yl': '1.1', 'pb': '1.2', 'mt': undefined});
          });
          it('functions with no mt version function', () => {
            pbVerStub.returns({version: '1.2'});
            win.YLHH.bidder.settings = {version: '1.1'};
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'yl': '1.1', 'pb': '1.2', 'mt': undefined});
          });
          it('functions with no values', () => {
            pbVerStub.returns({version: undefined});
            const bidReq = buildBidderRequest();
            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
            assert.deepEqual(serverRequestInfo.data.ver, {'yl': undefined, 'pb': undefined, 'mt': undefined});
          });
        });
        it('should use ssat value from config', () => {
          const bidReq = buildBidderRequest();
          bidReq.bids.length = 1;
          bidReq.bids[0].params.ssat = 99;
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.equal(serverRequestInfo.data.ssat, 99);
        });

        it('yl2 defaults to false', () => {
          const bidReq = buildBidderRequest();
          bidReq.bids.length = 1;
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.equal(serverRequestInfo.data.yl2, false);
        });

        it('should use yl2 value from config', () => {
          const bidReq = buildBidderRequest();
          bidReq.bids.length = 1;
          bidReq.bids[0].params.yl2 = true;
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.equal(serverRequestInfo.data.yl2, true);
        });

        it('should use yl2 value from localStorage', () => {
          localStorage.sdgYieldtest = '1';
          const bidReq = buildBidderRequest();
          bidReq.bids.length = 1;
          bidReq.bids[0].params.yl2 = false;
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.equal(serverRequestInfo.data.yl2, true);
        });

        it('should not have ssat by default', () => {
          const bidReq = buildBidderRequest();
          bidReq.bids.length = 1;
          delete bidReq.bids[0].params.ssat;
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.isUndefined(serverRequestInfo.data.ssat);
        });

        it('should skip viz field when unable to determine visibility of placement', () => {
          placementElements.length = 0;
          const bidReq = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.lengthOf(serverRequestInfo.data.bids, 2);

          for (let bid of serverRequestInfo.data.bids) {
            assert.isUndefined(bid.viz);
          }
        });

        it('should skip ref field when unable to determine document referrer', () => {
          // i.e., empty if user came from bookmark, or web page using 'rel="noreferrer" on link, etc
          buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest)[0];
          assert.lengthOf(serverRequestInfo.data.bids, 2);

          for (let bid of serverRequestInfo.data.bids) {
            assert.isUndefined(bid.ref);
          }
        });

        const gdprSamples = [
          {consentString: 'RG9ua2V5IEtvbmc=', gdprApplies: true},
          {consentString: 'UGluZyBQb25n', gdprApplies: false},
          {consentString: undefined, gdprApplies: true},
          {consentString: undefined, gdprApplies: false},
          {consentString: undefined, gdprApplies: undefined},
        ];
        gdprSamples.forEach((sample) => {
          it(`should add GDPR info ${JSON.stringify(sample)} when provided`, () => {
            const bidReq = buildBidderRequest();
            bidReq.gdprConsent = sample;

            const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

            const actualGdpr = serverRequestInfo.data.gdpr;
            assert.propertyVal(actualGdpr, 'applies', sample.gdprApplies);
            assert.propertyVal(actualGdpr, 'consent', sample.consentString);
          });
        });

        it(`should not add GDPR info when not provided`, () => {
          const bidReq = buildBidderRequest();

          delete bidReq.gdprConsent;

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          assert.notProperty(serverRequestInfo.data, 'gdpr');
        });

        it('should send contents of yieldlove_ab global object if it is available', () => {
          win.yieldlove_ab = {
            foo: 'bar',
            xyz: 123
          }

          const bidReq = buildBidderRequest();
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          const abTestingKeyValues = serverRequestInfo.data.ab;

          assert.lengthOf(Object.keys(abTestingKeyValues), 2);
          assert.propertyVal(abTestingKeyValues, 'foo', 'bar');
          assert.propertyVal(abTestingKeyValues, 'xyz', 123);
        });

        it('should be able to build without third party user id data', () => {
          const bidReq = buildBidderRequest();
          bidReq.bids.forEach(bid => delete bid.userId);
          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.lengthOf(serverRequestInfo.data.bids, 2);
          assert.notProperty(serverRequestInfo, 'uids');
        });

        it('should add schain if available', () => {
          const schain = Object.freeze({
            ver: '1.0',
            complete: 1,
            'nodes': [
              {
                asi: 'exchange1.com',
                sid: 'ABC',
                hp: 1,
                rid: 'bid-request-1',
                name: 'publisher',
                domain: 'publisher.com'
              }
            ]
          });

          const bidReq = buildBidderRequest();
          bidReq.bids.forEach(bid => bid.schain = schain);

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];
          assert.deepEqual(serverRequestInfo.data.schain, schain);
        });

        it('should add floor info to banner bid request if floor is available', () => {
          const bidReq = buildBidderRequest();

          const getFloorStub1 = sinon.stub();
          const getFloorStub2 = sinon.stub();

          getFloorStub1.onFirstCall().returns({currency: 'TRY', floor: 0.7});
          getFloorStub1.onSecondCall().returns({currency: 'TRY', floor: 1.3});
          getFloorStub1.onThirdCall().returns({currency: 'TRY', floor: 2.5});

          getFloorStub2.onFirstCall().returns({currency: 'USD', floor: 1.2});
          getFloorStub2.onSecondCall().returns({currency: 'USD', floor: 1.85});

          bidReq.bids[0].getFloor = getFloorStub1;
          bidReq.bids[1].getFloor = getFloorStub2;

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          const serverRequestBids = serverRequestInfo.data.bids;
          const firstBid = serverRequestBids[0];
          const secondBid = serverRequestBids[1];

          assert.nestedPropertyVal(firstBid, 'ban.fp.def', 0.7);
          assert.nestedPropertyVal(firstBid, 'ban.fp.cur', 'TRY');
          assert.deepNestedPropertyVal(firstBid, 'ban.fp.siz', [{w: 300, h: 600, p: 1.3}, {w: 160, h: 60, p: 2.5}]);

          assert.isTrue(getFloorStub1.calledWith({currency: 'EUR', mediaType: 'banner', size: '*'}));
          assert.isTrue(getFloorStub1.calledWith({currency: 'EUR', mediaType: 'banner', size: [300, 600]}));
          assert.isTrue(getFloorStub1.calledWith({currency: 'EUR', mediaType: 'banner', size: [160, 60]}));
          assert.isTrue(getFloorStub1.calledThrice);

          assert.nestedPropertyVal(secondBid, 'ban.fp.def', 1.2);
          assert.nestedPropertyVal(secondBid, 'ban.fp.cur', 'USD');
          assert.deepNestedPropertyVal(secondBid, 'ban.fp.siz', [{w: 728, h: 90, p: 1.85}]);

          assert.isTrue(getFloorStub2.calledWith({currency: 'EUR', mediaType: 'banner', size: '*'}));
          assert.isTrue(getFloorStub2.calledWith({currency: 'EUR', mediaType: 'banner', size: [728, 90]}));
          assert.isTrue(getFloorStub2.calledTwice);
        });

        it('should add floor info to video bid request if floor is available', () => {
          const bidReq = buildBidderRequest();

          const getFloorStub1 = sinon.stub();
          const getFloorStub2 = sinon.stub();

          getFloorStub1.onFirstCall().returns({currency: 'NZD', floor: 3.25});
          getFloorStub1.onSecondCall().returns({currency: 'NZD', floor: 4.10});
          getFloorStub2.onFirstCall().returns({currency: 'GBP', floor: 4.75});
          getFloorStub2.onSecondCall().returns({currency: 'GBP', floor: 6.50});

          delete bidReq.bids[0].mediaTypes.banner;
          bidReq.bids[0].mediaTypes.video = {
            playerSize: [640, 480],
            context: 'instream'
          };

          delete bidReq.bids[1].mediaTypes.banner;
          bidReq.bids[1].mediaTypes.video = {
            playerSize: [1280, 720],
            context: 'outstream'
          };

          bidReq.bids[0].getFloor = getFloorStub1;
          bidReq.bids[1].getFloor = getFloorStub2;

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          const serverRequestBids = serverRequestInfo.data.bids;
          const firstBid = serverRequestBids[0];
          const secondBid = serverRequestBids[1];

          assert.nestedPropertyVal(firstBid, 'vid.fp.def', 3.25);
          assert.nestedPropertyVal(firstBid, 'vid.fp.cur', 'NZD');
          assert.deepNestedPropertyVal(firstBid, 'vid.fp.siz', [{w: 640, h: 480, p: 4.10}]);

          assert.isTrue(getFloorStub1.calledWith({currency: 'EUR', mediaType: 'video', size: '*'}));
          assert.isTrue(getFloorStub1.calledWith({currency: 'EUR', mediaType: 'video', size: [640, 480]}));
          assert.isTrue(getFloorStub1.calledTwice);

          assert.nestedPropertyVal(secondBid, 'vid.fp.def', 4.75);
          assert.nestedPropertyVal(secondBid, 'vid.fp.cur', 'GBP');
          assert.deepNestedPropertyVal(secondBid, 'vid.fp.siz', [{w: 1280, h: 720, p: 6.50}]);

          assert.isTrue(getFloorStub2.calledWith({currency: 'EUR', mediaType: 'video', size: '*'}));
          assert.isTrue(getFloorStub2.calledWith({currency: 'EUR', mediaType: 'video', size: [1280, 720]}));
          assert.isTrue(getFloorStub2.calledTwice);
        });

        it('should not add floor info to bid request if floor is unavailable', () => {
          const bidReq = buildBidderRequest();
          const getFloorSpy = sinon.spy(() => ({}));

          delete bidReq.bids[0].getFloor;
          bidReq.bids[1].getFloor = getFloorSpy;

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          const serverRequestBids = serverRequestInfo.data.bids;
          const firstBid = serverRequestBids[0];
          const secondBid = serverRequestBids[1];

          assert.nestedPropertyVal(firstBid, 'ban.fp', undefined);
          assert.nestedPropertyVal(secondBid, 'ban.fp', undefined);

          assert.isTrue(getFloorSpy.calledWith({currency: 'EUR', mediaType: 'banner', size: '*'}));
          assert.isTrue(getFloorSpy.calledWith({currency: 'EUR', mediaType: 'banner', size: [728, 90]}));
          assert.isTrue(getFloorSpy.calledTwice);
        });

        it('should not add floor info for a size when it is the same as the default', () => {
          const bidReq = buildBidderRequest();
          const getFloorStub = sinon.stub();

          getFloorStub.onFirstCall().returns({currency: 'EUR', floor: 1.9});
          getFloorStub.onSecondCall().returns({currency: 'EUR', floor: 1.9});
          getFloorStub.onThirdCall().returns({currency: 'EUR', floor: 2.7});

          bidReq.bids[0].getFloor = getFloorStub;

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          const serverRequestBids = serverRequestInfo.data.bids;
          const bid = serverRequestBids[0];

          assert.nestedPropertyVal(bid, 'ban.fp.def', 1.9);
          assert.nestedPropertyVal(bid, 'ban.fp.cur', 'EUR');
          assert.deepNestedPropertyVal(bid, 'ban.fp.siz', [{w: 160, h: 60, p: 2.7}]);
        });

        it('should add all user data if available', () => {
          const bidReq = buildBidderRequest();

          const ortb2 = {
            user: {
              data: [
                {
                  name: 'example-site.com',
                  ext: {
                    segtax: '1',
                    segclass: '123'
                  },
                  segment: [{id: '12'}, {id: '10'}]
                },
                {
                  name: 'example-provider.com',
                  segment: [{
                    id: '2',
                    name: 'name',
                    value: 'value',
                    ext: {
                      xyz: 'abc'
                    }
                  }]
                }
              ]
            }
          }

          bidReq.ortb2 = utils.deepClone(ortb2);

          const serverRequestInfo = spec.buildRequests(bidReq.bids, bidReq)[0];

          const actualUserData = serverRequestInfo.data.user.data;
          const expectedUserData = ortb2.user.data;

          assert.deepEqual(actualUserData, expectedUserData);
        })
      });

      describe('Split bid requests', () => {
        describe(`should create separate request per ssat & video combo`, () => {
          const videoSsatSamples = [undefined, 1, 2];
          videoSsatSamples.forEach(ssat => {
            it(`should create separate request for video when its ssat=${ssat}`, () => {
              const videoBid = {
                bidId: 'bid3',
                bidder: 'stroeerCore',
                adUnitCode: 'div-1',
                mediaTypes: {
                  video: {
                    context: 'instream',
                    playerSize: [640, 480],
                    mimes: ['video/mp4', 'video/quicktime'],
                  }
                },
                params: {
                  sid: 'ODA=',
                  ssat: ssat
                },
                userId: userIds
              }

              const bannerBid1 = {
                bidId: 'bid8',
                bidder: 'stroeerCore',
                adUnitCode: 'div-2',
                mediaTypes: {
                  banner: {
                    sizes: [[300, 600], [160, 60]],
                  }
                },
                params: {
                  sid: 'NDA=',
                  ssat: 1
                },
                userId: userIds
              }

              const bannerBid2 = {
                bidId: 'bid12',
                bidder: 'stroeerCore',
                adUnitCode: 'div-3',
                mediaTypes: {
                  banner: {
                    sizes: [[100, 200], [300, 500]],
                  }
                },
                params: {
                  sid: 'ABC=',
                  ssat: 2
                },
                userId: userIds
              }

              bidderRequest.bids = [bannerBid1, videoBid, bannerBid2];

              const expectedBanner1Bid = [
                {
                  'sid': 'NDA=',
                  'bid': 'bid8',
                  'viz': true,
                  'ban': {
                    'siz': [[300, 600], [160, 60]]
                  }
                }
              ];

              const expectedVideoBid = [
                {
                  'sid': 'ODA=',
                  'bid': 'bid3',
                  'viz': true,
                  'vid': {
                    'ctx': 'instream',
                    'siz': [640, 480],
                    'mim': ['video/mp4', 'video/quicktime']
                  }
                }
              ];

              const expectedbanner2Bid = [
                {
                  'sid': 'ABC=',
                  'bid': 'bid12',
                  'ban': {
                    'siz': [[100, 200], [300, 500]]
                  }
                }
              ];

              const serverRequestInfos = spec.buildRequests(bidderRequest.bids, bidderRequest);
              assert.lengthOf(serverRequestInfos, 3);

              const banner1ServerRequestInfo = serverRequestInfos[0];
              assert.equal(banner1ServerRequestInfo.data.ssat, 1);

              const banner2ServerRequestInfo = serverRequestInfos[1];
              assert.equal(banner2ServerRequestInfo.data.ssat, 2);

              const videoServerRequestInfo = serverRequestInfos[2];
              assert.equal(videoServerRequestInfo.data.ssat, ssat);

              assert.deepEqual(JSON.parse(JSON.stringify(banner1ServerRequestInfo.data.bids)), expectedBanner1Bid);
              assert.deepEqual(JSON.parse(JSON.stringify(banner2ServerRequestInfo.data.bids)), expectedbanner2Bid);
              assert.deepEqual(JSON.parse(JSON.stringify(videoServerRequestInfo.data.bids)), expectedVideoBid);
            });
          });
        })
      });
    });
  });

  describe('interpret response entry point', () => {
    it('should have \"interpretResponse\" function', () => {
      assert.isFunction(spec.interpretResponse);
    });

    const invalidResponses = ['', '  ', ' ', undefined, null];
    invalidResponses.forEach(sample => {
      it('should ignore invalid responses (\"' + sample + '\") response', () => {
        const result = spec.interpretResponse({body: sample});
        assert.isArray(result);
        assert.lengthOf(result, 0);
      });
    });

    it('should call endpoint when it exists', () => {
      fakeServer.respondWith('');
      spec.interpretResponse({body: buildBidderResponseWithTep()});
      fakeServer.respond();

      assert.equal(fakeServer.requests.length, 1);
      const request = fakeServer.requests[0];

      assert.equal(request.method, 'GET');
      assert.equal(request.url, '//hb.adscale.de/sspReqId/5f465360-cb11-44ee-b0be-b47a4f583521/39000');
    });

    it('should not call endpoint when endpoint field not present', () => {
      fakeServer.respondWith('');
      spec.interpretResponse({body: buildBidderResponse()});
      fakeServer.respond();

      assert.equal(fakeServer.requests.length, 0);
    });

    it('should ignore legacy (prebid < 1.0) redirect', () => {
      // Old workaround for CORS/Ajax/Redirect issues on a few browsers
      const legacyRedirect = {redirect: 'http://somewhere.com/over'};
      assert.throws(() => spec.interpretResponse({body: legacyRedirect}));
    });

    it('should interpret a standard response', () => {
      const bidderResponse = buildBidderResponse();

      const result = spec.interpretResponse({body: bidderResponse});
      assertStandardFieldsOnBannerBid(result[0], 'bid1', '<div>tag1</div>', 300, 600, 4);
      // default custom values
      assertCustomFieldsOnBid(result[0], 0, 4, undefined, undefined, '<div>tag1</div>', 4, {'brandId': 123}, undefined);

      assertStandardFieldsOnBannerBid(result[1], 'bid2', '<div>tag2</div>', 728, 90, 7.3);
      // default custom values
      assertCustomFieldsOnBid(result[1], 0, 7.3, undefined, undefined, '<div>tag2</div>', 7.3, undefined);
    });

    it('should interpret a video response', () => {
      const bidderResponse = buildBidderResponseWithVideo();
      const bidResponses = spec.interpretResponse({body: bidderResponse});
      let videoBidResponse = bidResponses[0];
      assertStandardFieldsOnVideoBid(videoBidResponse, 'bid1', '<vast>video</vast>', 800, 250, 4);
      assertCustomFieldsOnBid(videoBidResponse, 0, 4, undefined, undefined, undefined, 4, undefined);
    })

    it('should interpret a first price response', () => {
      const bidderResponse = buildBidderResponseSecondPriceAuction();

      const result = spec.interpretResponse({body: bidderResponse});
      assertStandardFieldsOnBannerBid(result[0], 'bid1', '<div>tag1</div>', 300, 600, 4);
      assertCustomFieldsOnBid(result[0], 3.8, 2.0, 1.0, 'www.something.com', '<div>tag1</div>', 2.38, undefined);

      assertStandardFieldsOnBannerBid(result[1], 'bid2', '<div>tag2</div>', 728, 90, 7.3);
      assertCustomFieldsOnBid(result[1], 0, 1.0, 0.8, 'www.something-else.com', '<div>tag2</div>', 7.3, undefined);
    });

    it('should default floor to same value as cpm and default cpm2 to 0', () => {
      const bidderResponse = buildBidderResponse();
      assert.isUndefined(bidderResponse.bids[0].floor);
      assert.isUndefined(bidderResponse.bids[0].cpm2);
      assert.isUndefined(bidderResponse.bids[1].floor);
      assert.isUndefined(bidderResponse.bids[1].cpm2);

      const result = spec.interpretResponse({body: bidderResponse});

      assert.propertyVal(result[0], 'cpm2', 0);
      assert.propertyVal(result[0], 'floor', 4.0);

      assert.propertyVal(result[1], 'cpm2', 0);
      assert.propertyVal(result[1], 'floor', 7.3);
    });

    it('should extend bid with bidPriceOptimisation fields if provided', () => {
      const bidderResponse = buildBidderResponseWithBidPriceOptimisation();

      const result = spec.interpretResponse({body: bidderResponse});
      assertStandardFieldsOnBannerBid(result[0], 'bid1', '<div>tag1</div>', 300, 600, 4);
      assert.propertyVal(result[0], 'cp', 4);
      result[0].should.include.keys('rop');
      assert.propertyVal(result[0], 'ropFactor', 1.2)
    });

    it('should default cpm, width and height fields to 0 and include bidPriceOptimisation fields if provided and no bids', () => {
      const bidderResponse = buildBidderResponseWithBidPriceOptimisationButNoBids();

      const result = spec.interpretResponse({body: bidderResponse});
      assert.propertyVal(result[0], 'requestId', 'bid1');
      assert.propertyVal(result[0], 'cp', 4);
      result[0].should.include.keys('rop');
      assert.propertyVal(result[0], 'ropFactor', 1.2)
    });

    it('should add data to meta object', () => {
      const response = buildBidderResponse();
      response.bids[0] = Object.assign(response.bids[0], {adomain: ['website.org', 'domain.com']});
      const result = spec.interpretResponse({body: response});
      assert.deepPropertyVal(result[0], 'meta', {advertiserDomains: ['website.org', 'domain.com']});
      // nothing provided for the second bid
      assert.deepPropertyVal(result[1], 'meta', {advertiserDomains: undefined});
    });

    describe('should add generateAd method on bid object', () => {
      const externalEncTests = [// full price text
        {
          price: '1.570000',
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5DxfESCHg5CTVFw'
        },
        // partial price text
        {
          price: '1.59',
          bidId: '123456789123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg'
        },
        // large bidId will be trimmed (> 16 characters)
        {
          price: '1.59',
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg'
        },
        // small bidId will be padded (< 16 characters)
        {price: '1.59', bidId: '123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MDAwMDAwMDJGF0WFzgb7CQC2Nw'},
        // float instead of text
        {
          price: 1.59,
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg'
        },
        // long price after applying exchange rate: 12.03 * 0.32 = 3.8495999999999997 (use 3.8496)
        {
          price: 12.03,
          bidId: '123456789123456789',
          exchangeRate: 0.32,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N865AhTNThHQOG035A'
        },
        // long price after applying exchange rate: 22.23 * 0.26 = 5.779800000000001 (use 5.7798)
        {
          price: 22.23,
          bidId: '123456789123456789',
          exchangeRate: 0.26,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N8i5DRfNQBHQ4_a0lA'
        },
        // somehow empty string for price
        {
          price: '',
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N_2XOiD0eBHQUWJCcw'
        }, // handle zero
        {
          price: 0,
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2N82XOiD0eBHQdRlVNg'
        }];
      externalEncTests.forEach(test => {
        it(`should replace \${AUCTION_PRICE:ENC} macro with ${test.expectation} given auction price ${test.price} and exchange rate ${test.exchangeRate}`,
          () => {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.exchangeRate = test.exchangeRate;
            responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';
            responseBid.bidId = test.bidId;

            const result = spec.interpretResponse({body: bidderResponse});

            const bid = result[0];
            // Prebid will do this
            bid.adId = test.bidId;

            const ad = bid.generateAd({auctionPrice: test.price});

            const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
            const encryptedPrice = rx.exec(ad);
            assert.equal(encryptedPrice[1], test.expectation);
          });
      });

      const internalEncTests = [// full price text
        {
          price: '1.570000',
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny0i6OIZLp-4uQ97nA'
        },
        // ignore exchange rate
        {
          price: '1.570000',
          bidId: '123456789123456789',
          exchangeRate: 0.5,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny0i6OIZLp-4uQ97nA'
        },
        // partial price text
        {
          price: '2.945',
          bidId: '123456789123456789',
          exchangeRate: 1.0,
          expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny4i5OEcHq-I-FhZIg'
        }
        // not all combos required. Already tested on other macro (white box testing approach)
      ];
      internalEncTests.forEach(test => {
        it(`should replace \${SSP_AUCTION_PRICE:ENC} macro with ${test.expectation} given auction price ${test.price} with exchange rate ${test.exchangeRate} ignored`,
          () => {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.exchangeRate = test.exchangeRate;
            responseBid.ad = '<img src=\'tracker.com?p=${SSP_AUCTION_PRICE:ENC}></img>';
            responseBid.bidId = test.bidId;

            const result = spec.interpretResponse({body: bidderResponse});

            const bid = result[0];
            // Prebid will do this
            bid.adId = test.bidId;

            const ad = bid.generateAd({auctionPrice: test.price});

            const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
            const encryptedPrice = rx.exec(ad);
            assert.equal(encryptedPrice[1], test.expectation);
          });
      });

      it('should replace all occurrences of ${SPP_AUCTION_PRICE:ENC}', () => {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SSP_AUCTION_PRICE:ENC}></img>\n<script>var price=${SSP_AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE:ENC}', () => {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>\n<script>var price=${AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE}', () => {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE}></img>\n<script>var price=${AUCTION_PRICE}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        // Mimic prebid by replacing AUCTION_PRICE macros in ad. We keep the original for generateAd.
        bid.ad = bid.ad.replace(/\${AUCTION_PRICE}/g, '1.1111111');

        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22></img>\n<script>var price=40.22</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all macros at the same time', () => {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad =
          '<img src=\'tracker.com?p=${AUCTION_PRICE}&e=${AUCTION_PRICE:ENC}></img>\n<script>var price=${SSP_AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22&e=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${FIRST_BID:ENC}', () => {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${FIRST_BID:ENC}></img>\n<script>var price=${FIRST_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', firstBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${FIRST_BID:ENC} with empty string if no first bid', () => {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${FIRST_BID:ENC}></img>\n<script>var price=${FIRST_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad1 = bid.generateAd({auctionPrice: '40.22'});
        const ad2 = bid.generateAd({auctionPrice: '40.22', firstBid: null});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad1, expectedAd);
        assert.equal(ad2, expectedAd);
      });

      it('should replace all occurrences of ${SECOND_BID:ENC}', () => {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SECOND_BID:ENC}></img>\n<script>var price=${SECOND_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', secondBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${THIRD_BID:ENC}', () => {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${THIRD_BID:ENC}></img>\n<script>var price=${THIRD_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', thirdBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${SECOND_BID:ENC} with empty string if no second bid', () => {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SECOND_BID:ENC}></img>\n<script>var price=${SECOND_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad1 = bid.generateAd({auctionPrice: '40.22'});
        const ad2 = bid.generateAd({auctionPrice: '40.22', secondBid: null});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad1, expectedAd);
        assert.equal(ad2, expectedAd);
      });

      it('should replace all occurrences of ${THIRD_BID:ENC} with empty string if no second bid', () => {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${THIRD_BID:ENC}></img>\n<script>var price=${THIRD_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad1 = bid.generateAd({auctionPrice: '40.22'});
        const ad2 = bid.generateAd({auctionPrice: '40.22', thirdBid: null});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad1, expectedAd);
        assert.equal(ad2, expectedAd);
      });

      describe('price truncation in generateAd', function () {
        const d = new Decrpyter('c2xzRWh5NXhpZmxndTRxYWZjY2NqZGNhTW1uZGZya3Y=');
        const validPrices = [{price: '1.5700000', expectation: '1.570000'}, {
          price: '12345678',
          expectation: '12345678'
        },
        {price: '1234.56789', expectation: '1234.567'}, {price: '12345.1234', expectation: '12345.12'},
        {price: '123456.10', expectation: '123456.1'}, {price: '123456.105', expectation: '123456.1'},
        {price: '1234567.0052', expectation: '1234567'}, ];
        validPrices.forEach(test => {
          it(`should safely truncate ${test.price} to ${test.expectation}`, () => {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

            const result = spec.interpretResponse({body: bidderResponse});
            const bid = result[0];
            // Prebid will do this
            bid.adId = '123456789123456789';

            const ad = bid.generateAd({auctionPrice: test.price});

            const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
            const encryptedPrice = rx.exec(ad);
            assert.equal(d.decrypt(encryptedPrice[1]), test.expectation);
          });
        });

        const invalidPrices = [{price: '123456789'}, {price: '123456.15'}, {price: '1234567.0152'}, {price: '1234567.1052'}];
        invalidPrices.forEach(test => {
          it(`should error when price is ${test.price}`, function () {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

            const result = spec.interpretResponse({body: bidderResponse});
            const bid = result[0];
            // Prebid will do this
            bid.adId = '123456789123456789';

            assert.throws(() => bid.generateAd({auctionPrice: test.price}), Error);
          });
        });
      });
    });
  });

  describe('get user syncs entry point', () => {
    let win;

    beforeEach(() => {
      win = setupSingleWindow(sandbox);

      // fake
      win.document.createElement = function () {
        const attrs = {};
        return {
          setAttribute: (name, value) => {
            attrs[name] = value
          },
          getAttribute: (name) => attrs[name],
          hasAttribute: (name) => attrs[name] !== undefined,
          tagName: 'SCRIPT',
        }
      }
    });

    function prepForUserConnect(customUserConnectJsUrl = '') {
      const bidReq = buildBidderRequest();
      assert.equal(bidReq.bids[0].params.sid, 'NDA=');

      if (customUserConnectJsUrl) {
        bidReq.bids[0].params.connectjsurl = customUserConnectJsUrl;
      }

      // To get a slot id
      spec.buildRequests(bidReq.bids, bidReq);

      sandbox.stub(utils, 'insertElement');
    }

    function assertConnectJs(actualElement, expectedUrl, expectedSlotId) {
      assert.strictEqual(actualElement.tagName, 'SCRIPT');
      assert.strictEqual(actualElement.src, expectedUrl);

      if (expectedSlotId) {
        const config = JSON.parse(actualElement.getAttribute('data-container-config'));
        assert.equal(config.slotId, expectedSlotId);
      } else {
        assert.isFalse(actualElement.hasAttribute('data-container-config'));
      }
    }

    it('should have \"getUserSyncs\" function', () => {
      assert.isFunction(spec.getUserSyncs);
    });

    it('should perform user connect when there was a response', () => {
      prepForUserConnect();

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, 'https://js.adscale.de/userconnect.js', 'NDA=');
    });

    it('should still perform user connect when no sid found', () => {
      sandbox.stub(utils, 'insertElement');

      win.top.stroeerCore = {};

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, 'https://js.adscale.de/userconnect.js');
    });

    it('should not perform user connect when there was no response', () => {
      prepForUserConnect();
      spec.getUserSyncs({}, []/* empty, zero-length array */);
      assert.isTrue(utils.insertElement.notCalled);
    });

    it('should perform user connect using custom url', () => {
      const customUserConnectJsUrl = 'https://other.com/connect.js';
      prepForUserConnect(customUserConnectJsUrl);

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, customUserConnectJsUrl, 'NDA=');
    });
  });
});

function Decrpyter(encKey) {
  this.encKey = atob(encKey);
}

function unwebSafeBase64EncodedString(str) {
  let pad = '';
  if (str.length % 4 === 2) {
    pad += '==';
  } else if (str.length % 4 === 1) {
    pad += '=';
  }

  str = str.replace(/-/g, '+')
    .replace(/_/g, '/');

  return str + pad;
}

Decrpyter.prototype.decrypt = function (str) {
  const unencodedStr = atob(unwebSafeBase64EncodedString(str));
  const CIPHERTEXT_SIZE = 8;

  const initVector = unencodedStr.substring(0, 16);
  const cipherText = unencodedStr.substring(16, 16 + CIPHERTEXT_SIZE);
  // const signature = unencodedStr.substring(16 + CIPHERTEXT_SIZE);

  const pad = str_hmac_sha1(this.encKey, initVector);

  let unencryptedPrice = '';

  for (let i = 0; i < CIPHERTEXT_SIZE; i++) {
    let priceCharCode = cipherText.charCodeAt(i);
    const charCode = 0xff & (priceCharCode ^ convertSignedByte(pad.charCodeAt(i)));
    if (charCode === 0) {
      break;
    }
    unencryptedPrice = unencryptedPrice + String.fromCharCode(charCode);
  }

  // ignore integrity

  return unencryptedPrice;
};

function convertSignedByte(value) {
  if (value >= 128) {
    return value - 256;
  } else {
    return value;
  }
}

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
