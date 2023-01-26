const ObjC = require('frida-objc-bridge');

const {
  LSApplicationProxy,
  NSAutoreleasePool,
  NSNumber,
  NSString,
} = ObjC.classes;

const NO = 0;

const sbs = importSpringBoardServices();
const pidPtr = Memory.alloc(4);

rpc.exports = {
  enumerateApplications(identifiers, scope) {
    return performWithAutoreleasePool(() => {
      const identifier = NSString.stringWithUTF8String_(Memory.allocUtf8String('com.apple.calculator'));
      fetchAppMetadata(identifier);
      return [];
    });
  },

  _enumerateApplications(identifiers, scope) {
    console.log('identifiers:', JSON.stringify(identifiers));
    return performWithAutoreleasePool(() => {
      let identifierObjects;
      if (identifiers.length === 0) {
        const t1 = Date.now();
        try {
          identifierObjects = parseNSArray(sbs.copyApplicationDisplayIdentifiers(NO, NO));
        } catch (e) {
          console.log('Oh noes: ' + e.stack);
          return [];
        }
        const t2 = Date.now();
        console.log(`Listing took ${t2 - t1} ms`);
      } else {
        identifierObjects = identifiers.map(id => NSString.stringWithUTF8String_(Memory.allocUtf8String(id)));
      }

      const result = [];
      const t1 = Date.now();
      let nameTotal = 0;
      let pidTotal = 0;
      let paramsTotal = 0;
      for (const identifier of identifierObjects) {
        try {
          const t6 = Date.now();
          const name = sbs.copyLocalizedApplicationNameForDisplayIdentifier(identifier);
          const t7 = Date.now();

          const t8 = Date.now();
          let pid;
          if (sbs.processIDForDisplayIdentifier(identifier, pidPtr)) {
            console.log('Example: ' + identifier);
            pid = pidPtr.readU32();
          } else
            pid = 0;
          const t9 = Date.now();

          const t10 = Date.now();
          const parameters = fetchAppParameters(identifier, pid, scope);
          const t11 = Date.now();

          nameTotal += t7 - t6;
          pidTotal += t9 - t8;
          paramsTotal += t11 - t10;

          result.push([identifier.toString(), name.toString(), pid, parameters]);
        } catch (e) {
          console.log(`Skipping ${identifier.toString()}: ${e.stack}`);
        }
      }
      const t2 = Date.now();
      console.log(`Assembly took ${t2 - t1} ms (of which nameTotal=${nameTotal} pidTotal=${pidTotal} paramsTotal=${paramsTotal})`);
      return result;
    });
  }
};

function fetchAppParameters(identifier, pid, scope) {
  if (scope === 'minimal')
    return null;

  const parameters = {
    ...fetchAppMetadata(identifier),
    ...fetchAppState(pid),
  };

  if (scope === 'full') {
    const icon = sbs.copyIconImagePNGDataForDisplayIdentifier(identifier);
    if (icon !== null)
      parameters.$icon = icon.base64EncodedStringWithOptions_(0).toString();
  }

  return parameters;
}

function fetchAppMetadata(identifier) {
  const meta = {};

  const app = LSApplicationProxy.applicationProxyForIdentifier_(identifier);

  console.log('before');
  const t1 = Date.now();
  console.profile('fetch-app-metadata');

  for (let i = 0; i !== 2000; i++) {
    const version = app.shortVersionString();
    if (version !== null)
      meta.version = version.toString();

    const build = app.bundleVersion();
    if (build !== null)
      meta.build = build.toString();

    meta.path = app.bundleURL().path().toString();

    const dataPath = app.dataContainerURL();
    const containerUrls = app.groupContainerURLs();
    if (dataPath !== null || containerUrls?.count() > 0) {
      const containers = {};

      if (dataPath !== null)
        containers.data = dataPath.path().toString();

      if (containerUrls !== null) {
        for (const [key, value] of Object.entries(parseNSDictionary(containerUrls)))
          containers[key] = value.path().toString();
      }

      meta.containers = containers;
    }

    const getTaskAllow = app.entitlementValueForKey_ofClass_('get-task-allow', NSNumber);
    if (getTaskAllow?.boolValue())
      meta.debuggable = true;
    //const t3 = Date.now();
  }

  console.profileEnd();
  const t2 = Date.now();
  console.log(`Took ${t2 - t1} ms`);

  //console.log(`Query part one: ${t2 - t1} ms, part two ${t3 - t2} ms`);

  return meta;
}

function fetchAppState(pid) {
  const state = {};

  if (pid === 0)
    return state;

  const info = sbs.copyInfoForApplicationWithProcessID(pid);
  if (info === null)
    return state;

  const isFrontmost = info.valueForKey_('BKSApplicationStateAppIsFrontmost');
  if (isFrontmost.boolValue())
    state.frontmost = true;

  return state;
}

function importSpringBoardServices() {
  return [
    ['copyApplicationDisplayIdentifiers', 'pointer', ['bool', 'bool']],
    ['copyLocalizedApplicationNameForDisplayIdentifier', 'pointer', ['pointer']],
    ['processIDForDisplayIdentifier', 'bool', ['pointer', 'pointer']],
    ['copyInfoForApplicationWithProcessID', 'pointer', ['uint']],
    ['copyIconImagePNGDataForDisplayIdentifier', 'pointer', ['pointer']],
  ].reduce((api, [name, retType, argTypes]) => {
    const cname = 'SBS' + name[0].toUpperCase() + name.substring(1);
    const func = new NativeFunction(
        Module.getExportByName('/System/Library/PrivateFrameworks/SpringBoardServices.framework/SpringBoardServices', cname),
        retType,
        argTypes);

    let wrapper;
    if (name.startsWith('copy'))
      wrapper = (...args) => objcHandleToAutoreleasedWrapper(func(...args));
    else
      wrapper = func;

    api[name] = wrapper;

    return api;
  }, {});
}

function objcHandleToAutoreleasedWrapper(handle) {
  if (handle.isNull())
    return null;
  return new ObjC.Object(handle).autorelease();
}

function performWithAutoreleasePool(fn) {
  const t1 = Date.now();
  try {
  const pool = NSAutoreleasePool.alloc().init();
  try {
    return fn();
  } finally {
    pool.release();
    const t2 = Date.now();
    console.log(`Took ${t2 - t1} ms`);
  }
  } catch (e) {
    console.log('performWithAutoreleasePool() failed: ' + e.stack);
  }
}

function parseNSArray(arr) {
  const result = [];
  const count = arr.count().valueOf();
  for (let i = 0; i !== count; i++)
    result.push(arr.objectAtIndex_(i));
  return result;
}

function parseNSDictionary(dict) {
  const result = {};
  for (const key of parseNSArray(dict.allKeys()))
    result[key.toString()] = dict.valueForKey_(key);
  return result;
}

