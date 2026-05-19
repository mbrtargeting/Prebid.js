/**
 * This module provides wrapper-specific consent utilities for TCF v2 compliance.
 * It offers standardized consent checking for Yieldlove operations (vendor ID 251).
 */

import { logInfo } from '../src/utils.js'
import { getGlobal } from '../src/prebidGlobal.js'
import { config } from '../src/config.js'
import { getStorageManager } from '../src/storageManager.js'
import { MODULE_TYPE_BIDDER } from '../src/activities/modules.js'

const YIELDLOVE_VENDOR_ID = 251
const WRAPPER_MODULE_NAME = 'wrapper'

// Register wrapper module GVLID via setConfig
config.mergeConfig({
  gvlMapping: {
    [WRAPPER_MODULE_NAME]: YIELDLOVE_VENDOR_ID
  }
})

/**
 * Yieldlove Wrapper Consent Control
 * Provides standardized consent checking for Yieldlove (vendor ID 251)
 */
export const getStorageManagerPromise = new Promise((resolve) => {
  window.yieldlove_tc = window.yieldlove_tc || [];
  // Queue the storage manager creation for when CMP is ready
  window.yieldlove_tc.push(() => {
    const storageManager = getStorageManager({
      moduleType: MODULE_TYPE_BIDDER,
      moduleName: WRAPPER_MODULE_NAME
    });
    logInfo('[WrapperConsentControl] Storage manager created with consent enforcement')

    resolve(storageManager)
  });
})

// Make WrapperConsentControl available globally for wrapper components
const pbjs = getGlobal();

pbjs.WrapperConsentControl = {
  getStorageManager: getStorageManagerPromise
}

logInfo('[WrapperConsentControl] Module loaded and available globally')